import mongoose from "mongoose";
import Donacion from "../models/Donacion.js";

const canAccessRoom = async (user, roomId) => {
  if (!user) {
    return { ok: false, status: 401, msg: "No autenticado" };
  }
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return { ok: false, status: 400, msg: `ID inválido: ${roomId}` };
  }

  const donacion = await Donacion.findById(roomId);
  if (!donacion) {
    return { ok: false, status: 404, msg: "Donación no encontrada" };
  }

  const rol = String(user.rol || "").toLowerCase();
  if (rol === "admin") {
    return { ok: true, donacion };
  }
  if (rol === "donante" && String(donacion.donante) === String(user._id)) {
    return { ok: true, donacion };
  }
  if (
    rol === "recolector" &&
    donacion.recolector &&
    String(donacion.recolector) === String(user._id)
  ) {
    return { ok: true, donacion };
  }

  return { ok: false, status: 403, msg: "No autorizado" };
};

export { canAccessRoom };
