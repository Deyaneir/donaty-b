import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Categoria from "../models/Categoria.js";
import Recolector from "../models/Recolector.js";
import CollectorLocationSimulation from "../models/CollectorLocationSimulation.js";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";
import { notifyUsers } from "../services/firebase_notifications.js";
import {
  classifyCollectorGeofenceState,
  classifyCollectorLocation,
  hasValidCollectorCoordinates,
} from "../utils/collectorLocation.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import { isCollectorLocationSimulatorEnabled } from "../utils/devCollectorLocationSimulator.js";
import { enrichAssignmentHistory } from "../utils/campaignAssignmentHistory.js";

const MAX_RECOLECTORES_POR_PUNTO = 3;

const countAssignedCollectors = (points) =>
  new Set(points.flatMap((point) => (point.recolectores || []).map(String))).size;

const validateCampaignCapacity = (maxCollectors, points, additionalCollectors = 0) => {
  const maximum = Number(maxCollectors);
  const additional = Number(additionalCollectors);
  if (
    !Number.isInteger(maximum)
    || maximum < 0
    || !Number.isInteger(additional)
    || additional < 0
  ) {
    const error = new Error("El máximo de recolectores de la campaña no es válido");
    error.statusCode = 400;
    throw error;
  }
  const assigned = countAssignedCollectors(points);
  if (assigned + additional > maximum) {
    const error = new Error(
      `La campaña permite ${maximum} recolector(es), pero tiene ${assigned} asignados y se intentan agregar ${additional}`
    );
    error.statusCode = 409;
    throw error;
  }
};

const countActivePickupPoints = (points = []) =>
  points.filter((point) =>
    point.activo !== false
    && String(point.estado || "").toLowerCase() !== "inactivo"
  ).length;

const validateCampaignPointCapacity = (maxCollectors, points) => {
  const maximum = Number(maxCollectors);
  if (!Number.isInteger(maximum) || maximum < 0) {
    const error = new Error("El máximo de recolectores de la campaña no es válido");
    error.statusCode = 400;
    throw error;
  }
  const activePoints = countActivePickupPoints(points);
  if (activePoints > maximum) {
    const error = new Error(
      `La campaña permite ${maximum} recolector(es) y no puede tener ${activePoints} puntos activos`
    );
    error.statusCode = 409;
    throw error;
  }
};

const validateCampaignHours = (startValue, endValue) => {
  const start = String(startValue ?? "").trim();
  const end = String(endValue ?? "").trim();
  const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!start || !end) {
    const error = new Error(
      "La hora de inicio y la hora de finalización son obligatorias"
    );
    error.statusCode = 400;
    throw error;
  }
  if (!isTime(start) || !isTime(end)) {
    const error = new Error("Las horas deben tener el formato HH:mm");
    error.statusCode = 400;
    throw error;
  }
  const minutes = (value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  if (minutes(end) <= minutes(start)) {
    const error = new Error(
      "La hora de finalización debe ser posterior a la hora de inicio"
    );
    error.statusCode = 400;
    throw error;
  }
  return { horaInicio: start, horaFin: end };
};

const resolveCampaignState = (campaign, now = new Date()) => {
  const storedState = String(campaign?.estado ?? "").toLowerCase();
  if (storedState === "finalizada") return "finalizada";
  if (storedState === "borrador") return "borrador";
  const end = campaign?.fechaFin ? new Date(campaign.fechaFin) : null;
  if (
    (campaign?.activa === true || storedState === "desactivada")
    && end
    && !Number.isNaN(end.getTime())
    && end < new Date(now.getFullYear(), now.getMonth(), now.getDate())
  ) {
    return "finalizada";
  }
  if (storedState === "desactivada") return "desactivada";
  return campaign?.activa === true ? "activa" : "borrador";
};

const campaignDateRangesOverlap = (left, right) => {
  const start = (value) => value == null ? Number.NEGATIVE_INFINITY : new Date(value).getTime();
  const end = (value) => value == null ? Number.POSITIVE_INFINITY : new Date(value).getTime();
  const leftStart = start(left.fechaInicio);
  const leftEnd = end(left.fechaFin);
  const rightStart = start(right.fechaInicio);
  const rightEnd = end(right.fechaFin);
  if ([leftStart, leftEnd, rightStart, rightEnd].some(Number.isNaN)) return true;
  return leftStart <= rightEnd && rightStart <= leftEnd;
};

const assertNoOverlappingAssignments = async (
  campaign,
  collectorIds,
  dateOverrides = {}
) => {
  const ids = [...new Set((collectorIds || []).map(String).filter(Boolean))];
  if (!ids.length) return;

  const campaignDates = {
    fechaInicio: Object.prototype.hasOwnProperty.call(dateOverrides, "fechaInicio")
      ? dateOverrides.fechaInicio
      : campaign.fechaInicio,
    fechaFin: Object.prototype.hasOwnProperty.call(dateOverrides, "fechaFin")
      ? dateOverrides.fechaFin
      : campaign.fechaFin,
  };
  const otherCampaigns = await Campana.find({
    _id: { $ne: campaign._id },
    $or: [
      { "puntosRecoleccion.recolectores": { $in: ids } },
      {
        historialAsignacionesRecolectores: {
          $elemMatch: {
            recolector: { $in: ids },
            vigente: true,
          },
        },
      },
    ],
  })
    .select("nombre fechaInicio fechaFin puntosRecoleccion.recolectores historialAsignacionesRecolectores")
    .lean();

  for (const other of otherCampaigns) {
    const assignedIds = new Set([
      ...(other.puntosRecoleccion || []).flatMap((point) =>
        (point.recolectores || []).map(String)
      ),
      ...(other.historialAsignacionesRecolectores || [])
        .filter((entry) => entry.vigente)
        .map((entry) => String(entry.recolector)),
    ]);
    const conflictingCollector = ids.find((id) => assignedIds.has(id));
    if (conflictingCollector && campaignDateRangesOverlap(campaignDates, other)) {
      const error = new Error(
        `Un recolector ya tiene una asignación vigente en la campaña "${other.nombre}" durante fechas superpuestas`
      );
      error.statusCode = 409;
      throw error;
    }
  }
};

