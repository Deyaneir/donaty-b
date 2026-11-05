export const MAX_GPS_ACCURACY_METERS = 50;
export const MAX_GPS_AGE_MS = 5 * 60 * 1000;
export const MAX_GPS_FUTURE_SKEW_MS = 30 * 1000;

export const hasValidCollectorCoordinates = (latitude, longitude) =>
  Number.isFinite(latitude)
  && latitude >= -90
  && latitude <= 90
  && Number.isFinite(longitude)
  && longitude >= -180
  && longitude <= 180;

export const classifyCollectorGeofenceState = ({
  collectorActive,
  capturedAt,
  latitude,
  longitude,
  accuracyMeters,
  insideGeofence,
  now = Date.now(),
}) => {
  if (!collectorActive) return "inactivo";

  const timestamp = capturedAt ? new Date(capturedAt).getTime() : NaN;
  const age = now - timestamp;
  if (
    !Number.isFinite(age)
    || age < -MAX_GPS_FUTURE_SKEW_MS
    || age > MAX_GPS_AGE_MS
  ) {
    return capturedAt ? "desactualizado" : "sin_registro";
  }

  if (!hasValidCollectorCoordinates(latitude, longitude)) {
    return "sin_registro";
  }

  if (
    !Number.isFinite(accuracyMeters)
    || accuracyMeters < 0
    || accuracyMeters > MAX_GPS_ACCURACY_METERS
  ) {
    return "impreciso";
  }

  return insideGeofence ? "dentro" : "fuera";
};

export const getCollectorGeofenceTransition = (previousState, nextState) => {
  if (nextState === "fuera" && previousState !== "fuera") return "salida";
  if (nextState === "dentro" && previousState === "fuera") return "retorno";
  return null;
};

export const classifyCollectorLocation = ({
  collectorActive,
  matchesAssignment,
  updatedAt,
  latitude,
  longitude,
  accuracyMeters,
  now = Date.now(),
}) => {
  if (!collectorActive || !matchesAssignment) return "inactivo";

  const timestamp = updatedAt ? new Date(updatedAt).getTime() : NaN;
  const age = now - timestamp;
  if (
    !Number.isFinite(age)
    || age < -MAX_GPS_FUTURE_SKEW_MS
    || age > MAX_GPS_AGE_MS
  ) {
    return "desactualizado";
  }

  const hasValidCoordinates =
    hasValidCollectorCoordinates(latitude, longitude)
    && Number.isFinite(accuracyMeters)
    && accuracyMeters >= 0
    && accuracyMeters <= MAX_GPS_ACCURACY_METERS;
  return hasValidCoordinates ? "activo" : "sin_registro";
};
