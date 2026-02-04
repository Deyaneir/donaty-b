import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import {
  sendMailToRecoveryPassword,
  sendMailToRegister,
} from "../helpers/sendMail.js";
import { crearTokenJWT } from "../middlewares/JWT.js";
import { isBlank, requireFields } from "../utils/validation.js";

const isValidToken = (token = "") =>
  typeof token === "string" && token.trim().length === 32;
const isEpnEmail = (email = "") =>
  String(email).trim().toLowerCase().endsWith("@epn.edu.ec");

const registro = async (req, res) => {
  try {
    const { nombre, apellido, direccion, telefono, email, password } = req.body || {};
    const faltantes = requireFields(req.body, [
      "nombre",
      "apellido",
      "direccion",
      "telefono",
      "email",
      "password"
    ]);
    if (faltantes.length > 0) {
      return res
        .status(400)
        .json({ msg: "Lo sentimos, debes llenar todos los campos" });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    if (isEpnEmail(normalizedEmail)) {
      return res.status(400).json({
        msg: "Los correos @epn.edu.ec deben registrarse como administrador",
      });
    }
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

    const nuevoDonante = new Donante({
      nombre,
      apellido,
      direccion: direccion ?? "",
      telefono: telefono ?? "",
      email: normalizedEmail,
      rol: "donante",
      perfilCompleto: true,
      status: true,
      confirmEmail: false
    });
    nuevoDonante.password = await nuevoDonante.encryptPassword(password);

    // 🔹 GENERAR Y GUARDAR TOKEN DE CONFIRMACIÓN
    const token = nuevoDonante.createToken();
    nuevoDonante.token = token;
    nuevoDonante.confirmEmail = false;

    await sendMailToRegister(normalizedEmail, token);
    await nuevoDonante.save();

    res
      .status(200)
      .json({ msg: "Revisa tu correo electrónico para confirmar tu cuenta" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const confirmarMail = async (req, res) => {
  try {
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }

    let user = await Donante.findOne({ token, confirmEmail: false });
    if (!user) {
      user = await Admin.findOne({ token, confirmEmail: false });
    }
    if (!user) {
      user = await Recolector.findOne({ token, confirmEmail: false });
    }

    if (!user)
      return res
        .status(404)
        .json({ msg: "Token inválido o cuenta ya confirmada" });

    user.token = null;
    user.confirmEmail = true;

    await user.save();

    res
      .status(200)
      .json({ msg: "Cuenta confirmada, ya puedes iniciar sesión" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const recuperarPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (isBlank(email))
      return res
        .status(400)
        .json({ msg: "Debes ingresar un correo electrónico" });

    const normalizedEmail = email.trim().toLowerCase();
    const donante = await Donante.findOne({ email: normalizedEmail });
    if (!donante)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });

    const token = donante.createToken();
    donante.token = token;
    await sendMailToRecoveryPassword(normalizedEmail, token);
    await donante.save();
    res.status(200).json({
      msg: "Revisa tu correo electrónico para reestablecer tu cuenta",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const comprobarTokenPasword = async (req, res) => {
  try {
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }
    const donante = await Donante.findOne({ token });
    if (!donante || donante.token !== token) {
      return res
        .status(404)
        .json({ msg: "Lo sentimos, no se puede validar la cuenta" });
    }
    res
      .status(200)
      .json({ msg: "Token confirmado, ya puedes crear tu nuevo password" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

/* 🔹🔹 AQUÍ ESTÁ LA FUNCIÓN IMPORTANTE 🔹🔹 */
const crearNuevoPassword = async (req, res) => {
  try {
    const { token } = req.params;

    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }

    // Aceptamos varios nombres por si el front cambia:
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

    const donante = await Donante.findOne({ token });
    if (!donante) {
      return res
        .status(404)
        .json({ msg: "No se puede validar la cuenta" });
    }

    donante.token = null;
    donante.password = await donante.encryptPassword(password);
    await donante.save();

    res.status(200).json({
      msg: "Felicitaciones, ya puedes iniciar sesión con tu nuevo password",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const faltantes = requireFields(req.body, ["email", "password"]);
    if (faltantes.length > 0) {
      return res
        .status(404)
        .json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const donante = await Donante.findOne({ email: normalizedEmail }).select(
      "-__v -token -updatedAt -createdAt +password"
    );
    if (!donante)
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });
    if (donante.status === false)
      return res.status(403).json({ msg: "Cuenta desactivada" });
    if (!donante.confirmEmail)
      return res
        .status(403)
        .json({ msg: "Debes verificar tu cuenta antes de iniciar sesión" });

    const verificarPassword = await donante.matchPassword(password);
    if (!verificarPassword)
      return res.status(401).json({ msg: "El password no es correcto" });

    const {
      nombre,
      email: correo,
      apellido,
      direccion,
      telefono,
      _id,
      rol,
      perfilCompleto,
    } = donante;
    const token = crearTokenJWT(donante._id, donante.rol);

    res.status(200).json({
      token,
      rol,
      nombre,
      apellido,
      direccion,
      telefono,
      perfilCompleto,
      _id,
      correo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const perfil = (req, res) => {
  const { token, confirmEmail, createdAt, updatedAt, __v, ...datosPerfil } =
    req.donanteHeader.toJSON();
  res.status(200).json(datosPerfil);
};

const actualizarPerfil = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, direccion, telefono, email } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ msg: `ID inválido: ${id}` });

    const donante = await Donante.findById(id).select("+password");
    if (!donante)
      return res
        .status(404)
        .json({ msg: `No existe el donante con ID ${id}` });

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
    if (normalizedEmail && donante.email !== normalizedEmail) {
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
      donante.email = normalizedEmail;
    }

    if (nombre !== undefined) donante.nombre = nombre;
    if (apellido !== undefined) donante.apellido = apellido;
    if (direccion !== undefined) donante.direccion = direccion;
    if (telefono !== undefined) donante.telefono = telefono;
    donante.perfilCompleto = Boolean(
      (donante.nombre || "").trim() &&
      (donante.apellido || "").trim() &&
      (donante.direccion || "").trim() &&
      (donante.telefono || "").trim()
    );
    await donante.save();

    res.status(200).json(donante.toJSON());
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarPassword = async (req, res) => {
  try {
    const donante = await Donante.findById(
      req.donanteHeader._id
    ).select("+password");
    if (!donante)
      return res.status(404).json({
        msg: `Lo sentimos, no existe el donante ${req.donanteHeader._id}`,
      });

    const faltantes = requireFields(req.body, ["passwordactual", "passwordnuevo"]);
    if (faltantes.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const verificarPassword = await donante.matchPassword(
      req.body?.passwordactual
    );
    if (!verificarPassword)
      return res.status(404).json({
        msg: "Lo sentimos, el password actual no es el correcto",
      });

    donante.password = await donante.encryptPassword(
      req.body?.passwordnuevo
    );
    await donante.save();

    res.status(200).json({ msg: "Password actualizado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

export {
  registro,
  confirmarMail,
  recuperarPassword,
  comprobarTokenPasword,
  crearNuevoPassword,
  login,
  perfil,
  actualizarPerfil,
  actualizarPassword,
};
