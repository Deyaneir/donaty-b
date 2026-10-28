import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import { isBlank } from "../utils/validation.js";
import { fetchEmbedding, cosineSimilarity } from "./ai_controller.js";
import AiEmbedding from "../models/AiEmbedding.js";
import Campana from "../models/Campana.js";
import { resolveDonationCategory } from "../utils/categoryCatalog.js";
import { uploadImage, deleteImage } from "../helpers/cloudinaryImages.js";

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

const crearDonacion = async (req, res) => {
  let imagenSubida = null;
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const {
      tipo,
      categoria,
      subcategoria,
      descripcion,
      direccionEntrega,
      telefonoContacto,
      metadata,
      campana,
    } = req.body || {};

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
    const campanaDoc = await Campana.findById(campana).select("activa categoriasPermitidas");
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
    if (isBlank(descripcion) && isBlank(categoria)) {
      return res.status(400).json({ msg: "Debes indicar la descripción o categoría" });
    }

    const direccionFinal = String(direccionEntrega ?? user.direccion ?? "").trim();
    const telefonoFinal = String(telefonoContacto ?? user.telefono ?? "").trim();
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

    if (isBlank(direccionFinal) || isBlank(telefonoFinal)) {
      return res.status(400).json({ msg: "Debes indicar dirección y teléfono para donaciones físicas" });
    }

    imagenSubida = await uploadImage(req.files?.imagen, "donaty/donaciones");
    const donacion = await Donacion.create({
      donante: user._id,
      campana: campanaDoc._id,
      categoria: categoriaResuelta.categoria,
      categoriaRef: categoriaResuelta.categoriaId,
      subcategoria: categoriaResuelta.subcategoria,
      tipo: tipoFinal,
      descripcion: descripcion ?? "",
      estado: "pendiente",
      direccionEntrega: direccionFinal,
      telefonoContacto: telefonoFinal,
      metadata: parseMetadata(metadata),
      ...(imagenSubida || {}),
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

const crearDonacionRecolector = async (req, res) => {
  let imagenSubida = null;
  try {
    const user = req.user || req.donanteHeader;
    if (!user) return res.status(401).json({ msg: "No autenticado" });

    const {
      tipo,
      categoria,
      subcategoria,
      descripcion,
      direccionEntrega,
      telefonoContacto,
      metadata,
      campana,
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
    } = req.body || {};

    const tipoFinal = normalizeTipo(tipo ?? "fisica");
    if (!TIPOS.includes(tipoFinal)) return res.status(400).json({ msg: "Tipo de donación inválido" });
    const categoriaResuelta = await resolveDonationCategory(categoria, subcategoria);
    if (!categoriaResuelta.categoriaId || isBlank(campana)) {
      return res.status(400).json({ msg: "Debes indicar una categoría y su campaña para registrar la donación" });
    }
    if (!mongoose.Types.ObjectId.isValid(campana)) {
      return res.status(400).json({ msg: "La campaña indicada no es válida" });
    }
    const campanaDoc = await Campana.findById(campana).select("activa categoriasPermitidas");
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
    if (isBlank(descripcion) && isBlank(categoria)) {
      return res.status(400).json({ msg: "Debes indicar la descripción o categoría" });
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
    const pickupCoordinates = parseCoordinatePair(
      pickup.latitud ?? puntoRecoleccionLatitud ?? latitud,
      pickup.longitud ?? puntoRecoleccionLongitud ?? longitud
    );
    if (donorCoordinates === undefined || pickupCoordinates === undefined) {
      return res.status(400).json({ msg: "Las coordenadas deben incluir latitud y longitud válidas" });
    }
    if (isBlank(donorNombre) || isBlank(donorApellido)) {
      return res.status(400).json({ msg: "El nombre y apellido del donante externo son obligatorios" });
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
      direccionEntrega: direccionFinal,
      ...(pickupCoordinates ? { puntoRecoleccion: pickupCoordinates } : {}),
      telefonoContacto: telefonoFinal,
      metadata: parseMetadata(metadata),
      ...(imagenSubida || {}),
    });
    await donacion.populate([
      { path: "recolector", select: "nombre apellido email telefono" },
      { path: "registradoPorRecolector", select: "nombre apellido email telefono" },
      { path: "campana", select: "nombre activa" },
    ]);
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

    const items = await Donacion.find({ donante: user._id }).sort({
      createdAt: -1,
    });
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
      .populate("campana", "nombre")
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

    return res.status(200).json({ donacion });
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

      const donacion = await Donacion.findOneAndUpdate(
        { _id: id, tipo: "fisica", recolector: user._id, estado: estadoActual },
        { $set: { estado: estadoNuevo, ...extras(req) } },
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
      subcategoria,
      descripcion,
      direccionEntrega,
      telefonoContacto,
    } = req.body || {};

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

    if (direccionEntrega !== undefined) {
      donacion.direccionEntrega = String(direccionEntrega ?? "").trim();
    }
    if (telefonoContacto !== undefined) {
      donacion.telefonoContacto = String(telefonoContacto ?? "").trim();
    }

    // Si es física, debe seguir teniendo dirección/teléfono
    if (donacion.tipo === "fisica") {
      if (isBlank(donacion.direccionEntrega) || isBlank(donacion.telefonoContacto)) {
        return res.status(400).json({
          msg: "Debes indicar dirección y teléfono para donaciones físicas",
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
