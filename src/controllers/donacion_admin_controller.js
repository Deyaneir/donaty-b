import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";
import Campana from "../models/Campana.js";
import ChatConversation from "../models/ChatConversation.js";
import { notifyUsers } from "../services/firebase_notifications.js";
import { TERMINAL_DONATION_STATES } from "../services/donationAssignment.js";
import { publishDonationEvent } from "../services/domainEvents.js";
import {
  getAcademicPeriodStartMonth,
  resolveAcademicPeriod,
} from "../utils/academicPeriod.js";

const ESTADOS = [
  "pendiente",
  "asignada",
  "pendiente_recoleccion",
  "recolectada",
  "clasificada",
  "en_entrega",
  "entregada",
  "devolucion",
  "devuelta",
  "cancelada",
  "pagado",
];

const ESTADO_LABEL = {
  pendiente: "Pendiente de asignación",
  pagado: "Pagado",
  asignada: "Asignada",
  pendiente_recoleccion: "Pendiente de recolección",
  recolectada: "Recolectada",
  clasificada: "Clasificada",
  en_entrega: "En entrega",
  entregada: "Entregada",
  cancelada: "Cancelada",
  devolucion: "Devolución",
  devuelta: "Devuelto",
};
const etiqueta = (estado) => ESTADO_LABEL[estado] ?? estado;

const nombreCompleto = (p) =>
  `${p?.nombre ?? ""} ${p?.apellido ?? ""}`.trim() || "el recolector";

const conRelaciones = (query) =>
  query
    .populate("campana", "nombre activa fechaInicio fechaFin periodoAcademico")
    .populate("donante", "nombre apellido email telefono")
    .populate("recolector", "nombre apellido email telefono");

/** Lista de donaciones físicas, con filtros opcionales por estado y campaña. */
const listarDonacionesAdmin = async (req, res) => {
  try {
    const { estado, campana, recolector, periodoAcademico } = req.query || {};
    const filtro = { tipo: "fisica" };

    if (estado) {
      const estadoFinal = String(estado).trim().toLowerCase();
      if (!ESTADOS.includes(estadoFinal)) {
        return res.status(400).json({ msg: "Estado inválido" });
      }
      filtro.estado = estadoFinal;
    }

    if (campana) {
      const campanaFinal = String(campana).trim();
      if (campanaFinal === "ninguna") {
        filtro.campana = null;
      } else if (mongoose.Types.ObjectId.isValid(campanaFinal)) {
        filtro.campana = campanaFinal;
      } else {
        return res.status(400).json({ msg: "Campaña inválida" });
      }
    }

    if (recolector) {
      const collectorId = String(recolector).trim();
      if (collectorId === "ninguno") {
        filtro.recolector = null;
      } else if (mongoose.Types.ObjectId.isValid(collectorId)) {
        filtro.recolector = collectorId;
      } else {
        return res.status(400).json({ msg: "Recolector inválido" });
      }
    }

    if (periodoAcademico !== undefined) {
      const period = String(periodoAcademico).trim();
      if (!/^\d{4}-[AB]$/.test(period)) {
        return res.status(400).json({ msg: "Período académico inválido" });
      }
      const [yearText, half] = period.split("-");
      const year = Number(yearText);
      const boundary = getAcademicPeriodStartMonth();
      const startMonth = half === "B" ? boundary : 1;
      const endMonth = half === "A" ? boundary : 13;
      const campaignIds = await Campana.find({
        fechaInicio: {
          $gte: new Date(Date.UTC(year, startMonth - 1, 1)),
          $lt: new Date(Date.UTC(year, endMonth - 1, 1)),
        },
      }).distinct("_id");
      filtro.$and = [{
        $or: [
          { periodoAcademico: period },
          ...(campaignIds.length ? [{ campana: { $in: campaignIds } }] : []),
        ],
      }];
    }

    const items = await conRelaciones(
      Donacion.find(filtro).sort({ createdAt: -1 }).limit(1000)
    );

    return res.status(200).json({
      total: items.length,
      items: items.map((item) => {
        const donation = item.toObject();
        return {
          ...donation,
          periodoAcademico:
            donation.periodoAcademico
            || donation.campana?.periodoAcademico
            || resolveAcademicPeriod(
              donation.campana?.fechaInicio || donation.campana?.createdAt
            )
            || null,
        };
      }),
    });
  } catch (error) {
    console.error("Error al listar donaciones (admin):", error);
    return res.status(500).json({ msg: "Error al consultar las donaciones" });
  }
};

