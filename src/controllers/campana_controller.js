import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Categoria from "../models/Categoria.js";
import Donacion from "../models/Donacion.js";
import EntregaCampana from "../models/EntregaCampana.js";
import Recolector from "../models/Recolector.js";
import CollectorLocationSimulation from "../models/CollectorLocationSimulation.js";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";
import { notifyCampaignAssignmentChanges } from "../services/campaignAssignmentNotifications.js";
import {
  classifyCollectorGeofenceState,
  classifyCollectorLocation,
  hasValidCollectorCoordinates,
} from "../utils/collectorLocation.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import { isCollectorLocationSimulatorEnabled } from "../utils/devCollectorLocationSimulator.js";
import {
  buildInitialAssignmentHistory,
  buildPointAssignmentHistoryChanges,
  enrichAssignmentHistory,
} from "../utils/campaignAssignmentHistory.js";
import { resolveAcademicPeriod } from "../utils/academicPeriod.js";
import { buildCurrentCollectorCampaignFilter } from "../utils/collectorHistory.js";
import { listDonatedCampaignIds } from "../utils/donorCampaignHistory.js";
import {
  isCampaignAvailableNow,
  isCampaignDateFinished,
  isCampaignDateRangeValid,
  isCampaignScheduleFinished,
  normalizeCampaignDate,
} from "../utils/campaignSchedule.js";
import {
  getAvailableCollectorsForCampaign,
  hasCampaignScheduleOverlap,
  filterCurrentCollectorReservations,
  countCampaignCollectorAvailability,
} from "../utils/campaignAvailability.js";
import {
  isCollectorAssignedToPoint,
} from "../utils/pickupPoints.js";
import { publishCampaignEvent } from "../services/domainEvents.js";
import { transferCampaignCollectorDonations } from "../services/campaignCollectorReassignment.js";
import {
  getCampaignPrincipalCollectorId,
  getCampaignDeliveryReadiness,
  isCampaignFinished,
} from "../services/campaignDelivery.js";
import {
  selectLatestCollectorLocation,
  serializeCollectorLocation,
} from "../utils/collectorLocationSource.js";

const MAX_RECOLECTORES_POR_PUNTO = 3;

const getPointCollectorIds = (point) => [...new Set([
  ...(point?.recolectores || []).map((collector) =>
    String(collector?._id ?? collector)
  ),
  ...(point?.responsableRecolector
    ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
    : []),
].filter(Boolean))];

const countAssignedCollectors = (points) =>
  new Set(points.flatMap(getPointCollectorIds)).size;

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
      `La campaña permite ${maximum} recolector(es), pero tiene ${assigned} asignados y se intentan agregar ${additional}. Para cambiar un recolector asignado, usa la reasignación; no lo retires directamente`
    );
    error.statusCode = 409;
    throw error;
  }
};

const countActivePickupPoints = (points = []) =>
  points.filter(isActivePickupPoint).length;

const isActivePickupPoint = (point) =>
    point.activo !== false
    && String(point.estado || "").toLowerCase() !== "inactivo";

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

const normalizeCampaignDays = (value) => {
  if (value === undefined || value === null) return [];
  let parsedValue = value;
  if (typeof value === "string") {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = null;
    }
  }
  if (!Array.isArray(parsedValue)) {
    const error = new Error("Los días de atención deben enviarse como una lista");
    error.statusCode = 400;
    throw error;
  }
  const days = [...new Set(parsedValue.map(Number))].sort((left, right) => left - right);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    const error = new Error("Los días de atención deben ser enteros entre 1 y 7");
    error.statusCode = 400;
    throw error;
  }
  return days;
};

const toValidObjectIdStrings = (values = []) => [...new Set(
  (values || [])
    .map((value) => String(value?._id ?? value ?? ""))
    .filter((value) => value && mongoose.isValidObjectId(value))
)];

const listAvailableCollectorsForCampaign = async (campaign) => {
  const eligibleCollectors = await Recolector.find({
    confirmEmail: true,
    status: { $ne: false },
    aprobado: { $ne: false },
  })
    .select("_id campanaReservada reservasHorarioCampanas")
    .lean();
  if (!eligibleCollectors.length) return [];

  const reservationCampaignIds = toValidObjectIdStrings(
    eligibleCollectors.flatMap((collector) =>
      (collector.reservasHorarioCampanas || []).map((reservation) =>
        reservation.campana
      )
    )
  );
  const reservationCampaigns = reservationCampaignIds.length
    ? await Campana.find({ _id: { $in: reservationCampaignIds } })
        .select("_id estado activa puntosRecoleccion")
        .lean()
    : [];
  const collectorsWithCurrentReservations = eligibleCollectors.map((collector) => ({
    ...collector,
    reservasHorarioCampanas: filterCurrentCollectorReservations(
      collector.reservasHorarioCampanas,
      reservationCampaigns,
      collector._id
    ),
  }));

  const collectorIds = collectorsWithCurrentReservations.map((collector) => collector._id);
  const legacyCampaignIds = toValidObjectIdStrings(
    collectorsWithCurrentReservations
      .filter((collector) =>
        collector.campanaReservada
        && String(collector.campanaReservada) !== String(campaign._id)
        && !(collector.reservasHorarioCampanas || []).some(
          (reservation) =>
            String(reservation.campana) === String(collector.campanaReservada)
        )
      )
      .map((collector) => collector.campanaReservada)
  );
  const assignedCampaigns = await Campana.find({
    _id: { $ne: campaign._id },
    activa: true,
    $or: [
      { "puntosRecoleccion.recolectores": { $in: collectorIds } },
      { _id: { $in: legacyCampaignIds } },
    ],
  })
    .select("nombre activa estado fechaInicio fechaFin horaInicio horaFin diasAtencion puntosRecoleccion")
    .lean();
  return getAvailableCollectorsForCampaign(
    collectorsWithCurrentReservations,
    assignedCampaigns,
    campaign
  );
};

