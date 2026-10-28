import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Categoria from "../models/Categoria.js";

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
        totalDonaciones: porCampana.get(String(c._id)) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Error al listar campañas (admin):", error);
    return res.status(500).json({ msg: "Error al consultar las campañas" });
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

export { listarCampanasAdmin, donacionesDeCampana, eliminarCampana };