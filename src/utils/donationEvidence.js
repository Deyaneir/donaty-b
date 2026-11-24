import { urlPublica } from "./publicUrl.js";

const EVIDENCE_STAGES = ["recepcion", "finalizacion", "devolucion"];

const serializeDonationEvidence = (evidences = []) => {
  const grouped = Object.fromEntries(EVIDENCE_STAGES.map((stage) => [stage, []]));
  const collectorGroups = new Map();

  for (const evidence of evidences) {
    const stage = String(evidence.etapa ?? "");
    if (!Object.hasOwn(grouped, stage)) continue;
    const collector = evidence.recolector;
    const collectorId = collector?._id
      ? String(collector._id)
      : collector && typeof collector !== "object"
        ? String(collector)
        : "";
    const groupKey = `${stage}:${collectorId}`;
    let group = collectorGroups.get(groupKey);
    if (!group) {
      group = {
        responsable: {
          id: collectorId || null,
          nombre: collector?.nombre ?? null,
          apellido: collector?.apellido ?? null,
        },
        fotografias: [],
      };
      collectorGroups.set(groupKey, group);
      grouped[stage].push(group);
    }
    const photo = {
      ...(evidence._id ? { id: String(evidence._id) } : {}),
      etapa: stage,
      imagenUrl: urlPublica(evidence.imagenUrl),
      fecha: evidence.fecha ?? null,
      recolector: {
        id: collectorId || null,
        nombre: collector?.nombre ?? null,
        apellido: collector?.apellido ?? null,
      },
    };
    group.fotografias.push(photo);
  }

  return grouped;
};

export { serializeDonationEvidence };
