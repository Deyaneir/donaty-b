import mongoose from "mongoose";
import { unlink } from "node:fs/promises";
import Donacion from "../models/Donacion.js";
import { isBlank } from "../utils/validation.js";
import { fetchEmbedding, cosineSimilarity } from "./ai_controller.js";
import AiEmbedding from "../models/AiEmbedding.js";
import Campana from "../models/Campana.js";
import Recolector from "../models/Recolector.js";
import { resolveDonationCategory } from "../utils/categoryCatalog.js";
import {
  requireAllVisibleDonationFields,
  validateDonationMetadata,
} from "../utils/categoryFields.js";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";
import Admin from "../models/Admin.js";
import Donante from "../models/Donante.js";
import EntregaCampana from "../models/EntregaCampana.js";
import { notifyUsers } from "../services/firebase_notifications.js";
import {
  createCampaignDelivery,
  isCampaignFinished,
} from "../services/campaignDelivery.js";
import { resolveDonationDelivery } from "../utils/donationDelivery.js";
import { createDonationWithAssignment } from "../services/donationAssignment.js";
import { resolveAcademicPeriod } from "../utils/academicPeriod.js";
import { publishDonationEvent } from "../services/domainEvents.js";
import {
  classifyCollectorGeofenceState,
  hasValidCollectorCoordinates,
} from "../utils/collectorLocation.js";
import { serializeCampaignDeliveryForDonor } from "../utils/campaignDelivery.js";
import { donationStatusLabel } from "../utils/donationStatus.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import {
  isCollectorAssignedToPoint,
  isPickupPointActive,
  serializeTracePickupPoint,
} from "../utils/pickupPoints.js";
import { resolverPuntoId } from "../utils/pickupPointResolver.js";
import {
  buildCurrentCollectorCampaignFilter,
  buildPendingCollectorDonationFilter,
} from "../utils/collectorHistory.js";
import {
  isCampaignAvailableNow,
  isCampaignScheduleFinished,
} from "../utils/campaignSchedule.js";
import {
  parseDonationCollectionLocation,
  realGpsCoordinates,
} from "../utils/donationLocation.js";
import {
  buildCollectorDonorFields,
  parseCollectorDonationMetadata,
  parseExternalDonor,
} from "../utils/collectorDonationInput.js";
import { normalizeClassifiedProducts } from "../utils/donationClassification.js";
import { serializeDonationEvidence } from "../utils/donationEvidence.js";
import { resolveDonationClassification } from "../services/donationClassifications.js";
import { urlPublica } from "../utils/publicUrl.js";

const notifyAdminsOfNewDonation = async (donacion) => {
  try {
    const admins = await Admin.find({ status: { $ne: false } }).select("_id").lean();
    await notifyUsers({
      eventKey: `donation-created:${donacion._id}`,
      recipients: admins.map((admin) => ({ userId: admin._id, role: "admin" })),
      title: "Nueva donación registrada",
      body: `Código ${donacion._id}: revisa la donación registrada.`,
      data: {
        tipo: "new_donation",
        type: "new_donation",
        donacionId: String(donacion._id),
        donationId: String(donacion._id),
        campanaId: String(donacion.campana?._id || donacion.campana || ""),
        campaignId: String(donacion.campana?._id || donacion.campana || ""),
      },
    });
  } catch (error) {
    console.error("Error preparando notificación de nueva donación:", error.message || error);
  }
};

const notifyCollectorOfAutomaticAssignment = async (donacion, collectorId) => {
  try {
    await notifyUsers({
      eventKey: `donation-auto-assigned:${donacion._id}:${collectorId}`,
      recipients: [{ userId: collectorId, role: "recolector" }],
      title: "Nueva donación asignada",
      body: `Código ${donacion._id}: revisa los detalles de la donación.`,
      data: {
        tipo: "donation_assigned",
        type: "donation_assigned",
        donacionId: String(donacion._id),
        donationId: String(donacion._id),
        campanaId: String(donacion.campana?._id || donacion.campana || ""),
        campaignId: String(donacion.campana?._id || donacion.campana || ""),
      },
    });
  } catch (error) {
    console.error("Error notificando la asignación automática:", error.message || error);
  }
};

const notifyDonationStatusChange = async (
  donacion,
  previousStatus,
  nextStatus,
  changedBy = null
) => {
  if (!donacion?._id || previousStatus === nextStatus) return;
  try {
    const admins = await Admin.find({ status: { $ne: false } }).select("_id").lean();
    const fullName = (person) =>
      `${person?.nombre || ""} ${person?.apellido || ""}`.trim();
    const donorName = fullName(donacion.donante)
      || String(donacion.nombreDonante || "").trim();
    const collectorName = fullName(donacion.recolector);
    const campaignName = String(donacion.campana?.nombre || "");
    const changedByName = fullName(changedBy);
    const donationName = String(
      donacion.nombreBien
      || donacion.descripcion
      || [donacion.categoria, donacion.subcategoria].filter(Boolean).join(" · ")
      || ""
    ).trim();
    const displayName = donationName ? `“${donationName}”` : "tu aporte";
    const previousStatusLabel = donationStatusLabel(previousStatus);
    const newStatusLabel = donationStatusLabel(nextStatus);
    const recipients = [
      ...(donacion.donante
        ? [{ userId: donacion.donante._id || donacion.donante, role: "donante" }]
        : []),
      ...(donacion.recolector
        ? [{ userId: donacion.recolector._id || donacion.recolector, role: "recolector" }]
        : []),
      ...admins.map((admin) => ({ userId: admin._id, role: "admin" })),
    ];
    await notifyUsers({
      eventKey: `donation-status:${donacion._id}:${previousStatus}:${nextStatus}:${new Date(donacion.updatedAt || Date.now()).getTime()}`,
      recipients,
      title: "Estado de tu donación actualizado",
      body: `El estado de ${displayName} cambió de ${previousStatusLabel} a ${newStatusLabel}.`,
      data: {
        type: "donation_status",
        tipo: "donation_status",
        donationId: String(donacion._id),
        donacionId: String(donacion._id),
        campaignId: String(donacion.campana?._id || donacion.campana || ""),
        campanaId: String(donacion.campana?._id || donacion.campana || ""),
        previousStatus,
        previousState: previousStatus,
        status: nextStatus,
        estado: nextStatus,
        newStatus: nextStatus,
        previousStatusLabel,
        newStatusLabel,
        donationName,
        donationDescription: String(donacion.descripcion || ""),
        donorId: String(donacion.donante?._id || donacion.donante || ""),
        donorName,
        collectorId: String(donacion.recolector?._id || donacion.recolector || ""),
        collectorName,
        campaignName,
        changedById: String(changedBy?._id || ""),
        changedByName,
        changedByRole: String(changedBy?.rol || ""),
      },
    });
  } catch (error) {
    console.error("Error preparando notificación de estado:", error.message || error);
  }
};

const TIPOS = ["fisica"];
const ESTADOS = [
  "pendiente",
  "asignada",
  "pendiente_recoleccion",
  "recolectada",
  "clasificada",
  "en_entrega",
  "entregada",
  "cancelada",
  "devolucion",
  "devuelta",
];

const normalizeTipo = (value = "") => {
  const raw = String(value).trim().toLowerCase();
  if (raw === "fisico" || raw === "física") return "fisica";
  return raw;
};

const normalizeEstado = (value = "") => String(value).trim().toLowerCase();
const withDonationStatusLabel = (item) => {
  const donation = typeof item?.toObject === "function" ? item.toObject() : item;
  return {
    ...donation,
    estadoLabel: donationStatusLabel(donation?.estado),
  };
};
const getCampaignDonationRegistrationError = (campaign) => {
  const state = String(campaign?.estado ?? "").toLowerCase();
  if (state === "finalizada" || isCampaignScheduleFinished(campaign)) {
    return Object.assign(
      new Error("La campaña finalizó y no acepta nuevas donaciones"),
      { statusCode: 409 }
    );
  }
  if (
    campaign?.activa !== true
    || ["borrador", "desactivada"].includes(state)
  ) {
    return Object.assign(
      new Error("La campaña está inactiva y no acepta nuevas donaciones"),
      { statusCode: 409 }
    );
  }
  if (!isCampaignAvailableNow(campaign)) {
    return Object.assign(
      new Error("La campaña no está dentro de su fecha y horario de disponibilidad"),
      { statusCode: 409 }
    );
  }
  return null;
};
const parseCoordinatePair = (latitud, longitud) => {
  const latMissing = latitud === undefined || latitud === null || latitud === "";
  const lngMissing = longitud === undefined || longitud === null || longitud === "";
  if (latMissing && lngMissing) return null;
  const lat = Number(latitud);
  const lng = Number(longitud);
  if (
    latMissing || lngMissing ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) return undefined;
  return { latitud: lat, longitud: lng };
};
const parseMetadata = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Ignore malformed optional metadata.
    }
  }
  return {};
};
const escapeRegex = (str = "") =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validateCategoryQuantity = (metadata, category) => {
  const quantity = metadata?.metadata?.cantidad;
  if (quantity === undefined) return;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw Object.assign(new Error("La cantidad debe ser un entero positivo"), { statusCode: 400 });
  }
  if (
    Number.isInteger(category.maxUnidadesPorDonacion)
    && quantity > category.maxUnidadesPorDonacion
  ) {
    throw Object.assign(
      new Error(`La cantidad máxima para esta categoría es ${category.maxUnidadesPorDonacion}`),
      { statusCode: 400 }
    );
  }
};