const resolveCampaignState = (campaign, now = new Date()) => {
  const storedState = String(campaign?.estado ?? "").toLowerCase();
  if (storedState === "cerrada") return "cerrada";
  if (storedState === "finalizada") return "finalizada";
  if (storedState === "borrador") return "borrador";
  if (
    (campaign?.activa === true || storedState === "desactivada")
    && isCampaignDateFinished(campaign, now)
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
  collectorIds
) => {
  const ids = [...new Set((collectorIds || []).map(String).filter(Boolean))];
  if (!ids.length) return;
  const otherCampaigns = await Campana.find({
    _id: { $ne: campaign._id },
    "puntosRecoleccion.recolectores": { $in: ids },
  })
    .select("nombre activa estado fechaInicio fechaFin horaInicio horaFin diasAtencion puntosRecoleccion")
    .lean();

  for (const other of otherCampaigns) {
    if (resolveCampaignState(other) !== "activa") continue;
    for (const id of ids) {
      const requestedPoint = (campaign.puntosRecoleccion || []).find((point) =>
        (point.recolectores || []).some((collectorId) => String(collectorId) === id)
      );
      const existingPoint = (other.puntosRecoleccion || []).find((point) =>
        (point.recolectores || []).some((collectorId) => String(collectorId) === id)
      );
      if (
        requestedPoint
        && existingPoint
        && hasCampaignScheduleOverlap(campaign, requestedPoint, other, existingPoint)
      ) {
        const error = new Error(
          `El recolector ya tiene una asignación en horario coincidente con la campaña "${other.nombre}"`
        );
        error.statusCode = 409;
        throw error;
      }
    }
  }
};

const reserveCollectorsForCampaign = async (campaign, collectorIds, { session } = {}) => {
  const updatedReservations = [];
  try {
    for (const collectorId of [...new Set((collectorIds || []).map(String))]) {
      const campaignId = String(campaign._id);
      const point = (campaign.puntosRecoleccion || []).find((item) =>
        getPointCollectorIds(item).includes(collectorId)
      );
      if (!point) {
        const error = new Error("No se encontró el punto asignado al recolector");
        error.statusCode = 409;
        throw error;
      }

      const requested = {
        campana: campaign._id,
        nombreCampana: campaign.nombre || "",
        fechaInicio: campaign.fechaInicio ?? null,
        fechaFin: campaign.fechaFin ?? null,
        horaInicio: campaign.horaInicio || "",
        horaFin: campaign.horaFin || "",
        diasAtencion: campaign.diasAtencion || [],
        punto: {
          _id: point._id,
          nombre: point.nombre || "",
          horariosAtencion: point.horariosAtencion || [],
        },
      };
      let saved = false;
      for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
        let collectorQuery = Recolector.findById(collectorId)
          .select("+versionReservasHorario campanaReservada reservasHorarioCampanas status aprobado confirmEmail");
        if (session) collectorQuery = collectorQuery.session(session);
        const collector = await collectorQuery.lean();
        if (
          !collector
          || collector.status === false
          || collector.aprobado === false
          || !collector.confirmEmail
        ) {
          const error = new Error("El recolector ya no está habilitado");
          error.statusCode = 409;
          throw error;
        }

        const storedReservations = collector.reservasHorarioCampanas || [];
        const reservationCampaignIds = [...new Set(
          storedReservations.map((reservation) => String(reservation.campana))
        )];
        const reservationCampaigns = reservationCampaignIds.length
          ? await Campana.find({ _id: { $in: reservationCampaignIds } })
              .select("_id estado activa puntosRecoleccion")
              .lean()
          : [];
        const existingReservations = filterCurrentCollectorReservations(
          storedReservations,
          reservationCampaigns,
          collectorId
        );
        for (const existing of existingReservations) {
          if (
            String(existing.campana) !== campaignId
            && hasCampaignScheduleOverlap(
              campaign,
              point,
              existing,
              existing.punto
            )
          ) {
            const error = new Error(
              `El recolector ya tiene una asignación en horario coincidente con la campaña "${existing.nombreCampana}"`
            );
            error.statusCode = 409;
            throw error;
          }
        }

        const legacyCampaignId = collector.campanaReservada
          ? String(collector.campanaReservada)
          : "";
        if (
          legacyCampaignId
          && legacyCampaignId !== campaignId
          && !existingReservations.some(
            (entry) => String(entry.campana) === legacyCampaignId
          )
        ) {
          let legacyCampaignQuery = Campana.findById(legacyCampaignId)
            .select("nombre fechaInicio fechaFin horaInicio horaFin diasAtencion puntosRecoleccion");
          if (session) legacyCampaignQuery = legacyCampaignQuery.session(session);
          const legacyCampaign = await legacyCampaignQuery.lean();
          const legacyPoint = (legacyCampaign?.puntosRecoleccion || []).find(
            (item) => (item.recolectores || []).some(
              (assignedId) => String(assignedId) === collectorId
            )
          );
          if (
            legacyCampaign
            && resolveCampaignState(legacyCampaign) === "activa"
            && legacyPoint
            && hasCampaignScheduleOverlap(
              campaign,
              point,
              legacyCampaign,
              legacyPoint
            )
          ) {
            const error = new Error(
              `El recolector ya tiene una asignación en horario coincidente con la campaña "${legacyCampaign.nombre}"`
            );
            error.statusCode = 409;
            throw error;
          }
        }

        const previousReservation = storedReservations.find(
          (entry) => String(entry.campana) === campaignId
        ) || null;
        const nextReservations = existingReservations.filter(
          (entry) => String(entry.campana) !== campaignId
        );
        nextReservations.push(requested);
        const versionFilter = collector.versionReservasHorario === undefined
          ? {
              $or: [
                { versionReservasHorario: 0 },
                { versionReservasHorario: { $exists: false } },
              ],
            }
          : { versionReservasHorario: collector.versionReservasHorario };
        const update = await Recolector.updateOne(
          { _id: collectorId, ...versionFilter },
          {
            $set: {
              reservasHorarioCampanas: nextReservations,
              ...(collector.campanaReservada ? {} : { campanaReservada: campaign._id }),
            },
            $inc: { versionReservasHorario: 1 },
          },
          session ? { session } : undefined
        );
        saved = (update.matchedCount ?? update.n) === 1;
        if (saved) {
          updatedReservations.push({
            collectorId,
            campaignId,
            previousReservation,
            previousCampaignId: collector.campanaReservada
              ? String(collector.campanaReservada)
              : "",
          });
        }
      }
      if (!saved) {
        const error = new Error(
          "El recolector cambió mientras se reservaba; vuelve a intentarlo"
        );
        error.statusCode = 409;
        throw error;
      }
    }
    return updatedReservations;
  } catch (error) {
    if (!session) {
      await rollbackCollectorReservations(campaign._id, updatedReservations);
    }
    throw error;
  }
};

const rollbackCollectorReservations = async (campaignId, reservations) => {
  for (const reservation of reservations) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const collector = await Recolector.findById(reservation.collectorId)
        .select("+versionReservasHorario campanaReservada reservasHorarioCampanas")
        .lean();
      if (!collector) break;
      const nextReservations = (collector.reservasHorarioCampanas || [])
        .filter((entry) => String(entry.campana) !== campaignId);
      if (reservation.previousReservation) {
        nextReservations.push(reservation.previousReservation);
      }
      const versionFilter = collector.versionReservasHorario === undefined
        ? {
            $or: [
              { versionReservasHorario: 0 },
              { versionReservasHorario: { $exists: false } },
            ],
          }
        : { versionReservasHorario: collector.versionReservasHorario };
      const result = await Recolector.updateOne(
        {
          _id: reservation.collectorId,
          ...versionFilter,
        },
        {
          $set: {
            reservasHorarioCampanas: nextReservations,
            ...(String(collector.campanaReservada || "") === campaignId
              ? { campanaReservada: reservation.previousCampaignId || null }
              : {}),
          },
          $inc: { versionReservasHorario: 1 },
        }
      );
      if ((result.matchedCount ?? result.n) === 1) break;
    }
  }
};

