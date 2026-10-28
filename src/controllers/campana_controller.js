import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Categoria from "../models/Categoria.js";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";

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

const listarCampanas = async (req, res) => {
  try {
    const rol = String(req.user?.rol || "").toLowerCase();

    // Los administradores pueden consultar también las inactivas.
    // Donantes y recolectores solo consultan las activas.
    const filtro =
      rol === "admin" && req.query.todas === "true"
        ? {}
        : { activa: true };

    const campanas = await Campana.find(filtro).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      msg: "Campañas consultadas correctamente",
      total: campanas.length,
      campanas,
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
      fechaInicio,
      fechaFin,
      activa,
      categoriasPermitidas = [],
    } =
      req.body || {};

    if (typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({
        msg: "El nombre de la campaña es obligatorio",
      });
    }

    const inicio = fechaInicio ? new Date(fechaInicio) : null;
    const fin = fechaFin ? new Date(fechaFin) : null;

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

    if (inicio && fin && fin < inicio) {
      return res.status(400).json({
        msg: "La fecha de fin no puede ser anterior a la de inicio",
      });
    }

    const activaFinal = activa === undefined ? true : parseBoolean(activa);
    if (activaFinal === null) {
      return res.status(400).json({
        msg: "El campo activa debe ser verdadero o falso",
      });
    }

    const categorias = await validateCampaignCategories(categoriasPermitidas);
    const imagen = await uploadImage(req.files?.imagen, "donaty/campanas");

    const campana = await Campana.create({
      nombre: nombre.trim(),
      descripcion:
        typeof descripcion === "string" ? descripcion.trim() : "",
      fechaInicio: inicio,
      fechaFin: fin,
      activa: activaFinal,
      categoriasPermitidas: categorias,
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
      "fechaInicio",
      "fechaFin",
      "activa",
      "categoriasPermitidas",
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

    const fechaInicio =
      cambios.fechaInicio !== undefined
        ? cambios.fechaInicio
        : actual.fechaInicio;

    const fechaFin =
      cambios.fechaFin !== undefined ? cambios.fechaFin : actual.fechaFin;

    if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
      return res.status(400).json({
        msg: "La fecha de fin no puede ser anterior a la de inicio",
      });
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

export { listarCampanas, crearCampana, actualizarCampana };