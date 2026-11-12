import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInitialAssignmentHistory,
  buildPointAssignmentHistoryChanges,
  enrichAssignmentHistory,
} from "../src/utils/campaignAssignmentHistory.js";

test("records the real initial campaign assignment date for principals and supports", () => {
  const assignedAt = new Date("2026-11-08T05:00:00.000Z");
  const history = buildInitialAssignmentHistory({
    points: [
      {
        _id: "point-1",
        responsableRecolector: "collector-1",
        recolectores: ["collector-1", "collector-2"],
      },
    ],
    campaignId: "campaign-1",
    administratorId: "admin-1",
    assignedAt,
  });

  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.recolector), ["collector-1", "collector-2"]);
  for (const entry of history) {
    assert.equal(entry.campana, "campaign-1");
    assert.equal(entry.puntoNuevo, "point-1");
    assert.equal(entry.administrador, "admin-1");
    assert.equal(entry.fecha, assignedAt);
    assert.equal(entry.vigente, true);
  }
});

test("records an exact date when a campaign edit adds or moves an assignment", () => {
  const assignedAt = new Date("2026-11-08T05:30:00.000Z");
  const history = [{
    recolector: "collector-1",
    puntoAnterior: null,
    puntoNuevo: "point-1",
    fecha: new Date("2026-11-01T10:00:00.000Z"),
    vigente: true,
  }];
  const nextHistory = buildPointAssignmentHistoryChanges({
    previousPoints: [{
      _id: "point-1",
      responsableRecolector: "collector-1",
      recolectores: ["collector-1"],
    }],
    nextPoints: [
      { _id: "point-1", responsableRecolector: null, recolectores: [] },
      {
        _id: "point-2",
        responsableRecolector: "collector-1",
        recolectores: ["collector-1"],
      },
    ],
    history,
    campaignId: "campaign-1",
    administratorId: "admin-1",
    assignedAt,
  });

  assert.equal(nextHistory.length, 2);
  assert.equal(nextHistory[0].vigente, false);
  assert.equal(nextHistory[1].recolector, "collector-1");
  assert.equal(nextHistory[1].puntoAnterior, "point-1");
  assert.equal(nextHistory[1].puntoNuevo, "point-2");
  assert.equal(nextHistory[1].fecha, assignedAt);
  assert.equal(nextHistory[1].vigente, true);
  assert.equal(history[0].vigente, true);
});

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
