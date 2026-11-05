import { Schema, model } from "mongoose";

const puntoRecoleccionSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 120 },
    edificioId: { type: Number, min: 1, default: null },
    nombreEdificio: { type: String, default: "", trim: true, maxlength: 160 },
    edificio: { type: String, default: "", trim: true, maxlength: 120 },
    piso: { type: String, default: "", trim: true, maxlength: 40 },
    aula: { type: String, default: "", trim: true, maxlength: 80 },
    horariosAtencion: {
      type: [{
        diaSemana: { type: Number, min: 1, max: 7, required: true },
        horaInicio: { type: String, required: true },
        horaFin: { type: String, required: true },
      }],
      default: [],
    },
    descripcion: { type: String, default: "", trim: true, maxlength: 500 },
    estado: { type: String, enum: ["activo", "inactivo"], default: "activo" },
    claveUnica: { type: String, default: "", trim: true },
    direccion: { type: String, default: "", trim: true, maxlength: 500 },
    referenciasLugar: { type: String, default: "", trim: true, maxlength: 500 },
    telefonoContacto: { type: String, default: "", trim: true, maxlength: 30 },
    latitud: { type: Number, min: -90, max: 90, default: null },
    longitud: { type: Number, min: -180, max: 180, default: null },
    activo: { type: Boolean, default: true },
    recolectores: [{ type: Schema.Types.ObjectId, ref: "Recolector" }],
    responsableRecolector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      default: null,
    },
  },
  { timestamps: true }
);

const asignacionRecolectorSchema = new Schema(
  {
    recolector: { type: Schema.Types.ObjectId, ref: "Recolector", required: true },
    campana: { type: Schema.Types.ObjectId, ref: "Campana", required: true },
    puntoAnterior: { type: Schema.Types.ObjectId, default: null },
    puntoNuevo: { type: Schema.Types.ObjectId, default: null },
    administrador: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
    fecha: { type: Date, required: true, default: Date.now },
    motivo: { type: String, default: "", trim: true, maxlength: 500 },
    vigente: { type: Boolean, default: true },
  },
  { _id: true }
);

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
    ubicacion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
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
    horaInicio: {
      type: String,
      default: "",
      trim: true,
    },
    horaFin: {
      type: String,
      default: "",
      trim: true,
    },
    estado: {
      type: String,
      enum: ["borrador", "activa", "finalizada", "desactivada"],
      default: null,
      index: true,
    },
    activa: {
      type: Boolean,
      default: false,
      index: true,
    },
    numeroRecolectores: {
      type: Number,
      min: 0,
      default: 0,
    },
    metaDonaciones: {
      type: Number,
      min: 1,
      default: null,
    },
    assignmentVersion: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
    },
    categoriasPermitidas: {
      type: [{ type: Schema.Types.ObjectId, ref: "Categoria" }],
      default: [],
    },
    puntosRecoleccion: { type: [puntoRecoleccionSchema], default: [] },
    historialAsignacionesRecolectores: {
      type: [asignacionRecolectorSchema],
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