import { unlink } from "node:fs/promises";
import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import { deleteImage, uploadImage } from "../helpers/cloudinaryImages.js";

const STAGE_STATES = {
  recepcion: ["pendiente_recoleccion", "recolectada"],
  finalizacion: ["entregada"],
  devolucion: ["devolucion", "devuelta"],
};

const groupEvidenceByStage = (evidences = []) => ({
  recepcion: evidences.filter((item) => item.etapa === "recepcion"),
  finalizacion: evidences.filter((item) => item.etapa === "finalizacion"),
  devolucion: evidences.filter((item) => item.etapa === "devolucion"),
});

const subirEvidenciaDonacion = async (req, res) => {
  let uploadedImage = null;
  const image = !Array.isArray(req.files?.imagen) ? req.files?.imagen : null;
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    const stage = String(req.body?.etapa ?? "").trim().toLowerCase();
    const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de donación no es válido" });
    }
    if (!Object.hasOwn(STAGE_STATES, stage)) {
      return res.status(400).json({ msg: "La etapa debe ser recepcion, finalizacion o devolucion" });
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ msg: "Debes enviar un encabezado Idempotency-Key válido" });
    }

    const donation = await Donacion.findById(id).select("_id estado recolector evidencias");
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
      return res.status(200).json({
        evidencia: existing,
        evidenciasPorEtapa: groupEvidenceByStage(donation.evidencias),
        duplicada: true,
      });
    }

    uploadedImage = await uploadImage(image, `donaty/evidencias/${stage}`);
    if (!uploadedImage) {
      return res.status(400).json({ msg: "Debes adjuntar una imagen de evidencia" });
    }
    const evidence = {
      etapa: stage,
      recolector: user._id,
      fecha: new Date(),
      ...uploadedImage,
      idempotencyKey,
    };

    const result = await Donacion.updateOne(
      {
        _id: id,
        recolector: user._id,
        estado: { $in: STAGE_STATES[stage] },
        "evidencias.idempotencyKey": { $ne: idempotencyKey },
      },
      { $push: { evidencias: evidence } },
      { runValidators: true }
    );
    if (result.modifiedCount !== 1) {
      const current = await Donacion.findById(id).select("estado recolector evidencias");
      const duplicate = current?.evidencias.find(
        (item) => item.idempotencyKey === idempotencyKey
      );
      await deleteImage(uploadedImage.imagenPublicId);
      uploadedImage = null;
      if (duplicate) {
        return res.status(200).json({
          evidencia: duplicate,
          evidenciasPorEtapa: groupEvidenceByStage(current.evidencias),
          duplicada: true,
        });
      }
      return res.status(409).json({
        msg: "La asignación o estado de la donación cambió; no se guardó la evidencia",
      });
    }

    uploadedImage = null;
    const updated = await Donacion.findById(id).select("evidencias");
    const savedEvidence = updated.evidencias.find(
      (item) => item.idempotencyKey === idempotencyKey
    );
    return res.status(201).json({
      evidencia: savedEvidence,
      evidenciasPorEtapa: groupEvidenceByStage(updated.evidencias),
      duplicada: false,
    });
  } catch (error) {
    if (uploadedImage?.imagenPublicId) {
      try {
        await deleteImage(uploadedImage.imagenPublicId);
      } catch (cleanupError) {
        console.error("No se pudo limpiar evidencia duplicada:", cleanupError.message || cleanupError);
      }
    }
    console.error("Error guardando evidencia de donación:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al guardar la evidencia",
    });
  } finally {
    if (image?.tempFilePath) {
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

export { subirEvidenciaDonacion };
