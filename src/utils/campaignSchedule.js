const ECUADOR_TIME_ZONE = "America/Guayaquil";

const parseCampaignTime = (value) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const getCampaignDateKey = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

const normalizeCampaignDate = (value) => {
  if (typeof value === "string") {
    const text = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
    if (match && (text.length === 10 || !Number.isNaN(new Date(text).getTime()))) {
      const [, yearText, monthText, dayText] = match;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
      ) {
        return null;
      }
      return date;
    }
  }
  const key = getCampaignDateKey(value);
  if (key === null || key === undefined) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const isCampaignDateRangeValid = (startValue, endValue) => {
  const start = getCampaignDateKey(startValue);
  const end = getCampaignDateKey(endValue);
  if (start === undefined || end === undefined) return false;
  return !start || !end || end >= start;
};

const getEcuadorDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ECUADOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value])
  );
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60
      + Number(values.minute)
      + Number(values.second) / 60,
  };
};

const getEcuadorDateBounds = (date = new Date()) => {
  const { dateKey } = getEcuadorDateTime(date);
  const [year, month, day] = dateKey.split("-").map(Number);
  const startOfDay = new Date(Date.UTC(year, month - 1, day));
  const startOfNextDay = new Date(startOfDay);
  startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);
  return { startOfDay, startOfNextDay };
};

const isCampaignAvailableNow = (campaign, now = new Date()) => {
  const state = String(campaign?.estado ?? "").toLowerCase();
  if (
    campaign?.activa !== true
    || ["borrador", "cancelada", "desactivada", "finalizada"].includes(state)
  ) {
    return false;
  }

  const startDate = getCampaignDateKey(campaign.fechaInicio);
  const endDate = getCampaignDateKey(campaign.fechaFin);
  const startTime = parseCampaignTime(campaign.horaInicio);
  const endTime = parseCampaignTime(campaign.horaFin);
  if (
    startDate === undefined
    || endDate === undefined
    || startTime === null
    || endTime === null
    || endTime <= startTime
    || (startDate && endDate && endDate < startDate)
  ) {
    return false;
  }

  const current = getEcuadorDateTime(now);
  if (
    (startDate && current.dateKey < startDate)
    || (endDate && current.dateKey > endDate)
    || current.minutes < startTime
    || current.minutes > endTime
  ) {
    return false;
  }
  return true;
};

const isCampaignScheduleFinished = (campaign, now = new Date()) => {
  const state = String(campaign?.estado ?? "").toLowerCase();
  if (state === "finalizada") return true;
  if (state === "borrador") return false;
  const endDate = getCampaignDateKey(campaign?.fechaFin);
  if (!endDate) return false;

  const current = getEcuadorDateTime(now);
  if (current.dateKey > endDate) return true;
  if (current.dateKey < endDate) return false;

  const endTime = parseCampaignTime(campaign?.horaFin);
  return endTime === null ? false : current.minutes > endTime;
};

export {
  ECUADOR_TIME_ZONE,
  getCampaignDateKey,
  getEcuadorDateBounds,
  getEcuadorDateTime,
  isCampaignAvailableNow,
  isCampaignDateRangeValid,
  isCampaignScheduleFinished,
  normalizeCampaignDate,
  parseCampaignTime,
};
