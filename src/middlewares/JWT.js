import jwt from "jsonwebtoken";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";

const JWT_SECRET = process.env.JWT_SECRET || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}-refresh`;
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_EXPIRES_IN || "4h";
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN || "3650d";

const authFailure = (req, res, status, message, code, extra = {}) => {
  const operationId = String(
    req.get?.("Idempotency-Key")
    || req.body?.operationId
    || req.body?.idempotencyKey
    || ""
  ).trim();
  return res.status(status).json({
    msg: message,
    code,
    ...(operationId
      ? {
          operationId,
          codigo: code,
          sincronizacion: {
            operationId,
            estado: code === "TOKEN_EXPIRED"
              ? "authentication_required"
              : status === 403
                ? "permission_denied"
                : "authentication_required",
            createdAtLocal: req.body?.createdAtLocal ?? req.body?.localCreatedAt ?? null,
            receivedAt: new Date().toISOString(),
            processedAt: null,
          },
        }
      : {}),
    ...extra,
  });
};

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
      return authFailure(req, res, 401, "Token requerido", "AUTHENTICATION_REQUIRED");
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.type && decoded.type !== "access") {
      return authFailure(req, res, 401, "Token inválido", "INVALID_TOKEN");
    }

    const role = String(decoded?.rol || "").toLowerCase();
    const modelByRole = {
      admin: Admin,
      donante: Donante,
      recolector: Recolector,
    };
    const model = modelByRole[role];
    if (!model || !decoded?.id) {
      return authFailure(req, res, 401, "Token inválido", "INVALID_TOKEN");
    }
    const user = await model.findById(decoded.id);
    if (!user || String(user.rol || "").toLowerCase() !== role) {
      return authFailure(req, res, 401, "Usuario no autorizado", "USER_NOT_AUTHORIZED");
    }
    if (user.status === false) {
      return authFailure(
        req,
        res,
        403,
        "Cuenta desactivada",
        "ACCOUNT_DISABLED",
        { activo: false }
      );
    }

    req.donanteHeader = user;
    req.user = user;
    return next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return authFailure(
        req,
        res,
        401,
        "El token de acceso expiró; renueva la sesión antes de sincronizar",
        "TOKEN_EXPIRED"
      );
    }
    console.error("authMiddleware error", error.message);
    return authFailure(req, res, 401, "Token inválido", "INVALID_TOKEN");
  }
};

export const authOpcional = (req, res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  return authMiddleware(req, res, next);
};

export default authMiddleware;
