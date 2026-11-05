import { Schema, model } from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const recolectorSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    apellido: { type: String, required: true, trim: true },
    direccion: { type: String, default: "", trim: true },
    telefono: { type: String, default: "", trim: true },
    ciudad: { type: String, default: "", trim: true },
    sector: { type: String, default: "", trim: true },
    fechaNacimiento: { type: Date, default: null },
    universidad: { type: String, default: "", trim: true },
    carrera: { type: String, default: "", trim: true },
    semestre: { type: String, default: "", trim: true },
    perteneceAsociacion: { type: Boolean, default: null },
    asociacionEstudiantil: { type: String, default: "", trim: true },
    cargoAsociacion: { type: String, default: "", trim: true },
    aceptaTerminos: { type: Boolean, default: false },
    aceptaPrivacidad: { type: Boolean, default: false },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String, default: null, index: true },
    password: { type: String, required: true, select: false },
    rol: { type: String, enum: ["recolector"], default: "recolector", lowercase: true, trim: true },
    rolMigradoA: {
      type: String,
      enum: ["donante", "recolector"],
      default: null,
      index: true,
    },
    status: { type: Boolean, default: true },
    confirmEmail: { type: Boolean, default: false },
    // Aprobación del administrador. Default true para no bloquear a los
    // recolectores que ya existían; los registros nuevos se crean en false.
    aprobado: { type: Boolean, default: true },
    token: { type: String, default: null },
    tokenExpires: { type: Date, default: null },
    ubicacionGps: {
      campana: { type: Schema.Types.ObjectId, ref: "Campana", default: null },
      puntoRecoleccion: { type: Schema.Types.ObjectId, default: null },
      latitud: { type: Number, min: -90, max: 90, default: null },
      longitud: { type: Number, min: -180, max: 180, default: null },
      precisionMetros: { type: Number, min: 0, default: null },
      capturadoEn: { type: Date, default: null },
      estadoGeografico: {
        type: String,
        enum: ["dentro", "fuera"],
        default: null,
      },
      actualizadoEn: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

recolectorSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  if (typeof this.password === "string" && this.password.startsWith("$2b$")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

recolectorSchema.methods.encryptPassword = async function (password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

recolectorSchema.methods.matchPassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

recolectorSchema.methods.createToken = function () {
  const tokenGenerado = crypto.randomBytes(16).toString("hex");
  this.token = tokenGenerado;
  return tokenGenerado;
};

recolectorSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.token;
  delete obj.tokenExpires;
  delete obj.ubicacionGps;
  delete obj.googleId;
  return obj;
};

const Recolector = model("Recolector", recolectorSchema, "recolectores");
export default Recolector;