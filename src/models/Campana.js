import { Schema, model } from "mongoose";

const campanaSchema = new Schema(
  {
    nombre: {
      type: String,
      required: [true, "El nombre de la campaña es obligatorio"],
      trim: true,
      maxlength: 120,
    },
    descripcion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    imagenUrl: {
      type: String,
      default: "",
      trim: true,
    },
    imagenPublicId: {
      type: String,
      default: "",
      trim: true,
    },
    fechaInicio: {
      type: Date,
      default: null,
    },
    fechaFin: {
      type: Date,
      default: null,
    },
    activa: {
      type: Boolean,
      default: true,
      index: true,
    },
    categoriasPermitidas: {
      type: [{ type: Schema.Types.ObjectId, ref: "Categoria" }],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "campanas",
  }
);

campanaSchema.index({ activa: 1, fechaInicio: 1, fechaFin: 1 });

const Campana = model("Campana", campanaSchema);

export default Campana;