import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import { crearTokenJWT } from "../middlewares/JWT.js";
import { isBlank, requireFields } from "../utils/validation.js";
import { sendMailToRegister, sendMailToRecoveryPassword } from "../helpers/sendMail.js";

const ROLES = ["donante"];
const isEpnEmail = (email = "") =>
  String(email).trim().toLowerCase().endsWith("@epn.edu.ec");

const normalizeRole = (role = "") => String(role).trim().toLowerCase();
const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
};

const isValidToken = (token = "") =>
  typeof token === "string" && token.trim().length === 32;

const bootstrapAdmin = async (req, res) => {
  try {
    const expectedSecret = process.env.ADMIN_SEED_SECRET;
    if (!expectedSecret) {
      return res
        .status(500)
        .json({ msg: "ADMIN_SEED_SECRET no configurado" });
    }

    const secret = req.headers["x-admin-secret"] || req.body?.secret;
    if (!secret || secret !== expectedSecret) {
      return res.status(401).json({ msg: "Secreto inválido" });
    }

    const { nombre, apellido, email, password, force } = req.body || {};
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
        .json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isEpnEmail(normalizedEmail)) {
      return res.status(400).json({
        msg: "Solo se permiten correos institucionales @epn.edu.ec para administradores",
      });
    }
    const [emailExistenteUser, emailExistenteAdmin, emailExistenteRecolector] = await Promise.all([
      Donante.findOne({ email: normalizedEmail }),
      Admin.findOne({ email: normalizedEmail }),
      Recolector.findOne({ email: normalizedEmail }),
    ]);
    if (emailExistenteUser || emailExistenteAdmin || emailExistenteRecolector) {
      return res
        .status(409)
        .json({ msg: "El email ya se encuentra registrado" });
    }

    const adminCount = await Admin.countDocuments();
    if (adminCount > 0 && !force) {
      return res.status(409).json({
        msg: "Ya existe un administrador, usa force=true si deseas crear otro",
      });
    }

    const nuevoAdmin = new Admin({
      nombre,
      apellido,
      direccion: req.body?.direccion ?? "",
      telefono: req.body?.telefono ?? "",
      email: normalizedEmail,
      password,
      status: true,
      confirmEmail: false,
      token: null,
    });
    nuevoAdmin.password = await nuevoAdmin.encryptPassword(password);
    const token = nuevoAdmin.createToken();
    nuevoAdmin.token = token;
    nuevoAdmin.confirmEmail = false;
    await nuevoAdmin.save();
    await sendMailToRegister(normalizedEmail, token);

    return res.status(201).json({
      msg: "Revisa tu correo electrónico para confirmar tu cuenta",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const recuperarPasswordAdmin = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (isBlank(email)) {
      return res
        .status(400)
        .json({ msg: "Debes ingresar un correo electrónico" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isEpnEmail(normalizedEmail)) {
      return res.status(400).json({
        msg: "Solo se permiten correos institucionales @epn.edu.ec para administradores",
      });
    }
    const admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin) {
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });
    }

    const token = admin.createToken();
    admin.token = token;
    await sendMailToRecoveryPassword(normalizedEmail, token);
    await admin.save();

    return res.status(200).json({
      msg: "Revisa tu correo electrónico para reestablecer tu cuenta",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const comprobarTokenPasswordAdmin = async (req, res) => {
  try {
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(400).json({ msg: "Token inválido o malformado" });
    }
    const admin = await Admin.findOne({ token });
    if (!admin || admin.token !== token) {
      return res
        .status(404)
        .json({ msg: "Lo sentimos, no se puede validar la cuenta" });
    }
    return res
      .status(200)
      .json({ msg: "Token confirmado, ya puedes crear tu nuevo password" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const crearNuevoPasswordAdmin = async (req, res) => {
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

    const admin = await Admin.findOne({ token });
    if (!admin) {
      return res
        .status(404)
        .json({ msg: "No se puede validar la cuenta" });
    }

    admin.token = null;
    admin.password = await admin.encryptPassword(password);
    await admin.save();

    return res.status(200).json({
      msg: "Felicitaciones, ya puedes iniciar sesión con tu nuevo password",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const faltantes = requireFields(req.body, ["email", "password"]);
    if (faltantes.length > 0) {
      return res
        .status(400)
        .json({ msg: "Debes llenar todos los campos" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const admin = await Admin.findOne({ email: normalizedEmail }).select(
      "+password"
    );
    if (!admin) {
      return res
        .status(404)
        .json({ msg: "El usuario no se encuentra registrado" });
    }
    if (admin.status === false) {
      return res.status(403).json({ msg: "Cuenta desactivada" });
    }
    if (!admin.confirmEmail) {
      return res
        .status(403)
        .json({ msg: "Debes verificar tu cuenta antes de iniciar sesión" });
    }

    const verificarPassword = await admin.matchPassword(password);
    if (!verificarPassword) {
      return res.status(401).json({ msg: "El password no es correcto" });
    }

    const { nombre, apellido, direccion, telefono, _id } = admin;
    const token = crearTokenJWT(admin._id, "admin");

    return res.status(200).json({
      token,
      rol: "admin",
      nombre,
      apellido,
      direccion,
      telefono,
      _id,
      correo: admin.email,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const listarUsuarios = async (req, res) => {
  try {
    const { rol, status, q, page = "1", limit = "20" } = req.query || {};
    const filtro = {};

    if (rol) {
      const rolNormalizado = normalizeRole(rol);
      if (!ROLES.includes(rolNormalizado)) {
        return res.status(400).json({ msg: "Rol inválido" });
      }
      filtro.rol = rolNormalizado;
    }

    if (status !== undefined) {
      const statusBool = parseBoolean(status);
      if (statusBool === null) {
        return res.status(400).json({ msg: "Status inválido" });
      }
      filtro.status = statusBool;
    }

    if (q) {
      const regex = new RegExp(String(q), "i");
      filtro.$or = [{ nombre: regex }, { apellido: regex }, { email: regex }];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Donante.find(filtro)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Donante.countDocuments(filtro),
    ]);

    return res.status(200).json({
      total,
      page: pageNum,
      limit: limitNum,
      items,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const listarRecolectores = async (req, res) => {
  try {
    const { status, q, page = "1", limit = "20" } = req.query || {};
    const filtro = {};

    if (status !== undefined) {
      const statusBool = parseBoolean(status);
      if (statusBool === null) {
        return res.status(400).json({ msg: "Status inválido" });
      }
      filtro.status = statusBool;
    }

    if (q) {
      const regex = new RegExp(String(q), "i");
      filtro.$or = [{ nombre: regex }, { apellido: regex }, { email: regex }];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Recolector.find(filtro)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Recolector.countDocuments(filtro),
    ]);

    return res.status(200).json({
      total,
      page: pageNum,
      limit: limitNum,
      items,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const obtenerUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }
    const usuario = await Donante.findById(id);
    if (!usuario) {
      return res
        .status(404)
        .json({ msg: `No existe el usuario con ID ${id}` });
    }
    return res.status(200).json(usuario.toJSON());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarPerfilAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, direccion, telefono, email } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const admin = await Admin.findById(id).select("+password");
    if (!admin) {
      return res
        .status(404)
        .json({ msg: `No existe el admin con ID ${id}` });
    }

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
    if (normalizedEmail && admin.email !== normalizedEmail) {
      if (!isEpnEmail(normalizedEmail)) {
        return res.status(400).json({
          msg: "Solo se permiten correos institucionales @epn.edu.ec para administradores",
        });
      }
      const [emailExistenteUser, emailExistenteAdmin, emailExistenteRecolector] = await Promise.all([
        Donante.findOne({ email: normalizedEmail }),
        Admin.findOne({ email: normalizedEmail }),
        Recolector.findOne({ email: normalizedEmail }),
      ]);
      if (emailExistenteUser || emailExistenteAdmin || emailExistenteRecolector) {
        return res
          .status(404)
          .json({ msg: "El email ya se encuentra registrado" });
      }
      admin.email = normalizedEmail;
    }

    if (nombre !== undefined) admin.nombre = nombre;
    if (apellido !== undefined) admin.apellido = apellido;
    if (direccion !== undefined) admin.direccion = direccion;
    if (telefono !== undefined) admin.telefono = telefono;
    await admin.save();

    const adminActualizado = admin.toObject();
    return res.status(200).json(adminActualizado);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarRol = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    if (isBlank(rol)) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const nuevoRol = normalizeRole(rol);
    if (!ROLES.includes(nuevoRol)) {
      return res.status(400).json({ msg: "Rol inválido" });
    }

    const usuario = await Donante.findById(id);
    if (!usuario) {
      return res
        .status(404)
        .json({ msg: `No existe el usuario con ID ${id}` });
    }

    usuario.rol = nuevoRol;
    await usuario.save();
    return res.status(200).json(usuario.toJSON());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    if (isBlank(status)) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const nuevoStatus = parseBoolean(status);
    if (nuevoStatus === null) {
      return res.status(400).json({ msg: "Status inválido" });
    }

    const usuario = await Donante.findById(id);
    if (!usuario) {
      return res
        .status(404)
        .json({ msg: `No existe el usuario con ID ${id}` });
    }

    usuario.status = nuevoStatus;
    await usuario.save();
    return res.status(200).json(usuario.toJSON());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarStatusRecolector = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    if (isBlank(status)) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const nuevoStatus = parseBoolean(status);
    if (nuevoStatus === null) {
      return res.status(400).json({ msg: "Status inválido" });
    }

    const recolector = await Recolector.findById(id);
    if (!recolector) {
      return res
        .status(404)
        .json({ msg: `No existe el recolector con ID ${id}` });
    }

    recolector.status = nuevoStatus;
    await recolector.save();
    return res.status(200).json(recolector.toJSON());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const perfilAdmin = (req, res) => {
  const { token, confirmEmail, createdAt, updatedAt, __v, ...datosPerfil } =
    req.user.toJSON();
  res.status(200).json(datosPerfil);
};

const actualizarPasswordAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user?._id).select("+password");
    if (!admin)
      return res.status(404).json({
        msg: `Lo sentimos, no existe el admin ${req.user?._id}`,
      });

    const faltantes = requireFields(req.body, [
      "passwordactual",
      "passwordnuevo",
    ]);
    if (faltantes.length > 0) {
      return res.status(400).json({ msg: "Debes llenar todos los campos" });
    }

    const verificarPassword = await admin.matchPassword(
      req.body?.passwordactual
    );
    if (!verificarPassword)
      return res.status(404).json({
        msg: "Lo sentimos, el password actual no es el correcto",
      });

    admin.password = await admin.encryptPassword(req.body?.passwordnuevo);
    await admin.save();

    res.status(200).json({ msg: "Password actualizado correctamente" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

export {
  bootstrapAdmin,
  recuperarPasswordAdmin,
  comprobarTokenPasswordAdmin,
  crearNuevoPasswordAdmin,
  loginAdmin,
  listarUsuarios,
  obtenerUsuario,
  listarRecolectores,
  actualizarPerfilAdmin,
  actualizarRol,
  actualizarStatus,
  actualizarStatusRecolector,
  perfilAdmin,
  actualizarPasswordAdmin,
};
