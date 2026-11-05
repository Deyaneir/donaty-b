import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Categoria from "../models/Categoria.js";
import {
  normalizePickupPoints,
  resolveCampaignState,
} from "./campana_controller.js";
import {
  buildPickupPointsResponse,
  isPickupPointActive,
  serializePickupPoint,
} from "../utils/pickupPoints.js";

const normalizePointText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const pointUniqueKey = (point) => [
  point.edificioId !== undefined && point.edificioId !== null
    ? `id:${point.edificioId}`
    : `nombre:${normalizePointText(point.edificio || point.nombreEdificio)}`,
  normalizePointText(point.piso),
  normalizePointText(point.aula),
].join("|");

const listarCampanasAdmin = async (_req, res) => {
  try {
    const [campanas, conteos] = await Promise.all([
      Campana.find().sort({ createdAt: -1 }).lean(),
      Donacion.aggregate([
        { $match: { campana: { $ne: null } } },
        { $group: { _id: "$campana", total: { $sum: 1 } } },
      ]),
    ]);

    const porCampana = new Map(conteos.map((c) => [String(c._id), c.total]));

    return res.status(200).json({
      msg: "Campañas consultadas correctamente",
      total: campanas.length,
      campanas: campanas.map((c) => ({
        ...c,
        estado: resolveCampaignState(c),
        totalPuntos: c.puntosRecoleccion?.length ?? 0,
        totalDonaciones: porCampana.get(String(c._id)) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Error al listar campañas (admin):", error);
    return res.status(500).json({ msg: "Error al consultar las campañas" });
  }
};

const listarPuntosDeCampana = async (req, res) => {
  try {
    const { campanaId } = req.params;
    if (!mongoose.isValidObjectId(campanaId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const role = String(req.user?.rol || "").toLowerCase();
    const admin = role === "admin";
    const query = admin
      ? { _id: campanaId }
      : { _id: campanaId, activa: true };
    const campana = await Campana.findOne(query)
      .select("_id activa puntosRecoleccion")
      .lean();
    if (!campana) return res.status(404).json({ msg: "La campaña no existe" });

    const collectorCampaign = role === "recolector"
      ? {
          ...campana,
          puntosRecoleccion: (campana.puntosRecoleccion || []).filter((point) =>
            isPickupPointActive(point)
            && (point.recolectores || []).some(
              (collectorId) => String(collectorId) === String(req.user._id)
            )
          ),
        }
      : campana;
    return res.status(200).json(
      buildPickupPointsResponse(collectorCampaign, {
        includeAssignments: admin,
        activeOnly: !admin,
      })
    );
  } catch (error) {
    console.error("Error al consultar puntos de campaña:", error);
    return res.status(500).json({ msg: "Error al consultar los puntos de recolección" });
  }
};

const donacionesDeCampana = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ msg: "El identificador de la campaña no es válido" });
    }

    const campana = await Campana.findById(id);
    if (!campana) {
      return res.status(404).json({ msg: "La campaña no existe" });
    }

    const donaciones = await Donacion.find({ campana: id })
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido email telefono")
      .populate("recolector", "nombre apellido");

    return res.status(200).json({
      msg: "Donaciones consultadas correctamente",
      campana,
      total: donaciones.length,
      donaciones,
    });
  } catch (error) {
    console.error("Error al consultar donaciones de campaña:", error);
    return res
      .status(500)
      .json({ msg: "Error al consultar las donaciones de la campaña" });
  }
};

const eliminarCampana = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ msg: "El identificador de la campaña no es válido" });
    }

    const campana = await Campana.findById(id);
    if (!campana) {
      return res.status(404).json({ msg: "La campaña no existe" });
    }

    const total = await Donacion.countDocuments({ campana: id });
    if (total > 0) {
      return res.status(409).json({
        msg:
          `No se puede eliminar la campaña porque tiene ${total} donación(es) ` +
          "asociada(s). Puedes desactivarla para que deje de recibir donaciones.",
      });
    }

    const totalCategorias = await Categoria.countDocuments({ campana: id });
    if (totalCategorias > 0) {
      return res.status(409).json({
        msg:
          `No se puede eliminar la campaña porque tiene ${totalCategorias} categoría(s) asociada(s). ` +
          "Elimina primero las categorías que no tengan donaciones.",
        totalCategorias,
      });
    }

    await Campana.findByIdAndDelete(id);

    return res.status(200).json({
      msg: "Campaña eliminada correctamente",
      id,
    });
  } catch (error) {
    console.error("Error al eliminar campaña:", error);
    return res.status(500).json({ msg: "Error al eliminar la campaña" });
  }
};

