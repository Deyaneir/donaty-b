import { unlink } from "node:fs/promises";
import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import { serializeDonationEvidence } from "../utils/donationEvidence.js";
import { deleteImage, uploadImage } from "../helpers/cloudinaryImages.js";

const STAGE_STATES = {
  recepcion: ["pendiente_recoleccion", "recolectada"],
  finalizacion: ["entregada"],
  devolucion: ["devolucion", "devuelta"],
};
const MAX_EVIDENCE_IMAGES = 2;

const getEvidenceFiles = (files = {}) => {
  const normalize = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
  return [
    ...normalize(files.imagen),
    ...normalize(files.imagenes),
    ...normalize(files.evidencias),
  ];
};

const subirEvidenciaDonacion = async (req, res) => {
  let uploadedImages = [];
  const images = getEvidenceFiles(req.files);
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    const stage = String(req.body?.etapa ?? "").trim().toLowerCase();
    const idempotencyKey = String(
      req.get("Idempotency-Key") ?? req.body?.idempotencyKey ?? ""
    ).trim();

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de donación no es válido" });
    }
    if (!Object.hasOwn(STAGE_STATES, stage)) {
      return res.status(400).json({ msg: "La etapa debe ser recepcion, finalizacion o devolucion" });
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ msg: "Debes enviar un idempotencyKey válido" });
    }

    const donation = await Donacion.findById(id)
      .select("_id estado recolector evidencias")
      .populate("evidencias.recolector", "nombre apellido");
    if (!donation) return res.status(404).json({ msg: "Donación no encontrada" });
    if (String(donation.recolector) !== String(user._id)) {
      return res.status(403).json({ msg: "Solo el recolector asignado puede subir evidencia" });
    }
    if (!STAGE_STATES[stage].includes(donation.estado)) {
      return res.status(409).json({
        msg: "La etapa de evidencia no corresponde al estado actual de la donación",
      });
    }

    const existing = donation.evidencias.find(
      (item) => item.idempotencyKey === idempotencyKey
    );
    if (existing) {
      const evidenciasPorEtapa = serializeDonationEvidence(donation.evidencias);
      return res.status(200).json({
        evidencia: evidenciasPorEtapa[stage],
        evidencias: evidenciasPorEtapa,
        evidenciasPorEtapa,
        duplicada: true,
      });
    }

    if (!images.length) {
      return res.status(400).json({ msg: "Debes adjuntar una imagen de evidencia" });
    }
    if (images.length > MAX_EVIDENCE_IMAGES) {
      return res.status(400).json({
        msg: `Puedes adjuntar hasta ${MAX_EVIDENCE_IMAGES} fotografías por evidencia`,
      });
    }
    for (const image of images) {
      uploadedImages.push(
        await uploadImage(image, `donaty/evidencias/${stage}`)
      );
    }
    const evidenceDate = new Date();
    const evidence = uploadedImages.map((uploadedImage) => ({
      etapa: stage,
      recolector: user._id,
      fecha: evidenceDate,
      ...uploadedImage,
      idempotencyKey,
    }));

    const result = await Donacion.updateOne(
      {
        _id: id,
        recolector: user._id,
        estado: { $in: STAGE_STATES[stage] },
        "evidencias.idempotencyKey": { $ne: idempotencyKey },
      },
      { $push: { evidencias: { $each: evidence } } },
      { runValidators: true }
    );
    if (result.modifiedCount !== 1) {
      const current = await Donacion.findById(id)
        .select("estado recolector evidencias")
        .populate("evidencias.recolector", "nombre apellido");
      const duplicates = (current?.evidencias || []).filter(
        (item) => item.idempotencyKey === idempotencyKey
      );
      for (const image of uploadedImages) {
        await deleteImage(image.imagenPublicId);
      }
      uploadedImages = [];
      if (duplicates.length) {
        const evidenciasPorEtapa = serializeDonationEvidence(current.evidencias);
        return res.status(200).json({
        evidencia: evidenciasPorEtapa[stage],
        evidencias: evidenciasPorEtapa,
        evidenciasPorEtapa,
          duplicada: true,
        });
      }
      return res.status(409).json({
        msg: "La asignación o estado de la donación cambió; no se guardó la evidencia",
      });
    }

    uploadedImages = [];
    const updated = await Donacion.findById(id)
      .select("evidencias")
      .populate("evidencias.recolector", "nombre apellido");
    const evidenciasPorEtapa = serializeDonationEvidence(updated.evidencias);
    return res.status(201).json({
      evidencia: evidenciasPorEtapa[stage],
      evidencias: evidenciasPorEtapa,
      evidenciasPorEtapa,
      duplicada: false,
    });
  } catch (error) {
    for (const image of uploadedImages) {
      try {
        await deleteImage(image.imagenPublicId);
      } catch (cleanupError) {
        console.error("No se pudo limpiar evidencia duplicada:", cleanupError.message || cleanupError);
      }
    }
    console.error("Error guardando evidencia de donación:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al guardar la evidencia",
    });
  } finally {
    for (const image of images) {
      if (!image?.tempFilePath) continue;
      try {
        await unlink(image.tempFilePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("No se pudo limpiar el archivo temporal de evidencia:", cleanupError.message || cleanupError);
        }
      }
    }
  }
};

export { getEvidenceFiles, subirEvidenciaDonacion };
