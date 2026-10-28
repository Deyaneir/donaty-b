import mongoose from "mongoose";
import Categoria from "../models/Categoria.js";
import { isBlank } from "./validation.js";

const normalizeCategoryName = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const selectionError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

const findCategory = async (selection) => {
  const value = String(selection).trim();
  return mongoose.isValidObjectId(value)
    ? Categoria.findById(value)
    : Categoria.findOne({ nombreNormalizado: normalizeCategoryName(value) });
};

const resolveDonationCategory = async (
  categorySelection,
  subcategorySelection,
  expectedCampaignId = null
) => {
  if (isBlank(categorySelection)) {
    if (!isBlank(subcategorySelection)) {
      throw selectionError(400, "Debes indicar una categoría para la subcategoría");
    }
    return {
      categoria: "",
      categoriaId: null,
      campanaId: null,
      subcategoria: "",
    };
  }
  if (typeof categorySelection !== "string") {
    throw selectionError(400, "La categoría debe ser un identificador o nombre");
  }

  const category = await findCategory(categorySelection);
  if (!category) throw selectionError(404, "La categoría indicada no existe");
  if (!category.activa) throw selectionError(400, "La categoría indicada está inactiva");
  if (!category.campana) {
    throw selectionError(400, "La categoría no está asociada a una campaña");
  }
  if (
    expectedCampaignId &&
    String(category.campana) !== String(expectedCampaignId)
  ) {
    throw selectionError(400, "La categoría no pertenece a la campaña indicada");
  }

  if (isBlank(subcategorySelection)) {
    return {
      categoria: category.nombre,
      categoriaId: category._id,
      campanaId: category.campana,
      subcategoria: "",
    };
  }
  if (typeof subcategorySelection !== "string") {
    throw selectionError(400, "La subcategoría debe ser un identificador o nombre");
  }

  const subcategoryValue = subcategorySelection.trim();
  const subcategory = category.subcategorias.find((item) =>
    mongoose.isValidObjectId(subcategoryValue)
      ? String(item._id) === subcategoryValue
      : item.nombreNormalizado === normalizeCategoryName(subcategoryValue)
  );
  if (!subcategory) {
    throw selectionError(404, "La subcategoría indicada no existe en esa categoría");
  }
  if (!subcategory.activa) {
    throw selectionError(400, "La subcategoría indicada está inactiva");
  }

  return {
    categoria: category.nombre,
    categoriaId: category._id,
    campanaId: category.campana,
    subcategoria: subcategory.nombre,
  };
};

export { normalizeCategoryName, resolveDonationCategory };