import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollectionEvidence,
  validateCollectionEvidence,
} from "../src/controllers/donacion_controller.js";
import { getEvidenceFiles } from "../src/controllers/donacion_evidencia_controller.js";

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
    { files: { evidencias: file }, body: {}, get: () => "" },
    { _id: "collector-1", rol: "recolector" }
  );
  assert.equal(mobileEvidence.image, file);
  assert.deepEqual(mobileEvidence.images, [file]);
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
});

test("the evidence upload endpoint normalizes a single file or multiple multipart files", () => {
  const first = { tempFilePath: "/tmp/first.jpg" };
  const second = { tempFilePath: "/tmp/second.jpg" };
  assert.deepEqual(getEvidenceFiles({ imagen: first }), [first]);
  assert.deepEqual(getEvidenceFiles({ evidencias: [first, second] }), [first, second]);
  assert.deepEqual(getEvidenceFiles({ imagenes: [first, second] }), [first, second]);
});
