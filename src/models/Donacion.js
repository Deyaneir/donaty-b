import { Schema, model } from "mongoose";

const donacionSchema = new Schema(
  {
    donante: {
      type: Schema.Types.ObjectId,
      ref: "Donante",
      required: true,
      index: true,
    },
    recolector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      default: null,
    },
    tipo: {
      type: String,
      enum: ["dinero", "fisica"],
      required: true,
      lowercase: true,
      trim: true,
    },
    categoria: { type: String, default: "", trim: true },
    descripcion: { type: String, default: "", trim: true },
    monto: { type: Number, default: null },
    moneda: { type: String, default: "usd", lowercase: true, trim: true },
    metodoPago: {
      type: String,
      enum: ["stripe", "efectivo", "transferencia", "ninguno"],
      default: "ninguno",
      lowercase: true,
      trim: true,
    },
    estado: {
      type: String,
      enum: ["pendiente", "pagado", "asignada", "entregada", "cancelada"],
      default: "pendiente",
      lowercase: true,
      trim: true,
    },
    direccionEntrega: { type: String, default: "", trim: true },
    telefonoContacto: { type: String, default: "", trim: true },
    stripeSessionId: { type: String, default: null, index: true },
    stripePaymentIntentId: { type: String, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const Donacion = model("Donacion", donacionSchema, "donaciones");
export default Donacion;