const normalizePickupHours = (value) => {
  if (!Array.isArray(value)) {
    const error = new Error("Los horarios de atención deben enviarse como una lista");
    error.statusCode = 400;
    throw error;
  }
  const schedules = value.map((item) => {
    const day = Number(item?.diaSemana);
    const start = String(item?.horaInicio ?? "").trim();
    const finish = String(item?.horaFin ?? "").trim();
    if (
      !Number.isInteger(day) ||
      day < 1 ||
      day > 7 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(finish) ||
      start >= finish
    ) {
      const error = new Error(
        "Cada horario requiere un día válido y horas en formato HH:mm, con fin posterior al inicio"
      );
      error.statusCode = 400;
      throw error;
    }
    return { diaSemana: day, horaInicio: start, horaFin: finish };
  });
  if (schedules.length > 50) {
    const error = new Error("Un punto no puede tener más de 50 franjas horarias");
    error.statusCode = 400;
    throw error;
  }
  const byDay = new Map();
  for (const schedule of schedules) {
    const intervals = byDay.get(schedule.diaSemana) || [];
    intervals.push(schedule);
    byDay.set(schedule.diaSemana, intervals);
  }
  for (const intervals of byDay.values()) {
    intervals.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    if (intervals.some((interval, index) =>
      index > 0 && interval.horaInicio < intervals[index - 1].horaFin
    )) {
      const error = new Error("Las franjas del mismo día no pueden superponerse");
      error.statusCode = 400;
      throw error;
    }
  }
  return schedules;
};

const normalizePointText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
};

const validateCampaignCategories = async (value) => {
  if (!Array.isArray(value)) {
    const error = new Error("Las categorías permitidas deben ser una lista");
    error.statusCode = 400;
    throw error;
  }

  const ids = [...new Set(value.map((item) => String(item).trim()))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    const error = new Error("Una de las categorías no tiene un identificador válido");
    error.statusCode = 400;
    throw error;
  }

  if (ids.length === 0) return [];

  const activeCategories = await Categoria.find({
    _id: { $in: ids },
    activa: true,
  }).select("_id");
  if (activeCategories.length !== ids.length) {
    const error = new Error("Todas las categorías deben existir y estar activas");
    error.statusCode = 400;
    throw error;
  }

  return activeCategories.map((category) => category._id);
};

const normalizePickupPoints = (value, existingPoints = [], requireComplete = false) => {
  if (!Array.isArray(value)) {
    const error = new Error("Los puntos de recolección deben enviarse como una lista");
    error.statusCode = 400;
    throw error;
  }

  const existingById = new Map(existingPoints.map((point) => [String(point._id), point]));
  const seenIds = new Set();
  const points = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const error = new Error("Cada punto de recolección debe ser un objeto");
      error.statusCode = 400;
      throw error;
    }

    const existing = existingById.get(String(item._id ?? ""));
    const rawBuildingId = item.edificioId ?? existing?.edificioId ?? null;
    const edificioId = rawBuildingId === null || rawBuildingId === ""
      ? null
      : Number(rawBuildingId);
    if (edificioId !== null && (!Number.isInteger(edificioId) || edificioId < 1)) {
      const error = new Error("El identificador del edificio no es válido");
      error.statusCode = 400;
      throw error;
    }

    const nombreEdificio = String(item.nombreEdificio ?? existing?.nombreEdificio ?? "").trim();
    const edificio = String(item.edificio ?? item.building ?? existing?.edificio ?? "").trim();
    const piso = String(item.piso ?? existing?.piso ?? "").trim();
    const aula = String(item.aula ?? existing?.aula ?? "").trim();
    const name = [
      item.nombre ?? existing?.nombre,
      nombreEdificio,
      edificio,
      [piso, aula].filter(Boolean).join(" - "),
    ].map((candidate) => String(candidate ?? "").trim()).find(Boolean) || "";
    const descripcion = String(
      item.descripcion ?? item.description ?? existing?.descripcion ?? ""
    ).trim();
    const address = String(
      item.direccion ?? item.address ?? existing?.direccion ?? ""
    ).trim();
    const referenciasLugar = String(
      item.referenciasLugar
      ?? item.referencias
      ?? item.referencia
      ?? existing?.referenciasLugar
      ?? ""
    ).trim();
    const telefonoContacto = String(
      item.telefonoContacto ?? item.telefono ?? existing?.telefonoContacto ?? ""
    ).trim();
    const horariosAtencion = normalizePickupHours(
      item.horariosAtencion ?? existing?.horariosAtencion ?? []
    );
    const state = item.estado ?? existing?.estado;
    if (state !== undefined && !["activo", "inactivo"].includes(String(state).toLowerCase())) {
      const error = new Error("El estado del punto debe ser activo o inactivo");
      error.statusCode = 400;
      throw error;
    }
    const rawActive = item.activo;
    const active = rawActive === undefined
      ? state === undefined
        ? existing?.activo ?? true
        : String(state).toLowerCase() === "activo"
      : rawActive === true || rawActive === "true"
        ? true
        : rawActive === false || rawActive === "false"
          ? false
          : null;
    if (
      !name
      || name.length > 120
      || nombreEdificio.length > 160
      || edificio.length > 120
      || piso.length > 40
      || aula.length > 80
      || descripcion.length > 500
      || address.length > 500
      || referenciasLugar.length > 500
      || telefonoContacto.length > 30
      || typeof active !== "boolean"
    ) {
      const error = new Error("El nombre, dirección o estado del punto no es válido");
      error.statusCode = 400;
      throw error;
    }
    if (
      requireComplete
      && !existing
      && (
        (!edificioId && !nombreEdificio && !edificio)
        || !piso
        || !aula
      )
    ) {
      const error = new Error(
        "Cada punto nuevo requiere edificio, piso y aula"
      );
      error.statusCode = 400;
      throw error;
    }

    let pointId;
    if (item._id) {
      if (!mongoose.isValidObjectId(item._id)) {
        const error = new Error("El identificador del punto no es válido");
        error.statusCode = 400;
        throw error;
      }
      pointId = String(item._id);
      if (seenIds.has(pointId)) {
        const error = new Error("No se permiten puntos duplicados");
        error.statusCode = 409;
        throw error;
      }
      seenIds.add(pointId);
      if (!existingById.has(pointId)) {
        const error = new Error("El punto indicado no pertenece a esta campaña");
        error.statusCode = 400;
        throw error;
      }
    } else {
      pointId = new mongoose.Types.ObjectId();
    }

    if (active === false && existing?.recolectores?.length) {
      const error = new Error("No se puede desactivar un punto con recolectores asignados");
      error.statusCode = 409;
      throw error;
    }

    const rawLatitude = item.latitud ?? item.latitude ?? existing?.latitud;
    const rawLongitude = item.longitud ?? item.longitude ?? existing?.longitud;
    const latMissing = rawLatitude === undefined || rawLatitude === null || rawLatitude === "";
    const lngMissing = rawLongitude === undefined || rawLongitude === null || rawLongitude === "";
    const latitud = latMissing ? null : Number(rawLatitude);
    const longitud = lngMissing ? null : Number(rawLongitude);
    if (
      latMissing !== lngMissing
      || (latitud !== null && (!Number.isFinite(latitud) || latitud < -90 || latitud > 90))
      || (longitud !== null && (!Number.isFinite(longitud) || longitud < -180 || longitud > 180))
    ) {
      const error = new Error("Las coordenadas del punto deben incluir latitud y longitud válidas");
      error.statusCode = 400;
      throw error;
    }

    return {
      _id: pointId,
      nombre: name,
      edificioId,
      nombreEdificio,
      edificio,
      piso,
      aula,
      horariosAtencion,
      estado: active ? "activo" : "inactivo",
      claveUnica: [
        edificioId !== null ? `id:${edificioId}` : `nombre:${normalizePointText(edificio || nombreEdificio)}`,
        normalizePointText(piso),
        normalizePointText(aula),
      ].join("|"),
      descripcion,
      direccion: address,
      referenciasLugar,
      telefonoContacto,
      latitud,
      longitud,
      activo: active,
      recolectores: existing?.recolectores || [],
      responsableRecolector: existing?.responsableRecolector || null,
    };
  });

  const retained = new Set(points.map((point) => String(point._id)));
  if (existingPoints.some((point) => point.recolectores?.length && !retained.has(String(point._id)))) {
    const error = new Error("No se puede eliminar un punto que tiene recolectores asignados");
    error.statusCode = 409;
    throw error;
  }
  return points;
};

