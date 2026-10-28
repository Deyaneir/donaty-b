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

    puntoRecoleccion: {
      latitud: { type: Number, min: -90, max: 90, default: null },
      longitud: { type: Number, min: -180, max: 180, default: null },
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