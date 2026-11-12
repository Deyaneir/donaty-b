import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import { validateMobileRegistrationProfile } from "../utils/mobileRegistrationValidation.js";
import Campana from "../models/Campana.js";
import {
  sendMailToRecoveryPassword,
  sendMailToRecoveryPasswordMobile,
  sendMailToRegister,
  sendMailToRegisterMobile,
} from "../helpers/sendMail.js";
import {
  crearTokenJWT,
  crearRefreshToken,
  verificarRefreshToken,
} from "../middlewares/JWT.js";
import { isBlank, requireFields } from "../utils/validation.js";
import {
  buildPointCollectorAssignmentFilter,
  serializeCollectorAssignments,
} from "../utils/pickupPoints.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import {
  classifyCollectorGeofenceState,
  getCollectorGeofenceTransition,
  hasValidCollectorCoordinates,
} from "../utils/collectorLocation.js";
import CollectorLocationEvent from "../models/CollectorLocationEvent.js";
import CollectorLocation from "../models/CollectorLocation.js";
import CollectorLocationSimulation from "../models/CollectorLocationSimulation.js";
import { publishCollectorLocationEvent } from "../services/domainEvents.js";
import {
  selectLatestCollectorLocation,
  serializeCollectorLocation,
} from "../utils/collectorLocationSource.js";
import {
  createCollectorLocationScenario,
  isCollectorLocationSimulatorEnabled,
} from "../utils/devCollectorLocationSimulator.js";

const RECOVERY_TOKEN_MINUTES = 60;

const isValidToken = (token = "") =>
  typeof token === "string" && token.trim().length === 32;
const isTokenExpired = (doc) =>
  Boolean(doc?.tokenExpires && doc.tokenExpires < new Date());

