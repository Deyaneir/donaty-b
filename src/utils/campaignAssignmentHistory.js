const collectorIdOf = (entry) => {
  const collector = entry?.recolector;
  return String(collector?._id ?? collector?.id ?? collector ?? "");
};

const buildInitialAssignmentHistory = ({
  points = [],
  campaignId,
  administratorId,
  assignedAt,
}) =>
  points.flatMap((point) => {
    const collectorIds = new Set([
      ...(point?.recolectores || []).map((collector) =>
        String(collector?._id ?? collector)
      ),
      ...(point?.responsableRecolector
        ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
        : []),
    ]);

    return [...collectorIds].filter(Boolean).map((collectorId) => ({
      recolector: collectorId,
      campana: campaignId,
      puntoNuevo: point._id,
      administrador: administratorId,
      fecha: assignedAt,
      motivo: "Asignación inicial al crear la campaña",
      vigente: true,
    }));
  });

const buildPointAssignmentHistoryChanges = ({
  previousPoints = [],
  nextPoints = [],
  history = [],
  campaignId,
  administratorId,
  assignedAt,
}) => {
  const pointByCollector = (points) => {
    const assignments = new Map();
    for (const point of points) {
      const collectorIds = new Set([
        ...(point?.recolectores || []).map((collector) =>
          String(collector?._id ?? collector)
        ),
        ...(point?.responsableRecolector
          ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
          : []),
      ]);
      for (const collectorId of collectorIds) {
        if (collectorId) assignments.set(collectorId, String(point._id));
      }
    }
    return assignments;
  };
  const previousAssignments = pointByCollector(previousPoints);
  const nextAssignments = pointByCollector(nextPoints);
  const changes = [...new Set([
    ...previousAssignments.keys(),
    ...nextAssignments.keys(),
  ])].filter((collectorId) =>
    previousAssignments.get(collectorId) !== nextAssignments.get(collectorId)
  );
  const nextHistory = history.map((entry) =>
    typeof entry?.toObject === "function" ? entry.toObject() : { ...entry }
  );

  for (const collectorId of changes) {
    const previousPoint = previousAssignments.get(collectorId) ?? null;
    const nextPoint = nextAssignments.get(collectorId) ?? null;
    for (const entry of nextHistory) {
      if (entry.vigente !== false && collectorIdOf(entry) === collectorId) {
        entry.vigente = false;
      }
    }
    nextHistory.push({
      recolector: collectorId,
      campana: campaignId,
      puntoAnterior: previousPoint,
      puntoNuevo: nextPoint,
      administrador: administratorId,
      fecha: assignedAt,
      motivo: nextPoint
        ? "Asignación por edición de campaña"
        : "Retiro por edición de campaña",
      vigente: Boolean(nextPoint),
    });
  }

  return nextHistory;
};

const enrichAssignmentHistory = (history = []) => {
  const byCollector = new Map();
  history.forEach((entry, index) => {
    const collectorId = collectorIdOf(entry);
    if (!collectorId) return;
    const timeline = byCollector.get(collectorId) || [];
    timeline.push({ entry, index });
    byCollector.set(collectorId, timeline);
  });

  const endDateByIndex = new Map();
  for (const timeline of byCollector.values()) {
    timeline.sort((left, right) => {
      const leftTime = new Date(left.entry.fecha).getTime();
      const rightTime = new Date(right.entry.fecha).getTime();
      return leftTime - rightTime || left.index - right.index;
    });
    timeline.forEach((item, index) => {
      const next = timeline[index + 1];
      endDateByIndex.set(item.index, next?.entry.fecha ?? null);
    });
  }

  return history
    .map((entry, index) => ({
      ...entry,
      fechaFin: entry.puntoNuevo ? endDateByIndex.get(index) ?? null : null,
    }))
    .sort((left, right) => new Date(right.fecha) - new Date(left.fecha));
};

export {
  buildInitialAssignmentHistory,
  buildPointAssignmentHistoryChanges,
  enrichAssignmentHistory,
};