const releaseCampaignCollectorReservations = async (campaignId) => {
  await Recolector.updateMany(
    { "reservasHorarioCampanas.campana": campaignId },
    {
      $pull: { reservasHorarioCampanas: { campana: campaignId } },
      $inc: { versionReservasHorario: 1 },
    }
  );
  await Recolector.updateMany(
    { campanaReservada: campaignId },
    { $set: { campanaReservada: null } }
  );
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

const normalizeCampaignResponsibilities = (value) => {
  if (!Array.isArray(value)) {
    const error = new Error("Los responsables de campaña deben enviarse como una lista");
    error.statusCode = 400;
    throw error;
  }
  if (value.length > 50) {
    const error = new Error("Una campaña no puede tener más de 50 responsables");
    error.statusCode = 400;
    throw error;
  }
  return value.map((person) => {
    const nombreCompleto = typeof person?.nombreCompleto === "string"
      ? person.nombreCompleto.trim()
      : "";
    const cargo = typeof person?.cargo === "string" ? person.cargo.trim() : "";
    if (!nombreCompleto || nombreCompleto.length > 160 || !cargo || cargo.length > 120) {
      const error = new Error(
        "Cada responsable requiere nombre completo y cargo (máximo 160 y 120 caracteres)"
      );
      error.statusCode = 400;
      throw error;
    }
    return { nombreCompleto, cargo };
  });
};

const buildPointAssignmentsAfterRoleChange = (
  points,
  collectorId,
  pointId,
  requestedRole,
  replacedCollectorId = null
) => {
  if (replacedCollectorId) {
    if (String(replacedCollectorId) === String(collectorId)) {
      throw Object.assign(
        new Error("El recolector sustituto debe ser distinto al recolector anterior"),
        { statusCode: 400 }
      );
    }
    const target = points.find((point) => String(point._id) === String(pointId));
    const previousIds = getPointCollectorIds(target);
    if (!previousIds.includes(String(replacedCollectorId))) {
      throw Object.assign(
        new Error("El recolector sustituido no está asignado al punto indicado"),
        { statusCode: 409 }
      );
    }
    const previousRole = String(target?.responsableRecolector || "") === String(replacedCollectorId)
      ? "principal"
      : "apoyo";
    const pointsWithoutPrevious = points.map((point) => {
      if (String(point._id) !== String(pointId)) return point;
      const recolectores = getPointCollectorIds(point)
        .filter((id) => id !== String(replacedCollectorId));
      return {
        ...point,
        recolectores,
        responsableRecolector:
          String(point.responsableRecolector || "") === String(replacedCollectorId)
            ? null
            : point.responsableRecolector,
      };
    });
    return buildPointAssignmentsAfterRoleChange(
      pointsWithoutPrevious,
      collectorId,
      pointId,
      requestedRole || previousRole
    );
  }

  const target = points.find((point) => String(point._id) === String(pointId));
  const targetIds = getPointCollectorIds(target);
  const targetHasMain =
    target?.responsableRecolector
    && targetIds.includes(String(target.responsableRecolector));
  if (requestedRole === "apoyo" && !targetHasMain) {
    throw Object.assign(
      new Error("Asigna primero un recolector principal al punto"),
      { statusCode: 409 }
    );
  }
  if (
    requestedRole === "apoyo"
    && String(target?.responsableRecolector || "") === String(collectorId)
  ) {
    throw Object.assign(
      new Error("Designa primero a otro recolector como principal antes de cambiar el principal actual a apoyo"),
      { statusCode: 409 }
    );
  }

  return points.map((point) => {
    const isTarget = String(point._id) === String(pointId);
    const ids = getPointCollectorIds(point);
    const wasPrincipal =
      String(point.responsableRecolector || "") === String(collectorId);
    if (!isTarget) {
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        if (ids[index] === String(collectorId)) ids.splice(index, 1);
      }
    } else if (!ids.includes(String(collectorId))) {
      ids.push(String(collectorId));
    }
    const existingMainIsAssigned = ids.includes(
      String(point.responsableRecolector || "")
    );
    const responsible = isTarget
      ? requestedRole === "principal"
        ? collectorId
        : requestedRole === "apoyo" && wasPrincipal
          ? ids.find((id) => id !== String(collectorId)) || null
          : existingMainIsAssigned
            ? point.responsableRecolector
            : null
      : wasPrincipal
        ? null
        : existingMainIsAssigned
          ? point.responsableRecolector
          : null;
    if (
      (isTarget || wasPrincipal)
      && (
        !responsible
        || !ids.includes(String(responsible))
      )
    ) {
      throw Object.assign(
        new Error(
          isTarget
            ? "Selecciona un recolector principal para el punto"
            : "Asigna otro recolector como principal antes de retirar o mover el principal actual"
        ),
        { statusCode: 409 }
      );
    }
    return {
      ...point,
      recolectores: ids,
      responsableRecolector: responsible,
    };
  });
};

