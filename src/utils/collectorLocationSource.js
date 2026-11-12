const locationTimestamp = (location, simulated) => {
  const value = simulated
    ? location?.updatedAt
    : location?.actualizadoEn ?? location?.capturadoEn ?? location?.updatedAt;
  const timestamp = value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const selectLatestCollectorLocation = (realLocation, simulatedLocation) => {
  if (!simulatedLocation) return { location: realLocation ?? null, simulated: false };
  if (!realLocation) return { location: simulatedLocation, simulated: true };
  return locationTimestamp(simulatedLocation, true) > locationTimestamp(realLocation, false)
    ? { location: simulatedLocation, simulated: true }
    : { location: realLocation, simulated: false };
};

const serializeCollectorLocation = (location) => {
  if (!location) return null;
  const campaignId = location.campana ?? location.campaign;
  const pointId = location.puntoRecoleccion ?? location.point;

  return {
    campanaId: campaignId ? String(campaignId?._id ?? campaignId) : null,
    puntoRecoleccionId: pointId ? String(pointId?._id ?? pointId) : null,
    latitud: location.latitud ?? location.latitude,
    longitud: location.longitud ?? location.longitude,
    precisionMetros: location.precisionMetros ?? location.accuracyMeters ?? null,
    capturadoEn: location.capturadoEn ?? location.capturedAt ?? null,
    actualizadoEn: location.actualizadoEn ?? location.updatedAt ?? null,
  };
};

export { selectLatestCollectorLocation, serializeCollectorLocation };
