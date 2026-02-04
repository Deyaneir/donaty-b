import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";
import { isBlank } from "../utils/validation.js";
import { createStripeCheckoutSession } from "./stripe_controller.js";
import { fetchEmbedding, cosineSimilarity } from "./ai_controller.js";
import AiEmbedding from "../models/AiEmbedding.js";

const TIPOS = ["dinero", "fisica"];
const ESTADOS = [
  "pendiente",
  "pagado",
  "asignada",
  "entregada",
  "cancelada",
];

const normalizeTipo = (value = "") => {
  const raw = String(value).trim().toLowerCase();
  if (raw === "fisico" || raw === "física") return "fisica";
  return raw;
};

const normalizeEstado = (value = "") => String(value).trim().toLowerCase();
const escapeRegex = (str = "") =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const crearDonacion = async (req, res) => {
    try {
      const user = req.user || req.donanteHeader;
      if (!user) return res.status(401).json({ msg: "No autenticado" });

    const {
      tipo,
      categoria,
      descripcion,
      monto,
      moneda,
      metodoPago,
      direccionEntrega,
      telefonoContacto,
      metadata,
    } = req.body || {};

    if (isBlank(tipo)) {
      return res.status(400).json({ msg: "Debes indicar el tipo de donación" });
    }

    const tipoFinal = normalizeTipo(tipo);
    if (!TIPOS.includes(tipoFinal)) {
      return res.status(400).json({ msg: "Tipo de donación inválido" });
    }

    const isDinero = tipoFinal === "dinero";
    const estadoInicial = "pendiente";
    const metodoFinal = isDinero
      ? String(metodoPago || "stripe").trim().toLowerCase()
      : "ninguno";

    if (isDinero) {
      const amountInt = Number(monto);
      if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return res.status(400).json({
          msg: "Monto inválido. Envía 'monto' en centavos (entero).",
        });
      }
      const metodoValido = [
        "stripe",
        "efectivo",
        "transferencia",
        "ninguno",
      ].includes(
        metodoFinal
      );
      if (!metodoValido) {
        return res.status(400).json({ msg: "Método de pago inválido" });
      }
    } else {
      const hasDetalle = !isBlank(descripcion) || !isBlank(categoria);
      if (!hasDetalle) {
        return res
          .status(400)
          .json({ msg: "Debes indicar la descripción o categoría" });
      }
    }

  const direccionFinal = String(
    direccionEntrega ?? user.direccion ?? ""
  ).trim();
  const telefonoFinal = String(
    telefonoContacto ?? user.telefono ?? ""
  ).trim();

  // Chequeo de duplicados simples por descripción para el mismo donante
  const descNorm = String(descripcion || "").trim();
  if (descNorm) {
    const dup = await Donacion.findOne({
      donante: user._id,
      descripcion: { $regex: `^${escapeRegex(descNorm)}$`, $options: "i" },
    });
    if (dup) {
      return res
        .status(409)
        .json({ msg: "Ya registraste una donación con esa descripción. Modifícala para continuar." });
    }
  }

      // Chequeo semántico opcional (IA) para evitar duplicados parecidos
      if (descNorm.length >= 3) {
        try {
          const { vector, model } = await fetchEmbedding(descNorm);
          const threshold =
            descNorm.length <= 5 ? 0.95 : descNorm.length <= 15 ? 0.85 : 0.8;

          const existentes = await AiEmbedding.find({
            model,
            "meta.donanteId": String(user._id),
          }).lean();

          const similares = existentes
            .map((doc) => {
              const score = cosineSimilarity(vector, doc.embedding);
              if (score === null) return null;
              return { score, text: doc.text, donacionId: doc.meta?.donacionId };
            })
            .filter(Boolean)
            .filter((x) => x.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

          if (similares.length) {
            return res.status(409).json({
              msg: "Existe una donación muy similar. Ajusta la descripción.",
              similares: similares.map((s) => ({
                text: s.text,
                score: Number(s.score.toFixed(3)),
                donacionId: s.donacionId,
              })),
            });
          }

          // guardamos embedding para futuras comparaciones (se completa tras guardar donación)
          req._pendingEmbedding = { vector, model };
        } catch (err) {
          console.warn("IA similarity skip:", err?.message || err);
        }
      }

    if (!isDinero && (isBlank(direccionFinal) || isBlank(telefonoFinal))) {
      return res.status(400).json({
        msg: "Debes indicar dirección y teléfono para donaciones físicas",
      });
    }

      const donacion = new Donacion({
        donante: user._id,
        tipo: tipoFinal,
        categoria: categoria ?? "",
        descripcion: descripcion ?? "",
        monto: isDinero ? Number(monto) : null,
      moneda: String(moneda || "usd").toLowerCase(),
      metodoPago: metodoFinal,
      estado: estadoInicial,
      direccionEntrega: direccionFinal,
      telefonoContacto: telefonoFinal,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    });

      await donacion.save();

      // Si tenemos embedding pendiente, lo guardamos ahora vinculado a la donación
      if (req._pendingEmbedding) {
        try {
          await AiEmbedding.create({
            text: descNorm,
            embedding: req._pendingEmbedding.vector,
            model: req._pendingEmbedding.model,
            dims: req._pendingEmbedding.vector.length,
            meta: {
              donacionId: String(donacion._id),
              donanteId: String(user._id),
            },
          });
        } catch (err) {
          console.warn("No se pudo guardar embedding:", err?.message || err);
        }
      }

    if (isDinero && metodoFinal === "stripe") {
      try {
        const session = await createStripeCheckoutSession({
          amount: donacion.monto,
          currency: donacion.moneda,
          description: descripcion || "Donación",
          metadata: {
            ...(donacion.metadata || {}),
            donacionId: String(donacion._id),
            donanteId: String(user._id),
            tipo: "dinero",
          },
          email: user.email,
        });

        donacion.stripeSessionId = session.id;
        if (session.payment_intent) {
          donacion.stripePaymentIntentId = session.payment_intent;
        }
        await donacion.save();

        return res.status(201).json({
          donacion,
          checkoutUrl: session.url,
          sessionId: session.id,
        });
      } catch (error) {
        await Donacion.findByIdAndDelete(donacion._id);
        return res
          .status(500)
          .json({ msg: error.message || "Error creando sesión Stripe" });
      }
    }

    return res.status(201).json({ donacion });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
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
      recolector: user._id,
    })
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido");
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

const marcarEntregada = async (req, res) => {
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
    if (!donacion.recolector || String(donacion.recolector) !== String(user._id)) {
      return res.status(403).json({ msg: "No autorizado" });
    }
    if (donacion.estado !== "asignada") {
      return res
        .status(400)
        .json({ msg: "La donación no está asignada" });
    }

    donacion.estado = "entregada";
    await donacion.save();

    return res.status(200).json(donacion);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
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

    // ✅ Campos permitidos (NO tocamos monto/stripe para evitar inconsistencias)
    const { categoria, descripcion, direccionEntrega, telefonoContacto } = req.body || {};

    if (categoria !== undefined) donacion.categoria = categoria ?? "";
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

    await donacion.save();
    return res.status(200).json({ donacion });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
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
    return res.status(200).json({ msg: "Donación eliminada por admin" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};
export {
  crearDonacion,
  listarMisDonaciones,
  listarDonaciones,
  listarPendientesRecolector,
  listarAsignadasRecolector,
  asignarRecolector,
  marcarEntregada,
  actualizarEstado,

  // ✅ AGREGADO
  actualizarMiDonacion,
  eliminarMiDonacion,
  eliminarDonacionAdmin,
  listarDonacionesPublic,
};
