import test from "node:test";
import assert from "node:assert/strict";
import { enrichAssignmentHistory } from "../src/utils/campaignAssignmentHistory.js";

test("adds end times to point assignments without changing the source history", () => {
  const history = [
    {
      recolector: { _id: "collector-1" },
      puntoAnterior: null,
      puntoNuevo: "point-a",
      fecha: new Date("2026-11-04T10:00:00.000Z"),
      vigente: false,
    },
    {
      recolector: { _id: "collector-1" },
      puntoAnterior: "point-a",
      puntoNuevo: "point-b",
      fecha: new Date("2026-11-04T12:30:00.000Z"),
      vigente: true,
    },
    {
      recolector: { _id: "collector-2" },
      puntoAnterior: null,
      puntoNuevo: "point-a",
      fecha: new Date("2026-11-04T11:00:00.000Z"),
      vigente: true,
    },
  ];

  const result = enrichAssignmentHistory(history);

  assert.equal(result[0].fecha, history[1].fecha);
  assert.equal(result[0].fechaFin, null);
  assert.equal(result[1].fecha, history[2].fecha);
  assert.equal(result[1].fechaFin, null);
  assert.equal(result[2].fechaFin, history[1].fecha);
  assert.equal(history[0].fechaFin, undefined);
});
