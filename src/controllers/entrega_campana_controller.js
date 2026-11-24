import mongoose from "mongoose";
import { unlink } from "node:fs/promises";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import EntregaCampana from "../models/EntregaCampana.js";
import {
  createCampaignDelivery,
  findCampaignPrincipalPoint,
  getCampaignDeliveryReadiness,
  isCampaignFinished,
} from "../services/campaignDelivery.js";
import { publishCampaignEvent } from "../services/domainEvents.js";

const MAX_DELIVERY_IMAGES = 10;

const serializeCampaignDelivery = (delivery) => {
  const record = typeof delivery?.toObject === "function"
    ? delivery.toObject()
    : { ...delivery };
  const principal = record.recolectorPrincipal;
  const campaign = record.campana;
  const receiverName = [
    record.nombresReceptor,
    record.apellidosReceptor,
  ].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
  return {
    entrega: {
      recibeNombre: receiverName || record.receptor || "",
      recibeIdentificacion: record.recibeIdentificacion || "",
      recibeInstitucion: record.recibeInstitucion || "",
      fecha: record.fechaEntrega || null,
      fechaEntrega: record.fechaEntrega || null,
      observacion: record.observacion || "",
      entregadoPor: [
        record.recolectorPrincipalNombre || principal?.nombre || "",
        record.recolectorPrincipalApellido || principal?.apellido || "",
      ].filter(Boolean).join(" "),
    },
    campana: {
      id: String(campaign?._id ?? campaign ?? record.campana ?? ""),
      nombre: campaign?.nombre || record.campanaNombre || "",
    },
    tablas: (record.clasificaciones || []).map((classification) => ({
      clasificacion: classification.nombre,
      filas: (record.productos || [])
        .filter((product) =>
          String(product.clasificacionId || "") === String(classification.clasificacionId || "")
        )
        .map((product) => ({
          producto: product.nombreBien || "",
          cantidad: product.cantidad ?? null,
        })),
      total: classification.cantidadTotal || 0,
    })),
  };
};

const consultarEntregaGeneral = async (req, res) => {
  try {
    const user = req.user;
    const campaignId = req.params.campaignId || req.params.campanaId;
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const delivery = await EntregaCampana.findOne({ campana: campaignId })
      .populate("recolectorPrincipal", "nombre apellido")
      .populate("campana", "nombre")
      .lean();
    if (!delivery) {
      return res.status(404).json({
        msg: "La entrega general de esta campaña aún no ha sido registrada",
      });
    }
    const role = String(user.rol || "").toLowerCase();
    if (role === "donante") {
      const donationIds = (delivery.donaciones || [])
        .map((entry) => entry.donacion?._id ?? entry.donacion)
        .filter(Boolean);
      const ownsDonation = donationIds.length
        ? await Donacion.exists({
            _id: { $in: donationIds },
            campana: campaignId,
            donante: user._id,
          })
        : false;
      if (!ownsDonation) {
        return res.status(403).json({
          msg: "Solo puedes consultar la entrega de una campaña a la que pertenece una de tus donaciones",
        });
      }
      const serialized = serializeCampaignDelivery(delivery);
      return res.status(200).json({
        entregaGeneral: serialized.entrega,
        campana: serialized.campana,
      });
    }

    if (
      role !== "admin"
      && String(delivery.recolectorPrincipal?._id ?? delivery.recolectorPrincipal)
        !== String(user._id)
    ) {
      return res.status(403).json({
        msg: "Solo el recolector principal que registró la entrega puede consultarla",
      });
    }

    return res.status(200).json(serializeCampaignDelivery(delivery));
  } catch (error) {
    console.error("Error consultando la entrega general:", error.message || error);
    return res.status(500).json({
      msg: "No se pudo consultar la entrega general",
    });
  }
};

const getDeliveryImages = (files = {}) => {
  const normalize = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
  return [...normalize(files.imagen), ...normalize(files.imagenes)];
};

const consultarEstadoEntregaGeneral = async (req, res) => {
  try {
    const collectorId = req.user?._id;
    const { campaignId } = req.params;
    if (!collectorId) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const campaign = await Campana.findById(campaignId)
      .select("_id estado activa fechaFin puntosRecoleccion responsablesCampana")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });

    const readiness = await getCampaignDeliveryReadiness({
      campaign,
      collectorId,
    });
    const motivos = [];
    if (!readiness.esRecolectorPrincipal) motivos.push("no_es_recolector_principal");
    if (!readiness.campanaFinalizada) motivos.push("campana_no_finalizada");
    if (!readiness.recolectorHabilitado) motivos.push("recolector_no_habilitado");
    if (!readiness.totalDonaciones) motivos.push("sin_donaciones");
    if (readiness.totalDonaciones && !readiness.todasEnEntrega) {
      motivos.push("donaciones_pendientes");
    }
    if (readiness.donacionesSinClasificacion) {
      motivos.push("donaciones_sin_clasificacion");
    }
    if (readiness.entregaRegistrada) motivos.push("entrega_ya_registrada");

    return res.status(200).json({
      campanaId: String(campaign._id),
      puedeRegistrarEntrega: readiness.puedeRegistrarEntrega,
      puedeEntregar: readiness.puedeEntregar,
      esRecolectorPrincipal: readiness.esRecolectorPrincipal,
      campanaFinalizada: readiness.campanaFinalizada,
      todasEnEntrega: readiness.todasEnEntrega,
      totalDonaciones: readiness.totalDonaciones,
      donacionesPendientes: readiness.donacionesPendientes,
      donacionesSinClasificacion: readiness.donacionesSinClasificacion,
      entregaRegistrada: readiness.entregaRegistrada,
      motivos,
      ...(process.env.CAMPAIGN_DELIVERY_DEBUG === "true"
        ? { debug: readiness.debug }
        : {}),
    });
  } catch (error) {
    console.error("Error consultando estado de entrega general:", error.message || error);
    return res.status(500).json({
      msg: "No se pudo consultar el estado de la entrega general",
    });
  }
};

