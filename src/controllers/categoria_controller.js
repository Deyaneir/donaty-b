import mongoose from "mongoose";
import Categoria from "../models/Categoria.js";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import { normalizeCategoryName } from "../utils/categoryCatalog.js";

const validarClaveVisual = (value) =>
  value === "" || /^[a-zA-Z0-9_-]{1,64}$/.test(value);

const prepararSubcategorias = (value, existing = []) => {
  if (!Array.isArray(value)) {
    const error = new Error("Las subcategorías deben enviarse como una lista");
    error.statusCode = 400;
    throw error;
  }

  const merged = new Map(existing.map((item) => [
    item.nombreNormalizado || normalizeCategoryName(item.nombre),
    item.toObject ? item.toObject() : { ...item },
  ]));
  const seenNames = new Set();
  for (const item of value) {
    if (
      typeof item?.nombre !== "string" ||
      (item.descripcion !== undefined && typeof item.descripcion !== "string") ||
      (item.iconKey !== undefined && typeof item.iconKey !== "string")
    ) {
      const error = new Error("Nombre, descripción e icono de subcategoría deben ser texto");
      error.statusCode = 400;
      throw error;
    }
    const nombre = item.nombre.trim();
    const descripcion = (item.descripcion ?? "").trim();
    const iconKey = (item.iconKey ?? "").trim();
    const activa = item?.activa ?? true;
    const nombreNormalizado = normalizeCategoryName(nombre);

    if (!nombre || nombre.length > 80 || descripcion.length > 500) {
      const error = new Error("Cada subcategoría requiere nombre y tiene límites de longitud");
      error.statusCode = 400;
      throw error;
    }
    if (!validarClaveVisual(iconKey) || typeof activa !== "boolean") {
      const error = new Error("La clave visual o el estado de una subcategoría no es válido");
      error.statusCode = 400;
      throw error;
    }
    if (seenNames.has(nombreNormalizado)) {
      const error = new Error("No se permiten subcategorías duplicadas");
      error.statusCode = 409;
      throw error;
    }
    seenNames.add(nombreNormalizado);

    const previous = merged.get(nombreNormalizado);
    const subcategoria = {
      ...previous,
      nombre,
      nombreNormalizado,
      descripcion,
      iconKey,
      activa,
    };
    if (item?._id && mongoose.isValidObjectId(item._id)) subcategoria._id = item._id;
    merged.set(nombreNormalizado, subcategoria);
  }
  return [...merged.values()];
};

const validarDatosCategoria = ({ nombre, descripcion, iconKey, activa }) => {
  if (
    typeof nombre !== "string" ||
    typeof descripcion !== "string" ||
    typeof iconKey !== "string"
  ) {
    const error = new Error("Nombre, descripción e icono deben ser texto");
    error.statusCode = 400;
    throw error;
  }
  if (!nombre || nombre.length > 80 || descripcion.length > 500) {
    const error = new Error("El nombre es obligatorio y los campos deben respetar sus límites");
    error.statusCode = 400;
    throw error;
  }
  if (!validarClaveVisual(iconKey) || typeof activa !== "boolean") {
    const error = new Error("La clave visual o el estado no es válido");
    error.statusCode = 400;
    throw error;
  }
};

const obtenerCampana = async (id) => {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error("El identificador de la campaña no es válido");
    error.statusCode = 400;
    throw error;
  }
  const campana = await Campana.findById(id);
  if (!campana) {
    const error = new Error("La campaña no existe");
    error.statusCode = 404;
    throw error;
  }
  return campana;
};

