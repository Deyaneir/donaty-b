const isPickupPointActive = (point) =>
  String(point?.estado ?? "").toLowerCase() !== "inactivo"
  && point?.activo !== false;

const serializePickupPoint = (point, campanaId, { includeAssignments = true } = {}) => {
  const serialized = {
    ...point,
    _id: String(point._id),
    id: String(point._id),
    campanaId: String(campanaId),
    edificioId: point.edificioId ?? null,
    nombreEdificio: point.nombreEdificio ?? "",
    edificio: point.edificio ?? "",
    piso: point.piso ?? "",
    aula: point.aula ?? "",
    horariosAtencion: point.horariosAtencion ?? [],
    descripcion: point.descripcion ?? "",
    direccion: point.direccion ?? "",
    referenciasLugar: point.referenciasLugar ?? "",
    telefonoContacto: point.telefonoContacto ?? "",
    latitud: point.latitud ?? null,
    longitud: point.longitud ?? null,
    latitude: point.latitud ?? null,
    longitude: point.longitud ?? null,
    activo: isPickupPointActive(point),
    estado: isPickupPointActive(point) ? "activo" : "inactivo",
  };

  if (includeAssignments) {
    serialized.recolectoresAsignados = point.recolectores?.length ?? 0;
  } else {
    delete serialized.recolectores;
    delete serialized.responsableRecolector;
  }
  return serialized;
};

const serializePickupPoints = (
  points,
  campanaId,
  { includeAssignments = true, activeOnly = false } = {}
) =>
  (points || [])
    .filter((point) => !activeOnly || isPickupPointActive(point))
    .map((point) => serializePickupPoint(point, campanaId, { includeAssignments }));

const serializeTracePickupPoint = (point) => {
  if (!point) return null;

  return {
    _id: String(point._id),
    nombre: point.nombre ?? "",
    edificioId: point.edificioId ?? null,
    nombreEdificio: point.nombreEdificio ?? "",
    edificio: point.edificio ?? "",
    piso: point.piso ?? "",
    aula: point.aula ?? "",
    latitud: point.latitud ?? null,
    longitud: point.longitud ?? null,
    direccion: point.direccion ?? "",
    referenciasLugar: point.referenciasLugar ?? "",
  };
};

const buildPickupPointsResponse = (campaign, options = {}) => {
  const puntos = serializePickupPoints(
    campaign.puntosRecoleccion,
    campaign._id,
    options
  );
  return {
    campanaId: String(campaign._id),
    totalPuntos: puntos.length,
    puntos,
  };
};

const serializeCollectorAssignments = (campaigns, collectorId) =>
  (campaigns || []).flatMap((campaign) =>
    (campaign.puntosRecoleccion || [])
      .filter(
        (point) =>
          isPickupPointActive(point)
          && (point.recolectores || [])
            .some((assignedId) => String(assignedId) === String(collectorId))
      )
      .map((point) => ({
        campanaId: String(campaign._id),
        campanaNombre: campaign.nombre ?? "",
        puntoRecoleccionId: String(point._id),
        puntoNombre: point.nombre ?? "",
        edificioId: point.edificioId ?? null,
        nombreEdificio: point.nombreEdificio ?? "",
        edificio: point.edificio ?? "",
        piso: point.piso ?? "",
        aula: point.aula ?? "",
        latitud: point.latitud ?? null,
        longitud: point.longitud ?? null,
        horariosAtencion: point.horariosAtencion ?? [],
        direccion: point.direccion ?? "",
        referenciasLugar: point.referenciasLugar ?? "",
      }))
  );

export {
  isPickupPointActive,
  serializePickupPoint,
  serializePickupPoints,
  serializeTracePickupPoint,
  buildPickupPointsResponse,
  serializeCollectorAssignments,
};
