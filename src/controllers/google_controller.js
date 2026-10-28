import passport from "passport";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import { crearTokenJWT, crearRefreshToken } from "../middlewares/JWT.js";

const googleClient = new OAuth2Client();

// IDs de cliente aceptados al verificar el token de la app móvil.
// En Android el token sale con el Web client ID (serverClientId).
const getAllowedAudiences = () => {
  const ids = [
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID,
    ...String(process.env.GOOGLE_MOBILE_CLIENT_IDS || "").split(","),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
};

const buildPayload = (user) => ({
  token: crearTokenJWT(user._id, user.rol),
  refreshToken: crearRefreshToken(user._id, user.rol),
  rol: user.rol,
  nombre: user.nombre,
  apellido: user.apellido,
  direccion: user.direccion,
  telefono: user.telefono,
  perfilCompleto: Boolean(
    (user.nombre || "").trim() &&
    (user.apellido || "").trim() &&
    (user.direccion || "").trim() &&
    (user.telefono || "").trim()
  ),
  _id: user._id,
  correo: user.email,
});

const verifyGoogleIdentity = async (idToken, audiences) => {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: audiences,
  });
  const payload = ticket.getPayload();
  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)
  ) {
    throw new Error("Token de Google inválido");
  }
  return payload;
};

const findOrCreateGoogleDonante = async ({ googleId, email, nombre, apellido }) => {
  const [adminExistente, recolectorExistente] = await Promise.all([
    Admin.findOne({ email }),
    Recolector.findOne({ email }),
  ]);
  if (adminExistente || recolectorExistente) {
    const error = new Error("El email ya está registrado en otro rol");
    error.statusCode = 409;
    throw error;
  }

  let user = await Donante.findOne({
    $or: [{ googleId }, { email }],
  });

  if (!user) {
    const randomPassword = crypto.randomBytes(16).toString("hex");
    user = new Donante({
      nombre: nombre || "Usuario",
      apellido: apellido || "Google",
      direccion: "",
      telefono: "",
      email,
      password: randomPassword,
      rol: "donante",
      perfilCompleto: false,
      status: true,
      confirmEmail: true,
      googleId,
    });
    user.password = await user.encryptPassword(randomPassword);
    await user.save();
    return user;
  }

  let changed = false;
  if (!user.googleId) {
    user.googleId = googleId;
    changed = true;
  }
  if (!user.confirmEmail) {
    user.confirmEmail = true;
    changed = true;
  }
  const perfilCompleto = Boolean(
    (user.nombre || "").trim() &&
    (user.apellido || "").trim() &&
    (user.direccion || "").trim() &&
    (user.telefono || "").trim()
  );
  if (user.perfilCompleto !== perfilCompleto) {
    user.perfilCompleto = perfilCompleto;
    changed = true;
  }
  if (changed) await user.save();
  return user;
};

const googleCallback = (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err || !user) {
      const msg = info?.message || "No autorizado";
      return res.status(401).json({ msg });
    }
    if (user.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }

    const payload = buildPayload(user);

    const redirect = process.env.GOOGLE_SUCCESS_REDIRECT;
    if (redirect) {
      const url = new URL(redirect);
      url.searchParams.set("token", payload.token);
      url.searchParams.set("rol", user.rol);
      return res.redirect(url.toString());
    }

    if (!payload.perfilCompleto) {
      return res.status(200).json({
        ...payload,
        msg: "Completa tu perfil (nombre, apellido, dirección y teléfono)",
      });
    }

    return res.status(200).json(payload);
  })(req, res, next);
};

const googleMobileLogin = async (req, res) => {
  try {
    const audiences = getAllowedAudiences();
    const idToken = String(req.body?.idToken || "").trim();
    if (audiences.length === 0) {
      return res.status(503).json({ msg: "Google OAuth móvil no configurado" });
    }
    if (!idToken) {
      return res.status(400).json({ msg: "Debes enviar idToken" });
    }

        let payload;
    try {
          payload = await verifyGoogleIdentity(idToken, audiences);
    } catch (error) {
      console.error(
        "[Google OAuth] Error verificando ID token:",
        error.message
      );

      console.error(
        "[Google OAuth] Audiences configuradas:",
        audiences
      );

      return res.status(401).json({
        msg: "No se pudo validar el token de Google",
      });
    }
    const user = await findOrCreateGoogleDonante({
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      nombre: payload.given_name,
      apellido: payload.family_name,
    });
    if (user.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }
    const response = buildPayload(user);
    if (!response.perfilCompleto) {
      response.msg = "Completa tu perfil (nombre, apellido, dirección y teléfono)";
    }
    return res.status(200).json(response);
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ msg: error.message });
    }
    console.error(error);
    return res.status(500).json({ msg: "Error validando el inicio de sesión con Google" });
  }
};

const googleAdminMobileLogin = async (req, res) => {
  const audiences = getAllowedAudiences();
  const idToken = String(req.body?.idToken || "").trim();
  if (audiences.length === 0) {
    return res.status(503).json({ msg: "Google OAuth móvil no configurado" });
  }
  if (!idToken) {
    return res.status(400).json({ msg: "Debes enviar idToken" });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleIdentity(idToken, audiences);
  } catch (error) {
    console.error("[Google Admin] Error verificando ID token:", error.message);
    return res.status(401).json({ msg: "No se pudo validar el token de Google" });
  }

  try {
    const admin = await Admin.findOne({
      email: String(googleUser.email).trim().toLowerCase(),
    });
    if (!admin) {
      return res.status(403).json({ msg: "Esta cuenta de Google no es administradora" });
    }
    if (admin.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }
    if (!admin.confirmEmail) {
      return res.status(403).json({
        msg: "Debes verificar tu cuenta antes de iniciar sesión",
      });
    }

    return res.status(200).json(buildPayload(admin));
  } catch (error) {
    console.error("[Google Admin] Error iniciando sesión:", error);
    return res.status(500).json({ msg: "Error validando el inicio de sesión con Google" });
  }
};

const googleRecolectorMobileLogin = async (req, res) => {
  const audiences = getAllowedAudiences();
  const idToken = String(req.body?.idToken || "").trim();
  if (audiences.length === 0) {
    return res.status(503).json({ msg: "Google OAuth móvil no configurado" });
  }
  if (!idToken) {
    return res.status(400).json({ msg: "Debes enviar idToken" });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleIdentity(idToken, audiences);
  } catch (error) {
    console.error("[Google Recolector] Error verificando ID token:", error.message);
    return res.status(401).json({ msg: "No se pudo validar el token de Google" });
  }

  try {
    const recolector = await Recolector.findOne({
      email: String(googleUser.email).trim().toLowerCase(),
    });
    if (!recolector) {
      return res.status(403).json({
        msg: "No existe una cuenta de recolector asociada a este correo",
      });
    }
    if (recolector.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }
    if (!recolector.confirmEmail) {
      return res.status(403).json({
        msg: "Debes verificar tu cuenta antes de iniciar sesión",
      });
    }
    if (recolector.aprobado === false) {
      return res.status(403).json({
        msg: "Tu cuenta está pendiente de aprobación del administrador",
        aprobado: false,
      });
    }

    return res.status(200).json(buildPayload(recolector));
  } catch (error) {
    console.error("[Google Recolector] Error iniciando sesión:", error);
    return res.status(500).json({
      msg: "Error validando el inicio de sesión con Google",
    });
  }
};

export {
  googleCallback,
  googleMobileLogin,
  googleAdminMobileLogin,
  googleRecolectorMobileLogin,
};