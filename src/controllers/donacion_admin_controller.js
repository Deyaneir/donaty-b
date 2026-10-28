import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";

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
    .populate("campana", "nombre activa")
    .populate("donante", "nombre apellido email telefono")
    .populate("recolector", "nombre apellido email telefono");

/** Lista de donaciones físicas, con filtros opcionales por estado y campaña. */
const listarDonacionesAdmin = async (req, res) => {
  try {
    const { estado, campana } = req.query || {};
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

    const items = await conRelaciones(
      Donacion.find(filtro).sort({ createdAt: -1 }).limit(1000)
    );

    return res.status(200).json({ total: items.length, items });
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
            estado: "asignada",
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
      "estado recolector"
    );
    if (!actual) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    let filtro;
    let cambios;
    let reasignacion = false;

    if (actual.estado === "pendiente") {
      filtro = { _id: id, tipo: "fisica", estado: "pendiente" };
      cambios = { recolector: recolector._id, estado: "asignada" };
    } else if (actual.estado === "asignada") {
      if (String(actual.recolector) === String(recolector._id)) {
        return res.status(409).json({
          msg: `La donación ya está asignada a ${nombreCompleto(recolector)}. Elige otro recolector.`,
        });
      }
      filtro = { _id: id, tipo: "fisica", estado: "asignada" };
      cambios = { recolector: recolector._id };
      reasignacion = true;
    } else {
      return res.status(409).json({
        msg:
          `No se puede asignar esta donación porque está en estado "${etiqueta(actual.estado)}". ` +
          "Solo se asigna cuando está pendiente de asignación y se reasigna " +
          "mientras está asignada y no ha sido recolectada.",
      });
    }

    // El filtro por estado hace el cambio atómico: si otro proceso cambió la
    // donación justo antes, no se modifica.
    const donacion = await conRelaciones(
      Donacion.findOneAndUpdate(filtro, { $set: cambios }, { new: true })
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