/** Solo recolectores aprobados, activos y con el correo confirmado. */
const listarRecolectoresAsignables = async (_req, res) => {
  try {
    const [recolectores, cargas] = await Promise.all([
      Recolector.find({
        confirmEmail: true,
        status: { $ne: false },
        aprobado: { $ne: false },
      })
        .select("nombre apellido email telefono")
        .sort({ nombre: 1, apellido: 1 })
        .lean(),
      Donacion.aggregate([
        {
          $match: {
            tipo: "fisica",
            estado: { $nin: TERMINAL_DONATION_STATES },
            recolector: { $ne: null },
          },
        },
        { $group: { _id: "$recolector", total: { $sum: 1 } } },
      ]),
    ]);

    const porRecolector = new Map(cargas.map((c) => [String(c._id), c.total]));

    return res.status(200).json({
      total: recolectores.length,
      recolectores: recolectores.map((r) => ({
        ...r,
        asignadasActivas: porRecolector.get(String(r._id)) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Error al listar recolectores asignables:", error);
    return res
      .status(500)
      .json({ msg: "Error al consultar los recolectores disponibles" });
  }
};

/**
 * Asigna o reasigna una donación física a un recolector.
 * - Pendiente de asignación -> se asigna y pasa a "Asignada".
 * - Asignada (aún no recolectada) -> se reasigna a otro recolector.
 */
const asignarDonacionAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const recolectorId = String(req.body?.recolector ?? "").trim();
    if (!recolectorId || !mongoose.Types.ObjectId.isValid(recolectorId)) {
      return res
        .status(400)
        .json({ msg: "Debes seleccionar el recolector al que se asigna" });
    }

    const recolector = await Recolector.findById(recolectorId);
    if (!recolector) {
      return res
        .status(404)
        .json({ msg: "El recolector seleccionado no existe" });
    }
    if (recolector.status === false) {
      return res
        .status(400)
        .json({ msg: "El recolector seleccionado está inactivo" });
    }
    if (recolector.aprobado === false) {
      return res
        .status(400)
        .json({ msg: "El recolector seleccionado aún no está aprobado" });
    }
    if (!recolector.confirmEmail) {
      return res.status(400).json({
        msg: "El recolector seleccionado aún no confirmó su correo",
      });
    }

    const actual = await Donacion.findOne({ _id: id, tipo: "fisica" }).select(
      "estado recolector campana puntoRecoleccionRef"
    );
    if (!actual) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }
    const previousCollector = actual.recolector
      ? await Recolector.findById(actual.recolector)
      : null;
    if (actual.campana) {
      const campaign = await Campana.findById(actual.campana)
        .select("puntosRecoleccion")
        .lean();
      const point = campaign?.puntosRecoleccion?.find(
        (item) => String(item._id) === String(actual.puntoRecoleccionRef)
      );
      if (
        !point
        || point.activo === false
        || String(point.estado || "").toLowerCase() === "inactivo"
        || (
          !(point.recolectores || []).some(
            (assignedId) => String(assignedId) === String(recolector._id)
          )
          && String(point.responsableRecolector || "") !== String(recolector._id)
        )
      ) {
        return res.status(409).json({
          msg: "El recolector debe estar asignado al punto de recolección de esta campaña",
        });
      }
    }

    let filtro;
    let cambios;
    let reasignacion = false;
    const fechaAsignacion = new Date();

    if (actual.estado === "pendiente") {
      filtro = { _id: id, tipo: "fisica", estado: "pendiente" };
      cambios = {
        recolector: recolector._id,
        estado: "asignada",
        fechaAsignacion,
      };
    } else {
      if (String(actual.recolector) === String(recolector._id)) {
        return res.status(409).json({
          msg: `La donación ya está asignada a ${nombreCompleto(recolector)}. Elige otro recolector.`,
        });
      }
      filtro = { _id: id, tipo: "fisica", estado: actual.estado };
      cambios = { recolector: recolector._id, fechaAsignacion };
      reasignacion = true;
    }

    // El filtro por estado hace el cambio atómico: si otro proceso cambió la
    // donación justo antes, no se modifica.
    const historial = {
      recolectorAnterior: actual.recolector || null,
      recolectorNuevo: recolector._id,
      puntoRecoleccionAnterior: actual.puntoRecoleccionRef || null,
      puntoRecoleccionNuevo: actual.puntoRecoleccionRef || null,
      estado: actual.estado,
      administrador: req.user._id,
      fecha: fechaAsignacion,
      motivo: String(req.body?.motivo ?? "").trim().slice(0, 500),
    };
    const update = {
      $set: cambios,
      $push: { historialRecolectores: historial },
    };
    filtro.recolector = actual.recolector || null;
    if (cambios.estado !== undefined && actual.estado !== cambios.estado) {
      update.$push.historialEstados = {
        estado: cambios.estado,
        responsable: req.user._id,
        rolResponsable: "admin",
        fecha: new Date(),
        observaciones: String(req.body?.observaciones ?? "").trim().slice(0, 1000),
      };
    }
    const donacion = await conRelaciones(
      Donacion.findOneAndUpdate(filtro, update, { new: true })
    );

    if (!donacion) {
      const ahora = await Donacion.findById(id).select("estado");
      return res.status(409).json({
        msg:
          "La donación cambió de estado mientras la asignabas" +
          (ahora ? ` (ahora está en "${etiqueta(ahora.estado)}")` : "") +
          ". Actualiza la lista e inténtalo de nuevo.",
      });
    }

    if (reasignacion && actual.recolector) {
      const conversation = await ChatConversation.findOne({ room: String(id), type: "donation" });
      if (conversation) {
        const donorReadAt = conversation.participants.find(
          (participant) => participant.role === "donante" &&
            String(participant.userId) === String(donacion.donante?._id)
        )?.lastReadAt ?? null;
        conversation.participants = [
          ...(donacion.donante?._id
            ? [{ userId: donacion.donante._id, role: "donante", lastReadAt: donorReadAt }]
            : []),
          { userId: recolector._id, role: "recolector", lastReadAt: new Date() },
        ];
        await conversation.save();
      }

      const io = req.app.get("io");
      if (io) {
        const previousCollectorId = String(actual.recolector);
        const sockets = await io.in(String(id)).fetchSockets();
        for (const activeSocket of sockets) {
          if (String(activeSocket.data.user?._id) === previousCollectorId) {
            await activeSocket.leave(String(id));
            activeSocket.emit("roomAccessRevoked", {
              roomId: String(id),
              msg: "La donación fue reasignada y ya no tienes acceso al chat",
            });
          }
        }
      }
    }

    const reassignmentRecipients = [
      { userId: recolector._id, role: "recolector" },
      ...(donacion.donante?._id
        ? [{ userId: donacion.donante._id, role: "donante" }]
        : []),
    ];
    void notifyUsers({
      eventKey: `donation-${reasignacion ? "reassigned" : "assigned"}:${donacion._id}:${recolector._id}:${fechaAsignacion.getTime()}`,
      recipients: reassignmentRecipients,
      title: reasignacion ? "Donación reasignada" : "Nueva donación asignada",
      body: reasignacion
        ? `Tu donación ${donacion._id} fue reasignada a ${nombreCompleto(recolector)}.`
        : `Código ${donacion._id}: la donación fue asignada a ${nombreCompleto(recolector)}.`,
      data: {
        tipo: reasignacion ? "donation_reassigned" : "donation_assigned",
        type: reasignacion ? "donation_reassigned" : "donation_assigned",
        donacionId: String(donacion._id),
        donationId: String(donacion._id),
        campanaId: String(donacion.campana?._id ?? donacion.campana ?? ""),
        campaignId: String(donacion.campana?._id ?? donacion.campana ?? ""),
        campaignName: String(donacion.campana?.nombre || ""),
        donorId: String(donacion.donante?._id || ""),
        donorName: donacion.donante
          ? `${donacion.donante.nombre || ""} ${donacion.donante.apellido || ""}`.trim()
          : "",
        previousCollectorId: String(previousCollector?._id || ""),
        previousCollectorName: previousCollector
          ? `${previousCollector.nombre || ""} ${previousCollector.apellido || ""}`.trim()
          : "",
        newCollectorId: String(recolector._id),
        newCollectorName: nombreCompleto(recolector),
        collectorId: String(recolector._id),
        collectorName: nombreCompleto(recolector),
        changedById: String(req.user._id),
        changedByName: nombreCompleto(req.user),
        changedByRole: "admin",
      },
    });
    if (reasignacion && previousCollector) {
      void notifyUsers({
        eventKey: `donation-reassignment-removed:${donacion._id}:${previousCollector._id}:${fechaAsignacion.getTime()}`,
        recipients: [{ userId: previousCollector._id, role: "recolector" }],
        title: "Asignación actualizada",
        body: `Ya no eres responsable de la donación ${donacion._id}; fue reasignada a ${nombreCompleto(recolector)}.`,
        data: {
          type: "donation_reassignment_removed",
          donationId: String(donacion._id),
          campaignId: String(donacion.campana?._id ?? donacion.campana ?? ""),
          campaignName: String(donacion.campana?.nombre || ""),
          previousCollectorId: String(previousCollector._id),
          previousCollectorName: `${previousCollector.nombre || ""} ${previousCollector.apellido || ""}`.trim(),
          newCollectorId: String(recolector._id),
          newCollectorName: nombreCompleto(recolector),
          changedById: String(req.user._id),
          changedByName: nombreCompleto(req.user),
          changedByRole: "admin",
        },
      });
    }

    publishDonationEvent(req, "donation.assignment.updated", donacion);
    return res.status(200).json({
      msg: reasignacion
        ? `Donación reasignada correctamente a ${nombreCompleto(recolector)}`
        : `Donación asignada correctamente a ${nombreCompleto(recolector)}`,
      donacion,
    });
  } catch (error) {
    console.error("Error al asignar donación (admin):", error);
    return res.status(500).json({ msg: "Error al asignar la donación" });
  }
};

export {
  listarDonacionesAdmin,
  listarRecolectoresAsignables,
  asignarDonacionAdmin,
};