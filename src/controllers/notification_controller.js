import FcmDevice from "../models/FcmDevice.js";
import CollectorLocationEvent from "../models/CollectorLocationEvent.js";
import NotificationEvent from "../models/NotificationEvent.js";
import Donacion from "../models/Donacion.js";
import Campana from "../models/Campana.js";
import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";
import Admin from "../models/Admin.js";
import { donationStatusLabel } from "../utils/donationStatus.js";

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

const idString = (value) => String(value?._id ?? value ?? "");
const fullName = (person) =>
  `${person?.nombre || ""} ${person?.apellido || ""}`.trim();
const notificationType = (type) => ({
  donation_status: "DONATION_STATUS_CHANGED",
  donation_assigned: "DONATION_ASSIGNED",
  donation_reassigned: "DONATION_REASSIGNED",
  donation_reassignment_removed: "DONATION_REASSIGNMENT_REMOVED",
  collector_point_assignment: "CAMPAIGN_COLLECTOR_ASSIGNMENT_CHANGED",
}[String(type || "").toLowerCase()] || String(type || "notification").toUpperCase());

const listarNotificaciones = async (req, res) => {
  try {
    const owner = notificationOwnerFilter(req);
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const items = await NotificationEvent.find(owner)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const dataOf = (item) =>
      item.data && typeof item.data === "object" ? item.data : {};
    const donationIds = [...new Set(items
      .map((item) => idString(item.donationId || dataOf(item).donationId || dataOf(item).donacionId))
      .filter(Boolean))];
    const donations = donationIds.length
      ? await Donacion.find({ _id: { $in: donationIds } })
        .select("_id donante donanteExterno nombreDonante recolector campana nombreBien descripcion categoria subcategoria")
        .populate("donante", "_id nombre apellido")
        .populate("recolector", "_id nombre apellido")
        .populate("campana", "_id nombre")
        .lean()
      : [];
    const donationById = new Map(donations.map((item) => [String(item._id), item]));
    const campaignIds = [...new Set([
      ...items.map((item) => idString(item.campaignId || dataOf(item).campaignId || dataOf(item).campanaId)),
      ...donations.map((item) => idString(item.campana)),
    ].filter(Boolean))];
    const campaignRows = campaignIds.length
      ? await Campana.find({ _id: { $in: campaignIds } }).select("_id nombre").lean()
      : [];
    const campaignById = new Map(campaignRows.map((item) => [String(item._id), item]));
    const collectorIds = [...new Set([
      ...items.flatMap((item) => {
        const data = dataOf(item);
        return [
          data.collectorId,
          data.previousCollectorId,
          data.newCollectorId,
          item.recipientRole === "recolector" ? item.recipientId : null,
        ].map(idString);
      }),
      ...donations.map((item) => idString(item.recolector)),
    ].filter(Boolean))];
    const collectorRows = collectorIds.length
      ? await Recolector.find({ _id: { $in: collectorIds } }).select("_id nombre apellido").lean()
      : [];
    const collectorById = new Map(collectorRows.map((item) => [String(item._id), item]));
    const donorIds = [...new Set([
      ...items.map((item) => idString(dataOf(item).donorId)),
      ...donations.map((item) => idString(item.donante)),
    ].filter(Boolean))];
    const donorRows = donorIds.length
      ? await Donante.find({ _id: { $in: donorIds } }).select("_id nombre apellido").lean()
      : [];
    const donorById = new Map(donorRows.map((item) => [String(item._id), item]));
    const adminIds = [...new Set(items.flatMap((item) => {
      const data = dataOf(item);
      return [data.changedById, data.administratorId, data.administradorId].map(idString);
    }).filter(Boolean))];
    const adminRows = adminIds.length
      ? await Admin.find({ _id: { $in: adminIds } }).select("_id nombre apellido").lean()
      : [];
    const adminById = new Map(adminRows.map((item) => [String(item._id), item]));
    const normalizedItems = items.map((item) => {
      const data = dataOf(item);
      const donation = donationById.get(idString(item.donationId || data.donationId || data.donacionId));
      const campaignId = idString(item.campaignId || data.campaignId || data.campanaId || donation?.campana);
      const donorId = idString(data.donorId || donation?.donante);
      const collectorId = idString(data.collectorId || donation?.recolector
        || (item.recipientRole === "recolector" ? item.recipientId : null));
      const previousCollectorId = idString(data.previousCollectorId);
      const newCollectorId = idString(data.newCollectorId || collectorId);
      const changedById = idString(data.changedById || data.administratorId || data.administradorId);
      const donor = donorById.get(donorId);
      const collector = collectorById.get(collectorId);
      const campaign = campaignById.get(campaignId);
      const changedBy = adminById.get(changedById);
      const donationName = String(
        data.donationName
        || donation?.nombreBien
        || donation?.descripcion
        || [donation?.categoria, donation?.subcategoria].filter(Boolean).join(" · ")
        || ""
      ).trim();
      const previousStatus = String(data.previousStatus || data.previousState || "");
      const newStatus = String(data.newStatus || data.status || data.estado || "");
      const previousStatusLabel = donationStatusLabel(previousStatus);
      const newStatusLabel = donationStatusLabel(newStatus);
      const notificationBody = item.type === "donation_status"
        ? `El estado de ${donationName ? `“${donationName}”` : "tu aporte"} cambió de ${previousStatusLabel} a ${newStatusLabel}.`
        : item.body;
      return {
        id: String(item._id),
        type: notificationType(item.type),
        title: item.title,
        message: notificationBody,
        donationName,
        isRead: Boolean(item.readAt),
        createdAt: item.createdAt,
        readAt: item.readAt,
        donorName: data.donorName || fullName(donor) || donation?.nombreDonante || "",
        collectorName: data.collectorName || fullName(collector),
        campaignName: data.campaignName || campaign?.nombre || "",
        changedBy: changedById
          ? {
              id: changedById,
              fullName: data.changedByName || fullName(changedBy),
            }
          : null,
        data: {
          ...data,
          donationId: idString(item.donationId || data.donationId || data.donacionId),
          campaignId,
          conversationId: String(item.conversationId || data.conversationId || data.roomId || ""),
          donationName,
          donationDescription: String(donation?.descripcion || data.donationDescription || ""),
          previousStatus,
          previousStatusLabel,
          newStatus,
          newStatusLabel,
          donorId,
          donorName: data.donorName || fullName(donor) || donation?.nombreDonante || "",
          collectorId,
          collectorName: data.collectorName || fullName(collector),
          campaignName: data.campaignName || campaign?.nombre || "",
          previousCollector: previousCollectorId
            ? {
                id: previousCollectorId,
                fullName: data.previousCollectorName || fullName(collectorById.get(previousCollectorId)),
              }
            : null,
          newCollector: newCollectorId
            ? {
                id: newCollectorId,
                fullName: data.newCollectorName || fullName(collectorById.get(newCollectorId)),
              }
            : null,
          changedBy: changedById
            ? {
                id: changedById,
                fullName: data.changedByName || fullName(changedBy),
              }
            : null,
        },
        _id: item._id,
        recipientRole: item.recipientRole,
        body: notificationBody,
      };
    });
    const unreadCount = await NotificationEvent.countDocuments({
      ...owner,
      readAt: null,
    });
    return res.status(200).json({
      items: normalizedItems,
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
