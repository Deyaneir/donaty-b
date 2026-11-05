import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";
import { migrateUserRole } from "../services/userRoleMigration.js";

// Solo se gestionan donantes y recolectores. El rol de administrador nunca se
// asigna ni se modifica desde estas funciones.
const MODELOS = { donante: Donante, recolector: Recolector };

const getModelo = (rol) => MODELOS[String(rol || "").toLowerCase()] ?? null;

// toJSON ya quita password, token y tokenExpires; aquí se quita lo interno.
const sanitize = (doc) => {
  const { googleId, rolMigradoA, __v, ...datos } = doc.toJSON();
  return datos;
};

const listarUsuarios = async (_req, res) => {
  try {
    const [donantes, recolectores] = await Promise.all([
      Donante.find({ rolMigradoA: null }).sort({ createdAt: -1 }).limit(1000),
      Recolector.find({ rolMigradoA: null }).sort({ createdAt: -1 }).limit(1000),
    ]);

    const usuarios = [...donantes, ...recolectores]
      .map(sanitize)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const cambiarEstadoUsuario = async (req, res) => {
  try {
    const { rol, id } = req.params;

    const Modelo = getModelo(rol);
    if (!Modelo) {
      return res.status(400).json({
        msg: "Rol no válido. Solo se gestionan donantes y recolectores",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const { activo } = req.body || {};
    if (typeof activo !== "boolean") {
      return res.status(400).json({
        msg: "Debes indicar si el usuario queda activo (true) o inactivo (false)",
      });
    }

    const usuario = await Modelo.findById(id);
    if (!usuario) {
      return res.status(404).json({ msg: "No existe el usuario indicado" });
    }
    if (usuario.rolMigradoA) {
      return res.status(409).json({
        msg: "La cuenta fue migrada a otro rol y ya no puede editarse desde este registro",
      });
    }

    usuario.status = activo;
    await usuario.save();

    res.status(200).json({
      msg: activo
        ? "Usuario activado correctamente"
        : "Usuario desactivado correctamente",
      usuario: sanitize(usuario),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

const actualizarDatosUsuario = async (req, res) => {
  try {
    const { rol, id } = req.params;
    const currentRole = String(rol || "").toLowerCase();
    const Modelo = getModelo(currentRole);
    if (!Modelo) {
      return res.status(400).json({
        msg: "Rol no válido. Solo se gestionan donantes y recolectores",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: `ID inválido: ${id}` });
    }

    const usuario = await Modelo.findById(id).select("+password");
    if (!usuario) {
      return res.status(404).json({ msg: "No existe el usuario indicado" });
    }
    if (usuario.rolMigradoA) {
      return res.status(409).json({
        msg: "La cuenta fue migrada a otro rol y ya no puede editarse desde este registro",
      });
    }

    const allowed = ["nombre", "apellido", "email", "telefono", "direccion"];
    const provided = allowed.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field)
    );
    const roleWasProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "rol",
    );
    const targetRole = roleWasProvided
      ? String(req.body.rol || "").trim().toLowerCase()
      : currentRole;
    if (!["donante", "recolector"].includes(targetRole)) {
      return res.status(400).json({
        msg: "El rol debe ser donante o recolector",
      });
    }
    if (provided.length === 0 && targetRole === currentRole) {
      return res.status(400).json({ msg: "No se recibieron datos para actualizar" });
    }

    const updates = {};
    for (const field of provided) {
      const value = req.body[field];
      if (typeof value !== "string") {
        return res.status(400).json({ msg: `El campo ${field} debe ser texto` });
      }
      const normalized = value.trim();
      if (["nombre", "apellido", "email"].includes(field) && !normalized) {
        return res.status(400).json({ msg: `El campo ${field} es obligatorio` });
      }
      if (
        (field === "nombre" && normalized.length > 100) ||
        (field === "apellido" && normalized.length > 100) ||
        (field === "email" && normalized.length > 254) ||
        (field === "telefono" && normalized.length > 30) ||
        (field === "direccion" && normalized.length > 500)
      ) {
        return res.status(400).json({ msg: `El campo ${field} excede su longitud máxima` });
      }
      updates[field] = field === "email" ? normalized.toLowerCase() : normalized;
    }

    if (updates.email !== undefined && updates.email !== usuario.email) {
      const [donante, recolector] = await Promise.all([
        Donante.findOne({ email: updates.email, _id: { $ne: id } }).select("_id"),
        Recolector.findOne({ email: updates.email, _id: { $ne: id } }).select("_id"),
      ]);
      if (donante || recolector) {
        return res.status(409).json({ msg: "El correo ya está registrado" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
        return res.status(400).json({ msg: "El correo electrónico no es válido" });
      }
    }

    if (targetRole !== currentRole) {
      const migrated = await migrateUserRole({
        id,
        fromRole: currentRole,
        toRole: targetRole,
        updates,
      });
      return res.status(200).json({
        msg:
          targetRole === "recolector"
            ? "Rol actualizado. El recolector quedó pendiente de aprobación"
            : "Rol actualizado correctamente",
        usuario: sanitize(migrated),
      });
    }

    Object.assign(usuario, updates);
    await usuario.save();
    return res.status(200).json({
      msg: "Datos del usuario actualizados correctamente",
      usuario: sanitize(usuario),
    });
  } catch (error) {
    console.error("Error al actualizar los datos del usuario:", error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode
        ? error.message
        : "Error al actualizar los datos del usuario",
    });
  }
};

export { listarUsuarios, cambiarEstadoUsuario, actualizarDatosUsuario };