const resolveDonationRegistrationError = (error) => {
  if (error?.statusCode) {
    return { statusCode: error.statusCode, message: error.message };
  }
  if (error instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(error.errors || {})
      .map((item) => item.message)
      .filter(Boolean);
    return {
      statusCode: 400,
      message: messages.length
        ? messages.join("; ")
        : "Los datos de la donación no son válidos",
    };
  }
  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      message: `El campo ${error.path} tiene un formato no válido`,
    };
  }
  return {
    statusCode: 500,
    message: "No se pudo registrar la donación",
  };
};

const resolvePickupPoint = (campaign, pointId, collectorId = null) => {
  if (!pointId) return null;
  if (!mongoose.isValidObjectId(String(pointId))) {
    throw Object.assign(new Error("El punto de recolección no es válido"), { statusCode: 400 });
  }
  const point = campaign.puntosRecoleccion?.id(pointId);
  if (!point || !isPickupPointActive(point)) {
    throw Object.assign(new Error("El punto no pertenece a la campaña activa"), { statusCode: 400 });
  }
  if (
    collectorId
    && !isCollectorAssignedToPoint(point, collectorId)
  ) {
    throw Object.assign(new Error("No estás asignado al punto de recolección indicado"), { statusCode: 403 });
  }
  return point._id;
};

const statusHistoryEntry = (status, user, observaciones = "") => ({
  estado: status,
  responsable: user?._id || null,
  rolResponsable: String(user?.rol || ""),
  fecha: new Date(),
  observaciones: String(observaciones || "").trim().slice(0, 1000),
});

const getDonorProfile = async (user) => {
  const profile = await Donante.findById(user?._id)
    .select("nombre apellido direccion telefono")
    .lean();
  if (!profile) {
    throw Object.assign(new Error("No se encontró el perfil del donante autenticado"), {
      statusCode: 404,
    });
  }
  return profile;
};

const crearDonacion = async (req, res) => {
  let imagenSubida = null;
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });
    const donorProfile = await getDonorProfile(user);
    if (!String(donorProfile.telefono ?? "").trim()) {
      return res.status(400).json({
        msg: "Completa tu perfil: registra un teléfono de contacto antes de crear la donación",
      });
    }

    const {
      tipo,
      categoria,
      nombreBien,
      subcategoria,
      descripcion,
      referenciasEntrega,
      metadata,
      campana,
      ubicacionRecoleccion: ubicacionRecoleccionInput,
    } = req.body || {};
    const ubicacionRecoleccion = parseDonationCollectionLocation(
      ubicacionRecoleccionInput
    );

    if (isBlank(tipo)) return res.status(400).json({ msg: "Debes indicar el tipo de donación" });
    const tipoFinal = normalizeTipo(tipo);
    if (!TIPOS.includes(tipoFinal)) return res.status(400).json({ msg: "Tipo de donación inválido" });

    const categoriaResuelta = await resolveDonationCategory(categoria, subcategoria);
    if (!categoriaResuelta.categoriaId || isBlank(campana)) {
      return res.status(400).json({ msg: "Debes indicar una categoría y su campaña para registrar la donación" });
    }
    if (!mongoose.isValidObjectId(campana)) {
      return res.status(400).json({ msg: "La campaña indicada no es válida" });
    }
    const campanaDoc = await Campana.findById(campana)
      .select("activa estado fechaInicio fechaFin horaInicio horaFin categoriasPermitidas puntosRecoleccion");
    if (!campanaDoc) return res.status(404).json({ msg: "La campaña indicada no existe" });
    const registrationError = getCampaignDonationRegistrationError(campanaDoc);
    if (registrationError) {
      return res.status(registrationError.statusCode).json({ msg: registrationError.message });
    }
    if (String(categoriaResuelta.campanaId) !== String(campanaDoc._id)) {
      return res.status(400).json({ msg: "La categoría no pertenece a la campaña indicada" });
    }
    if (
      campanaDoc.categoriasPermitidas?.length > 0 &&
      !campanaDoc.categoriasPermitidas.some((id) => String(id) === String(categoriaResuelta.categoriaId))
    ) {
      return res.status(400).json({ msg: "La categoría seleccionada no está permitida en esta campaña" });
    }
    const metadataValidada = validateDonationMetadata(
      metadata,
      requireAllVisibleDonationFields(metadata, categoriaResuelta.campos)
    );
    validateCategoryQuantity(metadataValidada, categoriaResuelta);
    if (isBlank(descripcion)) {
      return res.status(400).json({ msg: "La descripción de la donación es obligatoria" });
    }
    if (isBlank(nombreBien)) {
      return res.status(400).json({ msg: "Debes indicar el nombre del bien donado" });
    }
    if (!req.files?.imagen) {
      return res.status(400).json({ msg: "Debes adjuntar una foto del bien donado" });
    }
    const descNorm = String(descripcion || "").trim();
    if (descNorm) {
      const dup = await Donacion.findOne({
        donante: user._id,
        descripcion: { $regex: `^${escapeRegex(descNorm)}$`, $options: "i" },
      });
      if (dup) {
        return res.status(409).json({ msg: "Ya registraste una donación con esa descripción. Modifícala para continuar." });
      }
    }

    let pendingEmbedding;
    if (descNorm.length >= 3) {
      try {
        const { vector, model } = await fetchEmbedding(descNorm);
        const threshold = descNorm.length <= 5 ? 0.95 : descNorm.length <= 15 ? 0.85 : 0.8;
        const existentes = await AiEmbedding.find({ model, "meta.donanteId": String(user._id) }).lean();
        const similares = existentes
          .map((doc) => {
            const score = cosineSimilarity(vector, doc.embedding);
            return score === null ? null : { score, text: doc.text, donacionId: doc.meta?.donacionId };
          })
          .filter(Boolean)
          .filter((item) => item.score >= threshold)
          .sort((left, right) => right.score - left.score)
          .slice(0, 3);
        if (similares.length) {
          return res.status(409).json({
            msg: "Existe una donación muy similar. Ajusta la descripción.",
            similares: similares.map((item) => ({
              text: item.text,
              score: Number(item.score.toFixed(3)),
              donacionId: item.donacionId,
            })),
          });
        }
        pendingEmbedding = { vector, model };
      } catch (error) {
        console.warn("IA similarity skip:", error?.message || error);
      }
    }

    imagenSubida = await uploadImage(req.files?.imagen, "donaty/donaciones");
    const { donacion, asignacion } = await createDonationWithAssignment({
      campaignId: campanaDoc._id,
      buildDonation: ({ campaign, point, collector, assignedAt }) => {
        const delivery = resolveDonationDelivery({
          profile: donorProfile,
          campaign,
          method: "punto_recoleccion",
          pointId: point._id,
          references: referenciasEntrega,
        });
        return {
          donante: user._id,
          nombreDonante: delivery.nombreDonante,
          campana: campaign._id,
          periodoAcademico:
            campaign.periodoAcademico
            || resolveAcademicPeriod(campaign.fechaInicio),
          categoria: categoriaResuelta.categoria,
          categoriaRef: categoriaResuelta.categoriaId,
          nombreBien: String(nombreBien).trim(),
          subcategoria: categoriaResuelta.subcategoria,
          tipo: tipoFinal,
          descripcion: descripcion ?? "",
          estado: "asignada",
          metodoEntrega: delivery.metodoEntrega,
          ...(ubicacionRecoleccion ? { ubicacionRecoleccion } : {}),
          historialEstados: [
            statusHistoryEntry(
              "asignada",
              user,
              "Asignación automática del punto y recolector al registrar la donación"
            ),
          ],
          direccionEntrega: delivery.direccionEntrega,
          referenciasEntrega: delivery.referenciasEntrega,
          telefonoContacto: delivery.telefonoContacto,
          fechaRegistro: assignedAt,
          metadata: metadataValidada.metadata,
          camposSnapshot: metadataValidada.camposSnapshot,
          ...(imagenSubida || {}),
        };
      },
    });
    if (pendingEmbedding) {
      try {
        await AiEmbedding.create({
          text: descNorm,
          embedding: pendingEmbedding.vector,
          model: pendingEmbedding.model,
          dims: pendingEmbedding.vector.length,
          meta: { donacionId: String(donacion._id), donanteId: String(user._id) },
        });
      } catch (error) {
        console.warn("No se pudo guardar embedding:", error?.message || error);
      }
    }
    publishDonationEvent(req, "donation.created", donacion);
    void notifyAdminsOfNewDonation(donacion);
    void notifyCollectorOfAutomaticAssignment(
      donacion,
      asignacion.recolector._id
    );
    const data = {
      tipo: "new_donation",
      donacionId: String(donacion._id),
      campanaId: String(donacion.campana?._id ?? donacion.campana ?? ""),
    };
    return res.status(201).json({ donacion, asignacion, data });
  } catch (error) {
    if (imagenSubida?.imagenPublicId) {
      try {
        await deleteImage(imagenSubida.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo limpiar la imagen de donación:", cleanupError.message);
      }
    }
    console.error(error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : `❌ Error en el servidor - ${error}`,
    });
  }
};

