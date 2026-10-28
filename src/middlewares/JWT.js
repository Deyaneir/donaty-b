import jwt from "jsonwebtoken";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";

const JWT_SECRET = process.env.JWT_SECRET || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}-refresh`;
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_EXPIRES_IN || "4h";
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN || "3650d";

export const crearTokenJWT = (id, rol = "donante", expiresIn = ACCESS_TOKEN_TTL) => {
  return jwt.sign({ id, rol, type: "access" }, JWT_SECRET, { expiresIn });
};

export const crearRefreshToken = (
  id,
  rol = "donante",
  expiresIn = REFRESH_TOKEN_TTL
) => {
  return jwt.sign({ id, rol, type: "refresh" }, JWT_REFRESH_SECRET, { expiresIn });
};

export const verificarRefreshToken = (token) => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
  if (decoded?.type !== "refresh") {
    throw new Error("El token no es un refresh token");
  }
  return decoded;
};

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.replace("Bearer ", "") : null;

    if (!token) {
      return res.status(401).json({ msg: "Token requerido" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.type && decoded.type !== "access") {
      return res.status(401).json({ msg: "Token inválido" });
    }

    const role = String(decoded?.rol || "").toLowerCase();
    let model = Donante;
    if (role === "admin") model = Admin;
    if (role === "recolector") model = Recolector;
    const user = await model.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ msg: "Usuario no autorizado" });
    }
    if (user.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }

    req.donanteHeader = user;
    req.user = user;
    return next();
  } catch (error) {
    console.error("authMiddleware error", error.message);
    return res.status(401).json({ msg: "Token inválido" });
  }
};

export default authMiddleware;
