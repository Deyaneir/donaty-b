import mongoose from "mongoose";
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
import { notifyUsers } from "../services/firebase_notifications.js";
import { resolveDonationDelivery } from "../utils/donationDelivery.js";
import { createDonationWithAssignment } from "../services/donationAssignment.js";
import {
  classifyCollectorGeofenceState,
  hasValidCollectorCoordinates,
} from "../utils/collectorLocation.js";
import { isInsideEpnCampus } from "../utils/epnCampusGeofence.js";
import {
  serializeTracePickupPoint,
} from "../utils/pickupPoints.js";
import {
  parseDonationCollectionLocation,
  realGpsCoordinates,
} from "../utils/donationLocation.js";

const notifyAdminsOfNewDonation = async (donacion) => {
  try {
    const admins = await Admin.find({ status: { $ne: false } }).select("_id").lean();
    await notifyUsers({
      eventKey: `donation-created:${donacion._id}`,
      recipients: admins.map((admin) => ({ userId: admin._id, role: "admin" })),
      title: "Nueva donación registrada",
      body: `Código ${donacion._id}: revisa la donación registrada.`,
      data: {
        type: "new_donation",
        donationId: donacion._id,
        campaignId: donacion.campana?._id || donacion.campana || "",
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
        type: "donation_assigned",
        donationId: donacion._id,
      },
    });
  } catch (error) {
    console.error("Error notificando la asignación automática:", error.message || error);
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

const resolvePickupPoint = (campaign, pointId, collectorId = null) => {
  if (!pointId) return null;
  if (!mongoose.isValidObjectId(String(pointId))) {
    throw Object.assign(new Error("El punto de recolección no es válido"), { statusCode: 400 });
  }
  const point = campaign.puntosRecoleccion?.id(pointId);
  if (!point || point.activo === false) {
    throw Object.assign(new Error("El punto no pertenece a la campaña activa"), { statusCode: 400 });
  }
  if (
    collectorId
    && !(point.recolectores || []).some((id) => String(id) === String(collectorId))
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
      .select("activa categoriasPermitidas puntosRecoleccion");
    if (!campanaDoc) return res.status(404).json({ msg: "La campaña indicada no existe" });
    if (!campanaDoc.activa) return res.status(400).json({ msg: "La campaña indicada no está activa" });
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
    void notifyAdminsOfNewDonation(donacion);
    void notifyCollectorOfAutomaticAssignment(
      donacion,
      asignacion.recolector._id
    );
    return res.status(201).json({ donacion, asignacion });
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
      campana,
      puntoRecoleccionId,
      donanteExterno,
      nombre,
      apellido,
      telefono,
      direccion,
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
      .select("activa categoriasPermitidas puntosRecoleccion");
    if (!campanaDoc) return res.status(404).json({ msg: "La campaña indicada no existe" });
    if (!campanaDoc.activa) return res.status(400).json({ msg: "La campaña indicada no está activa" });
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

    const externo = parseMetadata(donanteExterno);
    if (!Object.keys(externo).length) {
      Object.assign(externo, {
        nombre: nombre ?? "",
        apellido: apellido ?? "",
        telefono: telefono ?? "",
        direccion: direccion ?? "",
      });
    }
    const donorNombre = String(externo.nombre ?? "").trim();
    const donorApellido = String(externo.apellido ?? "").trim();
    const donorTelefono = String(externo.telefono ?? "").trim();
    const donorDireccion = String(externo.direccion ?? "").trim();
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
    if (isBlank(donorTelefono) || isBlank(donorDireccion)) {
      return res.status(400).json({ msg: "El teléfono y la dirección del donante externo son obligatorios" });
    }
    let pickupPointRef = resolvePickupPoint(campanaDoc, puntoRecoleccionId, user._id);
    if (!pickupPointRef && campanaDoc.puntosRecoleccion?.length) {
      const assignedPoints = campanaDoc.puntosRecoleccion.filter((point) =>
        point.activo !== false
        && (point.recolectores || []).some((id) => String(id) === String(user._id))
      );
      if (assignedPoints.length === 1) pickupPointRef = assignedPoints[0]._id;
      else if (assignedPoints.length > 1) {
        return res.status(400).json({ msg: "Debes indicar el punto de recolección asignado" });
      } else {
        return res.status(403).json({ msg: "No tienes un punto asignado en esta campaña" });
      }
    }

    const direccionFinal = String(direccionEntrega ?? donorDireccion).trim();
    const telefonoFinal = String(telefonoContacto ?? donorTelefono).trim();
    if (isBlank(direccionFinal) || isBlank(telefonoFinal)) {
      return res.status(400).json({ msg: "Debes indicar dirección y teléfono para donaciones físicas" });
    }
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
    const donacion = await Donacion.create({
      recolector: user._id,
      registradoPorRecolector: user._id,
      campana: campanaDoc._id,
      categoria: categoriaResuelta.categoria,
      categoriaRef: categoriaResuelta.categoriaId,
      nombreBien: String(nombreBien).trim(),
      subcategoria: categoriaResuelta.subcategoria,
      donanteExterno: {
        nombre: donorNombre,
        apellido: donorApellido,
        telefono: donorTelefono,
        direccion: donorDireccion,
        ...(donorCoordinates || {}),
      },
      tipo: tipoFinal,
      descripcion: descripcion ?? "",
      estado: "asignada",
      puntoRecoleccionRef: pickupPointRef,
      ...(ubicacionRecoleccion ? { ubicacionRecoleccion } : {}),
      historialEstados: [statusHistoryEntry("asignada", user)],
      historialRecolectores: [{
        recolectorNuevo: user._id,
        fecha: new Date(),
        motivo: "Registro inicial por recolector",
      }],
      direccionEntrega: direccionFinal,
      ...(pickupCoordinates ? { puntoRecoleccion: pickupCoordinates } : {}),
      telefonoContacto: telefonoFinal,
      metadata: metadataValidada.metadata,
      camposSnapshot: metadataValidada.camposSnapshot,
      ...(imagenSubida || {}),
    });
    await donacion.populate([
      { path: "recolector", select: "nombre apellido email telefono" },
      { path: "registradoPorRecolector", select: "nombre apellido email telefono" },
      { path: "campana", select: "nombre activa" },
    ]);
    void notifyAdminsOfNewDonation(donacion);
    return res.status(201).json({ donacion });
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

const listarMisDonaciones = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const items = await Donacion.find({ donante: user._id })
      .sort({ createdAt: -1 })
      .populate("campana", "nombre activa")
      .populate("recolector", "nombre apellido");
    return res.status(200).json({ items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
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

    return res.status(200).json({ items });
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
    return res.status(200).json({ items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const leerDonacionQR = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const role = String(user?.rol || "").toLowerCase();
    const codigo = String(req.body?.codigo ?? "").trim();
    const match = /^DONATY:(.+)$/i.exec(codigo);
    const id = match?.[1]?.trim();

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: "Código QR inválido" });
    }

    const donacion = await Donacion.findById(id)
      .populate("campana", "nombre puntosRecoleccion")
      .populate("donante", "nombre apellido telefono")
      .populate("recolector", "nombre apellido telefono");

    if (!donacion) {
      return res.status(404).json({ msg: "Donación no encontrada" });
    }

    const isAdmin = role === "admin";
    const isOwnerDonante = role === "donante" &&
      String(donacion.donante?._id ?? donacion.donante) === String(user._id);
    const isAssignedRecolector = role === "recolector" &&
      String(donacion.recolector?._id ?? donacion.recolector) === String(user._id);

    if (!isAdmin && !isOwnerDonante && !isAssignedRecolector) {
      return res.status(403).json({ msg: "No tienes permiso para consultar esta donación" });
    }

    const campaign = donacion.campana;
    const point = campaign?.puntosRecoleccion?.id(donacion.puntoRecoleccionRef);
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
    const gpsMatchesPoint =
      String(gps?.campana || "") === String(campaign?._id || "")
      && String(gps?.puntoRecoleccion || "") === String(point?._id || "");
    const locationState = classifyCollectorGeofenceState({
      collectorActive: responsible?.status !== false,
      capturedAt: gps?.capturadoEn ?? gps?.actualizadoEn,
      latitude: gps?.latitud,
      longitude: gps?.longitud,
      accuracyMeters: gps?.precisionMetros,
      insideGeofence:
        gps != null
        && isInsideEpnCampus(gps.latitud, gps.longitud),
    });
    const gpsCoordinatesAvailable =
      gpsMatchesPoint
      && locationState !== "inactivo"
      && hasValidCollectorCoordinates(gps?.latitud, gps?.longitud);
    const gpsFresh =
      gpsCoordinatesAvailable && ["dentro", "fuera"].includes(locationState);
    const evidenciasPorEtapa = {
      recepcion: donacion.evidencias.filter((evidence) => evidence.etapa === "recepcion"),
      finalizacion: donacion.evidencias.filter((evidence) => evidence.etapa === "finalizacion"),
      devolucion: donacion.evidencias.filter((evidence) => evidence.etapa === "devolucion"),
    };

    return res.status(200).json({
      donacion,
      evidenciasPorEtapa,
      puntoRecoleccion: serializeTracePickupPoint(point),
      recolectoresAsignadosAlPunto: pointCollectors,
      responsableVigente: responsible
        ? { _id: responsible._id, nombre: responsible.nombre, apellido: responsible.apellido }
        : null,
      ubicacionResponsable: {
        estado: !responsible || !gpsMatchesPoint
          ? "inactivo"
          : gpsFresh
          ? "activo"
          : locationState,
        estadoGeografico: gpsMatchesPoint ? locationState : "inactivo",
        coordenadas: gpsCoordinatesAvailable
          ? { latitud: gps.latitud, longitud: gps.longitud }
          : null,
        actualizadoEn: gpsMatchesPoint ? gps.actualizadoEn : null,
        capturadoEn: gpsMatchesPoint
          ? gps.capturadoEn ?? gps.actualizadoEn
          : null,
      },
      historialEstados: [...(donacion.historialEstados || [])]
        .sort((left, right) => new Date(left.fecha) - new Date(right.fecha)),
      historialRecolectores: [...(donacion.historialRecolectores || [])]
        .sort((left, right) => new Date(left.fecha) - new Date(right.fecha)),
    });
  } catch (error) {
    console.error("Error al consultar donación por QR:", error);
    return res.status(500).json({ msg: "Error al consultar la donación" });
  }
};

const listarPendientesRecolector = async (req, res) => {
  try {
    const items = await Donacion.find({
      tipo: "fisica",
      estado: "pendiente",
      recolector: null,
    })
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido");
    return res.status(200).json({ items });
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
    return res.status(200).json({ items });
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

    donacion.recolector = user._id;
    donacion.estado = "asignada";
    donacion.historialRecolectores.push({
      recolectorNuevo: user._id,
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
      return res.status(200).json({ donacion });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
    }
  };

const marcarPendienteRecoleccion = cambiarEstadoRecolector(
  "asignada",
  "pendiente_recoleccion"
);
const marcarRecolectada = cambiarEstadoRecolector(
  "pendiente_recoleccion",
  "recolectada"
);
const marcarClasificada = cambiarEstadoRecolector("recolectada", "clasificada");
const iniciarEntrega = cambiarEstadoRecolector("clasificada", "en_entrega");
const marcarEntregada = cambiarEstadoRecolector("en_entrega", "entregada");
const solicitarDevolucion = cambiarEstadoRecolector(
  "recolectada",
  "devolucion",
  (req) => ({ motivoDevolucion: String(req.body?.motivoDevolucion ?? "").trim() })
);
const confirmarDevolucion = cambiarEstadoRecolector("devolucion", "devuelta");

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

    if (donacion.estado !== estadoFinal) {
      donacion.historialEstados.push(
        statusHistoryEntry(estadoFinal, req.user, req.body?.observaciones)
      );
    }
    donacion.estado = estadoFinal;
    await donacion.save();

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
  listarMisDonaciones,
  listarDonaciones,
  listarPendientesRecolector,
  listarAsignadasRecolector,
  asignarRecolector,
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
