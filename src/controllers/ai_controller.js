import AiEmbedding from "../models/AiEmbedding.js";

const HF_MODEL_DEFAULT = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

const encodeModelId = (modelId) =>
  String(modelId)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

const getHfConfig = () => {
  const token = process.env.HF_TOKEN;
  const model = process.env.HF_MODEL || HF_MODEL_DEFAULT;
  const safeModel = encodeModelId(model);
  const apiUrl =
    process.env.HF_API_URL ||
    `https://router.huggingface.co/hf-inference/models/${safeModel}/pipeline/feature-extraction`;

  return { token, model, apiUrl };
};

const normalizeVector = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null;

  if (typeof data[0] === "number") {
    return data;
  }

  if (Array.isArray(data[0]) && typeof data[0][0] === "number") {
    // Si viene como batch de 1, devuelve el primer vector
    if (data.length === 1) return data[0];

    // Si viene por token, promediamos
    const dims = data[0].length;
    const avg = new Array(dims).fill(0);
    for (const vec of data) {
      for (let i = 0; i < dims; i += 1) {
        avg[i] += vec[i];
      }
    }
    for (let i = 0; i < dims; i += 1) {
      avg[i] /= data.length;
    }
    return avg;
  }

  return null;
};

const fetchEmbedding = async (text) => {
  const { token, model, apiUrl } = getHfConfig();
  if (!token) {
    throw new Error("HF_TOKEN no configurado");
  }

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: [text] }),
  });

  const raw = await resp.text().catch(() => "");
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!resp.ok) {
    const msg = data?.error || raw || `HTTP ${resp.status}`;
    const extra =
      data?.estimated_time !== undefined
        ? ` (retry en ~${data.estimated_time}s)`
        : "";
    throw new Error(`${msg}${extra}`);
  }

  const vector = normalizeVector(data);
  if (!vector) {
    throw new Error("Respuesta inesperada del modelo");
  }

  return { vector, model };
};

const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const indexAndCompare = async (req, res) => {
  try {
    const { text, topK = 5, minScore = 0, meta = {} } = req.body || {};
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ msg: "Debes enviar un texto" });
    }

    const { vector, model } = await fetchEmbedding(text.trim());
    const dims = vector.length;

    const existentes = await AiEmbedding.find({ model })
      .select("text embedding meta createdAt")
      .lean();

    const matches = existentes
      .map((doc) => {
        const score = cosineSimilarity(vector, doc.embedding);
        if (score === null) return null;
        return {
          id: doc._id,
          text: doc.text,
          meta: doc.meta || {},
          score: Number(score.toFixed(6)),
          createdAt: doc.createdAt,
        };
      })
      .filter(Boolean)
      .filter((item) => item.score >= Number(minScore || 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Number(topK) || 5, 50));

    const creado = await AiEmbedding.create({
      text: text.trim(),
      embedding: vector,
      model,
      dims,
      meta,
    });

    return res.status(200).json({
      id: creado._id,
      model,
      dims,
      matches,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: error.message || "Error interno" });
  }
};

const embeddings = async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ msg: "Debes enviar un texto" });
    }

    const { vector, model } = await fetchEmbedding(text.trim());
    return res.status(200).json({
      model,
      dims: vector.length,
      embedding: vector,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: error.message || "Error interno" });
  }
};

const similarity = async (req, res) => {
  try {
    const { textA, textB } = req.body || {};
    if (!textA || !textB) {
      return res
        .status(400)
        .json({ msg: "Debes enviar textA y textB" });
    }

    const [{ vector: vecA, model }, { vector: vecB }] = await Promise.all([
      fetchEmbedding(String(textA).trim()),
      fetchEmbedding(String(textB).trim()),
    ]);

    const score = cosineSimilarity(vecA, vecB);
    if (score === null) {
      return res.status(500).json({ msg: "No se pudo calcular la similitud" });
    }

    return res.status(200).json({
      model,
      similarity: Number(score.toFixed(6)),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: error.message || "Error interno" });
  }
};

const listEmbeddings = async (req, res) => {
  try {
    const { limit = 20 } = req.query || {};
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const items = await AiEmbedding.find({})
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .select("text model dims meta createdAt");
    return res.status(200).json({ items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: error.message || "Error interno" });
  }
};

const deleteEmbeddings = async (_req, res) => {
  try {
    const result = await AiEmbedding.deleteMany({});
    return res.status(200).json({
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: error.message || "Error interno" });
  }
};

export {
  embeddings,
  similarity,
  indexAndCompare,
  listEmbeddings,
  deleteEmbeddings,
  fetchEmbedding,
  cosineSimilarity,
};