const crearDonacionRecolector = async (req, res) => {
  let imagenSubida = null;
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const {
      tipo,
      categoria,
      nombreBien,
      subcategoria,
      descripcion,
      direccionEntrega,
      telefonoContacto,
      metadata,
      cantidad,
      campana,
      puntoRecoleccionId,
      donanteExterno,
      nombre,
      apellido,
      telefono,
      puntoRecoleccion,
      donanteLatitud,
      donanteLongitud,
      puntoRecoleccionLatitud,
      puntoRecoleccionLongitud,
      latitud,
      longitud,
      ubicacionRecoleccion: ubicacionRecoleccionInput,
    } = req.body || {};
    const ubicacionRecoleccion = parseDonationCollectionLocation(
      ubicacionRecoleccionInput
    );

    const tipoFinal = normalizeTipo(tipo ?? "fisica");
    if (!TIPOS.includes(tipoFinal)) return res.status(400).json({ msg: "Tipo de donación inválido" });
    const categoriaResuelta = await resolveDonationCategory(categoria, subcategoria);
    if (!categoriaResuelta.categoriaId || isBlank(campana)) {
      return res.status(400).json({ msg: "Debes indicar una categoría y su campaña para registrar la donación" });
    }
    if (!mongoose.Types.ObjectId.isValid(campana)) {
      return res.status(400).json({ msg: "La campaña indicada no es válida" });
    }
    const campanaDoc = await Campana.findById(campana)
      .select("activa estado fechaInicio fechaFin horaInicio horaFin categoriasPermitidas puntosRecoleccion");
    if (!campanaDoc) return res.status(404).json({ msg: "La campaña indicada no existe" });
    const registrationError = getCampaignDonationRegistrationError(campanaDoc);
    if (registrationError) {
      return res.status(registrationError.statusCode).json({ msg: registrationError.message });
    }
    if (String(categoriaResuelta.campanaId) !== String(campanaDoc._id)) {
      return res.status(400).json({ msg: "La categoría no pertenece a la campaña indicada" });
    }
    if (
      campanaDoc.categoriasPermitidas?.length > 0 &&
      !campanaDoc.categoriasPermitidas.some((id) => String(id) === String(categoriaResuelta.categoriaId))
    ) {
      return res.status(400).json({ msg: "La categoría seleccionada no está permitida en esta campaña" });
    }
    const metadataNormalizada = parseCollectorDonationMetadata(metadata, cantidad);
    const metadataValidada = validateDonationMetadata(
      metadataNormalizada,
      requireAllVisibleDonationFields(metadataNormalizada, categoriaResuelta.campos)
    );
    validateCategoryQuantity(metadataValidada, categoriaResuelta);
    if (isBlank(descripcion)) {
      return res.status(400).json({ msg: "La descripción de la donación es obligatoria" });
    }
    if (isBlank(nombreBien)) {
      return res.status(400).json({ msg: "Debes indicar el nombre del bien donado" });
    }
    if (!req.files?.imagen) {
      return res.status(400).json({ msg: "Debes adjuntar una foto del bien donado" });
    }

    const externo = parseExternalDonor(donanteExterno);
    if (!Object.keys(externo).length) {
      Object.assign(externo, {
        nombre: nombre ?? "",
        apellido: apellido ?? "",
        telefono: telefono ?? "",
      });
    }
    const donorNombre = String(externo.nombre ?? "").trim();
    const donorApellido = String(externo.apellido ?? "").trim();
    const donorTelefono = String(externo.telefono ?? "").trim();
    const donorCoordinates = parseCoordinatePair(
      externo.latitud ?? donanteLatitud,
      externo.longitud ?? donanteLongitud
    );
    const pickup = parseMetadata(puntoRecoleccion);
    let pickupCoordinates = parseCoordinatePair(
      pickup.latitud ?? puntoRecoleccionLatitud ?? latitud,
      pickup.longitud ?? puntoRecoleccionLongitud ?? longitud
    );
    if (ubicacionRecoleccion) {
      pickupCoordinates = realGpsCoordinates(ubicacionRecoleccion);
    }
    if (donorCoordinates === undefined || pickupCoordinates === undefined) {
      return res.status(400).json({ msg: "Las coordenadas deben incluir latitud y longitud válidas" });
    }
    if (isBlank(donorNombre) || isBlank(donorApellido)) {
      return res.status(400).json({ msg: "El nombre y apellido del donante externo son obligatorios" });
    }
    if (isBlank(donorTelefono)) {
      return res.status(400).json({ msg: "El teléfono del donante externo es obligatorio" });
    }
    let pickupPointRef = resolvePickupPoint(campanaDoc, puntoRecoleccionId, user._id);
    if (!pickupPointRef && campanaDoc.puntosRecoleccion?.length) {
      const assignedPoints = campanaDoc.puntosRecoleccion.filter((point) =>
        isPickupPointActive(point)
        && isCollectorAssignedToPoint(point, user._id)
      );
      if (assignedPoints.length === 1) pickupPointRef = assignedPoints[0]._id;
      else if (assignedPoints.length > 1) {
        return res.status(400).json({ msg: "Debes indicar el punto de recolección asignado" });
      } else {
        return res.status(403).json({ msg: "No tienes un punto asignado en esta campaña" });
      }
    }

    const donorFields = buildCollectorDonorFields({
      donor: {
        nombre: donorNombre,
        apellido: donorApellido,
        telefono: donorTelefono,
      },
      coordinates: donorCoordinates,
      direccionEntrega,
      telefonoContacto,
    });
    const descNorm = String(descripcion || "").trim();
    if (descNorm) {
      const duplicada = await Donacion.findOne({
        registradoPorRecolector: user._id,
        descripcion: { $regex: `^${escapeRegex(descNorm)}$`, $options: "i" },
      });
      if (duplicada) {
        return res.status(409).json({ msg: "Ya registraste una donación con esa descripción. Modifícala para continuar." });
      }
    }

    imagenSubida = await uploadImage(req.files?.imagen, "donaty/donaciones");
    const { donacion, asignacion } = await createDonationWithAssignment({
      campaignId: campanaDoc._id,
      pointId: pickupPointRef,
      requestingCollectorId: user._id,
      buildDonation: ({ campaign, point, assignedAt }) => ({
        registradoPorRecolector: user._id,
        campana: campaign._id,
        periodoAcademico:
          campaign.periodoAcademico
          || resolveAcademicPeriod(campaign.fechaInicio),
        categoria: categoriaResuelta.categoria,
        categoriaRef: categoriaResuelta.categoriaId,
        nombreBien: String(nombreBien).trim(),
        subcategoria: categoriaResuelta.subcategoria,
        ...donorFields,
        tipo: tipoFinal,
        descripcion: descripcion ?? "",
        estado: "asignada",
        puntoRecoleccionRef: point._id,
        ...(ubicacionRecoleccion ? { ubicacionRecoleccion } : {}),
        historialEstados: [statusHistoryEntry("asignada", user)],
        ...(pickupCoordinates ? { puntoRecoleccion: pickupCoordinates } : {}),
        fechaRegistro: assignedAt,
        metadata: metadataValidada.metadata,
        camposSnapshot: metadataValidada.camposSnapshot,
        ...(imagenSubida || {}),
      }),
    });
    await donacion.populate([
      { path: "recolector", select: "nombre apellido email telefono" },
      { path: "registradoPorRecolector", select: "nombre apellido email telefono" },
      { path: "campana", select: "nombre activa" },
    ]);
    publishDonationEvent(req, "donation.created", donacion);
    void notifyAdminsOfNewDonation(donacion);
    void notifyCollectorOfAutomaticAssignment(
      donacion,
      asignacion.recolector._id
    );
    const data = {
      tipo: "new_donation",
      donacionId: String(donacion._id),
      campanaId: String(donacion.campana?._id ?? donacion.campana ?? ""),
    };
    return res.status(201).json({ donacion, asignacion, data });
  } catch (error) {
    if (imagenSubida?.imagenPublicId) {
      try {
        await deleteImage(imagenSubida.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo limpiar la imagen de donación:", cleanupError.message);
      }
    }
    console.error("Error al registrar donación por recolector:", error);
    const responseError = resolveDonationRegistrationError(error);
    return res.status(responseError.statusCode).json({ msg: responseError.message });
  }
};

const listarMisDonaciones = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const items = await Donacion.find({ donante: user._id })
      .sort({ createdAt: -1 })
      .populate(
        "campana",
        "nombre activa estado imagenUrl fechaInicio fechaFin periodoAcademico"
      )
      .populate("recolector", "nombre apellido");
    const campaignIds = [...new Set(
      items
        .map((item) => item.campana?._id)
        .filter(Boolean)
        .map(String)
    )];
    const deliveries = campaignIds.length
      ? await EntregaCampana.find({ campana: { $in: campaignIds } })
        .select("_id campana receptor nombresReceptor apellidosReceptor telefonoReceptor cargoReceptor descripcionBienes fechaEntrega responsablesCampana evidencias donaciones estado createdAt updatedAt")
        .lean()
      : [];
    const deliveryByCampaign = new Map(
      deliveries.map((delivery) => [String(delivery.campana), delivery])
    );
    return res.status(200).json({
      items: items.map((item) => {
        const donation = item.toObject();
        const campaignDelivery = deliveryByCampaign.get(String(item.campana?._id || ""));
        const donationHasDelivery = campaignDelivery?.donaciones?.some(
          (entry) => String(entry.donacion?._id ?? entry.donacion) === String(donation._id)
        );
        return {
          ...donation,
          estadoLabel: donationStatusLabel(donation.estado),
          evidencias: (donation.evidencias || []).map((evidence) => ({
            ...evidence,
            imagenUrl: urlPublica(evidence.imagenUrl),
          })),
          entregas: (donation.entregas || []).map((delivery) => ({
            ...delivery,
            imagenUrl: urlPublica(delivery.imagenUrl),
          })),
          entregaGeneralCampana: serializeCampaignDeliveryForDonor(
            donationHasDelivery ? campaignDelivery : null,
            donationHasDelivery ? item.campana?._id || null : null
          ),
        };
      }),
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : `❌ Error en el servidor - ${error}`,
    });
  }
};

