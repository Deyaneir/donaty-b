import Clasificacion from "../models/Clasificacion.js";

const classificationError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const normalizeClassificationName = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

const getClassificationName = (value) => {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 160) {
    throw classificationError("El nombre de la clasificación es obligatorio (máximo 160 caracteres)");
  }
  return name;
};

const resolveDonationClassification = async ({
  campaignId,
  pointId,
  classificationId,
  classificationName,
  classificationModel = Clasificacion,
}) => {
  if (!campaignId || !pointId) {
    throw classificationError(
      "La donación debe estar asociada a una campaña y un punto de recolección",
      409
    );
  }

  if (classificationId) {
    const classification = await classificationModel.findOne({
      _id: classificationId,
      campana: campaignId,
      puntoRecoleccionRef: pointId,
    }).lean();
    if (!classification) {
      throw classificationError(
        "La clasificación no existe para esta campaña y punto de recolección",
        404
      );
    }
    if (
      classificationName
      && normalizeClassificationName(classificationName)
        !== normalizeClassificationName(classification.nombre)
    ) {
      throw classificationError(
        "El nombre no corresponde al identificador de clasificación enviado"
      );
    }
    return classification;
  }

  const nombre = getClassificationName(classificationName);
  const nombreClave = normalizeClassificationName(nombre);
  try {
    return await classificationModel.findOneAndUpdate(
      { campana: campaignId, puntoRecoleccionRef: pointId, nombreClave },
      {
        $setOnInsert: {
          campana: campaignId,
          puntoRecoleccionRef: pointId,
          nombre,
          nombreClave,
        },
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await classificationModel.findOne({
      campana: campaignId,
      puntoRecoleccionRef: pointId,
      nombreClave,
    }).lean();
    if (!existing) throw error;
    return existing;
  }
};

export {
  getClassificationName,
  normalizeClassificationName,
  resolveDonationClassification,
};