const normalizePickupPoints = (
  value,
  existingPoints = [],
  requireComplete = false,
  requirePrincipalForNewOrConfigured = false
) => {
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
    const hasCollectorConfiguration =
      Object.hasOwn(item, "responsableRecolector")
      || Object.hasOwn(item, "recolectoresSecundarios")
      || Object.hasOwn(item, "recolectores");
    const rawPrincipal = hasCollectorConfiguration
      ? item.responsableRecolector
      : existing?.responsableRecolector;
    const principalId = rawPrincipal ? String(rawPrincipal._id ?? rawPrincipal) : "";
    const rawSecondaryIds = Object.hasOwn(item, "recolectoresSecundarios")
      ? item.recolectoresSecundarios
      : Object.hasOwn(item, "recolectores")
        ? (Array.isArray(item.recolectores) ? item.recolectores : [])
            .map((collector) => String(collector?._id ?? collector))
            .filter((id) => id !== principalId)
        : (existing?.recolectores || [])
            .map((collector) => String(collector?._id ?? collector))
            .filter((id) => id !== principalId);
    if (!Array.isArray(rawSecondaryIds)) {
      const error = new Error("Los recolectores secundarios deben enviarse como una lista");
      error.statusCode = 400;
      throw error;
    }
    const secondaryIds = rawSecondaryIds.map((collector) =>
      String(collector?._id ?? collector)
    );
    const rawRequiredCollectorCount = Object.hasOwn(item, "recolectoresRequeridos")
      ? item.recolectoresRequeridos
      : existing?.recolectoresRequeridos;
    const requiredCollectorCount = rawRequiredCollectorCount === undefined
      || rawRequiredCollectorCount === null
      || rawRequiredCollectorCount === ""
      ? null
      : Number(rawRequiredCollectorCount);
    if (
      requiredCollectorCount !== null
      && (
        !Number.isInteger(requiredCollectorCount)
        || requiredCollectorCount < 1
        || requiredCollectorCount > MAX_RECOLECTORES_POR_PUNTO
      )
    ) {
      const error = new Error(
        `La cantidad requerida por punto debe ser un entero entre 1 y ${MAX_RECOLECTORES_POR_PUNTO}`
      );
      error.statusCode = 400;
      throw error;
    }
    if (
      (requirePrincipalForNewOrConfigured && (!existing || hasCollectorConfiguration))
      && !principalId
    ) {
      const error = new Error("Debes asignar un recolector principal al punto");
      error.statusCode = 400;
      throw error;
    }
    if (
      principalId
      && !mongoose.isValidObjectId(principalId)
      || secondaryIds.some((id) => !mongoose.isValidObjectId(id))
    ) {
      const error = new Error("Los identificadores de recolectores del punto no son válidos");
      error.statusCode = 400;
      throw error;
    }
    if (
      (principalId && secondaryIds.includes(principalId))
      || new Set(secondaryIds).size !== secondaryIds.length
    ) {
      const error = new Error(
        "El recolector principal no puede repetirse como secundario y no se permiten secundarios duplicados"
      );
      error.statusCode = 409;
      throw error;
    }
    if (requiredCollectorCount !== null) {
      const assignedCollectorCount = new Set([
        ...(principalId ? [principalId] : []),
        ...secondaryIds,
      ]).size;
      if (assignedCollectorCount < requiredCollectorCount) {
        const missingCollectors = requiredCollectorCount - assignedCollectorCount;
        const error = new Error(
          missingCollectors === 1
            ? "Falta 1 recolector para completar el punto"
            : `Faltan ${missingCollectors} recolectores para completar el punto`
        );
        error.statusCode = 409;
        throw error;
      }
    }
    if (principalId && secondaryIds.length + 1 > MAX_RECOLECTORES_POR_PUNTO) {
      const error = new Error("Un punto no puede tener más de 3 recolectores en total");
      error.statusCode = 409;
      throw error;
    }
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
      recolectoresRequeridos: requiredCollectorCount,
      recolectores: principalId
        ? [principalId, ...secondaryIds].map((id) => new mongoose.Types.ObjectId(id))
        : existing?.recolectores || [],
      responsableRecolector: principalId
        ? new mongoose.Types.ObjectId(principalId)
        : existing?.responsableRecolector || null,
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

const validateAssignableCollectors = async (ids, { session } = {}) => {
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
  let collectorQuery = Recolector.find({
    _id: { $in: normalizedIds },
    confirmEmail: true,
    status: { $ne: false },
    aprobado: { $ne: false },
  }).select("_id nombre apellido");
  if (session) collectorQuery = collectorQuery.session(session);
  const collectors = await collectorQuery.lean();
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
  if (activePoints.some((point) =>
    !point.responsableRecolector
    || !(point.recolectores || []).some(
      (collectorId) => String(collectorId) === String(point.responsableRecolector)
    )
  )) {
    const error = new Error(
      "Cada punto activo debe tener exactamente un recolector principal asignado"
    );
    error.statusCode = 409;
    throw error;
  }
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
  if (activeCollectors !== activeAssignedIds.length) {
    const error = new Error(
      "Todos los recolectores asignados a puntos activos deben estar activos, aprobados y verificados"
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

const listarCampanas = async (req, res) => {
  try {
    const rol = String(req.user?.rol || "").toLowerCase();
    const period = req.query?.periodoAcademico
      ? String(req.query.periodoAcademico).trim()
      : "";
    const search = req.query?.q ? String(req.query.q).trim() : "";
    if (period && !/^\d{4}-[AB]$/.test(period)) {
      return res.status(400).json({ msg: "Período académico inválido" });
    }
    if (search.length > 100) {
      return res.status(400).json({ msg: "La búsqueda no puede superar 100 caracteres" });
    }

    // Los donantes también conservan acceso a campañas donde ya tienen donaciones.
    // Los recolectores solo consultan campañas con puntos actualmente asignados.
    const donatedCampaignIds = rol === "donante"
      ? await listDonatedCampaignIds(req.user?._id)
      : [];
    const donatedCampaignIdSet = new Set(donatedCampaignIds.map(String));
    const filtro = rol === "admin" && req.query.todas === "true"
      ? {}
      : rol === "recolector"
        ? buildCurrentCollectorCampaignFilter({
            collectorId: req.user._id,
            period,
            search,
          })
        : rol === "donante"
          ? {
              $or: [
                { activa: true },
                ...(donatedCampaignIds.length
                  ? [{ _id: { $in: donatedCampaignIds } }]
                  : []),
              ],
              ...(period ? { periodoAcademico: period } : {}),
              ...(search ? { nombre: new RegExp(escapeRegex(search), "i") } : {}),
            }
          : { activa: true };

    let campanas = await Campana.find(filtro)
      .populate({
        path: "categoriasPermitidas",
        match: rol === "donante" ? {} : { activa: true },
        select: "nombre activa",
      })
      .sort({ createdAt: -1 });

    const campaignIds = campanas.map((campaign) => campaign._id);
    const deliveryReadinessByCampaign = new Map(
      rol === "recolector"
        ? await Promise.all(campanas.map(async (campaign) => [
            String(campaign._id),
            await getCampaignDeliveryReadiness({
              campaign,
              collectorId: req.user._id,
            }),
          ]))
        : []
    );
    const finishedCampaignIds = campanas
      .filter((campaign) => isCampaignFinished(campaign))
      .map((campaign) => campaign._id);
    const deliveredCampaignIds = finishedCampaignIds.length
      ? new Set((await EntregaCampana.distinct("campana", {
          campana: { $in: finishedCampaignIds },
        })).map(String))
      : new Set();
    const responseCampaigns = campanas.map((campaign) => {
        const serialized = campaign.toObject();
          serialized.periodoAcademico = serialized.periodoAcademico ?? null;
        const deliveryReadiness = deliveryReadinessByCampaign.get(String(campaign._id));
        serialized.puedeEntregar = rol === "recolector"
          && Boolean(deliveryReadiness?.puedeEntregar);
        serialized.cerrada = isCampaignFinished(campaign)
          && deliveredCampaignIds.has(String(campaign._id));
        if (
          rol === "recolector"
          && process.env.CAMPAIGN_DELIVERY_DEBUG === "true"
        ) {
          serialized.debug = deliveryReadiness?.debug;
        }
        if (
          rol === "donante"
          && !donatedCampaignIdSet.has(String(campaign._id))
        ) {
          serialized.categoriasPermitidas = (serialized.categoriasPermitidas || [])
            .filter((category) => category?.activa !== false);
        }
        serialized.categoriasPermitidas = (serialized.categoriasPermitidas || [])
          .map((category) => {
            if (category && typeof category === "object") delete category.activa;
            return category;
          });
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
                && isCollectorAssignedToPoint(point, req.user._id)
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
  let uploadedCampaignImage = null;
  let createdCampaign = null;
  let reservations = [];
  let availability = null;
  try {
    const {
      nombre,
      descripcion,
      ubicacion,
      fechaInicio,
      fechaFin,
      periodoAcademico,
      horaInicio,
      horaFin,
      diasAtencion,
      activa,
      numeroRecolectores,
      metaDonaciones,
      categoriasPermitidas = [],
      puntosRecoleccion = [],
      responsablesCampana = [],
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

    const inicio = normalizeCampaignDate(fechaInicio);
    const fin = normalizeCampaignDate(fechaFin);

    if (!inicio) {
      return res.status(400).json({
        msg: "La fecha de inicio no es válida",
      });
    }

    if (!fin) {
      return res.status(400).json({
        msg: "La fecha de fin no es válida",
      });
    }

    if (!isCampaignDateRangeValid(inicio, fin)) {
      return res.status(400).json({
        msg: "La fecha de finalización no puede ser anterior a la de inicio",
      });
    }
    let diasAtencionNormalizados;
    try {
      diasAtencionNormalizados = normalizeCampaignDays(diasAtencion);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ msg: error.message });
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
    if (
      periodoAcademico !== undefined
      && periodoAcademico !== null
      && (typeof periodoAcademico !== "string" || periodoAcademico.trim().length > 40)
    ) {
      return res.status(400).json({
        msg: "El período académico debe ser texto de máximo 40 caracteres",
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
    const responsables = normalizeCampaignResponsibilities(responsablesCampana);
    const puntos = normalizePickupPoints(puntosRecoleccion, [], true, true);
    validateCampaignCapacity(collectorLimit, puntos);
    validateCampaignPointCapacity(collectorLimit, puntos);
    const assignedIds = puntos.flatMap(getPointCollectorIds);
    if (new Set(assignedIds).size !== assignedIds.length) {
      return res.status(409).json({
        msg: "Un recolector no puede asignarse a más de un punto de la misma campaña",
      });
    }
    await validateAssignableCollectors(assignedIds);
    if (req.files?.imagen) {
      uploadedCampaignImage = await uploadImage(req.files.imagen, "donaty/campanas");
    }

    createdCampaign = new Campana({
      nombre: nombre.trim(),
      descripcion:
        typeof descripcion === "string" ? descripcion.trim() : "",
      ubicacion: ubicacion.trim(),
      fechaInicio: inicio,
      fechaFin: fin,
      diasAtencion: diasAtencionNormalizados,
      periodoAcademico: String(periodoAcademico || "").trim() || resolveAcademicPeriod(inicio),
      ...campaignHours,
      estado: "borrador",
      activa: false,
      numeroRecolectores: collectorLimit,
      metaDonaciones: donationGoal,
      categoriasPermitidas: categorias,
      responsablesCampana: responsables,
      puntosRecoleccion: puntos,
      ...(uploadedCampaignImage || {}),
    });
    const initialAssignmentDate = new Date();
    createdCampaign.historialAsignacionesRecolectores = buildInitialAssignmentHistory({
      points: createdCampaign.puntosRecoleccion,
      campaignId: createdCampaign._id,
      administratorId: req.user._id,
      assignedAt: initialAssignmentDate,
    });
    const activeAssignedIds = puntos
      .filter(isActivePickupPoint)
      .flatMap(getPointCollectorIds);
    await assertNoOverlappingAssignments(createdCampaign, activeAssignedIds);
    const availableCollectors = await listAvailableCollectorsForCampaign(createdCampaign);
    const collectorAvailability = countCampaignCollectorAvailability(
      availableCollectors,
      activeAssignedIds
    );
    availability = {
      puedeCrear: true,
      requeridos: collectorLimit,
      maximo: collectorLimit,
      asignados: collectorAvailability.asignados,
      disponiblesAdicionales: collectorAvailability.disponiblesAdicionales,
      disponibles: collectorAvailability.disponibles,
      faltantes: 0,
    };
    reservations = await reserveCollectorsForCampaign(createdCampaign, activeAssignedIds);
    await createdCampaign.save();

    const notificaciones = await notifyCampaignAssignmentChanges(
      createdCampaign,
      [],
      { eventPrefix: "campaign-created-assignment" }
    );
    await publishCampaignEvent(req, "campaign.created", createdCampaign);
    return res.status(201).json({
      msg: "Campaña creada correctamente",
      campana: createdCampaign,
      disponibilidad: availability,
      notificaciones,
    });
  } catch (error) {
    console.error("Error al crear campaña:", error);
    if (reservations.length && createdCampaign?._id) {
      await rollbackCollectorReservations(createdCampaign._id, reservations);
    }
    if (createdCampaign?._id) {
      await Campana.findByIdAndDelete(createdCampaign._id);
    }
    if (uploadedCampaignImage?.imagenPublicId) {
      try {
        await deleteImage(uploadedCampaignImage.imagenPublicId);
      } catch (cleanupError) {
        console.error(
          "No se pudo limpiar la imagen de campaña no guardada:",
          cleanupError.message || cleanupError
        );
      }
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        msg: error.message,
        ...(error.availability ? { disponibilidad: error.availability } : {}),
      });
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
      "periodoAcademico",
      "horaInicio",
      "horaFin",
      "diasAtencion",
      "estado",
      "activa",
      "numeroRecolectores",
      "metaDonaciones",
      "categoriasPermitidas",
      "responsablesCampana",
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
          const fecha = normalizeCampaignDate(cambios[campo]);

          if (!fecha) {
            return res.status(400).json({
              msg: `El campo ${campo} no contiene una fecha válida`,
            });
          }
          cambios[campo] = fecha;
        }
      }
    }
    if (cambios.periodoAcademico !== undefined) {
      if (cambios.periodoAcademico === null || cambios.periodoAcademico === "") {
        cambios.periodoAcademico = null;
      } else if (
        typeof cambios.periodoAcademico !== "string"
        || cambios.periodoAcademico.trim().length > 40
      ) {
        return res.status(400).json({
          msg: "El período académico debe ser texto de máximo 40 caracteres",
        });
      } else {
        cambios.periodoAcademico = cambios.periodoAcademico.trim();
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
    if (cambios.diasAtencion !== undefined) {
      try {
        cambios.diasAtencion = normalizeCampaignDays(cambios.diasAtencion);
      } catch (error) {
        return res.status(error.statusCode || 400).json({ msg: error.message });
      }
    }

    if (cambios.categoriasPermitidas !== undefined) {
      cambios.categoriasPermitidas = await validateCampaignCategories(
        cambios.categoriasPermitidas
      );
    }
    if (cambios.responsablesCampana !== undefined) {
      cambios.responsablesCampana = normalizeCampaignResponsibilities(
        cambios.responsablesCampana
      );
    }

    const actual = await Campana.findById(id);

    if (!actual) {
      return res.status(404).json({
        msg: "La campaña no existe",
      });
    }
    const previousPoints = actual.puntosRecoleccion.map((point) => point.toObject());
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
    const scheduleDataChanged = [
      "fechaInicio",
      "fechaFin",
      "horaInicio",
      "horaFin",
    ].some((field) => cambios[field] !== undefined);
    if (!closingCampaign || scheduleDataChanged) {
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
        actual.puntosRecoleccion,
        false,
        true
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
    const previousCollectorIds = new Set(
      (actual.puntosRecoleccion || []).flatMap((point) =>
        getPointCollectorIds(point)
      )
    );
    const requestedPointCollectorIds = (cambios.puntosRecoleccion ?? actual.puntosRecoleccion)
      .flatMap(getPointCollectorIds);
    if (new Set(requestedPointCollectorIds).size !== requestedPointCollectorIds.length) {
      return res.status(409).json({
        msg: "Un recolector no puede asignarse a más de un punto de la misma campaña",
      });
    }
    const addedCollectorIds = requestedPointCollectorIds.filter(
      (collectorId) => !previousCollectorIds.has(collectorId)
    );
    const removedCollectorIds = [...previousCollectorIds].filter(
      (collectorId) => !requestedPointCollectorIds.includes(collectorId)
    );
    if (
      removedCollectorIds.length
      && countAssignedCollectors(previousPoints) >= Number(actual.numeroRecolectores || 0)
    ) {
      return res.status(409).json({
        msg: "No retires directamente a un recolector cuando el máximo está ocupado; sustitúyelo mediante la reasignación",
      });
    }
    if (cambios.puntosRecoleccion !== undefined) {
      await validateAssignableCollectors(requestedPointCollectorIds);
      const activeRequestedCollectorIds = (cambios.puntosRecoleccion || [])
        .filter(isActivePickupPoint)
        .flatMap((point) => (point.recolectores || []).map(String));
      await assertNoOverlappingAssignments(
        {
          ...actual.toObject(),
          ...cambios,
          puntosRecoleccion: cambios.puntosRecoleccion,
        },
        activeRequestedCollectorIds
      );
    }

    const fechaInicio =
      cambios.fechaInicio !== undefined
        ? cambios.fechaInicio
        : actual.fechaInicio;

    const fechaFin =
      cambios.fechaFin !== undefined ? cambios.fechaFin : actual.fechaFin;
    if (
      cambios.periodoAcademico === undefined
      && cambios.fechaInicio !== undefined
      && fechaInicio
    ) {
      cambios.periodoAcademico = resolveAcademicPeriod(fechaInicio);
    } else if (!actual.periodoAcademico && actual.fechaInicio) {
      cambios.periodoAcademico = resolveAcademicPeriod(actual.fechaInicio);
    }

    if (
      fechaInicio
      && fechaFin
      && !isCampaignDateRangeValid(fechaInicio, fechaFin)
    ) {
      return res.status(400).json({
        msg: "La fecha de finalización no puede ser anterior a la de inicio",
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
    const campaignToSave = {
      ...actual.toObject(),
      ...cambios,
      fechaInicio,
      fechaFin,
    };
    if (cambios.puntosRecoleccion !== undefined) {
      cambios.historialAsignacionesRecolectores = buildPointAssignmentHistoryChanges({
        previousPoints: actual.puntosRecoleccion,
        nextPoints: cambios.puntosRecoleccion,
        history: actual.historialAsignacionesRecolectores,
        campaignId: actual._id,
        administratorId: req.user._id,
        assignedAt: new Date(),
      });
      campaignToSave.historialAsignacionesRecolectores =
        cambios.historialAsignacionesRecolectores;
    }
    const campaignWillBeActive =
      resolveCampaignState(campaignToSave) === "activa";
    if (
      cambios.fechaInicio !== undefined ||
      cambios.fechaFin !== undefined ||
      cambios.activa === true ||
      cambios.puntosRecoleccion !== undefined ||
      campaignWillBeActive
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
      await assertNoOverlappingAssignments(campaignToSave, assignedCollectorIds);
    }

    let imagenNueva;
    let reservations = [];
    try {
      const activePoints = (campaignToSave.puntosRecoleccion || []).filter(
        isActivePickupPoint
      );
      const activeCollectorIds = [
        ...new Set(activePoints.flatMap((point) =>
          (point.recolectores || []).map(String)
        )),
      ];
      const scheduleChanged =
        cambios.fechaInicio !== undefined
        || cambios.fechaFin !== undefined
        || cambios.horaInicio !== undefined
        || cambios.horaFin !== undefined
        || cambios.diasAtencion !== undefined
        || cambios.puntosRecoleccion !== undefined;
      if (campaignWillBeActive || scheduleChanged) {
        await validateAssignableCollectors(activeCollectorIds);
        reservations = await reserveCollectorsForCampaign(
          campaignToSave,
          activeCollectorIds
        );
      } else if (addedCollectorIds.length) {
        const activeCollectorIds = new Set(
          activePoints.flatMap((point) => (point.recolectores || []).map(String))
        );
        reservations = await reserveCollectorsForCampaign(
          campaignToSave,
          addedCollectorIds.filter((collectorId) =>
            activeCollectorIds.has(collectorId)
          )
        );
      }
      imagenNueva = await uploadImage(req.files?.imagen, "donaty/campanas");
      const imagenAnteriorPublicId = actual.imagenPublicId;
      Object.assign(actual, cambios, imagenNueva || {});
      await actual.save();
      reservations = [];
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
    } catch (error) {
      await rollbackCollectorReservations(campaignToSave._id, reservations);
      if (imagenNueva?.imagenPublicId) {
        try {
          await deleteImage(imagenNueva.imagenPublicId);
        } catch (cleanupError) {
          console.error(
            "No se pudo limpiar la imagen de campaña no guardada:",
            cleanupError.message || cleanupError
          );
        }
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({ msg: error.message });
      }
      throw error;
    }

    if (resolveCampaignState(actual) !== "activa") {
      try {
        await releaseCampaignCollectorReservations(actual._id);
      } catch (error) {
        console.error(
          "Campaña actualizada, pero no se pudieron liberar las reservas:",
          error.message || error
        );
        return res.status(500).json({
          msg: "La campaña se actualizó, pero no se pudieron liberar los recolectores",
        });
      }
    }
    if (removedCollectorIds.length) {
      await Recolector.updateMany(
        {
          _id: { $in: removedCollectorIds },
          "reservasHorarioCampanas.campana": actual._id,
        },
        {
          $pull: { reservasHorarioCampanas: { campana: actual._id } },
          $inc: { versionReservasHorario: 1 },
        }
      );
      await Recolector.updateMany(
        {
          _id: { $in: removedCollectorIds },
          campanaReservada: actual._id,
        },
        { $set: { campanaReservada: null } }
      );
    }
    const inactivePointCollectorIds = [
      ...new Set(
        (campaignToSave.puntosRecoleccion || [])
          .filter((point) => !isActivePickupPoint(point))
          .flatMap((point) => (point.recolectores || []).map(String))
      ),
    ];
    if (inactivePointCollectorIds.length) {
      await Recolector.updateMany(
        {
          _id: { $in: inactivePointCollectorIds },
          "reservasHorarioCampanas.campana": actual._id,
        },
        {
          $pull: { reservasHorarioCampanas: { campana: actual._id } },
          $inc: { versionReservasHorario: 1 },
        }
      );
      await Recolector.updateMany(
        {
          _id: { $in: inactivePointCollectorIds },
          campanaReservada: actual._id,
        },
        { $set: { campanaReservada: null } }
      );
    }

    const notificaciones = cambios.puntosRecoleccion !== undefined
      ? await notifyCampaignAssignmentChanges(actual, previousPoints)
      : [];
    await publishCampaignEvent(req, "campaign.updated", actual, removedCollectorIds);
    return res.status(200).json({
      msg: "Campaña actualizada correctamente",
      campana: actual,
      notificaciones,
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
    const role = String(req.user?.rol || "").toLowerCase();
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    if (!["admin", "recolector"].includes(role)) {
      return res.status(403).json({ msg: "No autorizado" });
    }
    let campaignQuery = Campana.findById(campaignId);
    if (role === "admin") {
      campaignQuery = campaignQuery
        .populate("historialAsignacionesRecolectores.administrador", "nombre apellido")
        .populate("historialAsignacionesRecolectores.recolector", "nombre apellido")
        .populate("historialAsignacionesRecolectores.recolectorAnterior", "nombre apellido");
    }
    const campaign = await campaignQuery.lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });

    if (role === "recolector") {
      const collectorId = String(req.user._id);
      const assignedPoints = (campaign.puntosRecoleccion || []).filter((point) =>
        point.activo !== false
        && String(point.estado || "").toLowerCase() !== "inactivo"
        && isCollectorAssignedToPoint(point, collectorId)
      );
      if (!assignedPoints.length) {
        return res.status(403).json({
          msg: "No tienes una asignación vigente en esta campaña",
        });
      }
      const assignedCollectorIds = [...new Set(assignedPoints.flatMap(getPointCollectorIds))];
      const collectors = await Recolector.find({ _id: { $in: assignedCollectorIds } })
        .select("_id nombre apellido")
        .lean();
      const collectorsById = new Map(
        collectors.map((collector) => [String(collector._id), collector])
      );
      return res.status(200).json({
        campanaId: String(campaign._id),
        puntos: assignedPoints.map((point) => {
          const pointCollectorIds = getPointCollectorIds(point);
          const principalId = getCampaignPrincipalCollectorId(campaign, point);
          const serializeCollector = (id) => {
            const collector = collectorsById.get(String(id));
            if (!collector) return null;
            return {
              _id: String(collector._id),
              nombre: collector.nombre ?? "",
              apellido: collector.apellido ?? "",
              rolPunto: principalId === String(id) ? "principal" : "apoyo",
            };
          };
          const roster = pointCollectorIds
            .map(serializeCollector)
            .filter(Boolean);
          const principal = principalId
            ? collectorsById.get(principalId)
            : null;
          return {
            _id: String(point._id),
            id: String(point._id),
            campanaId: String(campaign._id),
            nombre: point.nombre ?? "",
            edificioId: point.edificioId ?? null,
            nombreEdificio: point.nombreEdificio ?? "",
            edificio: point.edificio ?? "",
            piso: point.piso ?? "",
            aula: point.aula ?? "",
            descripcion: point.descripcion ?? "",
            direccion: point.direccion ?? "",
            referenciasLugar: point.referenciasLugar ?? "",
            latitud: point.latitud ?? null,
            longitud: point.longitud ?? null,
            latitude: point.latitud ?? null,
            longitude: point.longitud ?? null,
            activo: true,
            recolectoresRequeridos: point.recolectoresRequeridos ?? null,
            horariosAtencion: point.horariosAtencion || [],
            responsableRecolector: principal
              ? {
                  _id: String(principal._id),
                  nombre: principal.nombre ?? "",
                  apellido: principal.apellido ?? "",
                  rolPunto: "principal",
                }
              : null,
            recolectores: roster,
          };
        }),
      });
    }

    const pointById = new Map(
      (campaign.puntosRecoleccion || []).map((point) => [String(point._id), point])
    );
    const currentAssignments = (campaign.puntosRecoleccion || [])
      .filter((point) =>
        point.activo !== false
        && String(point.estado || "").toLowerCase() !== "inactivo"
      )
      .flatMap((point) =>
        getPointCollectorIds(point).map((collectorId) => ({
          collectorId: String(collectorId),
          pointId: String(point._id),
          pointName: point.nombre ?? "",
          rolPunto: getCampaignPrincipalCollectorId(campaign, point) === String(collectorId)
            ? "principal"
            : "apoyo",
        }))
      );
    const currentCollectorIds = [...new Set(
      currentAssignments.map((assignment) => assignment.collectorId)
    )];
    const collectorIds = toValidObjectIdStrings([
      ...currentCollectorIds,
      ...(campaign.historialAsignacionesRecolectores || []).map((entry) =>
        entry.recolector?._id ?? entry.recolector
      ),
    ]);
    const [collectors, activeCollectors] = await Promise.all([
      Recolector.find({ _id: { $in: collectorIds } })
        .select("nombre apellido email telefono direccion status aprobado confirmEmail")
        .lean(),
      Recolector.find({
        confirmEmail: true,
        status: { $ne: false },
        aprobado: { $ne: false },
      }).select("_id reservasHorarioCampanas campanaReservada").lean(),
    ]);
    const collectorsById = new Map(collectors.map((collector) => [String(collector._id), collector]));
    const activeCollectorIds = new Set(
      activeCollectors.map((collector) => String(collector._id))
    );
    const availableCollectors = (await listAvailableCollectorsForCampaign(campaign))
      .filter((collector) =>
        !currentCollectorIds.includes(String(collector._id))
      )
      .map((collector) => String(collector._id));
    const remainingCapacity = Math.max(
      0,
      Number(campaign.numeroRecolectores || 0) - currentCollectorIds.length
    );

    return res.status(200).json({
      campanaId: String(campaign._id),
      numeroRecolectores: campaign.numeroRecolectores,
      capacidadRestante: remainingCapacity,
      recolectoresActivos: activeCollectors.length,
      recolectoresDisponibles: availableCollectors.length,
      recolectoresDisponiblesIds: availableCollectors,
      recolectoresRequeridos: Number(campaign.numeroRecolectores || 0),
      recolectoresAsignados: currentCollectorIds.length,
      recolectoresAsignadosHabilitados: currentCollectorIds.filter((id) =>
        activeCollectorIds.has(id)
      ).length,
      puedeCompletarAsignacion:
        availableCollectors.length >= remainingCapacity,
      faltantesDisponibles: Math.max(
        0,
        remainingCapacity - availableCollectors.length
      ),
      asignacionesActuales: currentAssignments.map((assignment) => ({
        ...assignment,
        recolector: collectorsById.get(assignment.collectorId) || null,
      })      ),
      puntos: (campaign.puntosRecoleccion || []).map((point) => {
        const principalId = getCampaignPrincipalCollectorId(campaign, point);
        const recolectores = getPointCollectorIds(point)
          .map((id) => {
            const collector = collectorsById.get(String(id));
            if (!collector) return null;
            return {
              ...collector,
              rolPunto: principalId === String(id) ? "principal" : "apoyo",
              habilitado:
                collector.status !== false
                && collector.aprobado !== false
                && collector.confirmEmail === true,
            };
          })
          .filter(Boolean);
        return {
          id: String(point._id),
          nombre: point.nombre,
          direccion: point.direccion,
          activo: point.activo,
          recolectoresRequeridos: point.recolectoresRequeridos ?? null,
          horariosAtencion: point.horariosAtencion || [],
          recolectores,
          responsableRecolector:
            recolectores.find((collector) => collector.rolPunto === "principal") || null,
        };
      }),
      historialAsignaciones: (campaign.historialAsignacionesRecolectores || [])
        .map((entry) => {
          const source = entry && typeof entry.toObject === "function" ? entry.toObject() : entry;
          const pointId = source?.puntoNuevo ?? source?.puntoAnterior ?? null;
          const punto = pointId ? pointById.get(String(pointId)) || null : null;
          const recolector = source?.recolector && typeof source.recolector === "object"
            ? source.recolector
            : collectorsById.get(String(source?.recolector ?? "")) || null;
          return {
            ...source,
            recolector,
            punto: punto
              ? {
                  _id: String(punto._id),
                  id: String(punto._id),
                  nombre: punto.nombre ?? "",
                  direccion: punto.direccion ?? "",
                }
              : null,
            fecha: source?.fecha ? new Date(source.fecha).toISOString() : null,
          };
        })
        .sort((left, right) => {
          const leftTime = left?.fecha ? new Date(left.fecha).getTime() : 0;
          const rightTime = right?.fecha ? new Date(right.fecha).getTime() : 0;
          return rightTime - leftTime;
        }),
    });
  } catch (error) {
    console.error("Error consultando distribución de recolectores:", error.message || error);
    return res.status(500).json({ msg: "Error al consultar la distribución" });
  }
};

const retirarRecolectorDeCampana = async (req, res) => {
  try {
    const { campaignId, collectorId } = req.params;
    if (
      !mongoose.isValidObjectId(campaignId)
      || !mongoose.isValidObjectId(collectorId)
    ) {
      return res.status(400).json({
        msg: "Los identificadores de campaña y recolector no son válidos",
      });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const campaign = await Campana.findById(campaignId);
      if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
      const points = campaign.puntosRecoleccion.map((point) => point.toObject());
      const previousAssignments = getAssignmentMap(points);
      const previousPointId = previousAssignments.get(collectorId);
      if (!previousPointId) {
        return res.status(404).json({
          msg: "El recolector ya no está asignado a esta campaña",
        });
      }
      const previousPoint = points.find(
        (point) => String(point._id) === String(previousPointId)
      );
      if (countAssignedCollectors(points) >= Number(campaign.numeroRecolectores || 0)) {
        return res.status(409).json({
          msg: "No retires directamente a un recolector cuando el máximo está ocupado; sustitúyelo mediante la reasignación",
        });
      }
      if (String(previousPoint?.responsableRecolector || "") === collectorId) {
        return res.status(409).json({
          msg: "Asigna otro recolector como principal antes de retirar al principal actual",
        });
      }

      const nextPoints = points.map((point) => {
        const recolectores = (point.recolectores || [])
          .map(String)
          .filter((id) => id !== collectorId);
        return { ...point, recolectores };
      });
      const history = campaign.historialAsignacionesRecolectores.map((entry) =>
        entry.toObject()
      );
      for (const entry of history) {
        if (entry.vigente && String(entry.recolector) === collectorId) {
          entry.vigente = false;
        }
      }
      const historyEntryId = new mongoose.Types.ObjectId();
      history.push({
        _id: historyEntryId,
        recolector: collectorId,
        campana: campaign._id,
        puntoAnterior: previousPointId,
        puntoNuevo: null,
        administrador: req.user._id,
        fecha: new Date(),
        motivo: String(req.body?.motivo ?? "Retiro de asignación")
          .trim()
          .slice(0, 500),
        vigente: false,
      });
      const updated = await saveCampaignAssignments(campaign, nextPoints, history);
      if (!updated) continue;

      await Recolector.updateOne(
        { _id: collectorId },
        {
          $pull: { reservasHorarioCampanas: { campana: campaign._id } },
          $inc: { versionReservasHorario: 1 },
        }
      );
      await Recolector.updateOne(
        { _id: collectorId, campanaReservada: campaign._id },
        { $set: { campanaReservada: null } }
      );
      const notificaciones = await notifyCampaignAssignmentChanges(
        updated,
        points,
        { eventPrefix: "campaign-collector-removed" }
      );
      await publishCampaignEvent(req, "campaign.collectors.updated", updated, [collectorId]);
      return res.status(200).json({
        campanaId,
        recolectorId: collectorId,
        historialAsignaciones: updated.historialAsignacionesRecolectores,
        notificaciones,
      });
    }
    return res.status(409).json({
      msg: "La asignación cambió concurrentemente; vuelve a intentarlo",
    });
  } catch (error) {
    console.error("Error retirando recolector de campaña:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al retirar el recolector",
    });
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
      if (activePoints.some((point) =>
        !point.responsableRecolector
        || !(point.recolectores || []).some(
          (id) => String(id) === String(point.responsableRecolector)
        )
      )) {
        return res.status(409).json({
          msg: "Cada punto activo debe tener exactamente un recolector principal asignado antes de distribuir apoyos",
        });
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
      await validateAssignableCollectors([...occurrences.keys()]);
      if (requestedIds.some((id) => occurrences.has(id))) {
        return res.status(409).json({
          msg: "Un recolector seleccionado ya está asignado a esta campaña; usa la reasignación explícita",
        });
      }
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
        responsableRecolector: point.responsableRecolector,
      }));
      await assertNoOverlappingAssignments(
        { ...campaign.toObject(), puntosRecoleccion: nextPoints },
        requestedIds
      );
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

      const candidateCampaign = { ...campaign.toObject(), puntosRecoleccion: nextPoints };
      const reservations = await reserveCollectorsForCampaign(candidateCampaign, requestedIds);
      const updated = await saveCampaignAssignments(campaign, nextPoints, history);
      if (!updated) {
        await rollbackCollectorReservations(campaign._id, reservations);
        continue;
      }
      const notificaciones = await notifyCampaignAssignmentChanges(
        updated,
        points,
        { eventPrefix: "campaign-distribution" }
      );
      await publishCampaignEvent(req, "campaign.collectors.updated", updated);
      return res.status(200).json({
        campanaId: String(updated._id),
        puntos: updated.puntosRecoleccion,
        totalRecolectores: requestedIds.length,
        notificaciones,
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
  let reservations = [];
  let reservationCampaignId = null;
  try {
    const { campaignId, pointId } = req.params;
    const collectorId = String(req.body?.recolectorId ?? "").trim();
    const replacedCollectorId = req.body?.recolectorAnteriorId === undefined
      ? null
      : String(req.body.recolectorAnteriorId).trim();
    const requestedRole = req.body?.rol === undefined
      ? null
      : String(req.body.rol).trim().toLowerCase();
    if (
      !mongoose.isValidObjectId(campaignId)
      || !mongoose.isValidObjectId(pointId)
      || !mongoose.isValidObjectId(collectorId)
    ) {
      return res.status(400).json({ msg: "Los identificadores de campaña, punto y recolector deben ser válidos" });
    }
    if (
      replacedCollectorId !== null
      && !mongoose.isValidObjectId(replacedCollectorId)
    ) {
      return res.status(400).json({
        msg: "El identificador del recolector sustituido no es válido",
      });
    }
    if (requestedRole !== null && !["principal", "apoyo"].includes(requestedRole)) {
      return res.status(400).json({ msg: "El rol del recolector debe ser principal o apoyo" });
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
      const assignmentOccurrences = points.reduce(
        (total, point) => total + (point.recolectores || [])
          .filter((id) => String(id) === collectorId).length,
        0
      );
      if (assignmentOccurrences > 1) {
        return res.status(409).json({
          msg: "El recolector tiene asignaciones duplicadas en esta campaña; corrígelas antes de continuar",
        });
      }
      if (oldPointId === pointId && requestedRole === null) {
        return res.status(409).json({ msg: "El recolector ya está asignado a ese punto" });
      }
      if (replacedCollectorId) {
        const replacedPointIds = points
          .filter((point) => getPointCollectorIds(point).includes(replacedCollectorId))
          .map((point) => String(point._id));
        if (
          replacedPointIds.length !== 1
          || replacedPointIds[0] !== pointId
          || getPointCollectorIds(target).includes(collectorId)
        ) {
          return res.status(409).json({
            msg: "El recolector sustituido debe estar asignado únicamente al punto y el sustituto no debe estar ya en ese punto",
          });
        }
      }
      if (!oldPointId) {
        if (!replacedCollectorId) {
          validateCampaignCapacity(campaign.numeroRecolectores, points, 1);
        }
      }
      await validateAssignableCollectors([
        ...new Set([...(target.recolectores || []).map(String), collectorId]),
      ]);
      if (
        (target.recolectores || []).length >= MAX_RECOLECTORES_POR_PUNTO
        && oldPointId !== pointId
        && !replacedCollectorId
      ) {
        return res.status(409).json({ msg: "El punto ya tiene el máximo de 3 recolectores" });
      }
      const nextPoints = buildPointAssignmentsAfterRoleChange(
        points,
        collectorId,
        pointId,
        requestedRole,
        replacedCollectorId
      );
      await assertNoOverlappingAssignments(
        { ...campaign.toObject(), puntosRecoleccion: nextPoints },
        [collectorId]
      );
      const history = campaign.historialAsignacionesRecolectores.map((entry) => entry.toObject());
      for (const entry of history) {
        if (
          entry.vigente
          && (
            String(entry.recolector) === collectorId
            || String(entry.recolector) === replacedCollectorId
          )
        ) {
          entry.vigente = false;
        }
      }
      const historyEntryId = new mongoose.Types.ObjectId();
      history.push({
        _id: historyEntryId,
        recolector: collector._id,
        recolectorAnterior: replacedCollectorId,
        campana: campaign._id,
        puntoAnterior: replacedCollectorId ? pointId : oldPointId,
        puntoNuevo: pointId,
        donacionesTransferidas: [],
        administrador: req.user._id,
        fecha: new Date(),
        motivo: String(
          req.body?.motivo
          ?? (requestedRole ? `Asignación como ${requestedRole}` : "")
        ).trim().slice(0, 500),
        vigente: true,
      });
      const candidateCampaign = { ...campaign.toObject(), puntosRecoleccion: nextPoints };
      let updated;
      if (replacedCollectorId) {
        const result = await transferCampaignCollectorDonations({
          campaign,
          points: nextPoints,
          history,
          historyEntryId,
          previousCollectorId: replacedCollectorId,
          nextCollectorId: collectorId,
          pointId,
          administratorId: req.user._id,
          motive: String(req.body?.motivo ?? "").trim().slice(0, 500),
          validateAssignableCollectors,
          reserveCollectorsForCampaign,
        });
        updated = result?.campaign || null;
      } else {
        reservations = await reserveCollectorsForCampaign(candidateCampaign, [collectorId]);
        reservationCampaignId = campaign._id;
        updated = await saveCampaignAssignments(campaign, nextPoints, history);
      }
      if (!updated) {
        await rollbackCollectorReservations(campaign._id, reservations);
        reservations = [];
        continue;
      }
      reservations = [];
      const notificaciones = await notifyCampaignAssignmentChanges(
        updated,
        points,
        { eventPrefix: "campaign-collector-reassigned" }
      );
      await publishCampaignEvent(req, "campaign.collectors.updated", updated);
      return res.status(200).json({
        campanaId: campaignId,
        punto: updated.puntosRecoleccion.id(pointId),
        rol: String(updated.puntosRecoleccion.id(pointId)?.responsableRecolector) === collectorId
          ? "principal"
          : "apoyo",
        recolector: {
          _id: collector._id,
          nombre: collector.nombre,
          apellido: collector.apellido,
        },
        historialAsignaciones: updated.historialAsignacionesRecolectores,
        notificaciones,
      });
    }
    return res.status(409).json({ msg: "La asignación cambió concurrentemente; vuelve a intentarlo" });
  } catch (error) {
    if (reservations.length && reservationCampaignId) {
      try {
        await rollbackCollectorReservations(reservationCampaignId, reservations);
      } catch (rollbackError) {
        console.error(
          "Error revirtiendo la reserva del recolector sustituto:",
          rollbackError.message || rollbackError
        );
      }
    }
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
      .flatMap((point) => getPointCollectorIds(point).map((id) => ({
        collectorId: String(id),
        pointId: String(point._id),
        pointName: point.nombre,
        rol: String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "") === String(id)
          ? "principal"
          : "secundario",
      })));
    const collectorIds = [...new Set(
      activeAssignments.map((assignment) => assignment.collectorId)
    )];
    const collectors = await Recolector.find({
      _id: { $in: collectorIds },
    }).select("nombre apellido status ubicacionGps").lean();
    const byId = new Map(collectors.map((collector) => [String(collector._id), collector]));
    const simulations = isCollectorLocationSimulatorEnabled()
      ? await CollectorLocationSimulation.find({
          collector: { $in: collectorIds },
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
        const { location: gps, simulated } = selectLatestCollectorLocation(
          collector?.ubicacionGps,
          simulation
        );
        const matchesAssignment = Boolean(gps) && (
          simulated
            ? String(gps.campaign || "") === campaignId
              && String(gps.point || "") === assignment.pointId
            : true
        );
        const derivedState = classifyCollectorLocation({
          collectorActive: collector?.status !== false,
          matchesAssignment,
          updatedAt: gps?.capturadoEn ?? gps?.capturedAt,
          latitude: gps?.latitud ?? gps?.latitude,
          longitude: gps?.longitud ?? gps?.longitude,
          accuracyMeters: gps?.precisionMetros ?? gps?.accuracyMeters,
          now,
        });
        const state = simulated && gps.scenario === "sin_gps"
          ? "sin_registro"
          : derivedState;
        const geofenceState = classifyCollectorGeofenceState({
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
          now,
        });
        const locationPayload = geofenceState !== "inactivo"
          && hasValidCollectorCoordinates(
            gps?.latitud ?? gps?.latitude,
            gps?.longitud ?? gps?.longitude
          )
          ? serializeCollectorLocation(gps)
          : null;
        return {
          recolector: collector
            ? { _id: collector._id, nombre: collector.nombre, apellido: collector.apellido }
            : { _id: assignment.collectorId },
          punto: { _id: assignment.pointId, nombre: assignment.pointName },
          estado: state,
          estadoGeografico: matchesAssignment ? geofenceState : "inactivo",
          simulada: simulated,
          ...(simulated ? { escenario: gps.scenario } : {}),
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
          ubicacion: locationPayload,
          actualizadoEn: locationPayload?.actualizadoEn ?? null,
          capturadoEn: locationPayload?.capturadoEn ?? null,
          rol: assignment.rol,
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
  retirarRecolectorDeCampana,
  listarUbicacionesRecolectores,
  normalizePickupPoints,
  countAssignedCollectors,
  getPointCollectorIds,
  validateCampaignCapacity,
  validateCampaignPointCapacity,
  validateCampaignHours,
  normalizeCampaignDays,
  resolveCampaignState,
  countActivePickupPoints,
  campaignDateRangesOverlap,
  normalizeCampaignResponsibilities,
  buildPointAssignmentsAfterRoleChange,
  listAvailableCollectorsForCampaign,
  assertNoOverlappingAssignments,
  validateAssignableCollectors,
  reserveCollectorsForCampaign,
  rollbackCollectorReservations,
};