import Recolector from "../models/Recolector.js";
import CollectorLocationSimulation from "../models/CollectorLocationSimulation.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import { classifyCollectorGeofenceState } from "../utils/collectorLocation.js";
import { isCollectorLocationSimulatorEnabled } from "../utils/devCollectorLocationSimulator.js";
import { isQaGeofenceOverrideAllowed } from "../utils/qaGeofence.js";
import { selectLatestCollectorLocation } from "../utils/collectorLocationSource.js";

const LOCATION_ERRORS = {
  sin_registro: {
    code: "COLLECTOR_LOCATION_REQUIRED",
    msg: "Registra una ubicación GPS actual antes de realizar esta operación.",
  },
  desactualizado: {
    code: "COLLECTOR_LOCATION_STALE",
    msg: "La ubicación GPS está desactualizada. Regístrala nuevamente.",
  },
  impreciso: {
    code: "COLLECTOR_LOCATION_INACCURATE",
    msg: "La precisión GPS es insuficiente. Vuelve a registrar tu ubicación.",
  },
  fuera: {
    code: "OUTSIDE_EPN_GEOFENCE",
    msg: "Tu ubicación GPS registrada está fuera del área autorizada de la EPN.",
  },
  inactivo: {
    code: "COLLECTOR_INACTIVE",
    msg: "La cuenta de recolector no está activa.",
  },
};

const requireCollectorGeofence = async (req, res, next) => {
  const user = req.user || req.donanteHeader;
  if (!user?._id) {
    return res.status(401).json({ msg: "No autenticado" });
  }

  try {
    const collector = await Recolector.findById(user._id)
      .select("status ubicacionGps")
      .lean();
    const simulation = isCollectorLocationSimulatorEnabled()
      ? await CollectorLocationSimulation.findOne({
          collector: user._id,
          expiresAt: { $gt: new Date() },
        }).lean()
      : null;
    const { location: gps, simulated } = selectLatestCollectorLocation(
      collector?.ubicacionGps,
      simulation
    );
    const state = classifyCollectorGeofenceState({
      collectorActive: collector?.status !== false,
      capturedAt: gps?.capturadoEn ?? gps?.capturedAt,
      latitude: gps?.latitud ?? gps?.latitude,
      longitude: gps?.longitud ?? gps?.longitude,
      accuracyMeters: gps?.precisionMetros ?? gps?.accuracyMeters,
      insideGeofence:
        gps != null
        && (gps.latitud != null
          ? isInsideEpnCampus(gps.latitud, gps.longitud)
          : gps.latitude != null
          && isInsideEpnCampus(gps.latitude, gps.longitude)),
    });

    const qaOverride =
      state === "fuera"
      && isQaGeofenceOverrideAllowed(user);
    if (state !== "dentro" && !qaOverride) {
      const error = LOCATION_ERRORS[state] ?? LOCATION_ERRORS.sin_registro;
      return res.status(state === "inactivo" ? 403 : 409).json({
        ...error,
        estadoGeografico: state,
      });
    }

    req.collectorGeofence = {
      state,
      qaOverride,
      realState: state,
      capturedAt: gps.capturadoEn ?? gps.capturedAt,
      campaignId: gps.campana ?? gps.campaign,
      pointId: gps.puntoRecoleccion ?? gps.point,
      simulated,
    };
    if (qaOverride) {
      console.warn(
        `QA geofence bypass applied to allowlisted collector ${String(user._id)}`
      );
    }
    return next();
  } catch (error) {
    console.error("Error validando la ubicación del recolector:", error.message || error);
    return res.status(500).json({
      code: "COLLECTOR_LOCATION_VALIDATION_FAILED",
      msg: "No se pudo validar la ubicación. Inténtalo nuevamente.",
    });
  }
};

export default requireCollectorGeofence;
