import {
  buildPointCollectorAssignmentFilter,
  isCollectorAssignedToPoint,
  isPickupPointActive,
} from "./pickupPoints.js";
import {
  getEcuadorDateBounds,
  isCampaignAvailableNow,
} from "./campaignSchedule.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isCurrentCollectorCampaignAvailable = isCampaignAvailableNow;

const buildCampaignHistoryFilter = ({ collectorId, period, search } = {}) => {
  const filters = [];

  if (collectorId) {
    filters.push({
      $or: [
        { "puntosRecoleccion.recolectores": collectorId },
        { "puntosRecoleccion.responsableRecolector": collectorId },
        { "historialAsignacionesRecolectores.recolector": collectorId },
      ],
    });
  }
  if (period) filters.push({ periodoAcademico: period });
  if (search) {
    filters.push({
      nombre: new RegExp(escapeRegex(search), "i"),
    });
  }

  if (filters.length === 0) return {};
  return filters.length === 1 ? filters[0] : { $and: filters };
};

const buildCurrentCollectorCampaignFilter = ({
  collectorId,
  period,
  search,
  now = new Date(),
} = {}) => {
  const { startOfDay, startOfNextDay } = getEcuadorDateBounds(now);
  const filters = [
    {
      activa: true,
      estado: { $nin: ["borrador", "desactivada", "finalizada"] },
      puntosRecoleccion: {
        $elemMatch: {
          activo: { $ne: false },
          estado: { $ne: "inactivo" },
          ...buildPointCollectorAssignmentFilter(collectorId),
        },
      },
      $and: [
        {
          $or: [
            { fechaInicio: null },
            { fechaInicio: { $lt: startOfNextDay } },
          ],
        },
        {
          $or: [
            { fechaFin: null },
            { fechaFin: { $gte: startOfDay } },
          ],
        },
      ],
    },
  ];
  if (period) filters.push({ periodoAcademico: period });
  if (search) {
    filters.push({
      nombre: new RegExp(escapeRegex(search), "i"),
    });
  }
  return filters.length === 1 ? filters[0] : { $and: filters };
};

const mapCollectorPointAssignments = (collectorIds, campaigns) => {
  const assignmentsByCollector = new Map(
    (collectorIds || []).map((id) => [String(id), []])
  );
  for (const campaign of campaigns || []) {
    for (const point of campaign.puntosRecoleccion || []) {
      for (const collectorId of point.recolectores || []) {
        const assignments = assignmentsByCollector.get(String(collectorId));
        if (!assignments) continue;
        assignments.push({
          campanaId: String(campaign._id),
          campanaNombre: campaign.nombre,
          puntoRecoleccionId: String(point._id),
          puntoNombre: point.nombre,
          rol: String(point.responsableRecolector) === String(collectorId)
            ? "principal"
            : "secundario",
        });
      }
    }
  }
  return assignmentsByCollector;
};

const isCollectorAssignedToCampaign = (campaign, collectorId) => {
  return (campaign?.puntosRecoleccion || []).some((point) =>
    isPickupPointActive(point)
    && isCollectorAssignedToPoint(point, collectorId)
  );
};

const buildCollectorDonationFilter = (
  campaignId,
  collectorId,
  { includeAssignmentHistory = false } = {}
) => ({
  campana: campaignId,
  tipo: "fisica",
  ...(includeAssignmentHistory
    ? {
        $or: [
          { recolector: collectorId },
          { "historialRecolectores.recolectorAnterior": collectorId },
          { "historialRecolectores.recolectorNuevo": collectorId },
        ],
      }
    : { recolector: collectorId }),
});

const buildPendingCollectorDonationFilter = ({
  campaignPoints = [],
} = {}) => ({
  tipo: "fisica",
  estado: "pendiente",
  recolector: null,
  $or: [
    { campana: null },
    ...campaignPoints.map(({ campaignId, pointIds }) => ({
      campana: campaignId,
      puntoRecoleccionRef: { $in: pointIds },
    })),
  ],
});

export {
  buildCampaignHistoryFilter,
  buildCurrentCollectorCampaignFilter,
  isCurrentCollectorCampaignAvailable,
  mapCollectorPointAssignments,
  isCollectorAssignedToCampaign,
  buildCollectorDonationFilter,
  buildPendingCollectorDonationFilter,
};
