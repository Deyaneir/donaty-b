import { Schema, model } from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const donanteSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    apellido: { type: String, required: true, trim: true },
    direccion: { type: String, default: "", trim: true },
    telefono: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String, default: null, index: true },
    password: { type: String, required: true, select: false },
    rol: {
      type: String,
      enum: ["donante"],
      default: "donante",
      lowercase: true,
      trim: true
    },
    perfilCompleto: { type: Boolean, default: true },
    status: { type: Boolean, default: true },
    confirmEmail: { type: Boolean, default: false },
    token: { type: String, default: null },
    // Solo se usa en la recuperación de contraseña desde la app móvil.
    tokenExpires: { type: Date, default: null }
  },
  { timestamps: true }
);

donanteSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Evita re-hashear si ya viene encriptado
  if (typeof this.password === "string" && this.password.startsWith("$2b$")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

donanteSchema.methods.encryptPassword = async function (password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

donanteSchema.methods.matchPassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

donanteSchema.methods.createToken = function () {
  const tokenGenerado = crypto.randomBytes(16).toString("hex");
  this.token = tokenGenerado;
  return tokenGenerado;
};

donanteSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.token;
  delete obj.tokenExpires;
  return obj;
};

const Donante = model("Donante", donanteSchema);
export default Donante;