import { urlPublica } from "./publicUrl.js";

const EVIDENCE_STAGES = ["recepcion", "finalizacion", "devolucion"];

const createDonationEvidenceRecords = ({
  etapa,
  recolector,
  fecha,
  imagenes = [],
  idempotencyKey,
}) =>
  imagenes.map((imagen) => ({
    etapa,
    recolector,
    fecha,
    ...imagen,
    idempotencyKey,
  }));

const serializeDonationEvidenceRecords = (evidences = []) =>
  evidences
    .filter((evidence) => EVIDENCE_STAGES.includes(String(evidence.etapa ?? "")))
    .map((evidence) => {
      const collector = evidence.recolector;
      const collectorId = collector?._id
        ? String(collector._id)
        : collector && typeof collector !== "object"
          ? String(collector)
          : null;
      return {
        ...(evidence._id ? { id: String(evidence._id) } : {}),
        etapa: String(evidence.etapa),
        imagenUrl: urlPublica(evidence.imagenUrl),
        fecha: evidence.fecha ?? null,
        recolector: {
          id: collectorId,
          nombre: collector?.nombre ?? null,
          apellido: collector?.apellido ?? null,
        },
      };
    });

const serializeDonationEvidence = (evidences = []) => {
  const grouped = Object.fromEntries(EVIDENCE_STAGES.map((stage) => [stage, []]));
  const collectorGroups = new Map();

  for (const evidence of serializeDonationEvidenceRecords(evidences)) {
    const stage = evidence.etapa;
    const collector = evidence.recolector;
    const collectorId = collector.id || "";
    const groupKey = `${stage}:${collectorId}`;
    let group = collectorGroups.get(groupKey);
    if (!group) {
      group = {
        responsable: {
          id: collectorId || null,
          nombre: collector.nombre,
          apellido: collector.apellido,
        },
        fotografias: [],
      };
      collectorGroups.set(groupKey, group);
      grouped[stage].push(group);
    }
    group.fotografias.push(evidence);
  }

  return grouped;
};

export {
  createDonationEvidenceRecords,
  serializeDonationEvidence,
  serializeDonationEvidenceRecords,
};
