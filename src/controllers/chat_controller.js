import Admin from "../models/Admin.js";
import ChatConversation from "../models/ChatConversation.js";
import ChatMessage from "../models/ChatMessage.js";
import Donante from "../models/Donante.js";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";
import {
  canAccessRoom,
  emitToAuthorizedRoom,
  ensureAdminCollectorConversation,
  syncDonationConversation,
} from "../utils/chatRoom.js";
import { isBlank } from "../utils/validation.js";
import { notifyUsers } from "../services/firebase_notifications.js";

const currentUser = (req) => req.user || req.donanteHeader;

const rejectAccess = (res, access) => res.status(access.status).json({ msg: access.msg });

const sendRoomMessage = async (user, roomId, text) => {
  if (isBlank(roomId) || isBlank(text)) {
    return { error: { status: 400, msg: "roomId y text son requeridos" } };
  }
  const normalizedText = String(text).trim();
  if (normalizedText.length > 2000) {
    return { error: { status: 400, msg: "El mensaje no puede superar 2000 caracteres" } };
  }
  const access = await canAccessRoom(user, roomId, "write");
  if (!access.ok) return { error: access };

  const message = await ChatMessage.create({
    room: String(roomId),
    donacion: access.donacion?._id || null,
    senderId: user._id,
    senderRol: user.rol,
    senderNombre: user.nombre || "",
    senderApellido: user.apellido || "",
    senderEmail: user.email || "",
    text: normalizedText,
  });
  await ChatConversation.updateOne({ room: String(roomId) }, { $set: { updatedAt: message.createdAt } });
  const recipients = (access.conversation?.participants || [])
    .filter((participant) => String(participant.userId) !== String(user._id))
    .map((participant) => ({
      userId: participant.userId,
      role: participant.role,
    }));
  void notifyUsers({
    eventKey: `message:${message._id}`,
    recipients,
    title: "Nuevo mensaje",
    body: "Tienes un nuevo mensaje en Donaty-EC.",
    data: {
      type: "message",
      roomId: roomId,
      donationId: access.donacion?._id || "",
    },
  });
  return { message: message.toObject() };
};

const listConversations = async (req, res) => {
  try {
    const user = currentUser(req);
    const role = String(user.rol || "").toLowerCase();
    const donationFilter = role === "donante"
      ? { donante: user._id, recolector: { $ne: null } }
      : role === "recolector"
        ? { recolector: user._id, donante: { $ne: null } }
        : null;

    const donationConversations = [];
    if (donationFilter) {
      const donations = await Donacion.find(donationFilter)
        .populate("campana", "nombre")
        .populate("donante", "nombre apellido email telefono")
        .populate("recolector", "nombre apellido email telefono")
        .sort({ updatedAt: -1 });
      for (const donation of donations) {
        const conversation = await syncDonationConversation(donation);
        if (conversation) donationConversations.push({ conversation, donation });
      }
    }

    const directFilter = role === "admin"
      ? { type: "admin_recolector", participants: { $elemMatch: { userId: user._id, role: "admin" } } }
      : role === "recolector"
        ? { type: "admin_recolector", participants: { $elemMatch: { userId: user._id, role: "recolector" } } }
        : null;
    const directConversations = directFilter
      ? await ChatConversation.find(directFilter).sort({ updatedAt: -1 }).lean()
      : [];
    const allConversations = [
      ...donationConversations.map(({ conversation, donation }) => ({ conversation, donation, type: "donation" })),
      ...directConversations.map((conversation) => ({ conversation, donation: null, type: "admin_recolector" })),
    ];
    const rooms = allConversations.map(({ conversation }) => conversation.room);
    const latestMessages = rooms.length
      ? await ChatMessage.find({ room: { $in: rooms } }).sort({ createdAt: -1 }).lean()
      : [];
    const lastByRoom = new Map();
    for (const message of latestMessages) {
      if (!lastByRoom.has(message.room)) lastByRoom.set(message.room, message);
    }

    const conversations = await Promise.all(allConversations.map(async ({ conversation, donation, type }) => {
      const participant = conversation.participants.find((item) => String(item.userId) === String(user._id));
      const other = conversation.participants.find((item) => String(item.userId) !== String(user._id));
      let contact = null;
      if (other) {
        const ContactModel = other.role === "admin"
          ? Admin
          : other.role === "donante"
            ? Donante
            : Recolector;
        contact = await ContactModel.findById(other.userId).select("nombre apellido email telefono rol").lean();
      }
      const unreadQuery = {
        room: conversation.room,
        senderId: { $ne: user._id },
        ...(participant?.lastReadAt ? { createdAt: { $gt: participant.lastReadAt } } : {}),
      };
      const unreadCount = await ChatMessage.countDocuments(unreadQuery);
      return {
        id: conversation.room,
        type,
        donacion: donation ? {
          _id: donation._id,
          estado: donation.estado,
          descripcion: donation.descripcion,
          campana: donation.campana,
        } : null,
        contacto: contact,
        ultimoMensaje: lastByRoom.get(conversation.room) || null,
        ultimaActividad: lastByRoom.get(conversation.room)?.createdAt || conversation.createdAt,
        noLeidos: unreadCount,
        soloLectura: type === "donation" && ["entregada", "cancelada", "devuelta"].includes(donation?.estado),
      };
    }));

    conversations.sort((left, right) =>
      new Date(right.ultimaActividad || 0).getTime() - new Date(left.ultimaActividad || 0).getTime()
    );
    return res.status(200).json({ items: conversations });
  } catch (error) {
    console.error("Error al listar conversaciones:", error);
    return res.status(500).json({ msg: "Error al consultar las conversaciones" });
  }
};

