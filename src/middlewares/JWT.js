import jwt from "jsonwebtoken";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";

const JWT_SECRET = process.env.JWT_SECRET || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

export const crearTokenJWT = (id, rol = "donante") => {
  return jwt.sign({ id, rol }, JWT_SECRET, { expiresIn: "4h" });
};

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.replace("Bearer ", "") : null;

    if (!token) {
      return res.status(401).json({ msg: "Token requerido" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded?.rol || "").toLowerCase();
    let model = Donante;
    if (role === "admin") model = Admin;
    if (role === "recolector") model = Recolector;
    const user = await model.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ msg: "Usuario no autorizado" });
    }
    if (user.status === false) {
      return res.status(403).json({ msg: "Usuario inactivo" });
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
