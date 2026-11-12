import { Schema, model } from "mongoose";

const clasificacionSchema = new Schema(
  {
    campana: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      required: true,
      index: true,
    },
    puntoRecoleccionRef: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    nombre: { type: String, required: true, trim: true, maxlength: 160 },
    nombreClave: { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: "clasificaciones" }
);

clasificacionSchema.index(
  { campana: 1, puntoRecoleccionRef: 1, nombreClave: 1 },
  { unique: true }
);

const Clasificacion = model("Clasificacion", clasificacionSchema);

export default Clasificacion;
