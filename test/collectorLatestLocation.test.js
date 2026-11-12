import assert from "node:assert/strict";
import test from "node:test";
import CollectorLocation from "../src/models/CollectorLocation.js";
import Recolector from "../src/models/Recolector.js";
import { consultarUltimaUbicacionRecolector } from "../src/controllers/recolector_controller.js";

const collectorId = "507f1f77bcf86cd799439011";

const responseStub = () => ({
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("admin can query the latest persisted location with the app capture timestamp", async () => {
  const originals = {
    findCollector: Recolector.findById,
    findLocation: CollectorLocation.findOne,
  };
  const capturedAt = new Date("2026-11-10T12:15:00.000Z");
  const receivedAt = new Date("2026-11-10T12:15:08.000Z");
  Recolector.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: collectorId, status: true }),
  });
  CollectorLocation.findOne = (filter) => ({
    sort(sort) {
      assert.deepEqual(filter, { collector: collectorId });
      assert.deepEqual(sort, { receivedAt: -1 });
      return this;
    },
    lean: async () => ({
      latitude: -0.210145,
      longitude: -78.488712,
      accuracyMeters: 8,
      capturedAt,
      receivedAt,
    }),
  });
  const response = responseStub();

  try {
    await consultarUltimaUbicacionRecolector(
      {
        user: { _id: "507f191e810c19729de860ea", rol: "admin" },
        params: { collectorId },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.recolectorId, collectorId);
    assert.equal(response.body.ubicacion.capturadoEn.toISOString(), capturedAt.toISOString());
    assert.equal(response.body.ubicacion.actualizadoEn.toISOString(), receivedAt.toISOString());
    assert.equal(response.body.ubicacion.latitud, -0.210145);
  } finally {
    Recolector.findById = originals.findCollector;
    CollectorLocation.findOne = originals.findLocation;
  }
});

test("a collector cannot query another collector's location", async () => {
  const response = responseStub();
  await consultarUltimaUbicacionRecolector(
    {
      user: { _id: "507f191e810c19729de860ea", rol: "recolector" },
      params: { collectorId },
    },
    response
  );
  assert.equal(response.statusCode, 403);
});
