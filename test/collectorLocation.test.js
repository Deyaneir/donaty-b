import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCollectorLocation,
  hasValidCollectorCoordinates,
} from "../src/utils/collectorLocation.js";

test("keeps valid coordinates displayable after their freshness window expires", () => {
  assert.equal(hasValidCollectorCoordinates(-0.21, -78.49), true);
  assert.equal(hasValidCollectorCoordinates(91, -78.49), false);
  assert.equal(hasValidCollectorCoordinates(-0.21, Infinity), false);
});

test("classifies an old GPS record as outdated even if coordinates are outside", () => {
  const state = classifyCollectorLocation({
    collectorActive: true,
    matchesAssignment: true,
    updatedAt: "2020-01-01T00:00:00.000Z",
    latitude: -0.5,
    longitude: -78.8,
    accuracyMeters: 10,
    now: Date.parse("2026-11-04T15:00:00.000Z"),
  });

  assert.equal(state, "desactualizado");
});

test("only recent coordinates with valid ranges and accuracy are active", () => {
  const recent = Date.parse("2026-11-04T15:00:00.000Z");
  const base = {
    collectorActive: true,
    matchesAssignment: true,
    updatedAt: new Date(recent - 30_000),
    latitude: -0.21,
    longitude: -78.49,
    accuracyMeters: 20,
    now: recent,
  };

  assert.equal(classifyCollectorLocation(base), "activo");
  assert.equal(
    classifyCollectorLocation({ ...base, latitude: 91 }),
    "sin_registro"
  );
  assert.equal(
    classifyCollectorLocation({ ...base, accuracyMeters: 51 }),
    "sin_registro"
  );
});

test("rejects a future timestamp outside the allowed clock skew", () => {
  assert.equal(
    classifyCollectorLocation({
      collectorActive: true,
      matchesAssignment: true,
      updatedAt: "2026-11-04T15:02:00.000Z",
      latitude: -0.21,
      longitude: -78.49,
      accuracyMeters: 10,
      now: Date.parse("2026-11-04T15:00:00.000Z"),
    }),
    "desactualizado"
  );
});