const openAdminCollectorConversation = async (req, res) => {
  try {
    const result = await ensureAdminCollectorConversation(currentUser(req)._id, req.params.collectorId);
    if (!result.ok) return rejectAccess(res, result);
    const participant = result.conversation.participants.find(
      (item) => String(item.userId) === String(currentUser(req)._id)
    );
    return res.status(200).json({
      conversacion: {
        id: result.room,
        type: "admin_recolector",
        contacto: result.collector,
        ultimoMensaje: await ChatMessage.findOne({ room: result.room }).sort({ createdAt: -1 }).lean(),
        noLeidos: await ChatMessage.countDocuments({
          room: result.room,
          senderId: { $ne: currentUser(req)._id },
          ...(participant?.lastReadAt ? { createdAt: { $gt: participant.lastReadAt } } : {}),
        }),
      },
    });
  } catch (error) {
    console.error("Error al abrir conversación admin-recolector:", error);
    return res.status(500).json({ msg: "Error al abrir la conversación" });
  }
};

const getRoomMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const user = currentUser(req);
    const access = await canAccessRoom(user, roomId, "read");
    if (!access.ok) return rejectAccess(res, access);

    const items = await ChatMessage.find({ room: String(roomId) })
      .sort({ createdAt: -1 })
      .limit(limit);
    await ChatConversation.updateOne(
      { room: String(roomId), "participants.userId": user._id },
      { $set: { "participants.$.lastReadAt": new Date() } },
      { timestamps: false }
    );
    return res.status(200).json({ items: items.reverse() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al consultar los mensajes" });
  }
};

const postRoomMessage = async (req, res) => {
  try {
    const result = await sendRoomMessage(currentUser(req), req.params.roomId, req.body?.text);
    if (result.error) return res.status(result.error.status).json({ msg: result.error.msg });
    await emitToAuthorizedRoom(req.app.get("io"), req.params.roomId, "message", result.message);
    return res.status(201).json({ message: result.message });
  } catch (error) {
    console.error("Error al enviar mensaje:", error);
    return res.status(500).json({ msg: "Error al enviar el mensaje" });
  }
};

export { getRoomMessages, listConversations, openAdminCollectorConversation, postRoomMessage, sendRoomMessage };