const getAssignmentMap = (points) => {
  const map = new Map();
  for (const point of points) {
    for (const collector of point.recolectores || []) {
      map.set(String(collector), String(point._id));
    }
  }
  return map;
};

const validateAssignableCollectors = async (ids) => {
  if (!Array.isArray(ids) || ids.some((id) => !mongoose.isValidObjectId(String(id)))) {
    const error = new Error("recolectores debe ser una lista de identificadores válidos");
    error.statusCode = 400;
    throw error;
  }
  const normalizedIds = ids.map(String);
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    const error = new Error("La lista contiene recolectores duplicados");
    error.statusCode = 409;
    throw error;
  }
  const collectors = await Recolector.find({
    _id: { $in: normalizedIds },
    confirmEmail: true,
    status: { $ne: false },
    aprobado: { $ne: false },
  }).select("_id nombre apellido").lean();
  if (collectors.length !== normalizedIds.length) {
    const error = new Error("Todos los recolectores deben existir, estar activos, aprobados y verificados");
    error.statusCode = 400;
    throw error;
  }
  return collectors;
};

const validateCampaignCanBeActivated = async (points) => {
  const activePoints = (points || []).filter(
    (point) => point.activo !== false
      && String(point.estado || "").toLowerCase() !== "inactivo"
  );
  const activeAssignedIds = [...new Set(
    activePoints.flatMap((point) => (point.recolectores || []).map(String))
  )];
  const seenCollectors = new Set();
  for (const point of points || []) {
    const assigned = (point.recolectores || []).map(String);
    if (assigned.length > MAX_RECOLECTORES_POR_PUNTO) {
      const error = new Error("Un punto no puede tener más de 3 recolectores asignados");
      error.statusCode = 409;
      throw error;
    }
    for (const collectorId of assigned) {
      if (seenCollectors.has(collectorId)) {
        const error = new Error("Un recolector no puede estar duplicado en distintos puntos de la campaña");
        error.statusCode = 409;
        throw error;
      }
      seenCollectors.add(collectorId);
    }
  }
  if (!activeAssignedIds.length) {
    const error = new Error(
      "No se puede activar la campaña sin al menos un recolector asignado a un punto activo"
    );
    error.statusCode = 409;
    throw error;
  }
  const activeCollectors = await Recolector.countDocuments({
    _id: { $in: activeAssignedIds },
    confirmEmail: true,
    status: { $ne: false },
    aprobado: { $ne: false },
  });
  if (!activeCollectors) {
    const error = new Error(
      "No se puede activar la campaña sin un recolector activo, aprobado y verificado"
    );
    error.statusCode = 409;
    throw error;
  }
};

const saveCampaignAssignments = async (campaign, points, history) =>
  Campana.findOneAndUpdate(
    {
      _id: campaign._id,
      $or: [{ __v: campaign.__v || 0 }, { __v: { $exists: false } }],
    },
    {
      $set: {
        puntosRecoleccion: points,
        historialAsignacionesRecolectores: history,
      },
      $inc: { __v: 1 },
    },
    { new: true, runValidators: true }
  );

const notifyPointAssignmentChanges = (campaignId, changes) => {
  for (const change of changes) {
    if (!change.recolector) continue;
    void notifyUsers({
      eventKey: `collector-point-assignment:${campaignId}:${change.historyId}`,
      recipients: [{ userId: change.recolector, role: "recolector" }],
      title: change.puntoNuevo ? "Punto de recolección actualizado" : "Asignación de punto actualizada",
      body: change.puntoNuevo
        ? `Tu punto de recolección fue actualizado a ${change.nombrePunto}.`
        : "Tu asignación de punto fue retirada por administración.",
      data: {
        type: "collector_point_assignment",
        campaignId,
        pointId: change.puntoNuevo || "",
      },
    });
  }
};

