import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import ChatConversation from "../models/ChatConversation.js";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";
import { getDonationRoomAccess, parseAdminCollectorRoom } from "./chatPolicy.js";

const syncDonationConversation = async (donacion) => {
  if (!donacion.donante || !donacion.recolector) return null;
  const room = String(donacion._id);
  const existing = await ChatConversation.findOne({ room }).lean();
  const previousReadAt = (userId, role) => existing?.participants.find(
    (participant) => String(participant.userId) === String(userId) && participant.role === role
  )?.lastReadAt ?? null;
  const participants = [
    { userId: donacion.donante, role: "donante", lastReadAt: previousReadAt(donacion.donante, "donante") },
    { userId: donacion.recolector, role: "recolector", lastReadAt: previousReadAt(donacion.recolector, "recolector") },
  ];
  return ChatConversation.findOneAndUpdate(
    { room },
    {
      $set: { type: "donation", donacion: donacion._id, campana: donacion.campana, participants },
      $setOnInsert: { room },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const canAccessRoom = async (user, roomId, mode = "read") => {
  if (!user) return { ok: false, status: 401, msg: "No autenticado" };

  const directRoom = parseAdminCollectorRoom(roomId);
  if (directRoom) {
    const role = String(user.rol || "").toLowerCase();
    const isAdminParticipant = role === "admin" && String(user._id) === directRoom.adminId;
    const isCollectorParticipant = role === "recolector" && String(user._id) === directRoom.collectorId;
    if (!isAdminParticipant && !isCollectorParticipant) {
      return { ok: false, status: 403, msg: "No autorizado para esta conversación" };
    }
    const conversation = await ChatConversation.findOne({
      room: roomId,
      type: "admin_recolector",
      participants: { $all: [
        { $elemMatch: { userId: directRoom.adminId, role: "admin" } },
        { $elemMatch: { userId: directRoom.collectorId, role: "recolector" } },
      ] },
    });
    if (!conversation) return { ok: false, status: 404, msg: "Conversación no encontrada" };
    return { ok: true, conversation, donacion: null };
  }

  if (!mongoose.isValidObjectId(roomId)) {
    return { ok: false, status: 400, msg: `ID inválido: ${roomId}` };
  }
  const donacion = await Donacion.findById(roomId);
  if (!donacion) return { ok: false, status: 404, msg: "Donación no encontrada" };

  const access = getDonationRoomAccess(user, donacion, mode);
  if (!access.ok) return access;
  const conversation = await syncDonationConversation(donacion);
  return { ok: true, donacion, conversation };
};

const ensureAdminCollectorConversation = async (adminId, collectorId) => {
  if (!mongoose.isValidObjectId(collectorId)) {
    return { ok: false, status: 400, msg: "El ID del recolector no es válido" };
  }
  const [admin, collector] = await Promise.all([
    Admin.findById(adminId).select("_id nombre apellido email rol status").lean(),
    Recolector.findById(collectorId).select("_id nombre apellido email rol status aprobado confirmEmail").lean(),
  ]);
  if (!admin) return { ok: false, status: 404, msg: "Administrador no encontrado" };
  if (!collector) return { ok: false, status: 404, msg: "Recolector no encontrado" };
  if (collector.status === false || collector.aprobado === false || !collector.confirmEmail) {
    return { ok: false, status: 403, msg: "El recolector no está habilitado para chatear" };
  }
  const room = `admin:${adminId}:recolector:${collectorId}`;
  const conversation = await ChatConversation.findOneAndUpdate(
    { room },
    {
      $setOnInsert: {
        room,
        type: "admin_recolector",
        participants: [
          { userId: admin._id, role: "admin" },
          { userId: collector._id, role: "recolector" },
        ],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, room, conversation, admin, collector };
};

const emitToAuthorizedRoom = async (io, roomId, event, payload, excludeSocketId = null) => {
  if (!io) return;
  try {
    const sockets = await io.in(String(roomId)).fetchSockets();
    for (const socket of sockets) {
      if (excludeSocketId && socket.id === excludeSocketId) continue;
      const access = await canAccessRoom(socket.data.user, roomId, "read");
      if (access.ok) socket.emit(event, payload);
    }
  } catch (error) {
    console.error("No se pudo distribuir evento del chat:", error.message || error);
  }
};

export {
  canAccessRoom,
  emitToAuthorizedRoom,
  ensureAdminCollectorConversation,
  syncDonationConversation,
};