const crearCategoriaEnCampana = async (req, res, campaignId) => {
  try {
    const campana = await obtenerCampana(campaignId);
    const body = req.body || {};
    if (
      typeof body.nombre !== "string" ||
      (body.descripcion !== undefined && typeof body.descripcion !== "string") ||
      (body.iconKey !== undefined && typeof body.iconKey !== "string")
    ) {
      return res.status(400).json({ msg: "Nombre, descripción e icono deben ser texto" });
    }
    const datos = {
      nombre: body.nombre.trim(),
      descripcion: (body.descripcion ?? "").trim(),
      iconKey: (body.iconKey ?? "").trim(),
      activa: body.activa ?? true,
    };
    validarDatosCategoria(datos);
    const categoria = await Categoria.create({
      ...datos,
      campana: campana._id,
      nombreNormalizado: normalizeCategoryName(datos.nombre),
      subcategorias: prepararSubcategorias(body.subcategorias ?? []),
    });

    await Campana.updateOne(
      { _id: campana._id },
      { $addToSet: { categoriasPermitidas: categoria._id } }
    );
    return res.status(201).json({ categoria });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ msg: "Ya existe una categoría con ese nombre" });
    return res.status(error.statusCode || 500).json({ msg: error.statusCode ? error.message : "Error al crear la categoría" });
  }
};

const listarCategorias = async (req, res) => {
  try {
    const filtro = { activa: true };
    if (req.query.campana !== undefined && req.query.campana !== "") {
      const campana = await obtenerCampana(req.query.campana);
      if (!campana.activa) {
        return res.status(404).json({ msg: "La campaña no existe o está inactiva" });
      }
      filtro.campana = campana._id;
    } else {
      const campanasActivas = await Campana.find({ activa: true }).distinct("_id");
      filtro.campana = { $in: campanasActivas };
    }
    const categorias = await Categoria.find(filtro)
      .sort({ nombre: 1 })
      .lean();
    for (const categoria of categorias) {
      categoria.subcategorias = (categoria.subcategorias || []).filter((item) => item.activa);
    }
    return res.status(200).json({ total: categorias.length, categorias });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ msg: error.message });
    console.error("Error al listar categorías:", error);
    return res.status(500).json({ msg: "Error al consultar las categorías" });
  }
};

const listarCategoriasDeCampana = async (req, res) => {
  try {
    const campana = await obtenerCampana(req.params.campanaId);
    const rol = String(req.user?.rol || "").toLowerCase();
    if (rol !== "admin" && !campana.activa) {
      return res.status(404).json({ msg: "La campaña no existe o está inactiva" });
    }
    const filtro = { campana: campana._id };
    if (rol !== "admin") filtro.activa = true;
    const categorias = await Categoria.find(filtro).sort({ nombre: 1 }).lean();
    if (rol === "admin" && categorias.length > 0) {
      const counts = await Donacion.aggregate([
        {
          $match: {
            campana: campana._id,
            $or: [
              { categoriaRef: { $in: categorias.map((item) => item._id) } },
              { categoriaRef: null },
            ],
          },
        },
        {
          $group: {
            _id: {
              categoriaRef: "$categoriaRef",
              categoria: "$categoria",
            },
            total: { $sum: 1 },
          },
        },
      ]);
      const totals = new Map(categorias.map((item) => [String(item._id), 0]));
      for (const entry of counts) {
        const categoryId = entry._id.categoriaRef
          ? String(entry._id.categoriaRef)
          : "";
        if (categoryId && totals.has(categoryId)) {
          totals.set(categoryId, totals.get(categoryId) + entry.total);
          continue;
        }
        if (!categoryId) {
          const legacyCategory = categorias.find(
            (item) =>
              item.nombre === entry._id.categoria ||
              (item.nombresAnteriores || []).includes(entry._id.categoria)
          );
          if (legacyCategory) {
            const id = String(legacyCategory._id);
            totals.set(id, totals.get(id) + entry.total);
          }
        }
      }
      for (const category of categorias) {
        category.totalDonaciones = totals.get(String(category._id)) || 0;
      }
    }
    if (rol !== "admin") {
      for (const categoria of categorias) {
        categoria.subcategorias = (categoria.subcategorias || []).filter((item) => item.activa);
      }
    }
    return res.status(200).json({ campana: campana._id, total: categorias.length, categorias });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ msg: error.message });
    console.error("Error al listar categorías de campaña:", error);
    return res.status(500).json({ msg: "Error al consultar las categorías de la campaña" });
  }
};

