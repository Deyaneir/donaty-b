import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDonationReturnRequest,
  usesMultipartDonationReturn,
  validateDonationReturnRequest,
} from "../src/controllers/donacion_controller.js";

const makeRequest = ({ etapa = "devolucion", idempotencyKey = "return-123", evidencias } = {}) => ({
  body: { etapa, idempotencyKey },
  files: evidencias === undefined ? {} : { evidencias },
  get: () => "",
});

test("return requests accept one or multiple multipart evidencias files", () => {
  const first = { tempFilePath: "/tmp/return-1.jpg" };
  const second = { tempFilePath: "/tmp/return-2.jpg" };
  const single = buildDonationReturnRequest(makeRequest({ evidencias: first }));
  const multiple = buildDonationReturnRequest(makeRequest({ evidencias: [first, second] }));

  assert.deepEqual(single.images, [first]);
  assert.deepEqual(multiple.images, [first, second]);
  assert.equal(validateDonationReturnRequest(single), undefined);
  assert.equal(validateDonationReturnRequest(multiple), undefined);
});

test("return requests accept the Idempotency-Key header fallback", () => {
  const request = makeRequest({ evidencias: { tempFilePath: "/tmp/return.jpg" } });
  request.body.idempotencyKey = "";
  request.get = (name) => name === "Idempotency-Key" ? "header-key" : "";

  assert.equal(buildDonationReturnRequest(request).idempotencyKey, "header-key");
});

test("multipart requests select the evidence-aware transition handler", () => {
  const request = makeRequest();
  request.body = {};
  request.files = {};
  request.is = () => "multipart/form-data";

  assert.equal(usesMultipartDonationReturn(request), true);
});

test("return requests reject missing stage, idempotency key, or evidence files", () => {
  const image = { tempFilePath: "/tmp/return.jpg" };

  assert.throws(
    () => validateDonationReturnRequest({
      etapa: "recepcion",
      idempotencyKey: "return-123",
      images: [image],
    }),
    { statusCode: 400, message: 'La etapa debe ser "devolucion"' }
  );
  assert.throws(
    () => validateDonationReturnRequest({
      etapa: "devolucion",
      idempotencyKey: "",
      images: [image],
    }),
    { statusCode: 400 }
  );
  assert.throws(
    () => validateDonationReturnRequest({
      etapa: "devolucion",
      idempotencyKey: "return-123",
      images: [],
    }),
    { statusCode: 400 }
  );
  assert.throws(
    () => validateDonationReturnRequest({
      etapa: "devolucion",
      idempotencyKey: "return-123",
      images: [image, image, image],
    }),
    { statusCode: 400, message: "Puedes adjuntar hasta 2 evidencias por devolución" }
  );
});
