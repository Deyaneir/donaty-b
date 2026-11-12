const isPickupPointActive = (point) =>
  String(point?.estado ?? "").toLowerCase() !== "inactivo"
  && point?.activo !== false;

const isCollectorAssignedToPoint = (point, collectorId) => {
  const id = String(collectorId);
  return String(point?.responsableRecolector?._id ?? point?.responsableRecolector ?? "") === id
    || (point?.recolectores || []).some(
      (assignedId) => String(assignedId?._id ?? assignedId) === id
    );
};

const buildPointCollectorAssignmentFilter = (collectorId) => ({
  $or: [
    { recolectores: collectorId },
    { responsableRecolector: collectorId },
  ],
});

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
    serialized.recolectoresSecundarios = (point.recolectores || [])
      .filter(
        (collectorId) =>
          String(collectorId) !== String(point.responsableRecolector || "")
      )
      .map(String);
  } else {
    delete serialized.recolectores;
    delete serialized.responsableRecolector;
    delete serialized.recolectoresSecundarios;
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
          && isCollectorAssignedToPoint(point, collectorId)
      )
      .map((point) => {
        const pointId = String(point._id);
        const collectorKey = String(collectorId);
        const assignmentHistory = (campaign.historialAsignacionesRecolectores || [])
          .filter((entry) =>
            String(entry?.recolector?._id ?? entry?.recolector ?? "") === collectorKey
            && String(entry?.puntoNuevo?._id ?? entry?.puntoNuevo ?? "") === pointId
            && entry?.vigente !== false
          )
          .sort((left, right) =>
            new Date(right.fecha || 0).getTime() - new Date(left.fecha || 0).getTime()
          );
        const assignmentDate = assignmentHistory[0]?.fecha
          ? new Date(assignmentHistory[0].fecha)
          : null;
        const fechaAsignacion = assignmentDate && !Number.isNaN(assignmentDate.getTime())
          ? assignmentDate.toISOString()
          : null;

        return {
          campanaId: String(campaign._id),
          campanaNombre: campaign.nombre ?? "",
          puntoRecoleccionId: pointId,
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
          fechaAsignacion,
          rol: String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "")
            === collectorKey
            ? "principal"
            : "secundario",
          punto: {
            _id: pointId,
            id: pointId,
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
            horariosAtencion: point.horariosAtencion ?? [],
          },
        };
      })
  );

export {
  isPickupPointActive,
  isCollectorAssignedToPoint,
  buildPointCollectorAssignmentFilter,
  serializePickupPoint,
  serializePickupPoints,
  serializeTracePickupPoint,
  buildPickupPointsResponse,
  serializeCollectorAssignments,
};