const listarSubcategorias = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la categoría no es válido" });
    }
    const categoria = await Categoria.findOne({ _id: id, activa: true }).lean();
    if (!categoria) return res.status(404).json({ msg: "La categoría no existe o está inactiva" });
    const campanaActiva = await Campana.exists({ _id: categoria.campana, activa: true });
    if (!campanaActiva) return res.status(404).json({ msg: "La campaña de la categoría no existe o está inactiva" });

    const subcategorias = (categoria.subcategorias || [])
      .filter((item) => item.activa)
      .sort((left, right) => left.nombre.localeCompare(right.nombre));
    return res.status(200).json({ categoria: categoria.nombre, total: subcategorias.length, subcategorias });
  } catch (error) {
    console.error("Error al listar subcategorías:", error);
    return res.status(500).json({ msg: "Error al consultar las subcategorías" });
  }
};

const listarCategoriasAdmin = async (_req, res) => {
  try {
    const categorias = await Categoria.find().sort({ nombre: 1 }).lean();
    return res.status(200).json({ total: categorias.length, categorias });
  } catch (error) {
    console.error("Error al listar categorías para administración:", error);
    return res.status(500).json({ msg: "Error al consultar las categorías" });
  }
};

const obtenerCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la categoría no es válido" });
    }
    const categoria = await Categoria.findById(id).populate("campana", "nombre activa");
    if (!categoria) return res.status(404).json({ msg: "La categoría no existe" });
    const rol = String(req.user?.rol || "").toLowerCase();
    if (!categoria.activa && rol !== "admin") {
      return res.status(404).json({ msg: "La categoría no existe o está inactiva" });
    }
    if (rol !== "admin" && (!categoria.campana || !categoria.campana.activa)) {
      return res.status(404).json({ msg: "La campaña de la categoría no existe o está inactiva" });
    }
    return res.status(200).json({ categoria });
  } catch (error) {
    console.error("Error al consultar categoría:", error);
    return res.status(500).json({ msg: "Error al consultar la categoría" });
  }
};

const listarDonacionesDeCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la categoría no es válido" });
    }
    const categoria = await Categoria.findById(id);
    if (!categoria) return res.status(404).json({ msg: "La categoría no existe" });
    if (!categoria.campana) {
      return res.status(409).json({ msg: "La categoría no está asociada a una campaña" });
    }
    const campana = await Campana.findById(categoria.campana).select("_id");
    if (!campana) return res.status(404).json({ msg: "La campaña de la categoría no existe" });

    const filter = {
      campana: campana._id,
      $or: [
        { categoriaRef: categoria._id },
        { categoriaRef: null, categoria: { $in: [categoria.nombre, ...(categoria.nombresAnteriores || [])] } },
      ],
    };
    const rol = String(req.user?.rol || "").toLowerCase();
    if (rol === "donante") filter.donante = req.user._id;
    if (rol === "recolector") {
      filter.$and = [
        {
          $or: [
            { categoriaRef: categoria._id },
            { categoriaRef: null, categoria: { $in: [categoria.nombre, ...(categoria.nombresAnteriores || [])] } },
          ],
        },
        {
          $or: [
            { recolector: req.user._id },
            { registradoPorRecolector: req.user._id },
          ],
        },
      ];
      delete filter.$or;
    }

    const donaciones = await Donacion.find(filter)
      .select("_id campana categoria categoriaRef subcategoria descripcion tipo estado imagenUrl createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({
      categoria: { _id: categoria._id, nombre: categoria.nombre },
      total: donaciones.length,
      donaciones,
    });
  } catch (error) {
    console.error("Error al consultar donaciones de categoría:", error);
    return res.status(500).json({ msg: "Error al consultar las donaciones de la categoría" });
  }
};

const crearCategoria = async (req, res) => {
  try {
    const campaignId = req.body?.campana;
    if (!campaignId) return res.status(400).json({ msg: "Debes indicar la campaña de la categoría" });
    return crearCategoriaEnCampana(req, res, campaignId);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ msg: "Ya existe una categoría con ese nombre" });
    return res.status(error.statusCode || 500).json({ msg: error.statusCode ? error.message : "Error al crear la categoría" });
  }
};

const actualizarCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la categoría no es válido" });
    }
    const categoria = await Categoria.findById(id);
    if (!categoria) return res.status(404).json({ msg: "La categoría no existe" });
    if (Object.hasOwn(req.body || {}, "campana")) {
      return res.status(400).json({ msg: "Una categoría no puede cambiarse de campaña" });
    }

    const body = req.body || {};
    const allowedFields = ["nombre", "descripcion", "iconKey", "activa", "subcategorias"];
    const providedFields = allowedFields.filter((field) => Object.hasOwn(body, field));
    if (!providedFields.length) return res.status(400).json({ msg: "Debes enviar al menos un campo" });

    if (Object.hasOwn(body, "nombre")) {
      if (typeof body.nombre !== "string") return res.status(400).json({ msg: "El nombre debe ser texto" });
      const nombre = body.nombre.trim();
      if (!nombre || nombre.length > 80) return res.status(400).json({ msg: "El nombre debe tener entre 1 y 80 caracteres" });
      if (nombre !== categoria.nombre) categoria.nombresAnteriores.addToSet(categoria.nombre);
      categoria.nombre = nombre;
      categoria.nombreNormalizado = normalizeCategoryName(nombre);
    }
    if (Object.hasOwn(body, "descripcion")) {
      if (typeof body.descripcion !== "string") return res.status(400).json({ msg: "La descripción debe ser texto" });
      const descripcion = body.descripcion.trim();
      if (descripcion.length > 500) return res.status(400).json({ msg: "La descripción no puede superar 500 caracteres" });
      categoria.descripcion = descripcion;
    }
    if (Object.hasOwn(body, "iconKey")) {
      if (typeof body.iconKey !== "string") return res.status(400).json({ msg: "La clave visual debe ser texto" });
      const iconKey = body.iconKey.trim();
      if (!validarClaveVisual(iconKey)) return res.status(400).json({ msg: "La clave visual no es válida" });
      categoria.iconKey = iconKey;
    }
    if (Object.hasOwn(body, "activa")) {
      if (typeof body.activa !== "boolean") return res.status(400).json({ msg: "El estado debe ser booleano" });
      categoria.activa = body.activa;
    }
    if (Object.hasOwn(body, "subcategorias")) {
      categoria.subcategorias = prepararSubcategorias(
        body.subcategorias,
        categoria.subcategorias
      );
    }

    await categoria.save();
    return res.status(200).json({ categoria });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ msg: "Ya existe una categoría con ese nombre" });
    return res.status(error.statusCode || 500).json({ msg: error.statusCode ? error.message : "Error al actualizar la categoría" });
  }
};

const eliminarCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la categoría no es válido" });
    }
    const categoria = await Categoria.findById(id);
    if (!categoria) return res.status(404).json({ msg: "La categoría no existe" });

    let filter = { categoriaRef: categoria._id };
    if (categoria.campana) {
      filter.$or = [
        { categoriaRef: categoria._id },
        {
          categoriaRef: null,
          campana: categoria.campana,
          categoria: { $in: [categoria.nombre, ...(categoria.nombresAnteriores || [])] },
        },
      ];
      delete filter.categoriaRef;
    } else {
      filter = {
        $or: [
          { categoriaRef: categoria._id },
          {
            categoriaRef: null,
            categoria: { $in: [categoria.nombre, ...(categoria.nombresAnteriores || [])] },
          },
        ],
      };
    }
    const totalDonaciones = await Donacion.countDocuments(filter);
    if (totalDonaciones > 0) {
      return res.status(409).json({
        msg: `No se puede eliminar la categoría porque tiene ${totalDonaciones} donación(es) asociada(s). Desactívala para conservar el historial.`,
        totalDonaciones,
      });
    }

    await Promise.all([
      Categoria.findByIdAndDelete(id),
      categoria.campana
        ? Campana.updateOne({ _id: categoria.campana }, { $pull: { categoriasPermitidas: categoria._id } })
        : Promise.resolve(),
    ]);
    return res.status(200).json({ msg: "Categoría eliminada correctamente", id });
  } catch (error) {
    console.error("Error al eliminar categoría:", error);
    return res.status(500).json({ msg: "Error al eliminar la categoría" });
  }
};

export {
  listarCategorias,
  listarCategoriasDeCampana,
  listarSubcategorias,
  listarCategoriasAdmin,
  obtenerCategoria,
  listarDonacionesDeCategoria,
  crearCategoria,
  crearCategoriaEnCampana,
  actualizarCategoria,
  eliminarCategoria,
};