const registrarEntregaGeneral = async (req, res) => {
  const images = getDeliveryImages(req.files);
  const uploadedImages = [];
  try {
    const collectorId = req.user?._id;
    const campaignId = req.params?.campaignId || req.params?.campanaId;
    const receptorInput = req.body?.recibeNombre ?? req.body?.receptor;
    const receptor = typeof receptorInput === "string" ? receptorInput.trim() : "";
    const submittedDate = req.body?.fecha ?? req.body?.fechaEntrega;

    if (!collectorId) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    if (!receptor || receptor.length > 180) {
      return res.status(400).json({
        msg: "Indica el nombre de la persona o institución receptora (máximo 180 caracteres)",
      });
    }
    const nombresReceptor = String(req.body?.nombresReceptor ?? "").trim();
    const apellidosReceptor = String(req.body?.apellidosReceptor ?? "").trim();
    const recibeIdentificacion = String(req.body?.recibeIdentificacion ?? "").trim();
    const recibeInstitucion = String(req.body?.recibeInstitucion ?? "").trim();
    const telefonoReceptor = String(req.body?.telefonoReceptor ?? "").trim();
    const cargoReceptor = String(req.body?.cargoReceptor ?? "").trim();
    const observacion = String(req.body?.observacion ?? "").trim();
    const descripcionBienes = String(
      req.body?.descripcionBienes ?? observacion
    ).trim();
    if (
      nombresReceptor.length > 120
      || apellidosReceptor.length > 120
      || (Boolean(nombresReceptor) !== Boolean(apellidosReceptor))
      || recibeIdentificacion.length > 40
      || recibeInstitucion.length > 180
      || telefonoReceptor.length > 20
      || (telefonoReceptor && !/^\+?[0-9\s()-]{7,20}$/.test(telefonoReceptor))
      || cargoReceptor.length > 120
      || descripcionBienes.length > 2000
      || observacion.length > 2000
    ) {
      return res.status(400).json({
        msg: "Los datos del receptor no son válidos (nombres/apellidos, teléfono, cargo o descripción)",
      });
    }
    if (
      submittedDate !== undefined
      && (
        typeof submittedDate !== "string"
        || !submittedDate.trim()
        || Number.isNaN(new Date(submittedDate).getTime())
      )
    ) {
      return res.status(400).json({ msg: "La fecha de entrega no es válida" });
    }
    if (images.length > MAX_DELIVERY_IMAGES) {
      return res.status(400).json({
        msg: `Puedes adjuntar hasta ${MAX_DELIVERY_IMAGES} fotografías de evidencia`,
      });
    }

    const campaign = await Campana.findById(campaignId)
      .select("_id nombre estado activa fechaFin periodoAcademico puntosRecoleccion")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    if (!isCampaignFinished(campaign)) {
      return res.status(409).json({ msg: "La campaña todavía no ha finalizado" });
    }
    const isPrincipal = findCampaignPrincipalPoint(campaign, collectorId);
    if (!isPrincipal) {
      return res.status(403).json({
        msg: "Solo el recolector principal de un punto de la campaña puede registrar la entrega",
      });
    }

    for (const image of images) {
      uploadedImages.push(
        await uploadImage(image, "donaty/evidencias/entrega-campana")
      );
    }
    const entregaGeneral = await createCampaignDelivery({
      campaignId,
      collectorId,
      receptor,
      nombresReceptor,
      apellidosReceptor,
      recibeIdentificacion,
      recibeInstitucion,
      telefonoReceptor,
      cargoReceptor,
      observacion,
      descripcionBienes,
      fechaEntrega: submittedDate ? new Date(submittedDate) : new Date(),
      evidencias: uploadedImages.map((image) => ({
        ...image,
        fecha: new Date(),
      })),
    });

    uploadedImages.length = 0;
    await publishCampaignEvent(req, "campaign.delivery.registered", campaign);
    return res.status(201).json({
      msg: "Entrega general de campaña registrada correctamente",
      entregaGeneral: serializeCampaignDelivery(entregaGeneral),
    });
  } catch (error) {
    for (const image of uploadedImages) {
      try {
        await deleteImage(image.imagenPublicId);
      } catch (cleanupError) {
        console.error(
          "No se pudo limpiar una evidencia de entrega no registrada:",
          cleanupError.message || cleanupError
        );
      }
    }
    console.error("Error registrando la entrega general:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al registrar la entrega general",
    });
  } finally {
    for (const image of images) {
      if (!image?.tempFilePath) continue;
      try {
        await unlink(image.tempFilePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.error(
            "No se pudo limpiar el archivo temporal de entrega general:",
            error.message || error
          );
        }
      }
    }
  }
};

export {
  consultarEntregaGeneral,
  consultarEstadoEntregaGeneral,
  registrarEntregaGeneral,
};
