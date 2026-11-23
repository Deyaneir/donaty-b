import FcmDevice from "../models/FcmDevice.js";
import CollectorLocationEvent from "../models/CollectorLocationEvent.js";
import NotificationEvent from "../models/NotificationEvent.js";

const VALID_ROLES = new Set(["donante", "recolector", "admin"]);
const VALID_PLATFORMS = new Set(["android", "ios", "web"]);

const registerDevice = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const token = String(req.body?.token || "").trim();
    const platform = String(req.body?.platform || "").trim().toLowerCase();
    const role = String(user?.rol || "").trim().toLowerCase();

    if (!user || !token || token.length > 4096) {
      return res.status(400).json({ msg: "El token FCM es obligatorio y válido" });
    }
    if (!VALID_PLATFORMS.has(platform) || !VALID_ROLES.has(role)) {
      return res.status(400).json({ msg: "Plataforma o rol inválido" });
    }

    await FcmDevice.findOneAndUpdate(
      { token },
      {
        $set: {
          userId: user._id,
          role,
          platform,
          active: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(204).send();
  } catch (error) {
    console.error("Error registrando dispositivo FCM:", error);
    return res.status(500).json({ msg: "No se pudo registrar el dispositivo" });
  }
};

const deactivateDevice = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const token = String(req.body?.token || "").trim();
    if (!user || !token) {
      return res.status(400).json({ msg: "El token FCM es obligatorio" });
    }
    await FcmDevice.updateOne(
      { token, userId: user._id },
      { $set: { active: false, lastSeenAt: new Date() } }
    );
    return res.status(204).send();
  } catch (error) {
    console.error("Error desactivando dispositivo FCM:", error);
    return res.status(500).json({ msg: "No se pudo desactivar el dispositivo" });
  }
};

const listarEventosUbicacionRecolectores = async (req, res) => {
  try {
    const events = await CollectorLocationEvent.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json({ items: events });
  } catch (error) {
    console.error("Error consultando alertas de ubicación:", error.message || error);
    return res.status(500).json({
      msg: "No se pudieron consultar las alertas de ubicación",
    });
  }
};

const notificationOwnerFilter = (req) => {
  const user = req.user || req.donanteHeader;
  return {
    recipientId: user._id,
    recipientRole: String(user.rol || "").toLowerCase(),
  };
};

const listarNotificaciones = async (req, res) => {
  try {
    const owner = notificationOwnerFilter(req);
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const items = await NotificationEvent.find(owner)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const unreadCount = await NotificationEvent.countDocuments({
      ...owner,
      readAt: null,
    });
    return res.status(200).json({
      items,
      noLeidas: unreadCount,
      unreadCount,
    });
  } catch (error) {
    console.error("Error consultando notificaciones:", error.message || error);
    return res.status(500).json({ msg: "No se pudieron consultar las notificaciones" });
  }
};

const contarNotificacionesNoLeidas = async (req, res) => {
  try {
    const owner = notificationOwnerFilter(req);
    const unreadCount = await NotificationEvent.countDocuments({
      ...owner,
      readAt: null,
    });
    return res.status(200).json({
      noLeidas: unreadCount,
      unreadCount,
    });
  } catch (error) {
    console.error("Error contando notificaciones:", error.message || error);
    return res.status(500).json({ msg: "No se pudo contar las notificaciones" });
  }
};

const marcarNotificacionLeida = async (req, res) => {
  try {
    const owner = notificationOwnerFilter(req);
    const now = new Date();
    const notification = await NotificationEvent.findOneAndUpdate(
      { _id: req.params.id, ...owner, readAt: null },
      { $set: { readAt: now } },
      { new: true }
    );
    if (!notification) {
      const exists = await NotificationEvent.exists({ _id: req.params.id, ...owner });
      if (!exists) return res.status(404).json({ msg: "Notificación no encontrada" });
    }
    const unreadCount = await NotificationEvent.countDocuments({
      ...owner,
      readAt: null,
    });
    return res.status(200).json({
      notificacion: notification,
      noLeidas: unreadCount,
      unreadCount,
    });
  } catch (error) {
    console.error("Error marcando notificación como leída:", error.message || error);
    return res.status(500).json({ msg: "No se pudo actualizar la notificación" });
  }
};

const marcarTodasLeidas = async (req, res) => {
  try {
    const owner = notificationOwnerFilter(req);
    await NotificationEvent.updateMany(
      { ...owner, readAt: null },
      { $set: { readAt: new Date() } }
    );
    if (req.body?.conversationId) {
      await NotificationEvent.updateMany(
        {
          ...owner,
          type: "message",
          conversationId: String(req.body.conversationId),
          readAt: null,
        },
        { $set: { readAt: new Date() } }
      );
    }
    return res.status(200).json({ noLeidas: 0, unreadCount: 0 });
  } catch (error) {
    console.error("Error marcando notificaciones como leídas:", error.message || error);
    return res.status(500).json({ msg: "No se pudieron actualizar las notificaciones" });
  }
};

export {
  contarNotificacionesNoLeidas,
  deactivateDevice,
  listarEventosUbicacionRecolectores,
  listarNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  registerDevice,
};
