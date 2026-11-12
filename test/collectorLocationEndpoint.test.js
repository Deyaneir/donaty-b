import assert from "node:assert/strict";
import test from "node:test";
import Recolector from "../src/models/Recolector.js";
import CollectorLocation from "../src/models/CollectorLocation.js";
import CollectorLocationSimulation from "../src/models/CollectorLocationSimulation.js";
import {
  actualizarUbicacionRecolector,
  consultarUbicacionRecolector,
} from "../src/controllers/recolector_controller.js";
import requireCollectorGeofence from "../src/middlewares/requireCollectorGeofence.js";

const collectorId = "507f1f77bcf86cd799439011";
const originalNodeEnv = process.env.NODE_ENV;

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

const stubCollector = (document) => {
  const originals = {
    findById: Recolector.findById,
    updateOne: Recolector.updateOne,
    deleteSimulation: CollectorLocationSimulation.deleteOne,
    createLocation: CollectorLocation.create,
  };
  Recolector.findById = () => ({
    select() {
      return this;
    },
    lean: async () => document,
  });
  CollectorLocationSimulation.deleteOne = async () => ({ deletedCount: 0 });
  CollectorLocation.create = async (location) => ({ _id: "location-1", ...location });
  return () => {
    Recolector.findById = originals.findById;
    Recolector.updateOne = originals.updateOne;
    CollectorLocationSimulation.deleteOne = originals.deleteSimulation;
    CollectorLocation.create = originals.createLocation;
  };
};