const listarDonaciones = async (req, res) => {
  try {
    const { tipo, estado, donanteId, recolectorId } = req.query || {};
    const filtro = {};

    if (tipo) {
      const tipoFinal = normalizeTipo(tipo);
      if (!TIPOS.includes(tipoFinal)) {
        return res.status(400).json({ msg: "Tipo inválido" });
      }
      filtro.tipo = tipoFinal;
    }

    if (estado) {
      const estadoFinal = normalizeEstado(estado);
      if (!ESTADOS.includes(estadoFinal)) {
        return res.status(400).json({ msg: "Estado inválido" });
      }
      filtro.estado = estadoFinal;
    }

    if (donanteId && mongoose.Types.ObjectId.isValid(donanteId)) {
      filtro.donante = donanteId;
    }

    if (recolectorId && mongoose.Types.ObjectId.isValid(recolectorId)) {
      filtro.recolector = recolectorId;
    }

    const items = await Donacion.find(filtro)
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido email telefono")
      .populate("recolector", "nombre apellido email telefono");

    return res.status(200).json({ items: items.map(withDonationStatusLabel) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

// Listado público (sin auth) para landing
const listarDonacionesPublic = async (_req, res) => {
  try {
    const items = await Donacion.find({})
      .select("-evidencias -historialEstados -historialRecolectores -puntoRecoleccionRef -ubicacionRecoleccion")
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("donante", "nombre apellido");
    return res.status(200).json({ items: items.map(withDonationStatusLabel) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const eventTimestamp = (entry) => {
  const timestamp = new Date(entry?.fecha).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortDonationHistory = (entries = []) =>
  [...entries]
    .filter(Boolean)
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));

const serializeDonationStatusHistory = async (entries = []) => {
  const historyByRole = new Map();
  const modelsByRole = new Map([
    ["admin", Admin],
    ["donante", Donante],
    ["recolector", Recolector],
  ]);
  const idsByRole = new Map();

  for (const entry of entries) {
    const role = String(entry.rolResponsable || "").toLowerCase();
    const id = entry.responsable ? String(entry.responsable) : "";
    if (!id || !modelsByRole.has(role)) continue;
    if (!idsByRole.has(role)) idsByRole.set(role, new Set());
    idsByRole.get(role).add(id);
  }

  await Promise.all([...idsByRole].map(async ([role, ids]) => {
    const people = await modelsByRole.get(role)
      .find({ _id: { $in: [...ids] } })
      .select("_id nombre apellido")
      .lean();
    historyByRole.set(
      role,
      new Map(people.map((person) => [String(person._id), person]))
    );
  }));

  return entries.map((entry) => {
    const item = typeof entry.toObject === "function" ? entry.toObject() : { ...entry };
    const role = String(item.rolResponsable || "").toLowerCase();
    const person = item.responsable
      ? historyByRole.get(role)?.get(String(item.responsable))
      : null;
    return {
      ...item,
      estadoLabel: donationStatusLabel(item.estado),
      responsableDetalle: person
        ? {
            _id: person._id,
            nombre: person.nombre,
            apellido: person.apellido,
          }
        : null,
    };
  });
};

const leerDonacionQR = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const role = String(user?.rol || "").toLowerCase();
    const codigo = String(req.body?.codigo ?? "").trim();
    const match = /^DONATY:(.+)$/i.exec(codigo);
    const id = String(req.params?.id ?? match?.[1] ?? "").trim();

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        msg: req.params?.id ? "El identificador de donación no es válido" : "Código QR inválido",
      });
    }

    const donacion = await Donacion.findById(id)
      .populate(
        "campana",
        "nombre descripcion fechaInicio fechaFin periodoAcademico horaInicio horaFin diasAtencion puntosRecoleccion"
      )
      .populate("donante", "nombre apellido telefono")
      .populate("recolector", "nombre apellido telefono")
      .populate("evidencias.recolector", "nombre apellido")
      .populate("historialRecolectores.recolectorAnterior", "nombre apellido")
      .populate("historialRecolectores.recolectorNuevo", "nombre apellido")
      .populate("historialRecolectores.administrador", "nombre apellido");

    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    const isAdmin = role === "admin";
    const isOwnerDonante = role === "donante" &&
      String(donacion.donante?._id ?? donacion.donante) === String(user._id);
    const campaign = donacion.campana;
    const point = campaign?.puntosRecoleccion?.id(donacion.puntoRecoleccionRef);
    const isAssignedRecolector = role === "recolector" && (
      String(donacion.recolector?._id ?? donacion.recolector) === String(user._id)
      || isCollectorAssignedToPoint(point, user._id)
    );

    if (!isAdmin && !isOwnerDonante && !isAssignedRecolector) {
      return res.status(403).json({ msg: "No tienes permiso para consultar esta donación" });
    }

    const pointCollectorIds = (point?.recolectores || []).map((collectorId) => collectorId);
    const pointCollectors = pointCollectorIds.length
      ? await Recolector.find({ _id: { $in: pointCollectorIds } })
        .select("nombre apellido")
        .lean()
      : [];
    const responsibleId = donacion.recolector?._id
      || donacion.recolector
      || point?.responsableRecolector
      || null;
    const responsible = responsibleId
      ? await Recolector.findById(responsibleId).select("nombre apellido status ubicacionGps").lean()
      : null;
    const gps = responsible?.ubicacionGps;
    const locationState = classifyCollectorGeofenceState({
      collectorActive: responsible?.status !== false,
      capturedAt: gps?.capturadoEn,
      latitude: gps?.latitud,
      longitude: gps?.longitud,
      accuracyMeters: gps?.precisionMetros,
      insideGeofence:
        gps != null
        && isInsideEpnCampus(gps.latitud, gps.longitud),
    });
    const gpsCoordinatesAvailable =
      Boolean(responsible)
      && locationState !== "inactivo"
      && hasValidCollectorCoordinates(gps?.latitud, gps?.longitud);
    const gpsFresh =
      gpsCoordinatesAvailable && ["dentro", "fuera"].includes(locationState);
    const evidenciasPorEtapa = serializeDonationEvidence(donacion.evidencias);
    const donacionPayload = donacion.toObject();
    donacionPayload.imagenUrl = urlPublica(donacionPayload.imagenUrl);
    donacionPayload.entregas = (donacionPayload.entregas || []).map((delivery) => ({
      ...delivery,
      imagenUrl: urlPublica(delivery.imagenUrl),
    }));
    donacionPayload.estadoLabel = donationStatusLabel(donacion.estado);
    donacionPayload.evidencias = evidenciasPorEtapa;
    const historialEstados = sortDonationHistory(donacion.historialEstados);
    const historialEstadosConResponsable =
      await serializeDonationStatusHistory(historialEstados);
    const historialRecolectores = sortDonationHistory(donacion.historialRecolectores)
      .map((entry) => {
        const previousCollector = entry.recolectorAnterior;
        const newCollector = entry.recolectorNuevo;
        const administrator = entry.administrador;
        const person = (value) => value?._id
          ? {
              id: String(value._id),
              fullName: `${value.nombre || ""} ${value.apellido || ""}`.trim(),
            }
          : null;
        return {
          ...entry.toObject(),
          changedAt: entry.fecha,
          previousCollector: person(previousCollector),
          newCollector: person(newCollector),
          changedBy: person(administrator),
        };
      });
    const entregaGeneral = campaign?._id
      ? await EntregaCampana.findOne({
          campana: campaign._id,
          "donaciones.donacion": donacion._id,
        })
        .select("_id campana receptor nombresReceptor apellidosReceptor telefonoReceptor cargoReceptor descripcionBienes fechaEntrega responsablesCampana evidencias estado createdAt updatedAt")
        .lean()
      : null;

    return res.status(200).json({
      donacion: donacionPayload,
      entregaGeneralCampana: serializeCampaignDeliveryForDonor(
        entregaGeneral,
        campaign?._id || null
      ),
      evidenciasPorEtapa,
      puntoRecoleccion: serializeTracePickupPoint(point),
      recolectoresAsignadosAlPunto: pointCollectors,
      responsableVigente: responsible
        ? { _id: responsible._id, nombre: responsible.nombre, apellido: responsible.apellido }
        : null,
      ubicacionResponsable: {
        estado: !responsible
          ? "inactivo"
          : gpsFresh
          ? "activo"
          : locationState,
        estadoGeografico: responsible ? locationState : "inactivo",
        coordenadas: gpsCoordinatesAvailable
          ? { latitud: gps.latitud, longitud: gps.longitud }
          : null,
        actualizadoEn: responsible ? gps.actualizadoEn : null,
        capturadoEn: responsible
          ? gps.capturadoEn
          : null,
      },
      historialEstados: historialEstadosConResponsable,
        historialRecolectores,
    });
  } catch (error) {
    console.error("Error al consultar donación por QR:", error);
    return res.status(500).json({ msg: "Error al consultar la donación" });
  }
};

const listarPendientesRecolector = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const campaigns = await Campana.find(
      buildCurrentCollectorCampaignFilter({ collectorId: user._id })
    )
      .select("_id fechaInicio fechaFin horaInicio horaFin activa estado puntosRecoleccion")
      .lean();
    const campaignPoints = campaigns
      .filter((campaign) => isCampaignAvailableNow(campaign))
      .map((campaign) => ({
        campaignId: campaign._id,
        pointIds: (campaign.puntosRecoleccion || [])
          .filter((point) =>
            isPickupPointActive(point)
            && isCollectorAssignedToPoint(point, user._id)
          )
          .map((point) => point._id),
      }))
      .filter(({ pointIds }) => pointIds.length > 0);

    const items = await Donacion.find(
      buildPendingCollectorDonationFilter({ campaignPoints })
    )
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido");
    return res.status(200).json({ items: items.map(withDonationStatusLabel) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const listarAsignadasRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const items = await Donacion.find({
      tipo: "fisica",
      recolector: user._id,
    })
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido")
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");
    return res.status(200).json({ items: items.map(withDonationStatusLabel) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const asignarRecolector = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const donacion = await Donacion.findById(id);
    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }
    if (donacion.tipo !== "fisica") {
      return res
        .status(400)
        .json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (donacion.estado !== "pendiente") {
      return res.status(400).json({
        msg: "La donación no está disponible para asignación",
      });
    }
    if (donacion.campana) {
      const campaign = await Campana.findById(donacion.campana)
        .select("puntosRecoleccion")
        .lean();
      const point = campaign?.puntosRecoleccion?.find(
        (item) => String(item._id) === String(donacion.puntoRecoleccionRef)
      );
      if (!point || !isCollectorAssignedToPoint(point, user._id)) {
        return res.status(403).json({
          msg: "Solo un recolector asignado al punto puede autoasignarse esta donación",
        });
      }
    }

    donacion.recolector = user._id;
    donacion.estado = "asignada";
    donacion.historialRecolectores.push({
      recolectorNuevo: user._id,
      puntoRecoleccionNuevo: donacion.puntoRecoleccionRef || null,
      estado: "asignada",
      fecha: new Date(),
      motivo: "Autoasignación por recolector",
    });
    donacion.historialEstados.push(statusHistoryEntry("asignada", user));
    await donacion.save();

    return res.status(200).json(donacion);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const cambiarEstadoRecolector = (estadoActual, estadoNuevo, extras = () => ({})) =>
  async (req, res) => {
    try {
      const user = req.user || req.donanteHeader;
      const { id } = req.params;
      if (!user) return res.status(401).json({ msg: "No autenticado" });
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ msg: `ID inválido: ${id}` });
      }

      const actual = await Donacion.findById(id).select("tipo recolector estado");
      if (!actual) return res.status(404).json({ msg: "Donación no encontrada" });
      if (actual.tipo !== "fisica") {
        return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
      }
      if (!actual.recolector || String(actual.recolector) !== String(user._id)) {
        return res.status(403).json({ msg: "Solo el recolector asignado puede cambiar el estado" });
      }
      if (actual.estado !== estadoActual) {
        return res.status(409).json({
          msg: `Transición inválida: se esperaba "${estadoActual}" y la donación está "${actual.estado}"`,
        });
      }

      const update = {
        $set: { estado: estadoNuevo, ...extras(req) },
        $push: {
          historialEstados: statusHistoryEntry(
            estadoNuevo,
            user,
            req.body?.observaciones
          ),
        },
      };
      const donacion = await Donacion.findOneAndUpdate(
        { _id: id, tipo: "fisica", recolector: user._id, estado: estadoActual },
        update,
        { new: true, runValidators: true }
      )
        .populate("recolector", "nombre apellido email telefono")
        .populate("registradoPorRecolector", "nombre apellido email telefono")
        .populate("campana", "nombre activa");

      if (!donacion) {
        return res.status(409).json({ msg: "La donación cambió mientras se procesaba la acción" });
      }
      publishDonationEvent(req, "donation.status.updated", donacion);
      void notifyDonationStatusChange(donacion, estadoActual, estadoNuevo, user);
      return res.status(200).json({ donacion });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
    }
  };

const buildCollectionEvidence = (req, user) => {
  const normalizeFiles = (value) =>
    value == null ? [] : Array.isArray(value) ? value : [value];
  const images = [
    ...normalizeFiles(req.files?.imagen),
    ...normalizeFiles(req.files?.imagenes),
    ...normalizeFiles(req.files?.evidencias),
  ];
  const rawKey = String(req.get?.("Idempotency-Key") ?? "").trim()
    || String(req.body?.idempotencyKey ?? "").trim();
  const idempotencyKey = rawKey || `recolectada:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;

  return {
    image: images.length === 1 ? images[0] : null,
    images,
    idempotencyKey,
    user,
  };
};

const validateCollectionEvidence = (
  { image, images = [], idempotencyKey },
  { allowGeneratedKey = true } = {}
) => {
  if (!images.length && !image) {
    throw Object.assign(
      new Error("Debes adjuntar la evidencia fotográfica de la recolección"),
      { statusCode: 400 }
    );
  }
  if (!allowGeneratedKey && (!idempotencyKey || idempotencyKey.length > 128)) {
    throw Object.assign(
      new Error("Debes enviar un Idempotency-Key válido para la evidencia"),
      { statusCode: 400 }
    );
  }
  return true;
};

const normalizeReturnEvidenceFiles = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const buildDonationReturnRequest = (req) => ({
  etapa: String(req.body?.etapa ?? "").trim().toLowerCase(),
  idempotencyKey: String(req.body?.idempotencyKey ?? "").trim()
    || String(req.get?.("Idempotency-Key") ?? "").trim(),
  images: normalizeReturnEvidenceFiles(req.files?.evidencias),
});

const validateDonationReturnRequest = ({ etapa, idempotencyKey, images }) => {
  if (etapa !== "devolucion") {
    throw Object.assign(
      new Error('La etapa debe ser "devolucion"'),
      { statusCode: 400 }
    );
  }
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw Object.assign(
      new Error("Debes enviar un idempotencyKey válido (máximo 128 caracteres)"),
      { statusCode: 400 }
    );
  }
  if (!images.length) {
    throw Object.assign(
      new Error("Debes adjuntar al menos una imagen en el campo evidencias"),
      { statusCode: 400 }
    );
  }
  if (images.length > 2) {
    throw Object.assign(
      new Error("Puedes adjuntar hasta 2 evidencias por devolución"),
      { statusCode: 400 }
    );
  }
};

const cambiarEstadoRecolectorConEvidencias = ({
  estadoActual,
  estadoNuevo,
  operacion,
  extras = () => ({}),
}) => async (req, res) => {
  const { images } = buildDonationReturnRequest(req);
  let uploadedImages = [];
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    if (!user) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const evidenceRequest = buildDonationReturnRequest(req);
    validateDonationReturnRequest(evidenceRequest);
    const actual = await Donacion.findById(id)
      .select("tipo recolector estado evidencias");
    if (!actual) return res.status(404).json({ msg: "Donación no encontrada" });
    if (actual.tipo !== "fisica") {
      return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (!actual.recolector || String(actual.recolector) !== String(user._id)) {
      return res.status(403).json({
        msg: "Solo el recolector asignado puede cambiar el estado",
      });
    }

    const alreadyProcessed = (actual.evidencias || []).some(
      (evidence) => evidence.idempotencyKey === evidenceRequest.idempotencyKey
        && evidence.etapa === "devolucion"
        && evidence.operacion === operacion
    );
    if (alreadyProcessed) {
      const current = await Donacion.findById(id)
        .populate("recolector", "nombre apellido email telefono")
        .populate("registradoPorRecolector", "nombre apellido email telefono")
        .populate("campana", "nombre activa");
      return res.status(200).json({
        donacion: current,
        evidencias: current.evidencias,
        duplicada: true,
      });
    }
    if (actual.estado !== estadoActual) {
      return res.status(409).json({
        msg: `Transición inválida: se esperaba "${estadoActual}" y la donación está "${actual.estado}"`,
      });
    }

    for (const image of evidenceRequest.images) {
      uploadedImages.push(
        await uploadImage(image, "donaty/evidencias/devolucion")
      );
    }
    const evidenceDate = new Date();
    const evidencias = uploadedImages.map((uploadedImage) => ({
      etapa: "devolucion",
      operacion,
      recolector: user._id,
      fecha: evidenceDate,
      ...uploadedImage,
      idempotencyKey: evidenceRequest.idempotencyKey,
    }));
    const update = {
      $set: { estado: estadoNuevo, ...extras(req) },
      $push: {
        evidencias: { $each: evidencias },
        historialEstados: statusHistoryEntry(
          estadoNuevo,
          user,
          req.body?.observaciones
        ),
      },
    };
    const donacion = await Donacion.findOneAndUpdate(
      {
        _id: id,
        tipo: "fisica",
        recolector: user._id,
        estado: estadoActual,
        evidencias: {
          $not: {
            $elemMatch: {
              idempotencyKey: evidenceRequest.idempotencyKey,
              etapa: "devolucion",
              operacion,
            },
          },
        },
      },
      update,
      { new: true, runValidators: true }
    )
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");

    if (!donacion) {
      const current = await Donacion.findById(id)
        .select("estado evidencias")
        .lean();
      const duplicate = current?.evidencias?.some(
        (evidence) => evidence.idempotencyKey === evidenceRequest.idempotencyKey
          && evidence.etapa === "devolucion"
          && evidence.operacion === operacion
      );
      await Promise.all(
        uploadedImages.map((image) => deleteImage(image.imagenPublicId))
      );
      uploadedImages = [];
      if (duplicate) {
        const recovered = await Donacion.findById(id)
          .populate("recolector", "nombre apellido email telefono")
          .populate("registradoPorRecolector", "nombre apellido email telefono")
          .populate("campana", "nombre activa");
        return res.status(200).json({
          donacion: recovered,
          evidencias: recovered.evidencias,
          duplicada: true,
        });
      }
      return res.status(409).json({
        msg: "La asignación o el estado cambió; no se registró la devolución",
      });
    }

    uploadedImages = [];
    publishDonationEvent(req, "donation.status.updated", donacion);
    void notifyDonationStatusChange(donacion, estadoActual, estadoNuevo, user);
    return res.status(200).json({
      donacion,
      evidencias: donacion.evidencias,
      duplicada: false,
    });
  } catch (error) {
    for (const image of uploadedImages) {
      try {
        await deleteImage(image.imagenPublicId);
      } catch (cleanupError) {
        console.error(
          "No se pudo limpiar evidencia de devolución no registrada:",
          cleanupError.message || cleanupError
        );
      }
    }
    console.error("Error registrando la devolución:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al registrar la devolución",
    });
  } finally {
    for (const image of images) {
      if (!image?.tempFilePath) continue;
      try {
        await unlink(image.tempFilePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error(
            "No se pudo limpiar el archivo temporal de devolución:",
            cleanupError.message || cleanupError
          );
        }
      }
    }
  }
};

const usesMultipartDonationReturn = (req) =>
  Boolean(req.is?.("multipart/form-data"))
  || req.files?.evidencias != null
  || req.body?.etapa != null
  || req.body?.idempotencyKey != null;

const marcarPendienteRecoleccion = cambiarEstadoRecolector(
  "asignada",
  "pendiente_recoleccion"
);
const marcarRecolectada = async (req, res) => {
  let uploadedImages = [];
  let images = [];
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    if (!user) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const actual = await Donacion.findById(id).select("tipo recolector estado evidencias");
    if (!actual) return res.status(404).json({ msg: "Donación no encontrada" });
    if (actual.tipo !== "fisica") {
      return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (!actual.recolector || String(actual.recolector) !== String(user._id)) {
      return res.status(403).json({ msg: "Solo el recolector asignado puede marcar la donación como recolectada" });
    }
    if (actual.estado !== "pendiente_recoleccion") {
      return res.status(409).json({
        msg: `Transición inválida: se esperaba "pendiente_recoleccion" y la donación está "${actual.estado}"`,
      });
    }
    const evidenceRequest = buildCollectionEvidence(req, user);
    images = evidenceRequest.images.length
      ? evidenceRequest.images
      : evidenceRequest.image
        ? [evidenceRequest.image]
        : [];
    validateCollectionEvidence(evidenceRequest, { allowGeneratedKey: true });

    const idempotencyKey = evidenceRequest.idempotencyKey;
    const duplicateEvidence = actual.evidencias.filter(
      (entry) => entry.idempotencyKey === idempotencyKey
    );
    if (duplicateEvidence.length) {
      const current = await Donacion.findById(id)
        .populate("recolector", "nombre apellido email telefono")
        .populate("registradoPorRecolector", "nombre apellido email telefono")
        .populate("campana", "nombre activa");
      return res.status(200).json({
        donacion: current,
        evidencias: current.evidencias,
        duplicada: true,
      });
    }

    for (const image of images) {
      uploadedImages.push(
        await uploadImage(image, "donaty/evidencias/recepcion")
      );
    }
    const evidenceDate = new Date();
    const evidence = uploadedImages.map((uploadedImage) => ({
      etapa: "recepcion",
      recolector: user._id,
      fecha: evidenceDate,
      ...uploadedImage,
      idempotencyKey,
    }));

    const donacion = await Donacion.findOneAndUpdate(
      {
        _id: id,
        tipo: "fisica",
        recolector: user._id,
        estado: "pendiente_recoleccion",
        "evidencias.idempotencyKey": { $ne: idempotencyKey },
      },
      {
        $set: { estado: "recolectada" },
        $push: {
          evidencias: { $each: evidence },
          historialEstados: statusHistoryEntry("recolectada", user),
        },
      },
      { new: true, runValidators: true }
    )
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");

    if (!donacion) {
      const current = await Donacion.findById(id).select("estado evidencias");
      const currentEvidence = (current?.evidencias || []).filter(
        (entry) => entry.idempotencyKey === idempotencyKey
      );
      if (currentEvidence.length) {
        await Promise.all(
          uploadedImages.map((image) => deleteImage(image.imagenPublicId))
        );
        uploadedImages = [];
        const recovered = await Donacion.findById(id)
          .populate("recolector", "nombre apellido email telefono")
          .populate("registradoPorRecolector", "nombre apellido email telefono")
          .populate("campana", "nombre activa");
        return res.status(200).json({
          donacion: recovered,
          evidencias: recovered.evidencias,
          duplicada: true,
        });
      }
      await Promise.all(
        uploadedImages.map((image) => deleteImage(image.imagenPublicId))
      );
      uploadedImages = [];
      return res.status(409).json({ msg: "La donación cambió mientras se procesaba la acción" });
    }

    uploadedImages = [];
    publishDonationEvent(req, "donation.status.updated", donacion);
    void notifyDonationStatusChange(
      donacion,
      "pendiente_recoleccion",
      "recolectada",
      user
    );
    return res.status(200).json({
      donacion,
      evidencias: donacion.evidencias,
    });
  } catch (error) {
    for (const image of uploadedImages) {
      try {
        await deleteImage(image.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo limpiar la imagen de recolección:", cleanupError.message || cleanupError);
      }
    }
    console.error(error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : `❌ Error en el servidor - ${error}`,
    });
  } finally {
    for (const image of images) {
      if (!image?.tempFilePath) continue;
      try {
        await unlink(image.tempFilePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("No se pudo limpiar el archivo temporal de recolección:", cleanupError.message || cleanupError);
        }
      }
    }
  }
};
const marcarClasificada = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: "El identificador de donación no es válido" });
    }

    const actual = await Donacion.findById(id).select(
      "tipo recolector estado campana puntoRecoleccionRef clasificacionId categoria subcategoria nombreBien metadata"
    );
    if (!actual) return res.status(404).json({ msg: "Donación no encontrada" });
    if (actual.tipo !== "fisica") {
      return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (String(actual.recolector) !== String(user._id)) {
      return res.status(403).json({
        msg: "Solo el recolector asignado puede clasificar esta donación",
      });
    }
    const campaign = await Campana.findById(actual.campana)
      .select("_id puntosRecoleccion")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña de la donación no existe" });
    const resolvedPointId = resolverPuntoId(
      user,
      req.body?.puntoId,
      campaign,
      actual.puntoRecoleccionRef
    );
    if (actual.estado !== "recolectada") {
      return res.status(409).json({
        msg: `Transición inválida: se esperaba "recolectada" y la donación está "${actual.estado}"`,
      });
    }

    const classifiedAt = new Date();
    const productosClasificados = normalizeClassifiedProducts(
      req.body?.productosClasificados,
      actual,
      user._id,
      classifiedAt
    );
    const suppliedClassification = req.body?.clasificacion;
    const clasificacionId = req.body?.clasificacionId
      ?? (suppliedClassification && typeof suppliedClassification === "object"
        ? suppliedClassification._id ?? suppliedClassification.id
        : null);
    if (clasificacionId && !mongoose.isValidObjectId(clasificacionId)) {
      return res.status(400).json({
        msg: "El identificador de clasificación no es válido",
      });
    }
    const explicitClassificationName = req.body?.clasificacionNombre
      ?? req.body?.nombre
      ?? (typeof suppliedClassification === "string"
        ? suppliedClassification
        : suppliedClassification?.nombre);
    const clasificacionNombre = explicitClassificationName
      ?? (clasificacionId ? undefined : productosClasificados[0]?.categoria);
    const clasificacion = await resolveDonationClassification({
      campaignId: actual.campana,
      pointId: resolvedPointId,
      classificationId: clasificacionId || null,
      classificationName: clasificacionNombre,
    });
    const donacion = await Donacion.findOneAndUpdate(
      {
        _id: id,
        tipo: "fisica",
        recolector: user._id,
        estado: "recolectada",
      },
      {
        $set: {
          estado: "en_entrega",
          clasificacionId: clasificacion._id,
          productosClasificados,
        },
        $push: {
          historialEstados: statusHistoryEntry("en_entrega", user),
        },
      },
      { new: true, runValidators: true }
    )
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");

    if (!donacion) {
      return res.status(409).json({
        msg: "La donación cambió mientras se procesaba la clasificación",
      });
    }
    publishDonationEvent(req, "donation.status.updated", donacion);
    void notifyDonationStatusChange(donacion, "recolectada", "en_entrega", user);
    const classifiedDonations = await Donacion.find({
      campana: actual.campana,
      puntoRecoleccionRef: actual.puntoRecoleccionRef,
      clasificacionId: clasificacion._id,
    }).select("metadata cantidad").lean();
    const total = classifiedDonations.reduce((sum, donation) => {
      const quantity = Number(donation.metadata?.cantidad ?? donation.cantidad);
      return Number.isSafeInteger(quantity) && quantity > 0
        ? sum + quantity
        : sum;
    }, 0);
    return res.status(200).json({
      donacion,
      clasificacion: {
        id: String(clasificacion._id),
        nombre: clasificacion.nombre,
        total,
      },
    });
  } catch (error) {
    console.error("Error clasificando donación:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al clasificar la donación",
    });
  }
};
const iniciarEntrega = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const donation = await Donacion.findById(id).select("tipo recolector estado");
    if (!donation) return res.status(404).json({ msg: "Donación no encontrada" });
    if (donation.tipo !== "fisica") {
      return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (String(donation.recolector) !== String(user._id)) {
      return res.status(403).json({
        msg: "Solo el recolector asignado puede cambiar el estado",
      });
    }
    if (donation.estado === "en_entrega") {
      const current = await Donacion.findById(id)
        .populate("recolector", "nombre apellido email telefono")
        .populate("registradoPorRecolector", "nombre apellido email telefono")
        .populate("campana", "nombre activa");
      return res.status(200).json({ donacion: current });
    }
    if (donation.estado !== "clasificada") {
      return res.status(409).json({
        msg: `Transición inválida: se esperaba "clasificada" y la donación está "${donation.estado}"`,
      });
    }

    const updated = await Donacion.findOneAndUpdate(
      {
        _id: id,
        tipo: "fisica",
        recolector: user._id,
        estado: "clasificada",
      },
      {
        $set: { estado: "en_entrega" },
        $push: {
          historialEstados: statusHistoryEntry("en_entrega", user),
        },
      },
      { new: true, runValidators: true }
    )
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");
    if (!updated) {
      return res.status(409).json({
        msg: "La donación cambió mientras se procesaba la acción",
      });
    }
    publishDonationEvent(req, "donation.status.updated", updated);
    return res.status(200).json({ donacion: updated });
  } catch (error) {
    console.error("Error iniciando la entrega de donación:", error.message || error);
    return res.status(500).json({ msg: "Error al iniciar la entrega de la donación" });
  }
};
const marcarEntregada = async (req, res) => {
  const image = !Array.isArray(req.files?.imagen) ? req.files?.imagen : null;
  let uploadedImage = null;
  try {
    const user = req.user || req.donanteHeader;
    const { id } = req.params;
    const nombresReceptor = String(req.body?.nombresReceptor ?? "").trim();
    const apellidosReceptor = String(req.body?.apellidosReceptor ?? "").trim();
    const telefonoReceptor = String(req.body?.telefonoReceptor ?? "").trim();
    const cargoReceptor = String(req.body?.cargoReceptor ?? "").trim();
    const descripcionBienes = String(req.body?.descripcionBienes ?? "").trim();
    const idempotencyKey = String(
      req.get("Idempotency-Key") ?? req.body?.idempotencyKey ?? ""
    ).trim();

    if (!user?._id) return res.status(401).json({ msg: "No autenticado" });
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de donación no es válido" });
    }
    if (
      !nombresReceptor
      || nombresReceptor.length > 120
      || !apellidosReceptor
      || apellidosReceptor.length > 120
      || !cargoReceptor
      || cargoReceptor.length > 120
      || !descripcionBienes
      || descripcionBienes.length > 2000
    ) {
      return res.status(400).json({
        msg: "Completa nombres, apellidos, cargo y descripción de los bienes (máximo 120/2000 caracteres)",
      });
    }
    if (!/^\+?[0-9\s()-]{7,20}$/.test(telefonoReceptor)) {
      return res.status(400).json({ msg: "El teléfono de quien recibe no es válido" });
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ msg: "Debes enviar una clave de entrega válida" });
    }
    if (!image) {
      return res.status(400).json({ msg: "Debes adjuntar una fotografía de la entrega" });
    }

    const actual = await Donacion.findById(id).select(
      "tipo recolector estado entregas campana"
    );
    if (!actual) return res.status(404).json({ msg: "Donación no encontrada" });
    if (actual.tipo !== "fisica") {
      return res.status(400).json({ msg: "Solo aplica para donaciones físicas" });
    }
    if (String(actual.recolector) !== String(user._id)) {
      return res.status(403).json({
        msg: "Solo el recolector asignado puede registrar la entrega",
      });
    }
    const previousDelivery = actual.entregas.find(
      (delivery) => delivery.idempotencyKey === idempotencyKey
    );
    if (actual.estado === "entregada" && previousDelivery) {
      const current = await Donacion.findById(id).populate(
        "recolector",
        "nombre apellido email telefono"
      ).populate("campana", "nombre activa");
      return res.status(200).json({ donacion: current, duplicada: true });
    }
    if (actual.estado !== "en_entrega") {
      return res.status(409).json({
        msg: `Transición inválida: se esperaba "en_entrega" y la donación está "${actual.estado}"`,
      });
    }
    if (actual.campana) {
      const campaign = await Campana.findById(actual.campana)
        .select("_id estado activa fechaFin")
        .lean();
      if (campaign && isCampaignFinished(campaign)) {
        const [totalDonations, notReadyCount] = await Promise.all([
          Donacion.countDocuments({ campana: actual.campana }),
          Donacion.countDocuments({
            campana: actual.campana,
            estado: { $ne: "en_entrega" },
          }),
        ]);
        if (totalDonations > 0 && notReadyCount === 0) {
          return res.status(409).json({
            msg: "La campaña finalizada debe entregarse mediante la entrega general de campaña",
          });
        }
      }
    }

    uploadedImage = await uploadImage(image, "donaty/evidencias/finalizacion");
    const deliveredAt = new Date();
    const delivery = {
      nombresReceptor,
      apellidosReceptor,
      telefonoReceptor,
      cargoReceptor,
      descripcionBienes,
      recolector: user._id,
      fecha: deliveredAt,
      ...uploadedImage,
      idempotencyKey,
    };
    const updated = await Donacion.findOneAndUpdate(
      {
        _id: id,
        tipo: "fisica",
        recolector: user._id,
        estado: "en_entrega",
        "entregas.idempotencyKey": { $ne: idempotencyKey },
      },
      {
        $set: { estado: "entregada" },
        $push: {
          entregas: delivery,
          evidencias: {
            etapa: "finalizacion",
            recolector: user._id,
            fecha: deliveredAt,
            ...uploadedImage,
            idempotencyKey,
          },
          historialEstados: statusHistoryEntry("entregada", user),
        },
      },
      { new: true, runValidators: true }
    )
      .populate("recolector", "nombre apellido email telefono")
      .populate("registradoPorRecolector", "nombre apellido email telefono")
      .populate("campana", "nombre activa");

    if (!updated) {
      const current = await Donacion.findById(id).select("estado entregas");
      const duplicate = current?.entregas.find(
        (entry) => entry.idempotencyKey === idempotencyKey
      );
      if (duplicate) {
        await deleteImage(uploadedImage.imagenPublicId);
        uploadedImage = null;
        const donation = await Donacion.findById(id).populate(
          "recolector",
          "nombre apellido email telefono"
        ).populate("campana", "nombre activa");
        return res.status(200).json({ donacion: donation, duplicada: true });
      }
      return res.status(409).json({
        msg: "La asignación o el estado cambió; no se registró la entrega",
      });
    }

    uploadedImage = null;
    publishDonationEvent(req, "donation.status.updated", updated);
    void notifyDonationStatusChange(updated, "en_entrega", "entregada", user);
    return res.status(200).json({ donacion: updated, duplicada: false });
  } catch (error) {
    if (uploadedImage?.imagenPublicId) {
      try {
        await deleteImage(uploadedImage.imagenPublicId);
      } catch (cleanupError) {
        console.error(
          "No se pudo limpiar la imagen de entrega no registrada:",
          cleanupError.message || cleanupError
        );
      }
    }
    console.error("Error registrando la entrega:", error.message || error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : "Error al registrar la entrega",
    });
  } finally {
    if (image?.tempFilePath) {
      try {
        await unlink(image.tempFilePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error(
            "No se pudo limpiar el archivo temporal de entrega:",
            cleanupError.message || cleanupError
          );
        }
      }
    }
  }
};
const solicitarDevolucion = (req, res) => {
  const handler = usesMultipartDonationReturn(req)
    ? cambiarEstadoRecolectorConEvidencias({
        estadoActual: "recolectada",
        estadoNuevo: "devolucion",
        operacion: "solicitarDevolucion",
        extras: (request) => ({
          motivoDevolucion: String(request.body?.motivoDevolucion ?? "").trim(),
        }),
      })
    : cambiarEstadoRecolector(
        "recolectada",
        "devolucion",
        (request) => ({
          motivoDevolucion: String(request.body?.motivoDevolucion ?? "").trim(),
        })
      );
  return handler(req, res);
};

const confirmarDevolucion = (req, res) => {
  const handler = usesMultipartDonationReturn(req)
    ? cambiarEstadoRecolectorConEvidencias({
        estadoActual: "devolucion",
        estadoNuevo: "devuelta",
        operacion: "confirmarDevolucion",
      })
    : cambiarEstadoRecolector("devolucion", "devuelta");
  return handler(req, res);
};

const actualizarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }
    if (isBlank(estado)) {
      return res.status(400).json({ msg: "Debes indicar el estado" });
    }

    const estadoFinal = normalizeEstado(estado);
    if (!ESTADOS.includes(estadoFinal)) {
      return res.status(400).json({ msg: "Estado inválido" });
    }

    const donacion = await Donacion.findById(id);
    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    const previousStatus = donacion.estado;
    if (donacion.estado !== estadoFinal) {
      donacion.historialEstados.push(
        statusHistoryEntry(estadoFinal, req.user, req.body?.observaciones)
      );
    }
    donacion.estado = estadoFinal;
    await donacion.save();
    if (previousStatus !== estadoFinal) {
      void notifyDonationStatusChange(donacion, previousStatus, estadoFinal, req.user);
    }

    return res.status(200).json(donacion);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

/* ===========================
   ✅ AGREGADO: Donante edita SU donación
   =========================== */
const actualizarMiDonacion = async (req, res) => {
  let imagenSubida = null;
  let imagenGuardada = false;
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });
    const donorProfile = await getDonorProfile(user);

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const donacion = await Donacion.findById(id);
    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    // ✅ Debe pertenecer al donante logueado
    if (String(donacion.donante) !== String(user._id)) {
      return res.status(403).json({ msg: "No autorizado" });
    }

    // ✅ Recomendación: solo editar si está pendiente
    if (donacion.estado !== "pendiente") {
      return res.status(400).json({
        msg: "Solo puedes editar donaciones en estado pendiente",
      });
    }

    // ✅ Campos permitidos
    const {
      categoria,
      nombreBien,
      subcategoria,
      descripcion,
      direccionEntrega,
      direccionAlternativa,
      metodoEntrega,
      puntoRecoleccionId,
      referenciasEntrega,
      ubicacionRecoleccion: ubicacionRecoleccionInput,
    } = req.body || {};
    const ubicacionRecoleccion = parseDonationCollectionLocation(
      ubicacionRecoleccionInput
    );

    const categoryChanged =
      (categoria !== undefined && String(categoria ?? "").trim() !== donacion.categoria) ||
      (subcategoria !== undefined && String(subcategoria ?? "").trim() !== donacion.subcategoria);
    if (categoryChanged) {
      const categoriaResuelta = await resolveDonationCategory(
        categoria !== undefined ? categoria : donacion.categoria,
        subcategoria !== undefined ? subcategoria : donacion.subcategoria,
        donacion.campana
      );
      if (!categoriaResuelta.categoriaId) {
        return res.status(400).json({ msg: "La donación debe conservar una categoría válida" });
      }
      const campaignId = donacion.campana || categoriaResuelta.campanaId;
      const campana = await Campana.findById(campaignId).select(
        "categoriasPermitidas"
      );
      if (!campana) {
        return res.status(404).json({ msg: "La campaña de la categoría no existe" });
      }
      if (
        campana.categoriasPermitidas?.length > 0 &&
        !campana.categoriasPermitidas.some(
          (categoryId) => String(categoryId) === String(categoriaResuelta.categoriaId)
        )
      ) {
        return res.status(400).json({
          msg: "La categoría seleccionada no está permitida en esta campaña",
        });
      }
      donacion.campana = campaignId;
      donacion.categoria = categoriaResuelta.categoria;
      donacion.categoriaRef = categoriaResuelta.categoriaId;
      donacion.subcategoria = categoriaResuelta.subcategoria;
    }

    if (descripcion !== undefined) donacion.descripcion = descripcion ?? "";
    if (nombreBien !== undefined) {
      if (isBlank(nombreBien)) {
        return res.status(400).json({ msg: "Debes indicar el nombre del bien donado" });
      }
      donacion.nombreBien = String(nombreBien).trim();
    }

    if (ubicacionRecoleccion !== undefined) {
      donacion.ubicacionRecoleccion = ubicacionRecoleccion;
    }

    const deliveryChanged = [
      "metodoEntrega",
      "puntoRecoleccionId",
      "direccionAlternativa",
      "direccionEntrega",
      "referenciasEntrega",
    ].some((field) => Object.hasOwn(req.body || {}, field));
    if (deliveryChanged) {
      const methodExplicitlyChanged = Object.hasOwn(req.body || {}, "metodoEntrega");
      const effectiveMethod = metodoEntrega ?? donacion.metodoEntrega;
      const keepCurrentPoint = !methodExplicitlyChanged
        && donacion.metodoEntrega === "punto_recoleccion";
      const campaign = await Campana.findById(donacion.campana)
        .select("_id puntosRecoleccion")
        .lean();
      if (!campaign) {
        return res.status(404).json({ msg: "La campaña de la donación no existe" });
      }
      const delivery = resolveDonationDelivery({
        profile: donorProfile,
        campaign,
        method: metodoEntrega,
        pointId: puntoRecoleccionId,
        alternativeAddress: direccionAlternativa,
        legacyDeliveryAddress: direccionEntrega,
        references: referenciasEntrega,
        defaultMethod: effectiveMethod,
        defaultPointId: keepCurrentPoint ? donacion.puntoRecoleccionRef : null,
      });
      donacion.nombreDonante = delivery.nombreDonante;
      donacion.telefonoContacto = delivery.telefonoContacto;
      donacion.metodoEntrega = delivery.metodoEntrega;
      donacion.direccionEntrega = delivery.direccionEntrega;
      donacion.puntoRecoleccionRef = delivery.puntoRecoleccionRef;
      donacion.referenciasEntrega = delivery.referenciasEntrega;
    } else {
      donacion.nombreDonante = [donorProfile.nombre, donorProfile.apellido]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");
      donacion.telefonoContacto = String(donorProfile.telefono ?? "").trim();
      if (!donacion.telefonoContacto) {
        return res.status(400).json({
          msg: "Completa tu perfil: registra un teléfono de contacto antes de editar la donación",
        });
      }
    }

    const imagenAnteriorPublicId = donacion.imagenPublicId;
    if (req.files?.imagen) {
      imagenSubida = await uploadImage(req.files.imagen, "donaty/donaciones");
      donacion.imagenUrl = imagenSubida.imagenUrl;
      donacion.imagenPublicId = imagenSubida.imagenPublicId;
    }

    await donacion.save();
    imagenGuardada = true;

    if (imagenSubida && imagenAnteriorPublicId) {
      try {
        await deleteImage(imagenAnteriorPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo eliminar la imagen anterior de donación:", cleanupError.message);
      }
    }
    return res.status(200).json({ donacion });
  } catch (error) {
    if (!imagenGuardada && imagenSubida?.imagenPublicId) {
      try {
        await deleteImage(imagenSubida.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo limpiar la imagen de donación:", cleanupError.message);
      }
    }
    console.error(error);
    return res
      .status(error.statusCode || 500)
      .json({ msg: error.statusCode ? error.message : `❌ Error en el servidor - ${error}` });
  }
};

/* ===========================
   ✅ AGREGADO: Donante elimina SU donación
   =========================== */
const eliminarMiDonacion = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const donacion = await Donacion.findById(id);
    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    if (String(donacion.donante) !== String(user._id)) {
      return res.status(403).json({ msg: "No autorizado" });
    }

    // ✅ Recomendación: solo eliminar si está pendiente
    if (donacion.estado !== "pendiente") {
      return res.status(400).json({
        msg: "Solo puedes eliminar donaciones en estado pendiente",
      });
    }

    await Donacion.findByIdAndDelete(id);
    if (donacion.imagenPublicId) {
      try {
        await deleteImage(donacion.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo eliminar la imagen de la donación:", cleanupError.message);
      }
    }
    return res.status(200).json({ msg: "Donación eliminada" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

/* ===========================
   ✅ Admin elimina donación
   =========================== */
const eliminarDonacionAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const donacion = await Donacion.findById(id);
    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    await Donacion.findByIdAndDelete(id);
    if (donacion.imagenPublicId) {
      try {
        await deleteImage(donacion.imagenPublicId);
      } catch (cleanupError) {
        console.warn("No se pudo eliminar la imagen de la donación:", cleanupError.message);
      }
    }
    return res.status(200).json({ msg: "Donación eliminada por admin" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};
export {
  crearDonacion,
  crearDonacionRecolector,
  resolveDonationRegistrationError,
  getCampaignDonationRegistrationError,
  listarMisDonaciones,
  listarDonaciones,
  listarPendientesRecolector,
  listarAsignadasRecolector,
  asignarRecolector,
  buildCollectionEvidence,
  validateCollectionEvidence,
  buildDonationReturnRequest,
  usesMultipartDonationReturn,
  validateDonationReturnRequest,
  marcarRecolectada,
  marcarPendienteRecoleccion,
  marcarClasificada,
  iniciarEntrega,
  marcarEntregada,
  solicitarDevolucion,
  confirmarDevolucion,
  actualizarEstado,

  // ✅ AGREGADO
  actualizarMiDonacion,
  eliminarMiDonacion,
  eliminarDonacionAdmin,
  listarDonacionesPublic,
  leerDonacionQR,
};
