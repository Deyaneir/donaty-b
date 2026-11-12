import mongoose from "mongoose";
import { isCollectorAssignedToPoint } from "./pickupPoints.js";

const pointResolutionError = (message) =>
  Object.assign(new Error(message), { statusCode: 400 });

const resolverPuntoId = (
  user,
  queryPuntoId,
  campaign,
  preferredPointId = null
) => {
  const role = String(user?.rol || "").trim().toLowerCase();
  const userId = String(user?._id ?? user?.id ?? "");
  const points = campaign?.puntosRecoleccion || [];
  const assignedPoints = role === "recolector"
    ? points.filter((point) => isCollectorAssignedToPoint(point, userId))
    : [];
  const receivedPointId = queryPuntoId == null ? "" : String(queryPuntoId).trim();
  if (process.env.PICKUP_POINT_DEBUG === "true") {
    console.info("Resolviendo punto de recolección:", {
      campanaId: String(campaign?._id ?? ""),
      puntoIdRecibido: queryPuntoId ?? null,
      userId: userId || null,
      puntosAsignados: assignedPoints.map((point) => String(point._id)),
    });
  }
  const fail = (message) => {
    console.warn("No se pudo resolver el punto de recolección:", {
      campanaId: String(campaign?._id ?? ""),
      puntoIdRecibido: queryPuntoId ?? null,
      userId: userId || null,
      puntosAsignados: assignedPoints.map((point) => String(point._id)),
      mensaje: message,
    });
    throw pointResolutionError(message);
  };

  if (role === "recolector") {
    if (!assignedPoints.length) {
      return fail("El recolector no tiene punto asignado en esta campaña");
    }
    if (preferredPointId != null) {
      const preferredId = String(preferredPointId);
      if (!mongoose.isValidObjectId(preferredId)) {
        return fail(`El punto ${preferredId} no pertenece a la campaña ${campaign?._id}`);
      }
      const assignedPoint = assignedPoints.find(
        (point) => String(point._id) === preferredId
      );
      if (!assignedPoint) {
        const campaignPoint = points.some(
          (point) => String(point._id) === preferredId
        );
        return fail(
          campaignPoint
            ? `El punto ${preferredId} no está asignado al recolector en la campaña ${campaign?._id}`
            : `El punto ${preferredId} no pertenece a la campaña ${campaign?._id}`
        );
      }
      return String(assignedPoint._id);
    }
    const principal = assignedPoints.find(
      (point) =>
        String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "")
        === userId
    );
    return String((principal || assignedPoints[0])._id);
  }

  if (role !== "admin") {
    return fail("No tienes permiso para resolver el punto de recolección");
  }
  if (!receivedPointId || ["null", "undefined"].includes(receivedPointId.toLowerCase())) {
    if (points.length === 1) return String(points[0]._id);
    return fail("Debes indicar el puntoId de la campaña");
  }
  const point = mongoose.isValidObjectId(receivedPointId)
    ? points.find((item) => String(item._id) === receivedPointId)
    : null;
  if (!point) {
    return fail(`El punto ${receivedPointId} no pertenece a la campaña ${campaign?._id}`);
  }
  return String(point._id);
};

export { resolverPuntoId };
