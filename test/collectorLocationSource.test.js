import test from "node:test";
import assert from "node:assert/strict";
import {
  selectLatestCollectorLocation,
  serializeCollectorLocation,
} from "../src/utils/collectorLocationSource.js";

test("a real GPS update newer than a leftover simulation is selected as current", () => {
  const realLocation = {
    latitud: -0.21,
    longitud: -78.48,
    actualizadoEn: new Date("2026-11-06T16:00:00.000Z"),
  };
  const simulation = {
    latitude: -0.20,
    longitude: -78.47,
    updatedAt: new Date("2026-11-06T15:00:00.000Z"),
  };

  assert.deepEqual(selectLatestCollectorLocation(realLocation, simulation), {
    location: realLocation,
    simulated: false,
  });
});

test("a newer simulation remains explicitly marked and never replaces stored real data", () => {
  const realLocation = {
    latitud: -0.21,
    longitud: -78.48,
    actualizadoEn: new Date("2026-11-06T15:00:00.000Z"),
  };
  const simulation = {
    latitude: -0.20,
    longitude: -78.47,
    updatedAt: new Date("2026-11-06T16:00:00.000Z"),
  };

  assert.deepEqual(selectLatestCollectorLocation(realLocation, simulation), {
    location: simulation,
    simulated: true,
  });
  assert.equal(realLocation.latitud, -0.21);
});

test("location serialization preserves the same IDs and capture and receipt dates for real GPS", () => {
  const capturedAt = new Date("2026-11-06T15:00:00.000Z");
  const receivedAt = new Date("2026-11-06T15:00:02.000Z");

  assert.deepEqual(serializeCollectorLocation({
    campana: { _id: "campaign-1" },
    puntoRecoleccion: { _id: "point-1" },
    latitud: -0.21,
    longitud: -78.48,
    precisionMetros: 8,
    capturadoEn: capturedAt,
    actualizadoEn: receivedAt,
  }), {
    campanaId: "campaign-1",
    puntoRecoleccionId: "point-1",
    latitud: -0.21,
    longitud: -78.48,
    precisionMetros: 8,
    capturadoEn: capturedAt,
    actualizadoEn: receivedAt,
  });
});

test("location serialization uses simulation IDs and update time without inventing capture time", () => {
  const updatedAt = new Date("2026-11-06T15:00:02.000Z");

  assert.deepEqual(serializeCollectorLocation({
    campaign: { _id: "campaign-2" },
    point: { _id: "point-2" },
    latitude: -0.20,
    longitude: -78.47,
    accuracyMeters: 20,
    capturedAt: null,
    updatedAt,
  }), {
    campanaId: "campaign-2",
    puntoRecoleccionId: "point-2",
    latitud: -0.20,
    longitud: -78.47,
    precisionMetros: 20,
    capturadoEn: null,
    actualizadoEn: updatedAt,
  });
});