const registroRecolector = async (req, res) => {
  try {
    const { nombre, apellido, direccion, telefono, email, password, origen } =
      req.body || {};
    const esMovil = origen === "movil";
    console.log("[registroRecolector] origen recibido:", origen);

    const faltantes = requireFields(req.body, [
      "nombre",
      "apellido",
      "direccion",
      "telefono",
      "email",
      "password",
    ]);
    if (faltantes.length > 0) {
      return res
        .status(400)
        .json({ msg: "Lo sentimos, debes llenar todos los campos" });
    }
    const mobileProfile = esMovil
      ? validateMobileRegistrationProfile(req.body)
      : { profile: {} };
    if (mobileProfile.error) {
      return res.status(400).json({ msg: mobileProfile.error });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const [verificarEmailBDD, verificarEmailAdmin, verificarEmailRecolector] = await Promise.all([
      Donante.findOne({ email: normalizedEmail }),
      Admin.findOne({ email: normalizedEmail }),
      Recolector.findOne({ email: normalizedEmail }),
    ]);
    if (verificarEmailBDD || verificarEmailAdmin || verificarEmailRecolector) {
      return res
        .status(400)
        .json({ msg: "Lo sentimos, el email ya se encuentra registrado" });
    }

    const nuevoRecolector = new Recolector({
      nombre,
      apellido,
      direccion: direccion ?? "",
      telefono: telefono ?? "",
      ...mobileProfile.profile,
      email: normalizedEmail,
      status: true,
      confirmEmail: false,
      aprobado: false, // pendiente de aprobación del administrador
    });
    nuevoRecolector.password = await nuevoRecolector.encryptPassword(password);

    const token = nuevoRecolector.createToken();
    nuevoRecolector.token = token;
    nuevoRecolector.confirmEmail = false;

    // Web: correo de siempre. App móvil: correo con botón que abre la app.
    const enviarCorreoRegistro = esMovil
      ? sendMailToRegisterMobile
      : sendMailToRegister;
    await enviarCorreoRegistro(normalizedEmail, token);
    await nuevoRecolector.save();

    res
      .status(200)
      .json({ msg: "Revisa tu correo electrónico para confirmar tu cuenta" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const recuperarPasswordRecolector = async (req, res) => {
  try {
    const { email, origen } = req.body || {};
    const esMovil = origen === "movil";
    if (isBlank(email))
      return res
        .status(400)
        .json({ msg: "Debes ingresar un correo electrónico" });

    const normalizedEmail = email.trim().toLowerCase();
    const recolector = await Recolector.findOne({
      email: normalizedEmail,
      rolMigradoA: null,
    });
    if (!recolector)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });

    const token = recolector.createToken();
    recolector.token = token;
    // Solo el flujo móvil expira. En la web se limpia para no heredar una fecha vieja.
    recolector.tokenExpires = esMovil
      ? new Date(Date.now() + RECOVERY_TOKEN_MINUTES * 60 * 1000)
      : null;

    const enviarCorreoRecuperacion = esMovil
      ? sendMailToRecoveryPasswordMobile
      : sendMailToRecoveryPassword;
    await enviarCorreoRecuperacion(normalizedEmail, token);
    await recolector.save();
    res.status(200).json({
      msg: "Revisa tu correo electrónico para reestablecer tu cuenta",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const comprobarTokenPasswordRecolector = async (req, res) => {
  try {
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }
    const recolector = await Recolector.findOne({ token, rolMigradoA: null });
    if (!recolector || recolector.token !== token) {
      return res
        .status(404)
        .json({ msg: "Lo sentimos, no se puede validar la cuenta" });
    }
    if (isTokenExpired(recolector)) {
      return res.status(410).json({
        msg: "El enlace para restablecer la contraseña expiró. Solicita uno nuevo",
      });
    }
    res
      .status(200)
      .json({ msg: "Token confirmado, ya puedes crear tu nuevo password" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const crearNuevoPasswordRecolector = async (req, res) => {
  try {
    const { token } = req.params;

    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }

    const {
      password,
      confirmpassword,
      confirmPassword,
      password2,
    } = req.body || {};

    const confirm =
      confirmpassword ?? confirmPassword ?? password2 ?? undefined;

    if (isBlank(password) || isBlank(confirm)) {
      return res
        .status(400)
        .json({ msg: "Debes llenar todos los campos" });
    }

    if (password !== confirm) {
      return res
        .status(400)
        .json({ msg: "Los passwords no coinciden" });
    }

    const recolector = await Recolector.findOne({ token, rolMigradoA: null });
    if (!recolector) {
      return res
        .status(404)
        .json({ msg: "No se puede validar la cuenta" });
    }
    if (isTokenExpired(recolector)) {
      return res.status(410).json({
        msg: "El enlace para restablecer la contraseña expiró. Solicita uno nuevo",
      });
    }

    recolector.token = null;
    recolector.tokenExpires = null;
    recolector.password = await recolector.encryptPassword(password);
    await recolector.save();

    res.status(200).json({
      msg: "Felicitaciones, ya puedes iniciar sesión con tu nuevo password",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const loginRecolector = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const faltantes = requireFields(req.body, ["email", "password"]);
    if (faltantes.length > 0) {
      return res
        .status(404)
        .json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const recolector = await Recolector.findOne({
      email: normalizedEmail,
    }).select("-__v -token -updatedAt -createdAt +password");
    if (!recolector)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });
    if (recolector.status === false)
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    if (!recolector.confirmEmail)
      return res
        .status(403)
        .json({ msg: "Debes verificar tu cuenta antes de iniciar sesión" });

    const verificarPassword = await recolector.matchPassword(password);
    if (!verificarPassword)
      return res.status(401).json({ msg: "El password no es correcto" });

    // Se revisa después de validar la contraseña, para no revelar el estado
    // de la cuenta a quien no tenga las credenciales.
    if (recolector.aprobado === false)
      return res.status(403).json({
        msg:
          "Tu cuenta está pendiente de aprobación del administrador. " +
          "Podrás iniciar sesión cuando sea aprobada.",
      });

    const {
      nombre,
      email: correo,
      apellido,
      direccion,
      telefono,
      _id,
      rol,
    } = recolector;
    const token = crearTokenJWT(recolector._id, recolector.rol);
    const refreshToken = crearRefreshToken(recolector._id, recolector.rol);

    res.status(200).json({
      token,
      refreshToken,
      rol,
      nombre,
      apellido,
      direccion,
      telefono,
      _id,
      correo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const refreshRecolectorSession = async (req, res) => {
  try {
    const rawToken = String(
      req.body?.refreshToken || req.headers?.authorization || ""
    ).trim();
    const refreshToken = rawToken.startsWith("Bearer ")
      ? rawToken.replace("Bearer ", "")
      : rawToken;

    if (!refreshToken) {
      return res.status(400).json({ msg: "Refresh token requerido" });
    }

    const decoded = verificarRefreshToken(refreshToken);
    const recolector = await Recolector.findById(decoded.id);
    if (!recolector) {
      return res.status(401).json({ msg: "Usuario no autorizado" });
    }
    if (recolector.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }
    if (recolector.aprobado === false) {
      return res.status(403).json({
        msg: "Tu cuenta está pendiente de aprobación del administrador.",
      });
    }

    const token = crearTokenJWT(recolector._id, recolector.rol);
    const nextRefreshToken = crearRefreshToken(recolector._id, recolector.rol);

    return res.status(200).json({
      token,
      refreshToken: nextRefreshToken,
      rol: recolector.rol,
      _id: recolector._id,
      correo: recolector.email,
    });
  } catch (error) {
    console.error("refreshRecolectorSession error:", error.message);
    return res.status(401).json({ msg: "Refresh token inválido o expirado" });
  }
};

const perfilRecolector = (req, res) => {
  const { token, confirmEmail, createdAt, updatedAt, __v, ...datosPerfil } =
    req.donanteHeader.toJSON();
  res.status(200).json(datosPerfil);
};

const actualizarPerfilRecolector = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, direccion, telefono, email } = req.body || {};
    const user = req.user || req.donanteHeader;
    if (
      String(user?.rol || "").toLowerCase() !== "recolector"
      || String(user?._id) !== String(id)
    ) {
      return res.status(403).json({
        msg: "Solo puedes actualizar tu propio perfil de recolector",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ msg: `ID inválido: ${id}` });

    const recolector = await Recolector.findById(id).select("+password");
    if (!recolector)
      return res
        .status(404)
        .json({ msg: `No existe el recolector con ID ${id}` });

    const payload = req.body || {};
    const allowedFields = ["nombre", "apellido", "direccion", "telefono", "email"];
    const providedFields = allowedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(payload, field)
    );
    if (providedFields.length === 0) {
      return res.status(400).json({ msg: "Debes enviar al menos un campo" });
    }
    const invalidFields = providedFields.filter((field) => isBlank(payload[field]));
    if (invalidFields.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;
    if (normalizedEmail && recolector.email !== normalizedEmail) {
      const [emailExistente, emailAdmin, emailRecolector] = await Promise.all([
        Donante.findOne({ email: normalizedEmail }),
        Admin.findOne({ email: normalizedEmail }),
        Recolector.findOne({ email: normalizedEmail }),
      ]);
      if (emailExistente || emailAdmin || emailRecolector) {
        return res
          .status(404)
          .json({ msg: "El email ya se encuentra registrado" });
      }
      recolector.email = normalizedEmail;
    }

    if (nombre !== undefined) recolector.nombre = nombre;
    if (apellido !== undefined) recolector.apellido = apellido;
    if (direccion !== undefined) recolector.direccion = direccion;
    if (telefono !== undefined) recolector.telefono = telefono;
    await recolector.save();

    res.status(200).json(recolector.toJSON());
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarPasswordRecolector = async (req, res) => {
  try {
    const recolector = await Recolector.findById(req.donanteHeader._id).select(
      "+password"
    );
    if (!recolector)
      return res.status(404).json({
        msg: `Lo sentimos, no existe el recolector ${req.donanteHeader._id}`,
      });

    const faltantes = requireFields(req.body, [
      "passwordactual",
      "passwordnuevo",
    ]);
    if (faltantes.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const verificarPassword = await recolector.matchPassword(
      req.body?.passwordactual
    );
    if (!verificarPassword)
      return res.status(404).json({
        msg: "Lo sentimos, el password actual no es el correcto",
      });

    recolector.password = await recolector.encryptPassword(
      req.body?.passwordnuevo
    );
    await recolector.save();

    res.status(200).json({ msg: "Password actualizado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarUbicacionRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const {
      latitud,
      longitud,
      precisionMetros,
      capturadoEn,
      origenSeguimiento,
    } = req.body || {};
    const automaticTracking = origenSeguimiento === "automatico";
    if (!user?._id) {
      return res.status(401).json({ msg: "No autenticado" });
    }
    const parseCoordinate = (value) => {
      if (
        (typeof value !== "number" && typeof value !== "string")
        || (typeof value === "string" && value.trim() === "")
      ) {
        return NaN;
      }
      return Number(value);
    };
    const latitude = parseCoordinate(latitud);
    const longitude = parseCoordinate(longitud);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      return res.status(400).json({ msg: "Las coordenadas GPS no son válidas" });
    }
    let accuracy = null;
    if (precisionMetros !== undefined && precisionMetros !== null) {
      accuracy = parseCoordinate(precisionMetros);
      if (!Number.isFinite(accuracy) || accuracy < 0) {
        return res.status(400).json({
          msg: "La precisión GPS debe ser un número mayor o igual a cero",
        });
      }
    }
    let capturedAt = null;
    if (capturadoEn !== undefined && capturadoEn !== null && capturadoEn !== "") {
      if (
        (typeof capturadoEn !== "string" && typeof capturadoEn !== "number")
        || (typeof capturadoEn === "string" && capturadoEn.trim() === "")
      ) {
        return res.status(400).json({
          msg: "La fecha de captura GPS no es válida",
        });
      }
      capturedAt = new Date(capturadoEn);
      if (!Number.isFinite(capturedAt.getTime())) {
        return res.status(400).json({
          msg: "La fecha de captura GPS no es válida",
        });
      }
    }

    const collector = await Recolector.findById(user._id)
      .select("status")
      .lean();
    if (!collector || collector.status === false) {
      return res.status(403).json({ msg: "La cuenta de recolector no está activa" });
    }

    if (automaticTracking && isCollectorLocationSimulatorEnabled()) {
      const activeSimulation = await CollectorLocationSimulation.findOne({
        collector: user._id,
        expiresAt: { $gt: new Date() },
      }).lean();
      if (activeSimulation) {
        return res.status(409).json({
          code: "LOCATION_SIMULATION_ACTIVE",
          msg: "El seguimiento GPS real se pausó porque hay una simulación activa",
        });
      }
    }

    const recibidoEn = new Date();
    const insideGeofence = isInsideEpnCampus(latitude, longitude);
    const state = classifyCollectorGeofenceState({
      collectorActive: true,
      capturedAt,
      latitude,
      longitude,
      accuracyMeters: accuracy,
      insideGeofence,
    });
    const estadoGeografico = insideGeofence ? "dentro" : "fuera";
    const updateResult = await Recolector.updateOne(
      { _id: user._id, status: { $ne: false } },
      {
        $set: {
          ubicacionGps: {
            campana: null,
            puntoRecoleccion: null,
            latitud: latitude,
            longitud: longitude,
            precisionMetros: accuracy,
            capturadoEn: capturedAt,
            estadoGeografico,
            actualizadoEn: recibidoEn,
          },
        },
      },
      { runValidators: true }
    );
    if (!updateResult?.acknowledged) {
      throw new Error("MongoDB no confirmó el registro de la ubicación");
    }
    if (updateResult.matchedCount === 0) {
      return res.status(403).json({ msg: "La cuenta de recolector no está activa" });
    }
    if (updateResult.matchedCount !== 1) {
      throw new Error("MongoDB no confirmó el recolector actualizado");
    }

    const locationRecord = await CollectorLocation.create({
      collector: user._id,
      latitude,
      longitude,
      accuracyMeters: accuracy,
      capturedAt,
      receivedAt: recibidoEn,
    });
    if (!locationRecord?._id) {
      throw new Error("MongoDB no confirmó el registro del historial GPS");
    }

    if (!automaticTracking) {
      try {
        await CollectorLocationSimulation.deleteOne({ collector: user._id });
      } catch (error) {
        console.error(
          "La ubicación se guardó, pero no se pudo limpiar la simulación GPS:",
          error.message || error
        );
      }
    }

    publishCollectorLocationEvent(req, user._id, {
      latitud: latitude,
      longitud: longitude,
      precisionMetros: accuracy,
      capturadoEn: capturedAt,
      actualizadoEn: recibidoEn,
      estadoGeografico,
    });
    return res.status(200).json({
      ubicacion: {
        campanaId: null,
        puntoRecoleccionId: null,
        latitud: latitude,
        longitud: longitude,
        precisionMetros: accuracy,
        capturadoEn: capturedAt,
        actualizadoEn: recibidoEn,
        estadoGeografico: state,
        permiteOperar: state === "dentro",
      },
    });
  } catch (error) {
    console.error("Error guardando ubicación GPS del recolector:", error.message || error);
    return res.status(error.statusCode || 500).json({
      ...(error.code ? { code: error.code } : {}),
      msg: error.statusCode
        ? error.message
        : "Error al actualizar la ubicación GPS",
    });
  }
};

const consultarUbicacionRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });

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

    return res.status(200).json({
      estadoGeografico: state,
      permiteOperar: state === "dentro",
      simulada: simulated,
      ...(simulated ? { escenario: gps.scenario } : {}),
      ubicacion: hasValidCollectorCoordinates(
        gps?.latitud ?? gps?.latitude,
        gps?.longitud ?? gps?.longitude
      ) && state !== "inactivo"
        ? serializeCollectorLocation(gps)
        : null,
    });
  } catch (error) {
    console.error("Error consultando ubicación GPS del recolector:", error.message || error);
    return res.status(500).json({ msg: "No se pudo consultar la ubicación GPS" });
  }
};

const consultarUltimaUbicacionRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const { collectorId } = req.params;
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.isValidObjectId(collectorId)) {
      return res.status(400).json({ msg: "El identificador del recolector no es válido" });
    }
    if (
      String(user.rol || "").toLowerCase() !== "admin"
      && String(user._id) !== String(collectorId)
    ) {
      return res.status(403).json({
        msg: "Solo un administrador o el propio recolector puede consultar esta ubicación",
      });
    }

    const collector = await Recolector.findById(collectorId)
      .select("status ubicacionGps")
      .lean();
    if (!collector) return res.status(404).json({ msg: "El recolector no existe" });
    const locationRecord = await CollectorLocation.findOne({
      collector: collectorId,
    }).sort({ receivedAt: -1 }).lean();
    const location = locationRecord
      ? {
          latitude: locationRecord.latitude,
          longitude: locationRecord.longitude,
          accuracyMeters: locationRecord.accuracyMeters,
          capturedAt: locationRecord.capturedAt,
          updatedAt: locationRecord.receivedAt,
        }
      : collector.ubicacionGps;
    const state = classifyCollectorGeofenceState({
      collectorActive: collector.status !== false,
      capturedAt: location?.capturedAt ?? location?.capturadoEn,
      latitude: location?.latitude ?? location?.latitud,
      longitude: location?.longitude ?? location?.longitud,
      accuracyMeters: location?.accuracyMeters ?? location?.precisionMetros,
      insideGeofence:
        location != null
        && (location.latitude != null
          ? isInsideEpnCampus(location.latitude, location.longitude)
          : location.latitud != null
          && isInsideEpnCampus(location.latitud, location.longitud)),
    });
    const hasCoordinates = hasValidCollectorCoordinates(
      location?.latitude ?? location?.latitud,
      location?.longitude ?? location?.longitud
    );
    return res.status(200).json({
      recolectorId: String(collector._id),
      estadoGeografico: state,
      ubicacion: hasCoordinates
        ? serializeCollectorLocation(location)
        : null,
    });
  } catch (error) {
    console.error("Error consultando la última ubicación del recolector:", error.message || error);
    return res.status(500).json({
      msg: "No se pudo consultar la última ubicación del recolector",
    });
  }
};

const consultarSimuladorUbicacionRecolector = async (req, res) => {
  const user = req.user || req.donanteHeader;
  if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
  const habilitado = isCollectorLocationSimulatorEnabled();
  if (!habilitado) {
    return process.env.NODE_ENV === "production"
      ? res.status(404).json({ msg: "Simulador GPS no disponible" })
      : res.status(200).json({ habilitado: false });
  }

  try {
    const simulation = await CollectorLocationSimulation.findOne({
      collector: user._id,
      expiresAt: { $gt: new Date() },
    }).lean();
    return res.status(200).json({
      habilitado: true,
      simulacion: simulation
        ? {
            escenario: simulation.scenario,
            campanaId: String(simulation.campaign),
            puntoRecoleccionId: String(simulation.point),
          }
        : null,
    });
  } catch (error) {
    console.error("Error consultando el simulador GPS:", error.message || error);
    return res.status(500).json({ msg: "No se pudo consultar el simulador GPS" });
  }
};

const actualizarSimulacionUbicacionRecolector = async (req, res) => {
  let session;
  try {
    if (!isCollectorLocationSimulatorEnabled()) {
      return res.status(404).json({ msg: "Simulador GPS no disponible" });
    }

    const user = req.user || req.donanteHeader;
    const { campanaId, puntoRecoleccionId, escenario } = req.body || {};
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (
      !mongoose.isValidObjectId(campanaId)
      || !mongoose.isValidObjectId(puntoRecoleccionId)
    ) {
      return res.status(400).json({
        msg: "Debes indicar una campaña y un punto válidos",
      });
    }

    let simulatedFix;
    try {
      simulatedFix = createCollectorLocationScenario(escenario);
    } catch (error) {
      if (error instanceof RangeError) {
        return res.status(400).json({
          msg: "Escenario no válido para el simulador GPS",
        });
      }
      throw error;
    }

    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const campaign = await Campana.findOne({
        _id: campanaId,
        activa: true,
        puntosRecoleccion: {
          $elemMatch: {
            _id: puntoRecoleccionId,
            activo: { $ne: false },
            estado: { $ne: "inactivo" },
            ...buildPointCollectorAssignmentFilter(user._id),
          },
        },
      })
        .select("nombre puntosRecoleccion")
        .session(session);
      if (!campaign) {
        const error = new Error("No tienes una asignación vigente para ese punto");
        error.statusCode = 403;
        throw error;
      }

      const collector = await Recolector.findById(user._id)
        .select("nombre apellido status ubicacionGps")
        .session(session);
      if (!collector || collector.status === false) {
        const error = new Error("La cuenta de recolector no está activa");
        error.statusCode = 403;
        throw error;
      }

      const previousSimulation = await CollectorLocationSimulation.findOne({
        collector: user._id,
      }).session(session);
      const previousLocation = previousSimulation ?? collector.ubicacionGps;
      const previousState = previousLocation
        ? classifyCollectorGeofenceState({
            collectorActive: true,
            capturedAt:
              previousLocation.capturedAt
              ?? previousLocation.capturadoEn
              ?? previousLocation.actualizadoEn,
            latitude: previousLocation.latitude ?? previousLocation.latitud,
            longitude: previousLocation.longitude ?? previousLocation.longitud,
            accuracyMeters:
              previousLocation.accuracyMeters
              ?? previousLocation.precisionMetros,
            insideGeofence:
              previousLocation.latitude != null
                ? isInsideEpnCampus(
                    previousLocation.latitude,
                    previousLocation.longitude
                  )
                : previousLocation.latitud != null
                && isInsideEpnCampus(
                    previousLocation.latitud,
                    previousLocation.longitud
                  ),
          })
        : "sin_registro";
      const state = classifyCollectorGeofenceState({
        collectorActive: true,
        capturedAt: simulatedFix.capturedAt,
        latitude: simulatedFix.latitude,
        longitude: simulatedFix.longitude,
        accuracyMeters: simulatedFix.accuracyMeters,
        insideGeofence: simulatedFix.insideGeofence,
      });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await CollectorLocationSimulation.findOneAndUpdate(
        { collector: user._id },
        {
          $set: {
            collector: user._id,
            campaign: campaign._id,
            point: puntoRecoleccionId,
            scenario: escenario,
            latitude: simulatedFix.latitude,
            longitude: simulatedFix.longitude,
            accuracyMeters: simulatedFix.accuracyMeters,
            capturedAt: simulatedFix.capturedAt,
            expiresAt,
          },
        },
        { upsert: true, new: true, runValidators: true, session }
      );

      const transition = getCollectorGeofenceTransition(previousState, state);
      if (transition) {
        const point = campaign.puntosRecoleccion.id(puntoRecoleccionId);
        const [event] = await CollectorLocationEvent.create(
          [{
            eventKey:
              `collector-geofence-sim:${user._id}:${campaign._id}:` +
              `${puntoRecoleccionId}:${new mongoose.Types.ObjectId()}`,
            collector: user._id,
            campaign: campaign._id,
            point: puntoRecoleccionId,
            collectorName: `${collector.nombre} ${collector.apellido}`.trim(),
            campaignName: campaign.nombre,
            pointName: point?.nombre ?? "",
            state,
            latitude: simulatedFix.latitude,
            longitude: simulatedFix.longitude,
            accuracyMeters: simulatedFix.accuracyMeters,
            capturedAt: simulatedFix.capturedAt,
            simulated: true,
          }],
          { session }
        );
        result = { event: event.toObject(), state };
      } else {
        result = { event: null, state };
      }
    });

    return res.status(200).json({
      simulada: true,
      escenario,
      estadoGeografico: result.state,
      permiteOperar: result.state === "dentro",
      ubicacion: ["dentro", "fuera"].includes(result.state)
        ? {
            campanaId,
            puntoRecoleccionId,
            latitud: simulatedFix.latitude,
            longitud: simulatedFix.longitude,
            precisionMetros: simulatedFix.accuracyMeters,
            capturadoEn: simulatedFix.capturedAt,
          }
        : null,
      alertaSimuladaGenerada: result.event != null,
    });
  } catch (error) {
    console.error("Error aplicando simulación GPS:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode
        ? error.message
        : "No se pudo aplicar la simulación GPS",
    });
  } finally {
    if (session) await session.endSession();
  }
};

const limpiarSimulacionUbicacionRecolector = async (req, res) => {
  if (!isCollectorLocationSimulatorEnabled()) {
    return res.status(404).json({ msg: "Simulador GPS no disponible" });
  }
  const user = req.user || req.donanteHeader;
  if (!user?._id) return res.status(401).json({ msg: "No autenticado" });

  try {
    await CollectorLocationSimulation.deleteOne({ collector: user._id });
    return res.status(200).json({
      simulada: false,
      msg: "Simulación eliminada; se usará la última ubicación GPS real.",
    });
  } catch (error) {
    console.error("Error limpiando simulación GPS:", error.message || error);
    return res.status(500).json({ msg: "No se pudo limpiar la simulación GPS" });
  }
};

const listarAsignacionesVigentesRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user?._id) {
      return res.status(401).json({ msg: "No autenticado" });
    }

    const campaigns = await Campana.find({
      activa: true,
      puntosRecoleccion: {
        $elemMatch: {
          activo: { $ne: false },
          estado: { $ne: "inactivo" },
          ...buildPointCollectorAssignmentFilter(user._id),
        },
      },
    })
      .select("nombre puntosRecoleccion historialAsignacionesRecolectores")
      .lean();

    const items = serializeCollectorAssignments(campaigns, user._id);
    return res.status(200).json({ total: items.length, items });
  } catch (error) {
    console.error(
      "Error consultando asignaciones vigentes del recolector:",
      error.message || error
    );
    return res.status(500).json({
      msg: "No se pudieron consultar tus puntos de recolección asignados",
    });
  }
};

export {
  registroRecolector,
  recuperarPasswordRecolector,
  comprobarTokenPasswordRecolector,
  crearNuevoPasswordRecolector,
  loginRecolector,
  refreshRecolectorSession,
  perfilRecolector,
  actualizarPerfilRecolector,
  actualizarPasswordRecolector,
  actualizarUbicacionRecolector,
  consultarUbicacionRecolector,
  consultarUltimaUbicacionRecolector,
  consultarSimuladorUbicacionRecolector,
  actualizarSimulacionUbicacionRecolector,
  limpiarSimulacionUbicacionRecolector,
  listarAsignacionesVigentesRecolector,
};