const listarCampanas = async (req, res) => {
  try {
    const rol = String(req.user?.rol || "").toLowerCase();

    // Los administradores pueden consultar también las inactivas.
    // Donantes y recolectores solo consultan las activas.
    const filtro = rol === "admin" && req.query.todas === "true"
      ? {}
      : rol === "recolector"
        ? {
            activa: true,
            puntosRecoleccion: {
              $elemMatch: {
                activo: { $ne: false },
                estado: { $ne: "inactivo" },
                recolectores: req.user._id,
              },
            },
          }
        : { activa: true };

    const campanas = await Campana.find(filtro)
      .populate({
        path: "categoriasPermitidas",
        match: { activa: true },
        select: "nombre",
      })
      .sort({ createdAt: -1 });

    const responseCampaigns = campanas.map((campaign) => {
        const serialized = campaign.toObject();
        serialized.categoriasPermitidasNombres = (
          serialized.categoriasPermitidas || []
        ).map((category) => category?.nombre).filter(Boolean);
        serialized.estado = resolveCampaignState(campaign);
        if (rol === "admin") return serialized;
        delete serialized.historialAsignacionesRecolectores;
        if (rol === "recolector") {
          serialized.puntosRecoleccion = (serialized.puntosRecoleccion || [])
            .filter((point) =>
              point.activo !== false
              && String(point.estado || "").toLowerCase() !== "inactivo"
              && (point.recolectores || []).some(
                (collectorId) => String(collectorId) === String(req.user._id)
              )
            );
        }
        serialized.puntosRecoleccion = (serialized.puntosRecoleccion || []).map((point) => {
          delete point.recolectores;
          delete point.responsableRecolector;
          return point;
        });
        return serialized;
      });

    return res.status(200).json({
      msg: "Campañas consultadas correctamente",
      total: responseCampaigns.length,
      campanas: responseCampaigns,
    });
  } catch (error) {
    console.error("Error al listar campañas:", error);

    return res.status(500).json({
      msg: "Error al consultar las campañas",
    });
  }
};

const crearCampana = async (req, res) => {
  try {
    const {
      nombre,
      descripcion,
      ubicacion,
      fechaInicio,
      fechaFin,
      horaInicio,
      horaFin,
      activa,
      numeroRecolectores,
      metaDonaciones,
      categoriasPermitidas = [],
      puntosRecoleccion = [],
    } =
      req.body || {};

    if (typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({
        msg: "El nombre de la campaña es obligatorio",
      });
    }
    if (typeof descripcion !== "string" || descripcion.trim().length < 30) {
      return res.status(400).json({
        msg: "La descripción de la campaña es obligatoria y debe tener al menos 30 caracteres",
      });
    }
    if (
      typeof ubicacion !== "string"
      || !ubicacion.trim()
      || ubicacion.length > 300
    ) {
      return res.status(400).json({
        msg: "La ubicación de la campaña es obligatoria y debe tener máximo 300 caracteres",
      });
    }
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        msg: "Las fechas de inicio y finalización son obligatorias",
      });
    }
    let campaignHours;
    try {
      campaignHours = validateCampaignHours(horaInicio, horaFin);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ msg: error.message });
    }

    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);

    if (inicio && Number.isNaN(inicio.getTime())) {
      return res.status(400).json({
        msg: "La fecha de inicio no es válida",
      });
    }

    if (fin && Number.isNaN(fin.getTime())) {
      return res.status(400).json({
        msg: "La fecha de fin no es válida",
      });
    }

    if (fin <= inicio) {
      return res.status(400).json({
        msg: "La fecha de fin debe ser posterior a la de inicio",
      });
    }

    const collectorLimit = Number(numeroRecolectores);
    if (
      numeroRecolectores === undefined
      || numeroRecolectores === null
      || numeroRecolectores === ""
      || !Number.isInteger(collectorLimit)
      || collectorLimit < 0
    ) {
      return res.status(400).json({
        msg: "El máximo de recolectores debe ser un entero mayor o igual a cero",
      });
    }
    const donationGoal = Number(metaDonaciones);
    if (
      metaDonaciones === undefined
      || metaDonaciones === null
      || metaDonaciones === ""
      || !Number.isInteger(donationGoal)
      || donationGoal < 1
    ) {
      return res.status(400).json({
        msg: "La meta de donaciones debe ser un entero mayor que cero",
      });
    }

    const requestedActive = activa === undefined ? false : parseBoolean(activa);
    if (requestedActive === null) {
      return res.status(400).json({
        msg: "El campo activa debe ser verdadero o falso",
      });
    }
    if (requestedActive) {
      return res.status(409).json({
        msg: "Las campañas nuevas se guardan como borrador; actívala después desde su detalle",
      });
    }

    const categorias = await validateCampaignCategories(categoriasPermitidas);
    const puntos = normalizePickupPoints(puntosRecoleccion, [], true);
    validateCampaignCapacity(collectorLimit, puntos);
    validateCampaignPointCapacity(collectorLimit, puntos);
    if (!req.files?.imagen) {
      return res.status(400).json({
        msg: "Debes adjuntar una imagen de portada para la campaña",
      });
    }
    const imagen = await uploadImage(req.files?.imagen, "donaty/campanas");

    const campana = await Campana.create({
      nombre: nombre.trim(),
      descripcion:
        typeof descripcion === "string" ? descripcion.trim() : "",
      ubicacion: ubicacion.trim(),
      fechaInicio: inicio,
      fechaFin: fin,
      ...campaignHours,
      estado: "borrador",
      activa: false,
      numeroRecolectores: collectorLimit,
      metaDonaciones: donationGoal,
      categoriasPermitidas: categorias,
      puntosRecoleccion: puntos,
      ...imagen,
    });

    return res.status(201).json({
      msg: "Campaña creada correctamente",
      campana,
    });
  } catch (error) {
    console.error("Error al crear campaña:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({ msg: error.message });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        msg: error.message,
      });
    }

    return res.status(500).json({
      msg: "Error al crear la campaña",
    });
  }
};

