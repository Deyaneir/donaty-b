import { Schema, model } from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const adminSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    apellido: { type: String, required: true, trim: true },
    direccion: { type: String, default: "", trim: true },
    telefono: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    rol: { type: String, enum: ["admin"], default: "admin", lowercase: true, trim: true },
    status: { type: Boolean, default: true },
    confirmEmail: { type: Boolean, default: false },
    token: { type: String, default: null }
  },
  { timestamps: true }
);

adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  if (typeof this.password === "string" && this.password.startsWith("$2b$")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

adminSchema.methods.encryptPassword = async function (password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

adminSchema.methods.matchPassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

adminSchema.methods.createToken = function () {
  const tokenGenerado = crypto.randomBytes(16).toString("hex");
  this.token = tokenGenerado;
  return tokenGenerado;
};

adminSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.token;
  return obj;
};

const Admin = model("Admin", adminSchema);
export default Admin;
