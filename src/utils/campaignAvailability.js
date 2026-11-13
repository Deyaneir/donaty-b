import { getCampaignDateKey } from "./campaignSchedule.js";

const toDayNumber = (date) => {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
};

const parseTime = (value) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const intervalsOverlap = (left, right) =>
  left.start < right.end && right.start < left.end;

const getScheduleForDay = (campaign, point, day) => {
  const campaignDays = Array.isArray(campaign.diasAtencion)
    ? campaign.diasAtencion.map(Number)
    : null;
  if (campaignDays?.length && !campaignDays.includes(day)) return [];

  const pointSchedules = (point?.horariosAtencion || [])
    .filter((schedule) => Number(schedule.diaSemana) === day);
  const campaignStart = parseTime(campaign.horaInicio);
  const campaignEnd = parseTime(campaign.horaFin);
  const base = campaignStart !== null && campaignEnd !== null
    ? { start: campaignStart, end: campaignEnd }
    : { start: 0, end: 24 * 60 };

  if (!pointSchedules.length) {
    return !point?.horariosAtencion?.length
      ? [base]
      : campaignDays?.length
        ? []
        : [];
  }

  return pointSchedules.flatMap((schedule) => {
    const start = parseTime(schedule.horaInicio);
    const end = parseTime(schedule.horaFin);
    if (start === null || end === null) return [];
    const interval = { start: Math.max(start, base.start), end: Math.min(end, base.end) };
    return interval.start < interval.end ? [interval] : [];
  });
};

const hasCampaignScheduleOverlap = (
  leftCampaign,
  leftPoint,
  rightCampaign,
  rightPoint
) => {
  const startDates = [leftCampaign.fechaInicio, rightCampaign.fechaInicio]
    .map(getCampaignDateKey);
  const endDates = [leftCampaign.fechaFin, rightCampaign.fechaFin]
    .map(getCampaignDateKey);
  if ([...startDates, ...endDates].some((value) => !value)) {
    return true;
  }
  const start = [...startDates].sort().at(-1);
  const end = [...endDates].sort()[0];
  if (start > end) return false;

  const [startYear, startMonth, startDate] = start.split("-").map(Number);
  const [endYear, endMonth, endDate] = end.split("-").map(Number);
  const day = new Date(Date.UTC(startYear, startMonth - 1, startDate));
  const finalDay = new Date(Date.UTC(endYear, endMonth - 1, endDate));
  for (let cursor = day; cursor <= finalDay; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = toDayNumber(cursor);
    const leftIntervals = getScheduleForDay(leftCampaign, leftPoint, weekday);
    if (!leftIntervals.length) continue;
    const rightIntervals = getScheduleForDay(rightCampaign, rightPoint, weekday);
    if (leftIntervals.some((left) =>
      rightIntervals.some((right) => intervalsOverlap(left, right))
    )) {
      return true;
    }
  }
  return false;
};

const getAvailableCollectorsForCampaign = (collectors, assignedCampaigns, campaign) => {
  const candidatePoints = (campaign.puntosRecoleccion || [])
    .filter((point) =>
      String(point?.estado ?? "").toLowerCase() !== "inactivo"
      && point?.activo !== false
    );
  const availabilityPoints = candidatePoints.length
    ? candidatePoints
    : [{ horariosAtencion: [] }];

  return (collectors || []).filter((collector) => {
    if (
      collector.status === false
      || collector.aprobado === false
      || collector.confirmEmail !== true
    ) {
      return false;
    }
    const collectorId = String(collector._id);
    const reservationConflict = (collector.reservasHorarioCampanas || []).some(
      (reservation) =>
        String(reservation.campana) !== String(campaign._id)
        && availabilityPoints.some((point) =>
          hasCampaignScheduleOverlap(
            campaign,
            point,
            reservation,
            reservation.punto
          )
        )
    );
    if (reservationConflict) return false;

    return !(assignedCampaigns || []).some((other) =>
      (other.puntosRecoleccion || [])
        .filter((point) =>
          point.activo !== false
          && String(point.estado || "").toLowerCase() !== "inactivo"
        )
        .some((point) => {
          const assignedCollectorIds = [
            ...(point.recolectores || []).map((id) => String(id?._id ?? id)),
            ...(point.responsableRecolector
              ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
              : []),
          ];
          return assignedCollectorIds.includes(collectorId)
            && availabilityPoints.some((candidatePoint) =>
              hasCampaignScheduleOverlap(campaign, candidatePoint, other, point)
            );
        })
    );
  });
};

const filterCurrentCollectorReservations = (
  reservations,
  campaigns,
  collectorId
) => {
  const campaignById = new Map(
    (campaigns || []).map((campaign) => [String(campaign._id), campaign])
  );
  const normalizedCollectorId = String(collectorId);

  return (reservations || []).filter((reservation) => {
    const campaign = campaignById.get(String(reservation.campana));
    if (!campaign || ["desactivada", "finalizada"].includes(String(campaign.estado || "").toLowerCase())) {
      return false;
    }

    return (campaign.puntosRecoleccion || []).some((point) => {
      if (
        point.activo === false
        || String(point.estado || "").toLowerCase() === "inactivo"
      ) {
        return false;
      }
      const pointId = String(point._id);
      const assigned = (point.recolectores || []).some(
        (id) => String(id?._id ?? id) === normalizedCollectorId
      ) || String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "")
        === normalizedCollectorId;
      return assigned
        && (!reservation.punto?._id || String(reservation.punto._id) === pointId);
    });
  });
};

const countCampaignCollectorAvailability = (
  availableCollectors,
  assignedCollectorIds
) => {
  const assignedIds = new Set((assignedCollectorIds || []).map(String));
  const availableIds = new Set(
    (availableCollectors || [])
      .map((collector) => String(collector?._id ?? collector))
      .filter((id) => !assignedIds.has(id))
  );
  return {
    asignados: assignedIds.size,
    disponiblesAdicionales: availableIds.size,
    disponibles: assignedIds.size + availableIds.size,
  };
};

export {
  getAvailableCollectorsForCampaign,
  hasCampaignScheduleOverlap,
  filterCurrentCollectorReservations,
  countCampaignCollectorAvailability,
};
