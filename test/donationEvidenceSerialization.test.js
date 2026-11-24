import assert from "node:assert/strict";
import test from "node:test";
import { serializeDonationEvidence } from "../src/utils/donationEvidence.js";

test("evidence photos include stage, date, and the collector identity separately from their name", () => {
  const result = serializeDonationEvidence([
    {
      _id: "evidence-1",
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
    id: "collector-id",
    nombre: "Ana",
    apellido: "Pérez",
  });
  assert.equal(result.recepcion[0].fotografias.length, 2);
  assert.deepEqual(result.recepcion[0].fotografias[0], {
    id: "evidence-1",
    etapa: "recepcion",
    imagenUrl: "https://example.test/one.jpg",
    fecha: new Date("2026-11-08T10:00:00.000Z"),
    recolector: {
      id: "collector-id",
      nombre: "Ana",
      apellido: "Pérez",
    },
  });
  assert.equal(JSON.stringify(result).includes("internal-one"), false);
});

test("evidence without an available collector name does not substitute the ID", () => {
  const result = serializeDonationEvidence([{
    etapa: "devolucion",
    recolector: "collector-id",
    imagenUrl: "https://example.test/return.jpg",
    fecha: null,
  }]);

  assert.deepEqual(result.devolucion[0].fotografias[0].recolector, {
    id: "collector-id",
    nombre: null,
    apellido: null,
  });
  assert.equal(Object.hasOwn(result.devolucion[0].fotografias[0], "id"), false);
});
