const collectorIdOf = (entry) => {
  const collector = entry?.recolector;
  return String(collector?._id ?? collector?.id ?? collector ?? "");
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

export { enrichAssignmentHistory };