const actualizarCampana = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        msg: "El identificador de la campaña no es válido",
      });
    }

    const permitidos = [
      "nombre",
      "descripcion",
      "ubicacion",
      "fechaInicio",
      "fechaFin",
      "horaInicio",
      "horaFin",
      "estado",
      "activa",
      "numeroRecolectores",
      "metaDonaciones",
      "categoriasPermitidas",
      "puntosRecoleccion",
    ];

    const cambios = {};

    for (const campo of permitidos) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, campo)) {
        cambios[campo] = req.body[campo];
      }
    }

    const tieneImagen = Boolean(req.files?.imagen);
    if (Object.keys(cambios).length === 0 && !tieneImagen) {
      return res.status(400).json({
        msg: "No se recibieron campos para actualizar",
      });
    }

    if (
      cambios.nombre !== undefined &&
      (typeof cambios.nombre !== "string" || !cambios.nombre.trim())
    ) {
      return res.status(400).json({
        msg: "El nombre de la campaña es obligatorio",
      });
    }

    if (cambios.nombre !== undefined) {
      cambios.nombre = cambios.nombre.trim();
    }

    if (cambios.descripcion !== undefined) {
      if (typeof cambios.descripcion !== "string") {
        return res.status(400).json({
          msg: "La descripción debe ser texto",
        });
      }

      cambios.descripcion = cambios.descripcion.trim();
    }
    if (cambios.ubicacion !== undefined) {
      if (typeof cambios.ubicacion !== "string" || cambios.ubicacion.length > 300) {
        return res.status(400).json({
          msg: "La ubicación debe ser texto de máximo 300 caracteres",
        });
      }
      cambios.ubicacion = cambios.ubicacion.trim();
    }

    for (const campo of ["fechaInicio", "fechaFin"]) {
      if (cambios[campo] !== undefined) {
        if (cambios[campo] === null || cambios[campo] === "") {
          cambios[campo] = null;
        } else {
          const fecha = new Date(cambios[campo]);

          if (Number.isNaN(fecha.getTime())) {
            return res.status(400).json({
              msg: `El campo ${campo} no contiene una fecha válida`,
            });
          }

          cambios[campo] = fecha;
        }
      }
    }

    if (cambios.activa !== undefined) {
      cambios.activa = parseBoolean(cambios.activa);
      if (cambios.activa === null) {
        return res.status(400).json({
          msg: "El campo activa debe ser verdadero o falso",
        });
      }
    }
    if (cambios.estado !== undefined) {
      cambios.estado = String(cambios.estado).trim().toLowerCase();
      if (!["borrador", "activa", "finalizada", "desactivada"].includes(cambios.estado)) {
        return res.status(400).json({ msg: "El estado de campaña no es válido" });
      }
      cambios.activa = cambios.estado === "activa";
    } else if (cambios.activa !== undefined) {
      cambios.estado = cambios.activa ? "activa" : "desactivada";
    }

    if (cambios.numeroRecolectores !== undefined) {
      const recolectores = Number(cambios.numeroRecolectores);
      if (!Number.isInteger(recolectores) || recolectores < 0) {
        return res.status(400).json({
          msg: "El número de recolectores debe ser un entero mayor o igual a 0",
        });
      }
      cambios.numeroRecolectores = recolectores;
    }
    if (cambios.metaDonaciones !== undefined) {
      if (cambios.metaDonaciones === null || cambios.metaDonaciones === "") {
        cambios.metaDonaciones = null;
      } else {
        const target = Number(cambios.metaDonaciones);
        if (!Number.isInteger(target) || target < 1) {
          return res.status(400).json({
            msg: "La meta de donaciones debe ser un entero mayor que cero",
          });
        }
        cambios.metaDonaciones = target;
      }
    }

    if (cambios.categoriasPermitidas !== undefined) {
      cambios.categoriasPermitidas = await validateCampaignCategories(
        cambios.categoriasPermitidas
      );
    }

    const actual = await Campana.findById(id);

    if (!actual) {
      return res.status(404).json({
        msg: "La campaña no existe",
      });
    }
    if (
      (cambios.activa === true || cambios.estado === "activa")
      && resolveCampaignState(actual) === "finalizada"
    ) {
      return res.status(409).json({
        msg: "Una campaña finalizada no se puede reactivar",
      });
    }
    const requestedStartTime = cambios.horaInicio ?? actual.horaInicio;
    const requestedEndTime = cambios.horaFin ?? actual.horaFin;
    const closingCampaign =
      cambios.estado === "finalizada" || cambios.activa === false;
    if (!closingCampaign) {
      try {
        Object.assign(
          cambios,
          validateCampaignHours(requestedStartTime, requestedEndTime)
        );
      } catch (error) {
        return res.status(error.statusCode || 400).json({ msg: error.message });
      }
    }
    if (cambios.estado === "finalizada") cambios.activa = false;
    if (cambios.puntosRecoleccion !== undefined) {
      cambios.puntosRecoleccion = normalizePickupPoints(
        cambios.puntosRecoleccion,
        actual.puntosRecoleccion
      );
    }
    validateCampaignCapacity(
      cambios.numeroRecolectores ?? actual.numeroRecolectores,
      cambios.puntosRecoleccion ?? actual.puntosRecoleccion
    );
    validateCampaignPointCapacity(
      cambios.numeroRecolectores ?? actual.numeroRecolectores,
      cambios.puntosRecoleccion ?? actual.puntosRecoleccion
    );

    const fechaInicio =
      cambios.fechaInicio !== undefined
        ? cambios.fechaInicio
        : actual.fechaInicio;

    const fechaFin =
      cambios.fechaFin !== undefined ? cambios.fechaFin : actual.fechaFin;

    if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
      return res.status(400).json({
        msg: "La fecha de fin debe ser posterior a la de inicio",
      });
    }
    if (cambios.activa === true || cambios.estado === "activa") {
      const campaignReady = {
        ...actual.toObject(),
        ...cambios,
        fechaInicio,
        fechaFin,
        imagenUrl: actual.imagenUrl,
      };
      if (
        !campaignReady.nombre?.trim()
        || !campaignReady.descripcion?.trim()
        || !campaignReady.ubicacion?.trim()
        || !campaignReady.imagenUrl?.trim()
        || !Number.isInteger(Number(campaignReady.metaDonaciones))
        || Number(campaignReady.metaDonaciones) < 1
        || !campaignReady.fechaInicio
        || !campaignReady.fechaFin
      ) {
        return res.status(409).json({
          msg: "Completa nombre, descripción, ubicación, imagen, meta y fechas antes de activar la campaña",
        });
      }
      await validateCampaignCanBeActivated(
        cambios.puntosRecoleccion ?? actual.puntosRecoleccion
      );
    }
    if (
      cambios.fechaInicio !== undefined ||
      cambios.fechaFin !== undefined ||
      cambios.activa === true ||
      cambios.puntosRecoleccion !== undefined
    ) {
      const pointsForValidation =
        cambios.puntosRecoleccion ?? actual.puntosRecoleccion;
      const assignedCollectorIds = [
        ...new Set(
          pointsForValidation.flatMap((point) =>
            (point.recolectores || []).map(String)
          )
        ),
      ];
      await assertNoOverlappingAssignments(
        actual,
        assignedCollectorIds,
        { fechaInicio, fechaFin }
      );
    }

    let imagenNueva;
    try {
      imagenNueva = await uploadImage(req.files?.imagen, "donaty/campanas");
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ msg: error.message });
      }
      throw error;
    }

    const imagenAnteriorPublicId = actual.imagenPublicId;
    Object.assign(actual, cambios, imagenNueva || {});
    await actual.save();

    if (
      imagenNueva?.imagenPublicId &&
      imagenAnteriorPublicId &&
      imagenAnteriorPublicId !== imagenNueva.imagenPublicId
    ) {
      try {
        await deleteImage(imagenAnteriorPublicId);
      } catch (error) {
        console.warn("No se pudo eliminar la imagen anterior de campaña:", error.message);
      }
    }

    return res.status(200).json({
      msg: "Campaña actualizada correctamente",
      campana: actual,
    });
  } catch (error) {
    console.error("Error al actualizar campaña:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({ msg: error.message });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        msg: error.message,
      });
    }

    return res.status(500).json({
      msg: "Error al actualizar la campaña",
    });
  }
};

