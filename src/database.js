import mongoose from "mongoose";
import Categoria from "./models/Categoria.js";

const CATEGORY_INDEX_NAME = "campana_1_nombreNormalizado_1";
const CATEGORY_INDEX_KEY = { campana: 1, nombreNormalizado: 1 };
const CATEGORY_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { campana: { $type: "objectId" } },
};

const isCampaignScopedCategoryIndex = (index) =>
  index?.unique === true
  && JSON.stringify(index.key) === JSON.stringify(CATEGORY_INDEX_KEY)
  && JSON.stringify(index.partialFilterExpression)
    === JSON.stringify(CATEGORY_INDEX_OPTIONS.partialFilterExpression);

const assertNoCategoryIndexDuplicates = async () => {
  const duplicate = await Categoria.aggregate([
    { $match: { campana: { $type: "objectId" } } },
    {
      $group: {
        _id: {
          campana: "$campana",
          nombreNormalizado: "$nombreNormalizado",
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]);

  if (duplicate.length > 0) {
    throw new Error(
      "No se puede crear el índice de categorías: existen nombres normalizados duplicados dentro de una campaña"
    );
  }
};

const ensureCategoryIndex = async () => {
  const indexes = await Categoria.collection.listIndexes().toArray();
  const existingIndex = indexes.find((index) => index.name === CATEGORY_INDEX_NAME);

  if (existingIndex && !isCampaignScopedCategoryIndex(existingIndex)) {
    await assertNoCategoryIndexDuplicates();
    await Categoria.collection.dropIndex(CATEGORY_INDEX_NAME);
    console.log("Índice legado de categorías eliminado; se aplicará la definición campaña-nombre");
  }

  await Categoria.createIndexes();
};

const connectDB = async (uri) => {
  try {
    await mongoose.connect(uri);
    await ensureCategoryIndex();
    console.log("MongoDB conectado");
  } catch (error) {
    console.error("Error conectando a MongoDB", error.message);
    process.exit(1);
  }
};

export default connectDB;
