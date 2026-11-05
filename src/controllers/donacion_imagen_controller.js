import { readFile, unlink } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Categoria from "../models/Categoria.js";
import { validateDonationMetadata } from "../utils/categoryFields.js";
import {
  getImageWritableFields,
  normalizeImageFieldSuggestions,
} from "../utils/donationImageFields.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REQUEST_WINDOW_MS = 60 * 1000;
const REQUEST_LIMIT = 10;
const VISION_TIMEOUT_MS = 60 * 1000;
const requestCounts = new Map();
let requestSequence = 0;

const elapsedMs = (startedAt) => Math.round(performance.now() - startedAt);

const logStage = (requestStartedAt, stage, startedAt, details = {}) => {
  console.info("[donacion-imagen]", {
    stage,
    durationMs: elapsedMs(startedAt),
    totalMs: elapsedMs(requestStartedAt),
    ...details,
  });
};

const errorResponse = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

const checkRateLimit = (userId) => {
  const now = Date.now();
  const current = requestCounts.get(String(userId));
  if (!current || now - current.startedAt >= REQUEST_WINDOW_MS) {
    requestCounts.set(String(userId), { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= REQUEST_LIMIT) return false;
  current.count += 1;
  return true;
};

const cleanJsonResponse = (response) => {
  const content = response?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text || "").join("")
      : "";
  const normalizedText = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  return JSON.parse(normalizedText);
};

const getProviderErrorDetails = (rawBody, apiKey) => {
  let details = rawBody;
  try {
    details = JSON.stringify(JSON.parse(rawBody));
  } catch {
    // Keep non-JSON provider errors useful in the backend log.
  }
  return details
    .replace(/(Bearer\s+)[^\s"]+/gi, "$1[REDACTED]")
    .replace(apiKey, "[REDACTED]")
    .slice(0, 2000);
};

const classifyProviderError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (error?.name === "AbortError") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || message.includes("dns")) {
    return "dns";
  }
  if (
    code === "CERT_HAS_EXPIRED"
    || code === "CERT_INVALID"
    || code.startsWith("ERR_TLS")
    || message.includes("tls")
    || message.includes("certificate")
  ) {
    return "tls";
  }
  if (code === "ECONNREFUSED") return "connection-refused";
  if (code === "ECONNRESET" || code === "EPIPE" || message.includes("socket closed")) {
    return "connection-closed";
  }
  if (code === "ETIMEDOUT" || message.includes("timeout")) return "timeout";
  return "connection";
};

const providerErrorResponse = (res, status) => {
  if (status === 400) {
    return errorResponse(res, 400, "VISION_BAD_REQUEST", "La solicitud de análisis fue rechazada");
  }
  if (status === 401) {
    return errorResponse(res, 502, "VISION_PROVIDER_AUTH_ERROR", "La autenticación del proveedor de visión falló");
  }
  if (status === 403) {
    return errorResponse(res, 502, "VISION_PROVIDER_FORBIDDEN", "El proveedor de visión rechazó el acceso");
  }
  if (status === 404) {
    return errorResponse(res, 502, "VISION_MODEL_NOT_FOUND", "El modelo de visión no está disponible");
  }
  if (status === 429) {
    res.set("Retry-After", "60");
    return errorResponse(res, 429, "VISION_RATE_LIMITED", "El proveedor de visión está temporalmente limitado");
  }
  return errorResponse(res, 502, "VISION_PROVIDER_ERROR", "No se pudo completar el análisis de imagen");
};

const isValidConfidence = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 0;

const normalizeCatalogText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const resolveCatalogItem = (items, value) => {
  const candidateValue = value && typeof value === "object"
    ? value.id ?? value.categoryId ?? value.subcategoryId ?? value.nombre ?? value.name
    : value;
  const candidate = normalizeCatalogText(candidateValue);
  if (!candidate) return null;
  return items.find((item) =>
    normalizeCatalogText(item.id) === candidate
    || normalizeCatalogText(item.nombre) === candidate
  ) || null;
};

const normalizeFieldValue = (field, value) => {
  if (value === null || value === undefined) return value;
  if (!["dropdown", "multiSelect"].includes(field.type)) return value;

  const options = field.options || [];
  const resolveOption = (candidate) => {
    const normalized = normalizeCatalogText(candidate);
    return options.find((option) =>
      option.value === candidate
      || normalizeCatalogText(option.value) === normalized
      || normalizeCatalogText(option.label) === normalized
    )?.value || null;
  };

  if (field.type === "multiSelect") {
    return Array.isArray(value) ? value.map(resolveOption).filter(Boolean) : value;
  }
  return resolveOption(value);
};

const analyzeDonationImage = async (req, res) => {
  const requestStartedAt = performance.now();
  const requestId = ++requestSequence;
  const receivedImageAt = performance.now();
  const image = req.files?.imagen;
  const tempFilePath = !Array.isArray(image) ? image?.tempFilePath : null;
  logStage(requestStartedAt, "recepcion-imagen", receivedImageAt, {
    requestId,
    present: Boolean(image),
    multiple: Array.isArray(image),
  });

  try {
    console.info("[donacion-imagen] inicio-procesamiento", {
      requestId,
      userAuthenticated: Boolean(req.user?._id),
    });
    const validationStartedAt = performance.now();
    if (!req.user?._id) return errorResponse(res, 401, "UNAUTHENTICATED", "No autenticado");
    if (!checkRateLimit(req.user._id)) {
      res.set("Retry-After", "60");
      return errorResponse(res, 429, "RATE_LIMITED", "Límite de 10 análisis por minuto alcanzado");
    }
    if (Array.isArray(image) || !image?.tempFilePath) {
      return errorResponse(res, 400, "IMAGE_REQUIRED", "Debes adjuntar una imagen en el campo imagen");
    }
    if (!ALLOWED_IMAGE_TYPES.has(image.mimetype)) {
      return errorResponse(res, 415, "UNSUPPORTED_IMAGE_TYPE", "La imagen debe ser JPG, PNG o WebP");
    }
    if (image.truncated || image.size > MAX_IMAGE_SIZE) {
      return errorResponse(res, 413, "IMAGE_TOO_LARGE", "La imagen no puede superar 5 MB");
    }
    logStage(requestStartedAt, "validacion-imagen", validationStartedAt, {
      mimeTypeAccepted: ALLOWED_IMAGE_TYPES.has(image.mimetype),
      sizeBytes: image.size,
    });

    const campaignId = String(req.body?.campanaId ?? "").trim();
    if (!mongoose.isValidObjectId(campaignId)) {
      return errorResponse(res, 400, "INVALID_CAMPAIGN_ID", "Debes enviar un campanaId válido");
    }
    const catalogStartedAt = performance.now();
    const campaign = await Campana.findById(campaignId).select("activa categoriasPermitidas").lean();
    if (!campaign) return errorResponse(res, 404, "CAMPAIGN_NOT_FOUND", "La campaña no existe");
    if (!campaign.activa) return errorResponse(res, 400, "CAMPAIGN_INACTIVE", "La campaña no está activa");

    const requestedCategoryId = String(
      req.body?.categoriaId ?? req.body?.categoryId ?? ""
    ).trim();
    if (requestedCategoryId && !mongoose.isValidObjectId(requestedCategoryId)) {
      return errorResponse(res, 400, "INVALID_CATEGORY_ID", "Debes enviar una categoriaId válida");
    }

    const categoryFilter = { campana: campaignId, activa: true };
    if (campaign.categoriasPermitidas?.length) {
      categoryFilter._id = { $in: campaign.categoriasPermitidas };
    }
    if (requestedCategoryId) categoryFilter._id = requestedCategoryId;
    const categories = await Categoria.find(categoryFilter)
      .select("nombre descripcion subcategorias nombre campos")
      .lean();
    const catalog = categories.map((category) => ({
      id: String(category._id),
      nombre: category.nombre,
      descripcion: category.descripcion || "",
      subcategorias: (category.subcategorias || [])
        .filter((subcategory) => subcategory.activa)
        .map((subcategory) => ({ id: String(subcategory._id), nombre: subcategory.nombre })),
      campos: (category.campos || []).filter((field) => field.active !== false),
    }));
    const writableFields = requestedCategoryId
      ? getImageWritableFields(
        catalog.find((category) => category.id === requestedCategoryId)?.campos || []
      )
      : [];
    logStage(requestStartedAt, "consulta-mongodb-campana-categorias", catalogStartedAt, {
      requestId,
      categoryCount: catalog.length,
      requestedCategory: Boolean(requestedCategoryId),
    });
    if (requestedCategoryId && catalog.length === 0) {
      return errorResponse(res, 404, "CATEGORY_NOT_FOUND", "La categoría no pertenece a la campaña activa");
    }
    if (
      requestedCategoryId
      && campaign.categoriasPermitidas?.length
      && !campaign.categoriasPermitidas.some((id) => String(id) === requestedCategoryId)
    ) {
      return errorResponse(res, 404, "CATEGORY_NOT_FOUND", "La categoría no pertenece a la campaña activa");
    }

    console.info("[donacion-imagen] antes-configuracion-proveedor", {
      requestId,
      groqApiKeyConfigured: Boolean(process.env.GROQ_API_KEY),
      groqModelConfigured: Boolean(process.env.GROQ_MODEL || "qwen/qwen3.8-27b"),
      groqUrlConfigured: Boolean(process.env.GROQ_API_URL),
    });
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
    const apiUrl = process.env.GROQ_API_URL
      || "https://api.groq.com/openai/v1/chat/completions";
    if (!apiKey || !model) {
      console.error("[donacion-imagen] proveedor-no-configurado", {
        requestId,
        groqApiKeyConfigured: Boolean(apiKey),
        groqModelConfigured: Boolean(model),
        groqUrlConfigured: Boolean(process.env.GROQ_API_URL),
      });
      return errorResponse(res, 503, "VISION_NOT_CONFIGURED", "El análisis de imágenes no está configurado");
    }
    console.info("[donacion-imagen] configuracion-proveedor", {
      requestId,
      apiKeyConfigured: Boolean(apiKey),
      modelConfigured: Boolean(model),
      urlConfigured: Boolean(process.env.GROQ_API_URL),
      requestFormat: "Groq OpenAI-compatible chat completions with data URL image",
    });

    const base64StartedAt = performance.now();
    console.info("[donacion-imagen] antes-lectura-imagen", {
      requestId,
      tempFileAvailable: Boolean(tempFilePath),
    });
    let imageBuffer;
    try {
      imageBuffer = await readFile(tempFilePath);
    } catch (error) {
      console.error("[donacion-imagen] error-lectura-imagen", {
        requestId,
        code: error?.code || null,
        message: error?.message || "Error sin mensaje",
      });
      throw error;
    }
    const imageBase64 = imageBuffer.toString("base64");
    const dataUrl = `data:${image.mimetype};base64,${imageBase64}`;
    logStage(requestStartedAt, "lectura-base64-imagen", base64StartedAt, {
      requestId,
      imageBytes: imageBuffer.length,
      base64Bytes: imageBase64.length,
    });
    const prompt = [
      "Analiza visualmente la imagen para sugerir el nombre del bien, su descripción y los campos de texto o numéricos indicados.",
      "Devuelve solo un objeto JSON con nombreBien, descripcion, campos y confianza.",
      "nombreBien debe ser un nombre breve del artículo visible. descripcion debe tener hasta 500 caracteres y contener únicamente hechos observables.",
      "Si un dato no puede identificarse con evidencia suficiente, usa null. Nunca uses 'desconocido', 'no identificado', texto inventado ni afirmaciones no visibles.",
      "En campos, usa únicamente las claves exactas de la lista permitida y completa solo valores claramente observables en la fotografía. Para datos que no puedan deducirse con certeza, omite la clave o usa null.",
      "No selecciones opciones, no completes campos de selección, fechas, cantidades generales, categorías, subcategorías ni datos que no sean visibles.",
      `Campos editables permitidos: ${JSON.stringify(writableFields)}`,
      "confianza debe contener nombreBien, descripcion y campos, con números entre 0 y 1.",
    ].join("\n");
    console.info("[donacion-imagen] prompt-construido", {
      requestId,
      promptLength: prompt.length,
      catalogCount: catalog.length,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    const geminiStartedAt = performance.now();
    let providerStage = "espera-headers-gemini";
    let providerResponse;
    let providerBody;
    console.info("[donacion-imagen] inicio-fetch-groq", {
      requestId,
      totalMs: elapsedMs(requestStartedAt),
    });
    try {
      providerResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
        }),
      });
      logStage(requestStartedAt, "espera-headers-gemini", geminiStartedAt, {
        requestId,
        httpStatus: providerResponse.status,
      });
      const responseReadStartedAt = performance.now();
      providerStage = "lectura-body-gemini";
      providerBody = await providerResponse.text();
      logStage(requestStartedAt, "lectura-body-gemini", responseReadStartedAt, {
        requestId,
        httpStatus: providerResponse.status,
        responseBytes: Buffer.byteLength(providerBody),
      });
    } catch (error) {
      const errorType = classifyProviderError(error);
      console.error("[donacion-imagen] error-fetch-gemini", {
        requestId,
        type: errorType,
        stage: providerStage,
        code: error?.code || null,
        name: error?.name || "Error",
        message: error?.message || "Error sin mensaje",
        durationMs: elapsedMs(geminiStartedAt),
      });
      if (error.name === "AbortError") throw error;
      return errorResponse(res, 502, "VISION_PROVIDER_ERROR", "No se pudo completar el análisis de imagen");
    } finally {
      clearTimeout(timeout);
    }
    if (!providerResponse.ok) {
      const providerDetails = getProviderErrorDetails(providerBody, apiKey);
      console.error("Vision provider error", {
        status: providerResponse.status,
        details: providerDetails,
      });
      return providerErrorResponse(res, providerResponse.status);
    }

    let analysis;
    const jsonStartedAt = performance.now();
    try {
      analysis = cleanJsonResponse(JSON.parse(providerBody));
      logStage(requestStartedAt, "lectura-analisis-json", jsonStartedAt, {
        valid: true,
      });
    } catch {
      logStage(requestStartedAt, "lectura-analisis-json", jsonStartedAt, {
        valid: false,
      });
      return errorResponse(res, 502, "INVALID_VISION_RESPONSE", "El proveedor devolvió una respuesta inválida");
    }

    const rawName = analysis.nombreBien ?? analysis.name ?? analysis.itemName;
    const validName = typeof rawName === "string" && rawName.trim()
      ? rawName.trim().slice(0, 120)
      : null;
    const validDescription = typeof analysis.descripcion === "string" && analysis.descripcion.trim()
      ? analysis.descripcion.trim().slice(0, 500)
      : typeof analysis.description === "string" && analysis.description.trim()
        ? analysis.description.trim().slice(0, 500)
        : null;
    const rawFields = analysis.campos ?? analysis.fields;
    const fieldSuggestions = normalizeImageFieldSuggestions(rawFields, writableFields);
    const confidenceFields = Object.fromEntries(
      Object.keys(fieldSuggestions).map((key) => [
        key,
        isValidConfidence(analysis.confidence?.campos?.[key] ?? analysis.confidence?.fields?.[key]),
      ])
    );
    const fieldsNotIdentified = writableFields
      .map((field) => field.key)
      .filter((key) => !Object.hasOwn(fieldSuggestions, key));
    const suggestions = {
      nombreBien: validName,
      descripcion: validDescription,
      campos: fieldSuggestions,
    };
    const confidence = {
      nombreBien: suggestions.nombreBien
        ? isValidConfidence(analysis.confidence?.nombreBien ?? analysis.confidence?.name)
        : 0,
      descripcion: suggestions.descripcion
        ? isValidConfidence(analysis.confidence?.descripcion ?? analysis.confidence?.description)
        : 0,
      campos: confidenceFields,
    };
    const requiresManualReview = true;
    console.info("[donacion-imagen] respuesta-sugerencias", {
      requestId,
      suggestionsApplied: [
        suggestions.nombreBien,
        suggestions.descripcion,
        ...Object.values(fieldSuggestions),
      ].filter((value) => value !== null).length,
      requiresReview: requiresManualReview,
    });
    return res.status(200).json({
      success: true,
      descripcion: suggestions.descripcion,
      sugerencias: suggestions,
      confianza: confidence,
      camposRequierenRevision: [
        ...(suggestions.nombreBien ? ["nombreBien"] : []),
        ...(suggestions.descripcion ? ["descripcion"] : []),
        ...Object.keys(fieldSuggestions),
      ],
      camposNoIdentificados: fieldsNotIdentified,
      requiereRevision: requiresManualReview,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return errorResponse(res, 504, "VISION_TIMEOUT", "El análisis superó el tiempo máximo de 60 segundos");
    }
    console.error("Error al analizar imagen de donación:", error.message || error);
    return errorResponse(res, 500, "INTERNAL_ERROR", "Error interno al analizar la imagen");
  } finally {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (error) {
        if (error.code !== "ENOENT") console.warn("No se pudo eliminar la imagen temporal:", error.message);
      }
    }
  }
};

export { analyzeDonationImage };