const listarDistribucionRecolectores = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    const campaign = await Campana.findById(campaignId)
      .populate("historialAsignacionesRecolectores.administrador", "nombre apellido")
      .populate("historialAsignacionesRecolectores.recolector", "nombre apellido")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });

    const currentAssignments = (campaign.puntosRecoleccion || [])
      .filter((point) =>
        point.activo !== false
        && String(point.estado || "").toLowerCase() !== "inactivo"
      )
      .flatMap((point) =>
        (point.recolectores || []).map((collectorId) => ({
          collectorId: String(collectorId),
          pointId: String(point._id),
          pointName: point.nombre ?? "",
        }))
      );
    const currentCollectorIds = [...new Set(
      currentAssignments.map((assignment) => assignment.collectorId)
    )];
    const collectorIds = [...new Set([
      ...currentCollectorIds,
      ...(campaign.historialAsignacionesRecolectores || []).map((entry) =>
        String(entry.recolector?._id ?? entry.recolector)
      ),
    ])];
    const collectors = await Recolector.find({ _id: { $in: collectorIds } })
      .select("nombre apellido email telefono direccion status aprobado confirmEmail")
      .lean();
    const collectorsById = new Map(collectors.map((collector) => [String(collector._id), collector]));

    return res.status(200).json({
      campanaId: String(campaign._id),
      numeroRecolectores: campaign.numeroRecolectores,
      recolectoresAsignados: currentCollectorIds.length,
      asignacionesActuales: currentAssignments.map((assignment) => ({
        ...assignment,
        recolector: collectorsById.get(assignment.collectorId) || null,
      })),
      puntos: (campaign.puntosRecoleccion || []).map((point) => ({
        id: String(point._id),
        nombre: point.nombre,
        direccion: point.direccion,
        activo: point.activo,
        horariosAtencion: point.horariosAtencion || [],
        recolectores: (point.recolectores || [])
          .map((id) => collectorsById.get(String(id)))
          .filter(Boolean),
        responsableRecolector: point.responsableRecolector
          ? collectorsById.get(String(point.responsableRecolector)) || null
          : null,
      })),
      historialAsignaciones: enrichAssignmentHistory(
        campaign.historialAsignacionesRecolectores || []
      ),
    });
  } catch (error) {
    console.error("Error consultando distribución de recolectores:", error.message || error);
    return res.status(500).json({ msg: "Error al consultar la distribución" });
  }
};

