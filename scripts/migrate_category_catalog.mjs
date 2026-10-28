import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import Donacion from "../src/models/Donacion.js";
import Categoria from "../src/models/Categoria.js";
import Campana from "../src/models/Campana.js";
import { normalizeCategoryName } from "../src/utils/categoryCatalog.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDirectory, "..", ".env") });

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/donaty";

try {
  await mongoose.connect(uri);

  const withoutCampaign = await Donacion.countDocuments({
    categoria: { $type: "string", $ne: "" },
    $or: [{ campana: null }, { campana: { $exists: false } }],
  });
  const categoriesByCampaign = await Donacion.aggregate([
    {
      $match: {
        categoria: { $type: "string", $ne: "" },
        campana: { $type: "objectId" },
      },
    },
    {
      $group: {
        _id: "$categoria",
        campanas: { $addToSet: "$campana" },
      },
    },
  ]);
  const normalizedGroups = new Map();
  for (const group of categoriesByCampaign) {
    const nombre = String(group._id).trim();
    if (!nombre || nombre.length > 80) {
      console.warn(`Categoría omitida por longitud/formato: ${JSON.stringify(group._id)}`);
      continue;
    }
    const nombreNormalizado = normalizeCategoryName(nombre);
    const normalizedGroup = normalizedGroups.get(nombreNormalizado) || {
      nombres: new Set(),
      campanas: new Set(),
    };
    normalizedGroup.nombres.add(nombre);
    for (const campanaId of group.campanas) normalizedGroup.campanas.add(String(campanaId));
    normalizedGroups.set(nombreNormalizado, normalizedGroup);
  }

  let inserted = 0;
  let assigned = 0;
  let alreadyPresent = 0;
  let ambiguous = 0;
  let orphanedCampaign = 0;

  for (const [nombreNormalizado, group] of normalizedGroups) {
    if (group.campanas.size !== 1) {
      ambiguous += 1;
      console.warn(`Categoría omitida: ${JSON.stringify([...group.nombres])} aparece en más de una campaña`);
      continue;
    }

    const nombre = [...group.nombres][0];
    const campanaId = new mongoose.Types.ObjectId([...group.campanas][0]);
    if (!(await Campana.exists({ _id: campanaId }))) {
      orphanedCampaign += 1;
      console.warn(`Categoría omitida: ${JSON.stringify(nombre)} referencia una campaña inexistente`);
      continue;
    }
    const existing = await Categoria.findOne({ nombreNormalizado });
    if (existing?.campana && String(existing.campana) !== String(campanaId)) {
      ambiguous += 1;
      console.warn(`Categoría omitida: ${JSON.stringify(nombre)} ya pertenece a otra campaña`);
      continue;
    }

    let categoriaId;
    const aliases = [...group.nombres].filter((item) => item !== nombre);
    if (!existing) {
      const created = await Categoria.create({
        campana: campanaId,
        nombre,
        nombreNormalizado,
        nombresAnteriores: aliases,
        descripcion: "",
        iconKey: "",
        activa: true,
        subcategorias: [],
      });
      categoriaId = created._id;
      inserted += 1;
    } else {
      let changed = false;
      if (!existing.campana) {
        existing.campana = campanaId;
        changed = true;
      }
      if (aliases.some((item) => !existing.nombresAnteriores.includes(item))) {
        existing.nombresAnteriores.addToSet(...aliases);
        changed = true;
      }
      if (changed) await existing.save();
      categoriaId = existing._id;
      if (!existing.campana) assigned += 1;
      else if (changed) assigned += 1;
      else alreadyPresent += 1;
    }

    await Campana.updateOne(
      { _id: campanaId },
      { $addToSet: { categoriasPermitidas: categoriaId } }
    );
  }

  console.log(
    `Migración terminada. Nuevas: ${inserted}; asignadas: ${assigned}; ya correctas: ${alreadyPresent}; ambiguas: ${ambiguous}; campañas inexistentes: ${orphanedCampaign}; donaciones sin campaña: ${withoutCampaign}.`
  );
} catch (error) {
  console.error("No se pudo migrar el catálogo de categorías:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}