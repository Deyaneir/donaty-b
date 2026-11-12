import { Schema, model } from "mongoose";

const responsableSnapshotSchema = new Schema(
  {
    responsableCampanaRef: { type: Schema.Types.ObjectId, required: true },
    nombreCompleto: { type: String, required: true, trim: true, maxlength: 160 },
    cargo: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const evidenciaSchema = new Schema(
  {
    imagenUrl: { type: String, required: true },
    imagenPublicId: { type: String, required: true },
    fecha: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const productoEntregadoSchema = new Schema(
  {
    donacionId: { type: Schema.Types.ObjectId, ref: "Donacion", required: true },
    clasificacionId: { type: Schema.Types.ObjectId, ref: "Clasificacion", default: null },
    clasificacionNombre: { type: String, default: "", trim: true, maxlength: 160 },
    puntoRecoleccionRef: { type: Schema.Types.ObjectId, default: null },
    puntoRecoleccionNombre: { type: String, default: "", trim: true, maxlength: 120 },
    categoria: { type: String, default: "", trim: true, maxlength: 160 },
    subcategoria: { type: String, default: "", trim: true, maxlength: 160 },
    nombreBien: { type: String, required: true, trim: true, maxlength: 255 },
    cantidad: { type: Number, min: 0, default: null },
    donacionesSinCantidad: { type: Number, min: 0, default: 0 },
    donaciones: [{ type: Schema.Types.ObjectId, ref: "Donacion" }],
  },
  { _id: false }
);

const clasificacionEntregadaSchema = new Schema(
  {
    clasificacionId: {
      type: Schema.Types.ObjectId,
      ref: "Clasificacion",
      default: null,
    },
    nombre: { type: String, required: true, trim: true, maxlength: 160 },
    cantidadTotal: { type: Number, min: 0, required: true },
    donacionesSinCantidad: { type: Number, min: 0, default: 0 },
    totalDonaciones: { type: Number, min: 0, required: true },
  },
  { _id: false }
);

const donationTraceSchema = new Schema(
  {
    donacion: { type: Schema.Types.ObjectId, ref: "Donacion", required: true },
    clasificacionId: { type: Schema.Types.ObjectId, ref: "Clasificacion", default: null },
    recolectorAsignado: { type: Schema.Types.ObjectId, ref: "Recolector", default: null },
    puntoRecoleccionRef: { type: Schema.Types.ObjectId, default: null },
    estado: { type: String, required: true },
  },
  { _id: false }
);

const entregaCampanaSchema = new Schema(
  {
    campana: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      required: true,
      unique: true,
      index: true,
    },
    puntoRecoleccionRef: { type: Schema.Types.ObjectId, default: null },
    recolectorPrincipal: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      required: true,
    },
    recolectorPrincipalNombre: { type: String, default: "", trim: true, maxlength: 120 },
    recolectorPrincipalApellido: { type: String, default: "", trim: true, maxlength: 120 },
    receptor: { type: String, required: true, trim: true, maxlength: 180 },
    nombresReceptor: { type: String, default: "", trim: true, maxlength: 120 },
    apellidosReceptor: { type: String, default: "", trim: true, maxlength: 120 },
    recibeIdentificacion: { type: String, default: "", trim: true, maxlength: 40 },
    recibeInstitucion: { type: String, default: "", trim: true, maxlength: 180 },
    telefonoReceptor: { type: String, default: "", trim: true, maxlength: 20 },
    cargoReceptor: { type: String, default: "", trim: true, maxlength: 120 },
    observacion: { type: String, default: "", trim: true, maxlength: 2000 },
    descripcionBienes: { type: String, default: "", trim: true, maxlength: 10000 },
    fechaEntrega: { type: Date, required: true },
    responsablesCampana: { type: [responsableSnapshotSchema], default: [] },
    productos: { type: [productoEntregadoSchema], required: true },
    clasificaciones: { type: [clasificacionEntregadaSchema], default: [] },
    donaciones: { type: [donationTraceSchema], required: true },
    evidencias: { type: [evidenciaSchema], default: [] },
    estado: {
      type: String,
      enum: ["registrada"],
      default: "registrada",
      required: true,
    },
  },
  { timestamps: true, collection: "entregas_campana" }
);

const EntregaCampana = model("EntregaCampana", entregaCampanaSchema);

export default EntregaCampana;
