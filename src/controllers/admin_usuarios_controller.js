import mongoose from "mongoose";
import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";

// Solo se gestionan donantes y recolectores. El rol de administrador nunca se
// asigna ni se modifica desde estas funciones.
const MODELOS = { donante: Donante, recolector: Recolector };

const getModelo = (rol) => MODELOS[String(rol || "").toLowerCase()] ?? null;

// toJSON ya quita password, token y tokenExpires; aquí se quita lo interno.
const sanitize = (doc) => {
  const { googleId, __v, ...datos } = doc.toJSON();
  return datos;
};

const listarUsuarios = async (_req, res) => {
  try {
    const [donantes, recolectores] = await Promise.all([
      Donante.find().sort({ createdAt: -1 }).limit(1000),
      Recolector.find().sort({ createdAt: -1 }).limit(1000),
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

export { listarUsuarios, cambiarEstadoUsuario };