import { Schema, model } from "mongoose";

const subcategoriaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 80 },
    nombreNormalizado: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "", trim: true, maxlength: 500 },
    iconKey: { type: String, default: "", trim: true, maxlength: 64 },
    activa: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const categoriaSchema = new Schema(
  {
    campana: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      default: null,
      index: true,
    },
    nombre: { type: String, required: true, trim: true, maxlength: 80 },
    nombreNormalizado: { type: String, required: true, trim: true },
    nombresAnteriores: { type: [String], default: [] },
    descripcion: { type: String, default: "", trim: true, maxlength: 500 },
    iconKey: { type: String, default: "", trim: true, maxlength: 64 },
    activa: { type: Boolean, default: true, index: true },
    subcategorias: { type: [subcategoriaSchema], default: [] },
  },
  { timestamps: true, collection: "categorias" }
);

categoriaSchema.index({ nombreNormalizado: 1 }, { unique: true });
categoriaSchema.index({ campana: 1, activa: 1, nombre: 1 });
categoriaSchema.index({ activa: 1, nombre: 1 });

const Categoria = model("Categoria", categoriaSchema);

export default Categoria;