import { urlPublica } from "./publicUrl.js";

const EVIDENCE_STAGES = ["recepcion", "finalizacion", "devolucion"];

const serializeDonationEvidence = (evidences = []) => {
  const grouped = Object.fromEntries(EVIDENCE_STAGES.map((stage) => [stage, []]));
  const collectorGroups = new Map();

  for (const evidence of evidences) {
    const stage = String(evidence.etapa ?? "");
    if (!Object.hasOwn(grouped, stage)) continue;
    const collector = evidence.recolector;
    const collectorId = String(collector?._id ?? collector ?? "");
    const groupKey = `${stage}:${collectorId}`;
    let group = collectorGroups.get(groupKey);
    if (!group) {
      group = {
        responsable: {
          nombre: collector?.nombre ?? "",
          apellido: collector?.apellido ?? "",
        },
        fotografias: [],
      };
      collectorGroups.set(groupKey, group);
      grouped[stage].push(group);
    }
    group.fotografias.push({
      imagenUrl: urlPublica(evidence.imagenUrl),
      fecha: evidence.fecha,
    });
  }

  return grouped;
};

export { serializeDonationEvidence };
