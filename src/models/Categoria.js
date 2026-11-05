import { Schema, model } from "mongoose";

const subcategoriaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 80 },
    nombreNormalizado: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "", trim: true, maxlength: 500 },
    formularioTitulo: { type: String, default: "", trim: true, maxlength: 120 },
    formularioDescripcion: { type: String, default: "", trim: true, maxlength: 500 },
    iconKey: { type: String, default: "", trim: true, maxlength: 64 },
    activa: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const campoOptionSchema = new Schema(
  {
    value: { type: String, required: true },
    label: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const campoSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 64 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      required: true,
      enum: ["shortText", "longText", "integer", "decimal", "date", "dropdown", "multiSelect", "yesNo", "unit"],
    },
    required: { type: Boolean, default: false },
    options: { type: [campoOptionSchema], default: [] },
    min: { type: Schema.Types.Mixed, default: null },
    max: { type: Schema.Types.Mixed, default: null },
    unit: { type: String, default: "", trim: true, maxlength: 32 },
    order: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
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
    formularioTitulo: { type: String, default: "", trim: true, maxlength: 120 },
    formularioDescripcion: { type: String, default: "", trim: true, maxlength: 500 },
    iconKey: { type: String, default: "", trim: true, maxlength: 64 },
    activa: { type: Boolean, default: true, index: true },
    subcategorias: { type: [subcategoriaSchema], default: [] },
    campos: { type: [campoSchema], default: [] },
    maxUnidadesPorDonacion: { type: Number, min: 1, default: null },
  },
  { timestamps: true, collection: "categorias" }
);

categoriaSchema.index(
  { campana: 1, nombreNormalizado: 1 },
  { unique: true, partialFilterExpression: { campana: { $type: "objectId" } } }
);
categoriaSchema.index({ campana: 1, activa: 1, nombre: 1 });
categoriaSchema.index({ activa: 1, nombre: 1 });

const Categoria = model("Categoria", categoriaSchema);

export default Categoria;