import { Schema, model } from "mongoose";

const aiEmbeddingSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    embedding: { type: [Number], required: true },
    model: { type: String, required: true },
    dims: { type: Number, required: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

const AiEmbedding = model("AiEmbedding", aiEmbeddingSchema, "ai_embeddings");
export default AiEmbedding;