const distribuirRecolectores = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    const collectorIds = req.body?.recolectores;
    await validateAssignableCollectors(collectorIds);
    const requestedIds = collectorIds.map(String);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const campaign = await Campana.findById(campaignId);
      if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
      const points = campaign.puntosRecoleccion.map((point) => point.toObject());
      const activePoints = points.filter((point) =>
        point.activo !== false
        && String(point.estado || "").toLowerCase() !== "inactivo"
      );
      if (!activePoints.length) {
        return res.status(409).json({ msg: "Configura al menos un punto de recolección activo" });
      }
      validateCampaignCapacity(campaign.numeroRecolectores, points);
      validateCampaignPointCapacity(campaign.numeroRecolectores, points);
      if (requestedIds.length < 1) {
        return res.status(409).json({ msg: "Selecciona al menos un recolector" });
      }
      const occurrences = new Map();
      for (const point of points) {
        for (const collectorId of point.recolectores || []) {
          const id = String(collectorId);
          occurrences.set(id, (occurrences.get(id) || 0) + 1);
        }
      }
      if ([...occurrences.values()].some((count) => count > 1)) {
        return res.status(409).json({
          msg: "Hay recolectores duplicados en los puntos de esta campaña; corrige las asignaciones antes de distribuir",
        });
      }
      if (requestedIds.some((id) => occurrences.has(id))) {
        return res.status(409).json({
          msg: "Un recolector seleccionado ya está asignado a esta campaña; usa la reasignación explícita",
        });
      }
      await assertNoOverlappingAssignments(campaign, requestedIds);
      const currentAssigned = countAssignedCollectors(points);
      validateCampaignCapacity(
        campaign.numeroRecolectores,
        points,
        requestedIds.length
      );

      const pointCounts = new Map(
        activePoints.map((point) => [String(point._id), (point.recolectores || []).length])
      );
      if (
        activePoints.some((point) =>
          (point.recolectores || []).length > MAX_RECOLECTORES_POR_PUNTO
        )
      ) {
        return res.status(409).json({
          msg: "Un punto supera el máximo de 3 recolectores; corrige las asignaciones antes de distribuir",
        });
      }
      const capacity = activePoints.reduce(
        (total, point) => total + MAX_RECOLECTORES_POR_PUNTO - pointCounts.get(String(point._id)),
        0
      );
      const campaignCapacity = Math.max(
        0,
        campaign.numeroRecolectores - countAssignedCollectors(points)
      );
      if (requestedIds.length > campaignCapacity) {
        return res.status(409).json({
          msg: `La campaña permite un máximo de ${campaign.numeroRecolectores} recolector(es)`,
        });
      }
      if (requestedIds.length > capacity) {
        return res.status(409).json({ msg: "La cantidad supera la capacidad total de los puntos activos" });
      }

      const assignmentByCollector = new Map();
      for (const collectorId of requestedIds) {
        const point = activePoints
          .filter((candidate) =>
            pointCounts.get(String(candidate._id)) < MAX_RECOLECTORES_POR_PUNTO
          )
          .sort((left, right) =>
            pointCounts.get(String(left._id)) - pointCounts.get(String(right._id))
          )[0];
        if (!point) return res.status(409).json({ msg: "No hay capacidad disponible en los puntos" });
        assignmentByCollector.set(collectorId, String(point._id));
        pointCounts.set(String(point._id), pointCounts.get(String(point._id)) + 1);
      }

      const nextPoints = points.map((point) => ({
        ...point,
        recolectores: [
          ...(point.recolectores || []),
          ...requestedIds
            .filter((id) => assignmentByCollector.get(id) === String(point._id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        ],
        responsableRecolector:
          (point.recolectores || []).some(
            (id) => String(id) === String(point.responsableRecolector)
          )
            ? point.responsableRecolector
            : requestedIds.find(
                (id) => assignmentByCollector.get(id) === String(point._id)
              ) || (point.recolectores || [])[0] || null,
      }));
      const history = campaign.historialAsignacionesRecolectores.map((entry) => entry.toObject());
      const activeHistoryByCollector = new Map(
        history.filter((entry) => entry.vigente).map((entry) => [String(entry.recolector), entry])
      );
      const changed = [];
      for (const collectorId of requestedIds) {
        const oldPoint = null;
        const newPoint = assignmentByCollector.get(collectorId) || null;
        const currentEntry = activeHistoryByCollector.get(collectorId);
        if (currentEntry) currentEntry.vigente = false;
        const historyId = new mongoose.Types.ObjectId();
        const entry = {
          _id: historyId,
          recolector: collectorId,
          campana: campaign._id,
          puntoAnterior: oldPoint,
          puntoNuevo: newPoint,
          administrador: req.user._id,
          fecha: new Date(),
          motivo: String(req.body?.motivo ?? "").trim().slice(0, 500),
          vigente: Boolean(newPoint),
        };
        history.push(entry);
        changed.push({
          recolector: collectorId,
          puntoNuevo: newPoint,
          nombrePunto: nextPoints.find((point) => String(point._id) === newPoint)?.nombre || "",
          historyId,
        });
      }

      const updated = await saveCampaignAssignments(campaign, nextPoints, history);
      if (!updated) continue;
      notifyPointAssignmentChanges(campaignId, changed);
      return res.status(200).json({
        campanaId: String(updated._id),
        puntos: updated.puntosRecoleccion,
        totalRecolectores: requestedIds.length,
      });
    }

    return res.status(409).json({
      msg: "La distribución cambió por otra solicitud concurrente; vuelve a consultar e inténtalo otra vez",
    });
  } catch (error) {
    console.error("Error distribuyendo recolectores:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al distribuir recolectores",
    });
  }
};

const reasignarRecolectorAPunto = async (req, res) => {
  try {
    const { campaignId, pointId } = req.params;
    const collectorId = String(req.body?.recolectorId ?? "").trim();
    if (
      !mongoose.isValidObjectId(campaignId)
      || !mongoose.isValidObjectId(pointId)
      || !mongoose.isValidObjectId(collectorId)
    ) {
      return res.status(400).json({ msg: "Los identificadores de campaña, punto y recolector deben ser válidos" });
    }
    const collectors = await validateAssignableCollectors([collectorId]);
    const collector = collectors[0];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const campaign = await Campana.findById(campaignId);
      if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
      const points = campaign.puntosRecoleccion.map((point) => point.toObject());
      validateCampaignPointCapacity(campaign.numeroRecolectores, points);
      const target = points.find((point) => String(point._id) === pointId);
      if (
        !target
        || target.activo === false
        || String(target.estado || "").toLowerCase() === "inactivo"
      ) {
        return res.status(404).json({ msg: "El punto activo no pertenece a la campaña" });
      }
      const previousAssignments = getAssignmentMap(points);
      const oldPointId = previousAssignments.get(collectorId) || null;
      if (oldPointId === pointId) {
        return res.status(409).json({ msg: "El recolector ya está asignado a ese punto" });
      }
      if (!oldPointId) {
        validateCampaignCapacity(campaign.numeroRecolectores, points, 1);
      }
      await assertNoOverlappingAssignments(campaign, [collectorId]);
      if ((target.recolectores || []).length >= MAX_RECOLECTORES_POR_PUNTO && oldPointId !== pointId) {
        return res.status(409).json({ msg: "El punto ya tiene el máximo de 3 recolectores" });
      }

      const nextPoints = points.map((point) => {
        const ids = (point.recolectores || []).map(String).filter((id) => id !== collectorId);
        if (String(point._id) === pointId) ids.push(collectorId);
        const responsible = String(point.responsableRecolector || "") === collectorId
          ? (ids[0] || null)
          : point.responsableRecolector;
        return {
          ...point,
          recolectores: ids,
          responsableRecolector: String(point._id) === pointId
            ? (responsible || collectorId)
            : responsible,
        };
      });
      const history = campaign.historialAsignacionesRecolectores.map((entry) => entry.toObject());
      for (const entry of history) {
        if (entry.vigente && String(entry.recolector) === collectorId) entry.vigente = false;
      }
      const historyEntryId = new mongoose.Types.ObjectId();
      history.push({
        _id: historyEntryId,
        recolector: collector._id,
        campana: campaign._id,
        puntoAnterior: oldPointId,
        puntoNuevo: pointId,
        administrador: req.user._id,
        fecha: new Date(),
        motivo: String(req.body?.motivo ?? "").trim().slice(0, 500),
        vigente: true,
      });
      const updated = await saveCampaignAssignments(campaign, nextPoints, history);
      if (!updated) continue;
      notifyPointAssignmentChanges(campaignId, [{
        recolector: collectorId,
        puntoNuevo: pointId,
        nombrePunto: target.nombre,
        historyId: historyEntryId,
      }]);
      return res.status(200).json({
        campanaId: campaignId,
        punto: updated.puntosRecoleccion.id(pointId),
        recolector: {
          _id: collector._id,
          nombre: collector.nombre,
          apellido: collector.apellido,
        },
        historialAsignaciones: updated.historialAsignacionesRecolectores,
      });
    }
    return res.status(409).json({ msg: "La asignación cambió concurrentemente; vuelve a intentarlo" });
  } catch (error) {
    console.error("Error reasignando recolector a punto:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al reasignar el recolector",
    });
  }
};

