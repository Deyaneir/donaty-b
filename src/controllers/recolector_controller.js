import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import {
  sendMailToRecoveryPassword,
  sendMailToRecoveryPasswordMobile,
  sendMailToRegister,
  sendMailToRegisterMobile,
} from "../helpers/sendMail.js";
import {
  crearTokenJWT,
  crearRefreshToken,
  verificarRefreshToken,
} from "../middlewares/JWT.js";
import { isBlank, requireFields } from "../utils/validation.js";

const RECOVERY_TOKEN_MINUTES = 60;

const isValidToken = (token = "") =>
  typeof token === "string" && token.trim().length === 32;
const isTokenExpired = (doc) =>
  Boolean(doc?.tokenExpires && doc.tokenExpires < new Date());

const registroRecolector = async (req, res) => {
  try {
    const { nombre, apellido, direccion, telefono, email, password, origen } =
      req.body || {};
    const esMovil = origen === "movil";
    console.log("[registroRecolector] origen recibido:", origen);

    const faltantes = requireFields(req.body, [
      "nombre",
      "apellido",
      "direccion",
      "telefono",
      "email",
      "password",
    ]);
    if (faltantes.length > 0) {
      return res
        .status(400)
        .json({ msg: "Lo sentimos, debes llenar todos los campos" });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const [verificarEmailBDD, verificarEmailAdmin, verificarEmailRecolector] = await Promise.all([
      Donante.findOne({ email: normalizedEmail }),
      Admin.findOne({ email: normalizedEmail }),
      Recolector.findOne({ email: normalizedEmail }),
    ]);
    if (verificarEmailBDD || verificarEmailAdmin || verificarEmailRecolector) {
      return res
        .status(400)
        .json({ msg: "Lo sentimos, el email ya se encuentra registrado" });
    }

    const nuevoRecolector = new Recolector({
      nombre,
      apellido,
      direccion: direccion ?? "",
      telefono: telefono ?? "",
      email: normalizedEmail,
      status: true,
      confirmEmail: false,
      aprobado: false, // pendiente de aprobación del administrador
    });
    nuevoRecolector.password = await nuevoRecolector.encryptPassword(password);

    const token = nuevoRecolector.createToken();
    nuevoRecolector.token = token;
    nuevoRecolector.confirmEmail = false;

    // Web: correo de siempre. App móvil: correo con botón que abre la app.
    const enviarCorreoRegistro = esMovil
      ? sendMailToRegisterMobile
      : sendMailToRegister;
    await enviarCorreoRegistro(normalizedEmail, token);
    await nuevoRecolector.save();

    res
      .status(200)
      .json({ msg: "Revisa tu correo electrónico para confirmar tu cuenta" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const recuperarPasswordRecolector = async (req, res) => {
  try {
    const { email, origen } = req.body || {};
    const esMovil = origen === "movil";
    if (isBlank(email))
      return res
        .status(400)
        .json({ msg: "Debes ingresar un correo electrónico" });

    const normalizedEmail = email.trim().toLowerCase();
    const recolector = await Recolector.findOne({
      email: normalizedEmail,
    });
    if (!recolector)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });

    const token = recolector.createToken();
    recolector.token = token;
    // Solo el flujo móvil expira. En la web se limpia para no heredar una fecha vieja.
    recolector.tokenExpires = esMovil
      ? new Date(Date.now() + RECOVERY_TOKEN_MINUTES * 60 * 1000)
      : null;

    const enviarCorreoRecuperacion = esMovil
      ? sendMailToRecoveryPasswordMobile
      : sendMailToRecoveryPassword;
    await enviarCorreoRecuperacion(normalizedEmail, token);
    await recolector.save();
    res.status(200).json({
      msg: "Revisa tu correo electrónico para reestablecer tu cuenta",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const comprobarTokenPasswordRecolector = async (req, res) => {
  try {
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }
    const recolector = await Recolector.findOne({ token });
    if (!recolector || recolector.token !== token) {
      return res
        .status(404)
        .json({ msg: "Lo sentimos, no se puede validar la cuenta" });
    }
    if (isTokenExpired(recolector)) {
      return res.status(410).json({
        msg: "El enlace para restablecer la contraseña expiró. Solicita uno nuevo",
      });
    }
    res
      .status(200)
      .json({ msg: "Token confirmado, ya puedes crear tu nuevo password" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const crearNuevoPasswordRecolector = async (req, res) => {
  try {
    const { token } = req.params;

    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }

    const {
      password,
      confirmpassword,
      confirmPassword,
      password2,
    } = req.body || {};

    const confirm =
      confirmpassword ?? confirmPassword ?? password2 ?? undefined;

    if (isBlank(password) || isBlank(confirm)) {
      return res
        .status(400)
        .json({ msg: "Debes llenar todos los campos" });
    }

    if (password !== confirm) {
      return res
        .status(400)
        .json({ msg: "Los passwords no coinciden" });
    }

    const recolector = await Recolector.findOne({ token });
    if (!recolector) {
      return res
        .status(404)
        .json({ msg: "No se puede validar la cuenta" });
    }
    if (isTokenExpired(recolector)) {
      return res.status(410).json({
        msg: "El enlace para restablecer la contraseña expiró. Solicita uno nuevo",
      });
    }

    recolector.token = null;
    recolector.tokenExpires = null;
    recolector.password = await recolector.encryptPassword(password);
    await recolector.save();

    res.status(200).json({
      msg: "Felicitaciones, ya puedes iniciar sesión con tu nuevo password",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const loginRecolector = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const faltantes = requireFields(req.body, ["email", "password"]);
    if (faltantes.length > 0) {
      return res
        .status(404)
        .json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const recolector = await Recolector.findOne({
      email: normalizedEmail,
    }).select("-__v -token -updatedAt -createdAt +password");
    if (!recolector)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });
    if (recolector.status === false)
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    if (!recolector.confirmEmail)
      return res
        .status(403)
        .json({ msg: "Debes verificar tu cuenta antes de iniciar sesión" });

    const verificarPassword = await recolector.matchPassword(password);
    if (!verificarPassword)
      return res.status(401).json({ msg: "El password no es correcto" });

    // Se revisa después de validar la contraseña, para no revelar el estado
    // de la cuenta a quien no tenga las credenciales.
    if (recolector.aprobado === false)
      return res.status(403).json({
        msg:
          "Tu cuenta está pendiente de aprobación del administrador. " +
          "Podrás iniciar sesión cuando sea aprobada.",
      });

    const {
      nombre,
      email: correo,
      apellido,
      direccion,
      telefono,
      _id,
      rol,
    } = recolector;
    const token = crearTokenJWT(recolector._id, recolector.rol);
    const refreshToken = crearRefreshToken(recolector._id, recolector.rol);

    res.status(200).json({
      token,
      refreshToken,
      rol,
      nombre,
      apellido,
      direccion,
      telefono,
      _id,
      correo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const refreshRecolectorSession = async (req, res) => {
  try {
    const rawToken = String(
      req.body?.refreshToken || req.headers?.authorization || ""
    ).trim();
    const refreshToken = rawToken.startsWith("Bearer ")
      ? rawToken.replace("Bearer ", "")
      : rawToken;

    if (!refreshToken) {
      return res.status(400).json({ msg: "Refresh token requerido" });
    }

    const decoded = verificarRefreshToken(refreshToken);
    const recolector = await Recolector.findById(decoded.id);
    if (!recolector) {
      return res.status(401).json({ msg: "Usuario no autorizado" });
    }
    if (recolector.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada", activo: false });
    }
    if (recolector.aprobado === false) {
      return res.status(403).json({
        msg: "Tu cuenta está pendiente de aprobación del administrador.",
      });
    }

    const token = crearTokenJWT(recolector._id, recolector.rol);
    const nextRefreshToken = crearRefreshToken(recolector._id, recolector.rol);

    return res.status(200).json({
      token,
      refreshToken: nextRefreshToken,
      rol: recolector.rol,
      _id: recolector._id,
      correo: recolector.email,
    });
  } catch (error) {
    console.error("refreshRecolectorSession error:", error.message);
    return res.status(401).json({ msg: "Refresh token inválido o expirado" });
  }
};

const perfilRecolector = (req, res) => {
  const { token, confirmEmail, createdAt, updatedAt, __v, ...datosPerfil } =
    req.donanteHeader.toJSON();
  res.status(200).json(datosPerfil);
};

const actualizarPerfilRecolector = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, direccion, telefono, email } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ msg: `ID inválido: ${id}` });

    const recolector = await Recolector.findById(id).select("+password");
    if (!recolector)
      return res
        .status(404)
        .json({ msg: `No existe el recolector con ID ${id}` });

    const payload = req.body || {};
    const allowedFields = ["nombre", "apellido", "direccion", "telefono", "email"];
    const providedFields = allowedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(payload, field)
    );
    if (providedFields.length === 0) {
      return res.status(400).json({ msg: "Debes enviar al menos un campo" });
    }
    const invalidFields = providedFields.filter((field) => isBlank(payload[field]));
    if (invalidFields.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;
    if (normalizedEmail && recolector.email !== normalizedEmail) {
      const [emailExistente, emailAdmin, emailRecolector] = await Promise.all([
        Donante.findOne({ email: normalizedEmail }),
        Admin.findOne({ email: normalizedEmail }),
        Recolector.findOne({ email: normalizedEmail }),
      ]);
      if (emailExistente || emailAdmin || emailRecolector) {
        return res
          .status(404)
          .json({ msg: "El email ya se encuentra registrado" });
      }
      recolector.email = normalizedEmail;
    }

    if (nombre !== undefined) recolector.nombre = nombre;
    if (apellido !== undefined) recolector.apellido = apellido;
    if (direccion !== undefined) recolector.direccion = direccion;
    if (telefono !== undefined) recolector.telefono = telefono;
    await recolector.save();

    res.status(200).json(recolector.toJSON());
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarPasswordRecolector = async (req, res) => {
  try {
    const recolector = await Recolector.findById(req.donanteHeader._id).select(
      "+password"
    );
    if (!recolector)
      return res.status(404).json({
        msg: `Lo sentimos, no existe el recolector ${req.donanteHeader._id}`,
      });

    const faltantes = requireFields(req.body, [
      "passwordactual",
      "passwordnuevo",
    ]);
    if (faltantes.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const verificarPassword = await recolector.matchPassword(
      req.body?.passwordactual
    );
    if (!verificarPassword)
      return res.status(404).json({
        msg: "Lo sentimos, el password actual no es el correcto",
      });

    recolector.password = await recolector.encryptPassword(
      req.body?.passwordnuevo
    );
    await recolector.save();

    res.status(200).json({ msg: "Password actualizado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

export {
  registroRecolector,
  recuperarPasswordRecolector,
  comprobarTokenPasswordRecolector,
  crearNuevoPasswordRecolector,
  loginRecolector,
  refreshRecolectorSession,
  perfilRecolector,
  actualizarPerfilRecolector,
  actualizarPasswordRecolector,
};