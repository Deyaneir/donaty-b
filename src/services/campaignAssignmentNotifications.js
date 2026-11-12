import Recolector from "../models/Recolector.js";
import { notifyUsers } from "./firebase_notifications.js";

const collectorIdsForPoint = (point) => [...new Set([
  ...(point?.recolectores || []).map((collector) =>
    String(collector?._id ?? collector)
  ),
  ...(point?.responsableRecolector
    ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
    : []),
].filter(Boolean))];

const assignmentsByCollector = (points = []) => {
  const assignments = new Map();
  for (const point of points) {
    const pointId = String(point?._id ?? "");
    const principalId = String(
      point?.responsableRecolector?._id ?? point?.responsableRecolector ?? ""
    );
    for (const collectorId of collectorIdsForPoint(point)) {
      assignments.set(collectorId, {
        point,
        pointId,
        rolPunto: collectorId === principalId ? "principal" : "apoyo",
      });
    }
  }
  return assignments;
};

const buildAssignmentNotificationChanges = (previousPoints = [], nextPoints = []) => {
  const previous = assignmentsByCollector(previousPoints);
  const next = assignmentsByCollector(nextPoints);
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter((collectorId) => {
      const before = previous.get(collectorId);
      const after = next.get(collectorId);
      return before?.pointId !== after?.pointId
        || before?.rolPunto !== after?.rolPunto;
    })
    .map((collectorId) => ({
      collectorId,
      previous: previous.get(collectorId) || null,
      current: next.get(collectorId) || null,
    }));
};

const buildAssignmentNotification = (
  campaign,
  change,
  collectorsById,
  eventPrefix = "campaign-assignment"
) => {
  const assignment = change.current || change.previous;
  const point = assignment.point;
  const principalId = String(
    point?.responsableRecolector?._id ?? point?.responsableRecolector ?? ""
  );
  const principal = collectorsById.get(principalId);
  const pointRoster = collectorIdsForPoint(point).map((id) => {
    const collector = collectorsById.get(id);
    return collector
      ? {
          _id: id,
          nombre: collector.nombre ?? "",
          apellido: collector.apellido ?? "",
          rolPunto: id === principalId ? "principal" : "apoyo",
        }
      : null;
  }).filter(Boolean);
  const assignedHistory = (campaign.historialAsignacionesRecolectores || [])
    .filter((entry) =>
      String(entry?.recolector?._id ?? entry?.recolector ?? "") === change.collectorId
    )
    .sort((left, right) =>
      new Date(right.fecha || 0).getTime() - new Date(left.fecha || 0).getTime()
    )[0];
  const eventId = assignedHistory?._id
    ? String(assignedHistory._id)
    : String(campaign.__v ?? campaign.updatedAt?.getTime?.() ?? Date.now());
  const recipientRole = change.current?.rolPunto || "retirado";

  return {
    eventKey: `${eventPrefix}:${campaign._id}:${eventId}:${change.collectorId}:${recipientRole}`,
    recipients: [{ userId: change.collectorId, role: "recolector" }],
    title: change.current
      ? "Asignación de campaña actualizada"
      : "Asignación de campaña retirada",
    body: change.current
      ? `Fuiste asignado como ${recipientRole} al punto ${point?.nombre || "de recolección"} de ${campaign.nombre}.`
      : `Tu asignación al punto ${point?.nombre || "de recolección"} de ${campaign.nombre} fue retirada.`,
    data: {
      type: "collector_point_assignment",
      campaignId: String(campaign._id),
      campanaId: String(campaign._id),
      campaignName: String(campaign.nombre ?? ""),
      pointId: assignment.pointId,
      puntoRecoleccionId: assignment.pointId,
      pointName: String(point?.nombre ?? ""),
      principalId,
      principalNombre: String(principal?.nombre ?? ""),
      principalApellido: String(principal?.apellido ?? ""),
      recolectores: JSON.stringify(pointRoster),
      rolPunto: recipientRole,
    },
  };
};

const notifyCampaignAssignmentChanges = async (
  campaign,
  previousPoints = [],
  { eventPrefix = "campaign-assignment" } = {}
) => {
  const changes = buildAssignmentNotificationChanges(
    previousPoints,
    campaign?.puntosRecoleccion || []
  );
  if (!changes.length) return [];

  const allPoints = [
    ...previousPoints,
    ...(campaign?.puntosRecoleccion || []),
  ];
  const ids = [...new Set(allPoints.flatMap(collectorIdsForPoint))];
  try {
    const collectors = await Recolector.find({ _id: { $in: ids } })
      .select("_id nombre apellido")
      .lean();
    const collectorsById = new Map(
      collectors.map((collector) => [String(collector._id), collector])
    );
    return await Promise.all(changes.map(async (change) => {
      const notification = buildAssignmentNotification(
        campaign,
        change,
        collectorsById,
        eventPrefix
      );
      const result = await notifyUsers(notification);
      return { recolectorId: change.collectorId, estado: result.status };
    }));
  } catch (error) {
    console.error("Error preparando avisos de asignación:", error.message || error);
    return changes.map((change) => ({
      recolectorId: change.collectorId,
      estado: "failed",
    }));
  }
};

export {
  buildAssignmentNotification,
  buildAssignmentNotificationChanges,
  notifyCampaignAssignmentChanges,
};