test("stores an outside location without campaign or point and separates timestamps", async () => {
  process.env.NODE_ENV = "production";
  const capturedAt = new Date("2020-01-02T03:04:05.000Z");
  let update;
  let savedHistory;
  const restore = stubCollector({ status: true });
  CollectorLocation.create = async (location) => {
    savedHistory = location;
    return { _id: "location-1", ...location };
  };
  Recolector.updateOne = async (...args) => {
    update = args;
    return { acknowledged: true, matchedCount: 1 };
  };
  const response = responseStub();

  try {
    await actualizarUbicacionRecolector(
      {
        user: { _id: collectorId },
        body: {
          recolectorId: "507f191e810c19729de860ea",
          latitud: -0.1807,
          longitud: -78.4678,
          precisionMetros: 8,
          capturadoEn: capturedAt.toISOString(),
        },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(update[0]._id, collectorId);
    assert.equal(update[0].recolectorId, undefined);
    const savedLocation = update[1].$set.ubicacionGps;
    assert.equal(savedLocation.campana, null);
    assert.equal(savedLocation.puntoRecoleccion, null);
    assert.equal(savedLocation.latitud, -0.1807);
    assert.equal(savedLocation.longitud, -78.4678);
    assert.equal(savedLocation.capturadoEn.toISOString(), capturedAt.toISOString());
    assert.equal(savedHistory.capturedAt.toISOString(), capturedAt.toISOString());
    assert.ok(savedLocation.actualizadoEn instanceof Date);
    assert.notEqual(savedLocation.actualizadoEn.toISOString(), capturedAt.toISOString());
    assert.equal(response.body.ubicacion.capturadoEn.toISOString(), capturedAt.toISOString());
    assert.equal(response.body.ubicacion.estadoGeografico, "desactualizado");
    assert.equal(response.body.ubicacion.permiteOperar, false);
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("accepts valid coordinates outside the geofence without an accuracy value", async () => {
  process.env.NODE_ENV = "production";
  const restore = stubCollector({ status: true });
  Recolector.updateOne = async () => ({ acknowledged: true, matchedCount: 1 });
  const response = responseStub();

  try {
    await actualizarUbicacionRecolector(
      {
        user: { _id: collectorId },
        body: { latitud: -0.1807, longitud: -78.4678 },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ubicacion.capturadoEn, null);
    assert.ok(response.body.ubicacion.actualizadoEn instanceof Date);
    assert.equal(response.body.ubicacion.estadoGeografico, "sin_registro");
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("rejects out-of-range coordinates before writing", async () => {
  const restore = stubCollector({ status: true });
  let updateCalled = false;
  Recolector.updateOne = async () => {
    updateCalled = true;
    return { acknowledged: true, matchedCount: 1 };
  };
  const response = responseStub();

  try {
    await actualizarUbicacionRecolector(
      {
        user: { _id: collectorId },
        body: { latitud: 91, longitud: -78.4 },
      },
      response
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.body.msg, /coordenadas GPS/);
    assert.equal(updateCalled, false);
  } finally {
    restore();
  }
});

test("does not return an old location's receipt date as its capture date", async () => {
  process.env.NODE_ENV = "production";
  const capturedAt = new Date("2020-01-02T03:04:05.000Z");
  const receivedAt = new Date("2020-01-03T03:04:05.000Z");
  const restore = stubCollector({
    status: true,
    ubicacionGps: {
      latitud: -0.21,
      longitud: -78.48,
      precisionMetros: 8,
      capturadoEn: null,
      actualizadoEn: receivedAt,
    },
  });
  const response = responseStub();

  try {
    await consultarUbicacionRecolector(
      { user: { _id: collectorId } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ubicacion.capturadoEn, null);
    assert.equal(
      response.body.ubicacion.actualizadoEn.toISOString(),
      receivedAt.toISOString()
    );
    assert.equal(response.body.estadoGeografico, "sin_registro");
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("returns the authenticated collector's latest outside location", async () => {
  process.env.NODE_ENV = "production";
  const capturedAt = new Date();
  const receivedAt = new Date(capturedAt.getTime() + 1_000);
  const restore = stubCollector({
    status: true,
    ubicacionGps: {
      latitud: -0.1807,
      longitud: -78.4678,
      precisionMetros: 8,
      capturadoEn: capturedAt,
      actualizadoEn: receivedAt,
      campana: null,
      puntoRecoleccion: null,
    },
  });
  const response = responseStub();

  try {
    await consultarUbicacionRecolector(
      { user: { _id: collectorId } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.estadoGeografico, "fuera");
    assert.equal(response.body.ubicacion.latitud, -0.1807);
    assert.equal(response.body.ubicacion.longitud, -78.4678);
    assert.equal(response.body.ubicacion.capturadoEn.toISOString(), capturedAt.toISOString());
    assert.equal(response.body.ubicacion.actualizadoEn.toISOString(), receivedAt.toISOString());
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("does not use server receipt time as a GPS capture time for geofence checks", async () => {
  process.env.NODE_ENV = "production";
  const restore = stubCollector({
    status: true,
    ubicacionGps: {
      latitud: -0.210145,
      longitud: -78.488712,
      precisionMetros: 8,
      capturadoEn: null,
      actualizadoEn: new Date(),
    },
  });
  const response = responseStub();
  let nextCalled = false;

  try {
    await requireCollectorGeofence(
      { user: { _id: collectorId } },
      response,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "COLLECTOR_LOCATION_REQUIRED");
    assert.equal(nextCalled, false);
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("returns an error when the authenticated collector update is not persisted", async () => {
  process.env.NODE_ENV = "production";
  const restore = stubCollector({ status: true });
  Recolector.updateOne = async () => ({ acknowledged: true, matchedCount: 0 });
  const response = responseStub();

  try {
    await actualizarUbicacionRecolector(
      {
        user: { _id: collectorId },
        body: { latitud: -0.21, longitud: -78.48, precisionMetros: 8 },
      },
      response
    );

    assert.equal(response.statusCode, 403);
    assert.match(response.body.msg, /cuenta de recolector/);
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("does not return success when the database write is unacknowledged", async () => {
  process.env.NODE_ENV = "production";
  const restore = stubCollector({ status: true });
  Recolector.updateOne = async () => ({ acknowledged: false, matchedCount: 0 });
  const response = responseStub();

  try {
    await actualizarUbicacionRecolector(
      {
        user: { _id: collectorId },
        body: { latitud: -0.21, longitud: -78.48, precisionMetros: 8 },
      },
      response
    );

    assert.equal(response.statusCode, 500);
    assert.match(response.body.msg, /actualizar la ubicación/);
  } finally {
    restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