const listarUbicacionesRecolectores = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    const campaign = await Campana.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    const activeAssignments = (campaign.puntosRecoleccion || [])
      .filter((point) =>
        point.activo !== false
        && String(point.estado || "").toLowerCase() !== "inactivo"
      )
      .flatMap((point) => (point.recolectores || []).map((id) => ({
        collectorId: String(id),
        pointId: String(point._id),
        pointName: point.nombre,
      })));
    const collectors = await Recolector.find({
      _id: { $in: activeAssignments.map((assignment) => assignment.collectorId) },
    }).select("nombre apellido status ubicacionGps").lean();
    const byId = new Map(collectors.map((collector) => [String(collector._id), collector]));
    const simulations = isCollectorLocationSimulatorEnabled()
      ? await CollectorLocationSimulation.find({
          collector: { $in: activeAssignments.map((assignment) => assignment.collectorId) },
          campaign: campaignId,
          expiresAt: { $gt: new Date() },
        }).lean()
      : [];
    const simulationsByCollector = new Map(
      simulations.map((simulation) => [String(simulation.collector), simulation])
    );
    const now = Date.now();

    return res.status(200).json({
      campanaId: String(campaign._id),
      ubicaciones: activeAssignments.map((assignment) => {
        const collector = byId.get(assignment.collectorId);
        const simulation = simulationsByCollector.get(assignment.collectorId);
        const gps = simulation ?? collector?.ubicacionGps;
        const gpsCampaign = gps?.campana ?? gps?.campaign;
        const gpsPoint = gps?.puntoRecoleccion ?? gps?.point;
        const matchesAssignment =
          String(gpsCampaign || "") === campaignId
          && String(gpsPoint || "") === assignment.pointId;
        const derivedState = classifyCollectorLocation({
          collectorActive: collector?.status !== false,
          matchesAssignment,
          updatedAt: gps?.actualizadoEn ?? gps?.capturedAt,
          latitude: gps?.latitud ?? gps?.latitude,
          longitude: gps?.longitud ?? gps?.longitude,
          accuracyMeters: gps?.precisionMetros ?? gps?.accuracyMeters,
          now,
        });
        const state = simulation?.scenario === "sin_gps"
          ? "sin_registro"
          : derivedState;
        const geofenceState = classifyCollectorGeofenceState({
          collectorActive: collector?.status !== false,
          capturedAt: gps?.capturadoEn ?? gps?.capturedAt ?? gps?.actualizadoEn,
          latitude: gps?.latitud ?? gps?.latitude,
          longitude: gps?.longitud ?? gps?.longitude,
          accuracyMeters: gps?.precisionMetros ?? gps?.accuracyMeters,
          insideGeofence:
            gps != null
            && (gps.latitud != null
              ? isInsideEpnCampus(gps.latitud, gps.longitud)
              : gps.latitude != null
              && isInsideEpnCampus(gps.latitude, gps.longitude)),
          now,
        });
        return {
          recolector: collector
            ? { _id: collector._id, nombre: collector.nombre, apellido: collector.apellido }
            : { _id: assignment.collectorId },
          punto: { _id: assignment.pointId, nombre: assignment.pointName },
          estado: state,
          estadoGeografico: matchesAssignment ? geofenceState : "inactivo",
          simulada: Boolean(simulation),
          ...(simulation ? { escenario: simulation.scenario } : {}),
          coordenadas: matchesAssignment
            && geofenceState !== "inactivo"
            && hasValidCollectorCoordinates(
              gps?.latitud ?? gps?.latitude,
              gps?.longitud ?? gps?.longitude
            )
            ? {
                latitud: gps.latitud ?? gps.latitude,
                longitud: gps.longitud ?? gps.longitude,
              }
            : null,
          actualizadoEn: matchesAssignment
            ? gps.actualizadoEn ?? gps.updatedAt ?? gps.capturedAt
            : null,
          capturadoEn: matchesAssignment
            ? gps.capturadoEn ?? gps.capturedAt ?? gps.actualizadoEn
            : null,
        };
      }),
    });
  } catch (error) {
    console.error("Error consultando GPS de recolectores:", error.message || error);
    return res.status(500).json({ msg: "Error al consultar ubicaciones GPS" });
  }
};

export {
  listarCampanas,
  crearCampana,
  actualizarCampana,
  listarDistribucionRecolectores,
  distribuirRecolectores,
  reasignarRecolectorAPunto,
  listarUbicacionesRecolectores,
  normalizePickupPoints,
  countAssignedCollectors,
  validateCampaignCapacity,
  validateCampaignPointCapacity,
  validateCampaignHours,
  resolveCampaignState,
  countActivePickupPoints,
  campaignDateRangesOverlap,
};