const crearPuntoRecoleccion = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const input = req.body?.punto ?? req.body;
    if (input?.campanaId && String(input.campanaId) !== String(campaignId)) {
      return res.status(400).json({ msg: "El punto debe pertenecer a la campaña de la ruta" });
    }
    const [punto] = normalizePickupPoints([input], [], true);
    const currentCampaign = await Campana.findById(campaignId)
      .select("_id numeroRecolectores puntosRecoleccion")
      .lean();
    if (!currentCampaign) return res.status(404).json({ msg: "La campaña no existe" });

    const duplicate = (currentCampaign.puntosRecoleccion || []).some((existing) =>
      isPickupPointActive(existing)
      && pointUniqueKey(existing) === punto.claveUnica
    );
    if (punto.activo && duplicate) {
      return res.status(409).json({
        msg: "Ya existe un punto activo para ese edificio, piso y aula",
      });
    }
    const activeCount = (currentCampaign.puntosRecoleccion || [])
      .filter(isPickupPointActive).length;
    if (punto.activo && activeCount >= Number(currentCampaign.numeroRecolectores || 0)) {
      return res.status(409).json({
        msg: "No hay capacidad de recolectores disponible para agregar otro punto activo",
      });
    }

    const filter = { _id: campaignId };
    if (punto.activo) {
      filter.puntosRecoleccion = {
        $not: {
          $elemMatch: {
            claveUnica: punto.claveUnica,
            activo: { $ne: false },
            estado: { $ne: "inactivo" },
          },
        },
      };
      filter.$expr = {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$puntosRecoleccion", []] },
                as: "point",
                cond: {
                  $and: [
                    { $ne: ["$$point.activo", false] },
                    {
                      $ne: [
                        { $toLower: { $ifNull: ["$$point.estado", ""] } },
                        "inactivo",
                      ],
                    },
                  ],
                },
              },
            },
          },
          { $ifNull: ["$numeroRecolectores", 0] },
        ],
      };
    }
    const campana = await Campana.findOneAndUpdate(
      filter,
      { $push: { puntosRecoleccion: punto } },
      { new: true, runValidators: true }
    ).lean();
    if (!campana) {
      return res.status(409).json({
        msg: "El punto duplicado o la capacidad disponible cambió; vuelve a consultar",
      });
    }
    const createdPoint = campana.puntosRecoleccion.at(-1);

    return res.status(201).json({
      msg: "Punto de recolección creado correctamente",
      campanaId: String(campana._id),
      punto: serializePickupPoint(createdPoint, campana._id),
      totalPuntos: campana.puntosRecoleccion.length,
    });
  } catch (error) {
    console.error("Error al crear punto de recolección:", error);
    if (error.statusCode || error.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ msg: error.message });
    }
    return res.status(500).json({ msg: "Error al crear el punto de recolección" });
  }
};

