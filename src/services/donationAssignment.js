import { randomInt as secureRandomInt } from "node:crypto";
import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";

const TERMINAL_DONATION_STATES = ["cancelada", "entregada", "devuelta"];

const assignmentError = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });

const isPointAvailable = (point) =>
  point?.activo !== false
  && String(point?.estado ?? "").toLowerCase() !== "inactivo";

const chooseBalancedAssignment = ({
  points,
  collectors,
  loadByPoint = new Map(),
  loadByCollector = new Map(),
  randomInt = secureRandomInt,
}) => {
  const availableCollectors = new Set(collectors.map((collector) => String(collector._id)));
  const candidates = points
    .filter(isPointAvailable)
    .flatMap((point) =>
      [...new Set((point.recolectores || []).map(String))]
        .filter((collectorId) => availableCollectors.has(collectorId))
        .map((collectorId) => ({
          point,
          collector: collectors.find((item) => String(item._id) === collectorId),
          pointLoad: loadByPoint.get(String(point._id)) || 0,
          collectorLoad: loadByCollector.get(collectorId) || 0,
        }))
    );

  if (!candidates.length) {
    throw assignmentError(
      "No hay puntos activos con recolectores disponibles asignados a esta campaña"
    );
  }

  const loadScore = (item) => [
    Math.max(item.pointLoad, item.collectorLoad),
    item.pointLoad + item.collectorLoad,
  ];
  const bestScore = candidates
    .map(loadScore)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])[0];
  const tied = candidates.filter((item) => {
    const score = loadScore(item);
    return score[0] === bestScore[0] && score[1] === bestScore[1];
  });

  return tied[randomInt(tied.length)];
};

const makeLoadMaps = (rows) => {
  const loadByPoint = new Map();
  const loadByCollector = new Map();
  for (const row of rows) {
    if (row._id.point !== null && row._id.point !== undefined) {
      const pointId = String(row._id.point);
      loadByPoint.set(pointId, (loadByPoint.get(pointId) || 0) + row.total);
    }
    if (row._id.recolector !== null && row._id.recolector !== undefined) {
      const collectorId = String(row._id.recolector);
      loadByCollector.set(
        collectorId,
        (loadByCollector.get(collectorId) || 0) + row.total
      );
    }
  }
  return { loadByPoint, loadByCollector };
};

const createDonationWithAssignment = async ({
  campaignId,
  buildDonation,
  campaignModel = Campana,
  donationModel = Donacion,
  collectorModel = Recolector,
  sessionFactory = () => mongoose.startSession(),
  randomInt = secureRandomInt,
}) => {
  const session = await sessionFactory();
  let result;

  try {
    await session.withTransaction(async () => {
      const campaign = await campaignModel
        .findOne({ _id: campaignId, activa: true })
        .session(session);
      if (!campaign) {
        throw assignmentError("La campaña no existe o no está activa", 409);
      }

      const activePoints = (campaign.puntosRecoleccion || []).filter(isPointAvailable);
      if (!activePoints.length) {
        throw assignmentError(
          "La campaña no tiene puntos de recolección activos y disponibles"
        );
      }
      const collectorIds = [...new Set(
        activePoints.flatMap((point) => (point.recolectores || []).map(String))
      )];
      const collectors = collectorIds.length
        ? await collectorModel.find({
          _id: { $in: collectorIds },
          status: { $ne: false },
          aprobado: { $ne: false },
          confirmEmail: true,
        }).select("_id nombre apellido").session(session).lean()
        : [];
      if (!collectors.length) {
        throw assignmentError(
          "La campaña no tiene recolectores activos, aprobados y verificados disponibles"
        );
      }

      const rows = await donationModel.aggregate([
        {
          $match: {
            campana: campaign._id,
            estado: { $nin: TERMINAL_DONATION_STATES },
          },
        },
        {
          $group: {
            _id: {
              point: "$puntoRecoleccionRef",
              recolector: "$recolector",
            },
            total: { $sum: 1 },
          },
        },
      ]).session(session);
      const { loadByPoint, loadByCollector } = makeLoadMaps(rows);
      const selected = chooseBalancedAssignment({
        points: activePoints,
        collectors,
        loadByPoint,
        loadByCollector,
        randomInt,
      });

      const lock = await campaignModel.updateOne(
        { _id: campaign._id, activa: true },
        { $inc: { assignmentVersion: 1 } },
        { session }
      );
      if ((lock.modifiedCount ?? lock.nModified) !== 1) {
        throw assignmentError(
          "La campaña cambió durante la asignación; vuelve a intentarlo"
        );
      }

      const assignedAt = new Date();
      const payload = await buildDonation({
        campaign,
        point: selected.point,
        collector: selected.collector,
        assignedAt,
      });
      const [donation] = await donationModel.create([{
        ...payload,
        recolector: selected.collector._id,
        puntoRecoleccionRef: selected.point._id,
        fechaAsignacion: assignedAt,
        historialRecolectores: [
          ...(payload.historialRecolectores || []),
          {
            recolectorNuevo: selected.collector._id,
            puntoRecoleccionNuevo: selected.point._id,
            fecha: assignedAt,
            motivo: "Asignación automática al registrar la donación",
          },
        ],
      }], { session });

      result = {
        donacion: donation,
        asignacion: {
          fecha: assignedAt,
          puntoRecoleccion: {
            _id: selected.point._id,
            nombre: selected.point.nombre,
            descripcion: selected.point.descripcion || "",
            direccion: selected.point.direccion || "",
            referenciasLugar: selected.point.referenciasLugar || "",
            telefonoContacto: selected.point.telefonoContacto || "",
            edificioId: selected.point.edificioId ?? null,
            nombreEdificio: selected.point.nombreEdificio || "",
            edificio: selected.point.edificio || "",
            piso: selected.point.piso || "",
            aula: selected.point.aula || "",
            latitud: selected.point.latitud ?? null,
            longitud: selected.point.longitud ?? null,
          },
          recolector: {
            _id: selected.collector._id,
            nombre: selected.collector.nombre,
            apellido: selected.collector.apellido,
          },
        },
      };
    });
    return result;
  } catch (error) {
    if (error.statusCode) throw error;
    if (
      error.hasErrorLabel?.("TransientTransactionError")
      || error.code === 112
      || error.code === 251
    ) {
      throw Object.assign(
        new Error("La asignación cambió concurrentemente; vuelve a intentarlo"),
        { statusCode: 409 }
      );
    }
    if (
      error.code === 20
      || error.codeName === "IllegalOperation"
      || /Transaction numbers are only allowed/i.test(error.message || "")
    ) {
      throw Object.assign(
        new Error("La asignación automática requiere una instancia MongoDB compatible con transacciones"),
        { statusCode: 503 }
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export {
  TERMINAL_DONATION_STATES,
  chooseBalancedAssignment,
  createDonationWithAssignment,
};
