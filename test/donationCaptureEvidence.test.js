import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollectionEvidence,
  validateCollectionEvidence,
} from "../src/controllers/donacion_controller.js";
import { getEvidenceFiles } from "../src/controllers/donacion_evidencia_controller.js";
import {
  createDonationEvidenceRecords,
  serializeDonationEvidenceRecords,
} from "../src/utils/donationEvidence.js";

test("recollection requires a photo before the donation can move to recolectada", () => {
  assert.throws(
    () => validateCollectionEvidence({ image: null, idempotencyKey: "abc" }),
    { statusCode: 400 }
  );

  const file = { tempFilePath: "/tmp/pickup.jpg", mimetype: "image/jpeg", size: 500 };
  const evidence = buildCollectionEvidence({ files: { imagen: file }, body: {}, get: () => "" }, { _id: "collector-1", rol: "recolector" });

  assert.equal(evidence.image, file);
  assert.ok(evidence.idempotencyKey.startsWith("recolectada:"));
  assert.equal(validateCollectionEvidence(evidence), true);

  const mobileEvidence = buildCollectionEvidence(
    {
      files: { evidencias: file },
      body: { etapa: "recepcion", idempotencyKey: "mobile-pickup-key" },
      get: () => "",
    },
    { _id: "collector-1", rol: "recolector" }
  );
  assert.equal(mobileEvidence.image, file);
  assert.deepEqual(mobileEvidence.images, [file]);
  assert.equal(mobileEvidence.etapa, "recepcion");
  assert.equal(mobileEvidence.idempotencyKey, "mobile-pickup-key");
  assert.equal(validateCollectionEvidence(mobileEvidence), true);

  const secondFile = {
    tempFilePath: "/tmp/pickup-2.jpg",
    mimetype: "image/jpeg",
    size: 600,
  };
  const multipleEvidence = buildCollectionEvidence(
    {
      files: { evidencias: [file, secondFile] },
      body: { idempotencyKey: "multi-photo-key" },
      get: () => "",
    },
    { _id: "collector-1", rol: "recolector" }
  );
  assert.deepEqual(multipleEvidence.images, [file, secondFile]);
  assert.equal(multipleEvidence.image, null);
  assert.equal(multipleEvidence.idempotencyKey, "multi-photo-key");
  assert.equal(validateCollectionEvidence(multipleEvidence), true);

  const mobileMultipleEvidence = buildCollectionEvidence(
    {
      files: { imagenes: [file, secondFile] },
      body: { idempotencyKey: "multi-image-key" },
      get: () => "",
    },
    { _id: "collector-1", rol: "recolector" }
  );
  assert.deepEqual(mobileMultipleEvidence.images, [file, secondFile]);
  assert.equal(validateCollectionEvidence(mobileMultipleEvidence), true);
  assert.throws(
    () => validateCollectionEvidence({ ...mobileEvidence, etapa: "entrega" }),
    { statusCode: 400 }
  );
  assert.throws(
    () => validateCollectionEvidence({ ...mobileEvidence, idempotencyKey: "x".repeat(129) }),
    { statusCode: 400 }
  );
});

test("recollection stores every uploaded URL under the recepcion stage and serializes it consistently", () => {
  const uploadedImages = [
    { imagenUrl: "https://images.example.test/photo-1.jpg", imagenPublicId: "private-1" },
    { imagenUrl: "https://images.example.test/photo-2.jpg", imagenPublicId: "private-2" },
  ];
  const evidence = createDonationEvidenceRecords({
    etapa: "recepcion",
    recolector: "collector-example",
    fecha: new Date("2026-11-23T12:00:00.000Z"),
    imagenes: uploadedImages,
    idempotencyKey: "pickup-key",
  });
  const response = serializeDonationEvidenceRecords(evidence);

  assert.equal(evidence.length, 2);
  assert.ok(evidence.every((item) => item.etapa === "recepcion"));
  assert.ok(evidence.every((item) => item.recolector === "collector-example"));
  assert.ok(evidence.every((item) => item.idempotencyKey === "pickup-key"));
  assert.deepEqual(response.map(({ etapa, imagenUrl, recolector }) => ({
    etapa,
    imagenUrl,
    recolector,
  })), [
    {
      etapa: "recepcion",
      imagenUrl: "https://images.example.test/photo-1.jpg",
      recolector: { id: "collector-example", nombre: null, apellido: null },
    },
    {
      etapa: "recepcion",
      imagenUrl: "https://images.example.test/photo-2.jpg",
      recolector: { id: "collector-example", nombre: null, apellido: null },
    },
  ]);
});

test("the evidence upload endpoint normalizes a single file or multiple multipart files", () => {
  const first = { tempFilePath: "/tmp/first.jpg" };
  const second = { tempFilePath: "/tmp/second.jpg" };
  assert.deepEqual(getEvidenceFiles({ imagen: first }), [first]);
  assert.deepEqual(getEvidenceFiles({ evidencias: [first, second] }), [first, second]);
  assert.deepEqual(getEvidenceFiles({ imagenes: [first, second] }), [first, second]);
});