const actualizarPuntoRecoleccion = async (req, res) => {
  try {
    const { campaignId, pointId } = req.params;
    if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(pointId)) {
      return res.status(400).json({ msg: "Los identificadores de campaña y punto no son válidos" });
    }
    const input = req.body?.punto ?? req.body;
    if (input?.campanaId && String(input.campanaId) !== String(campaignId)) {
      return res.status(400).json({ msg: "El punto debe pertenecer a la campaña de la ruta" });
    }

    const campaign = await Campana.findById(campaignId)
      .select("_id numeroRecolectores puntosRecoleccion");
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    const currentPoint = campaign.puntosRecoleccion.id(pointId);
    if (!currentPoint) return res.status(404).json({ msg: "El punto no existe en esta campaña" });

    const mergedInput = {
      ...currentPoint.toObject(),
      ...input,
      _id: pointId,
    };
    if (Object.hasOwn(input, "estado") && !Object.hasOwn(input, "activo")) {
      delete mergedInput.activo;
    }
    const [updatedPoint] = normalizePickupPoints([mergedInput], campaign.puntosRecoleccion);
    const duplicate = campaign.puntosRecoleccion.some((existing) =>
      String(existing._id) !== String(pointId)
      && isPickupPointActive(existing)
      && pointUniqueKey(existing) === updatedPoint.claveUnica
    );
    if (updatedPoint.activo && duplicate) {
      return res.status(409).json({
        msg: "Ya existe otro punto activo para ese edificio, piso y aula",
      });
    }
    const currentPointIsActive = isPickupPointActive(currentPoint);
    const activeCount = campaign.puntosRecoleccion
      .filter(isPickupPointActive).length;
    if (
      updatedPoint.activo
      && !currentPointIsActive
      && activeCount >= Number(campaign.numeroRecolectores || 0)
    ) {
      return res.status(409).json({
        msg: "No hay capacidad de recolectores disponible para activar este punto",
      });
    }

    const updateFilter = {
      _id: campaignId,
      "puntosRecoleccion._id": pointId,
    };
    if (updatedPoint.activo) {
      updateFilter.$and = [{
        puntosRecoleccion: {
          $not: {
            $elemMatch: {
              _id: { $ne: pointId },
              claveUnica: updatedPoint.claveUnica,
              activo: { $ne: false },
              estado: { $ne: "inactivo" },
            },
          },
        },
      }];
      updateFilter.$expr = {
        [currentPointIsActive ? "$lte" : "$lt"]: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$puntosRecoleccion", []] },
                as: "point",
                cond: {
                  $and: [
                    { $ne: ["$$point.activo", false] },
                    {
                      $ne: [
                        { $toLower: { $ifNull: ["$$point.estado", ""] } },
                        "inactivo",
                      ],
                    },
                  ],
                },
              },
            },
          },
          { $ifNull: ["$numeroRecolectores", 0] },
        ],
      };
    }
    const updatedCampaign = await Campana.findOneAndUpdate(
      updateFilter,
      { $set: { "puntosRecoleccion.$": updatedPoint } },
      { new: true, runValidators: true }
    ).lean();
    if (!updatedCampaign) {
      return res.status(409).json({
        msg: "El punto cambió concurrentemente; vuelve a consultar e inténtalo otra vez",
      });
    }

    const savedPoint = updatedCampaign.puntosRecoleccion.find(
      (point) => String(point._id) === String(pointId)
    );
    return res.status(200).json({
      msg: "Punto de recolección actualizado correctamente",
      campanaId: String(updatedCampaign._id),
      punto: serializePickupPoint(savedPoint, updatedCampaign._id),
      totalPuntos: updatedCampaign.puntosRecoleccion.length,
    });
  } catch (error) {
    console.error("Error al actualizar punto de recolección:", error);
    if (error.statusCode || error.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ msg: error.message });
    }
    return res.status(500).json({ msg: "Error al actualizar el punto de recolección" });
  }
};

const eliminarPuntoRecoleccion = async (req, res) => {
  try {
    const { campaignId, pointId } = req.params;
    if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(pointId)) {
      return res.status(400).json({ msg: "Los identificadores de campaña y punto no son válidos" });
    }

    const campaignExists = await Campana.exists({ _id: campaignId });
    if (!campaignExists) return res.status(404).json({ msg: "La campaña no existe" });

    const point = await Campana.findOne({
      _id: campaignId,
      "puntosRecoleccion._id": pointId,
    }).select("puntosRecoleccion").lean();
    const existingPoint = point?.puntosRecoleccion?.find(
      (item) => String(item._id) === pointId
    );
    if (!existingPoint) return res.status(404).json({ msg: "El punto no existe en esta campaña" });
    if (existingPoint.recolectores?.length) {
      return res.status(409).json({
        msg: "No se puede eliminar un punto que tiene recolectores asignados",
      });
    }

    const donationExists = await Donacion.exists({
      campana: campaignId,
      puntoRecoleccionRef: pointId,
    });
    if (donationExists) {
      return res.status(409).json({
        msg: "No se puede eliminar un punto asociado a una o más donaciones",
      });
    }

    const campana = await Campana.findOneAndUpdate(
      {
        _id: campaignId,
        puntosRecoleccion: {
          $elemMatch: {
            _id: pointId,
            $or: [
              { recolectores: { $size: 0 } },
              { recolectores: { $exists: false } },
            ],
          },
        },
      },
      { $pull: { puntosRecoleccion: { _id: pointId } } },
      { new: true, runValidators: true }
    ).lean();
    if (!campana) {
      return res.status(409).json({
        msg: "El punto cambió o recibió una asignación; vuelve a consultar la campaña",
      });
    }

    return res.status(200).json({
      msg: "Punto de recolección eliminado correctamente",
      campanaId: String(campana._id),
      pointId,
      totalPuntos: campana.puntosRecoleccion.length,
    });
  } catch (error) {
    console.error("Error al eliminar punto de recolección:", error);
    return res.status(500).json({ msg: "Error al eliminar el punto de recolección" });
  }
};

export {
  listarCampanasAdmin,
  listarPuntosDeCampana,
  donacionesDeCampana,
  eliminarCampana,
  crearPuntoRecoleccion,
  actualizarPuntoRecoleccion,
  eliminarPuntoRecoleccion,
};