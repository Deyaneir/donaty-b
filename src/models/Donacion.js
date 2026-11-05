import { Schema, model } from "mongoose";

const donanteExternoSchema = new Schema(
  {
    nombre: {
      type: String,
      trim: true,
      default: "",
    },
    apellido: {
      type: String,
      trim: true,
      default: "",
    },
    telefono: {
      type: String,
      trim: true,
      default: "",
    },
    latitud: { type: Number, min: -90, max: 90, default: null },
    longitud: { type: Number, min: -180, max: 180, default: null },
    direccion: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const campoSnapshotSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    required: { type: Boolean, default: false },
    options: [{ value: String, label: String }],
    min: { type: Schema.Types.Mixed, default: null },
    max: { type: Schema.Types.Mixed, default: null },
    unit: { type: String, default: "" },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const historialEstadoSchema = new Schema(
  {
    estado: { type: String, required: true },
    responsable: { type: Schema.Types.ObjectId, default: null },
    rolResponsable: { type: String, default: "" },
    fecha: { type: Date, required: true, default: Date.now },
    observaciones: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const historialRecolectorSchema = new Schema(
  {
    recolectorAnterior: { type: Schema.Types.ObjectId, ref: "Recolector", default: null },
    recolectorNuevo: { type: Schema.Types.ObjectId, ref: "Recolector", default: null },
    puntoRecoleccionAnterior: { type: Schema.Types.ObjectId, default: null },
    puntoRecoleccionNuevo: { type: Schema.Types.ObjectId, default: null },
    administrador: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    fecha: { type: Date, required: true, default: Date.now },
    motivo: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: false }
);

const evidenciaSchema = new Schema(
  {
    etapa: { type: String, enum: ["recepcion", "finalizacion", "devolucion"], required: true },
    recolector: { type: Schema.Types.ObjectId, ref: "Recolector", required: true },
    fecha: { type: Date, required: true, default: Date.now },
    imagenUrl: { type: String, required: true },
    imagenPublicId: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
  },
  { _id: false }
);

const ubicacionRecoleccionSchema = new Schema(
  {
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
    source: { type: String, enum: ["gps_real", "simulated", "map"], required: true },
    isSimulated: { type: Boolean, required: true },
    buildingId: { type: Number, min: 1, default: null },
    buildingName: { type: String, default: "", trim: true, maxlength: 160 },
  },
  { _id: false }
);

const donacionSchema = new Schema(
  {
    // ID de la cuenta del donante, si tiene una.
    donante: {
      type: Schema.Types.ObjectId,
      ref: "Donante",
      default: null,
      index: true,
    },

    // Datos de la persona que todavía no tiene cuenta.
    donanteExterno: {
      type: donanteExternoSchema,
      default: null,
    },
    nombreDonante: {
      type: String,
      default: "",
      trim: true,
      maxlength: 241,
    },

    // Recolector asignado para recoger la donación.
    recolector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      default: null,
    },

    // Recolector que registró la donación en el sistema.
    registradoPorRecolector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      default: null,
      index: true,
    },

    campana: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      default: null,
      index: true,
    },
    puntoRecoleccionRef: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    fechaAsignacion: {
      type: Date,
      default: null,
    },

    tipo: {
      type: String,
      enum: ["fisica"],
      default: "fisica",
      required: true,
      lowercase: true,
      trim: true,
    },

    categoria: {
      type: String,
      default: "",
      trim: true,
    },

    categoriaRef: {
      type: Schema.Types.ObjectId,
      ref: "Categoria",
      default: null,
      index: true,
    },

    nombreBien: {
      type: String,
      default: "",
      trim: true,
      maxlength: 255,
    },

    subcategoria: {
      type: String,
      default: "",
      trim: true,
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

    descripcion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    estado: {
      type: String,
      enum: [
        "pendiente",
        "asignada",
        "pendiente_recoleccion",
        "recolectada",
        "clasificada",
        "en_entrega",
        "entregada",
        "cancelada",
        "devolucion",
        "devuelta",
      ],
      default: "pendiente",
      lowercase: true,
      trim: true,
      index: true,
    },

    motivoDevolucion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },

    direccionEntrega: {
      type: String,
      default: "",
      trim: true,
    },
    metodoEntrega: {
      type: String,
      enum: ["punto_recoleccion", "domicilio"],
      default: "domicilio",
    },
    referenciasEntrega: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    fechaRegistro: {
      type: Date,
      default: null,
    },

    puntoRecoleccion: {
      latitud: { type: Number, min: -90, max: 90, default: null },
      longitud: { type: Number, min: -180, max: 180, default: null },
    },
    ubicacionRecoleccion: {
      type: ubicacionRecoleccionSchema,
      default: null,
    },

    telefonoContacto: {
      type: String,
      default: "",
      trim: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    camposSnapshot: {
      type: [campoSnapshotSchema],
      default: [],
    },
    historialEstados: { type: [historialEstadoSchema], default: [] },
    historialRecolectores: { type: [historialRecolectorSchema], default: [] },
    evidencias: { type: [evidenciaSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

// Evita registros sin donante registrado ni datos de una persona externa.
donacionSchema.pre("validate", function (next) {
  if (!this.donante && !this.donanteExterno) {
    return next(
      new Error("La donación debe tener un donante registrado o externo")
    );
  }

  if (this.donante && this.donanteExterno) {
    return next(
      new Error("No se deben mezclar un donante registrado y uno externo")
    );
  }

  if (
    this.donanteExterno &&
    (!this.donanteExterno.nombre || !this.donanteExterno.apellido)
  ) {
    return next(
      new Error("El nombre y apellido del donante externo son obligatorios")
    );
  }

  next();
});

donacionSchema.index({ campana: 1, categoriaRef: 1, createdAt: -1 });

const Donacion = model("Donacion", donacionSchema, "donaciones");

export default Donacion;