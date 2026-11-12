import assert from "node:assert/strict";
import test from "node:test";
import { serializeDonationEvidence } from "../src/utils/donationEvidence.js";

test("evidence photos are grouped under a collector name without exposing the collector ID", () => {
  const result = serializeDonationEvidence([
    {
      etapa: "recepcion",
      recolector: { _id: "collector-id", nombre: "Ana", apellido: "Pérez" },
      imagenUrl: "https://example.test/one.jpg",
      imagenPublicId: "internal-one",
      fecha: new Date("2026-11-08T10:00:00.000Z"),
    },
    {
      etapa: "recepcion",
      recolector: { _id: "collector-id", nombre: "Ana", apellido: "Pérez" },
      imagenUrl: "https://example.test/two.jpg",
      imagenPublicId: "internal-two",
      fecha: new Date("2026-11-08T10:01:00.000Z"),
    },
  ]);

  assert.equal(result.recepcion.length, 1);
  assert.deepEqual(result.recepcion[0].responsable, {
    nombre: "Ana",
    apellido: "Pérez",
  });
  assert.equal(result.recepcion[0].fotografias.length, 2);
  assert.deepEqual(Object.keys(result.recepcion[0].fotografias[0]).sort(), [
    "fecha",
    "imagenUrl",
  ]);
  assert.equal(JSON.stringify(result).includes("collector-id"), false);
  assert.equal(JSON.stringify(result).includes("internal-one"), false);
});
