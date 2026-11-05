import test from "node:test";
import assert from "node:assert/strict";
import {
  countAssignedCollectors,
  campaignDateRangesOverlap,
  validateCampaignCapacity,
  validateCampaignPointCapacity,
  validateCampaignHours,
  resolveCampaignState,
} from "../src/controllers/campana_controller.js";

test("campaign collector capacity counts unique collectors across points", () => {
  const points = [
    { recolectores: ["collector-1"] },
    { recolectores: ["collector-2", "collector-1"] },
  ];

  assert.equal(countAssignedCollectors(points), 2);
  assert.throws(() => validateCampaignCapacity(1, points), {
    statusCode: 409,
  });
  assert.throws(() => validateCampaignCapacity(2, points, 1), {
    statusCode: 409,
  });
  assert.doesNotThrow(() => validateCampaignCapacity(2, points));
});

test("campaign collector capacity rejects invalid configured limits", () => {
  assert.throws(() => validateCampaignCapacity(-1, []), {
    statusCode: 400,
  });
  assert.throws(() => validateCampaignCapacity(1.5, []), {
    statusCode: 400,
  });
});

test("campaign date overlap blocks only assigned periods that overlap", () => {
  const first = {
    fechaInicio: "2026-12-02T00:00:00.000Z",
    fechaFin: "2026-12-06T00:00:00.000Z",
  };
  assert.equal(
    campaignDateRangesOverlap(first, {
      fechaInicio: "2026-12-06T00:00:00.000Z",
      fechaFin: "2026-12-09T00:00:00.000Z",
    }),
    true
  );
  assert.equal(
    campaignDateRangesOverlap(first, {
      fechaInicio: "2026-12-07T00:00:00.000Z",
      fechaFin: "2026-12-09T00:00:00.000Z",
    }),
    false
  );
  assert.equal(campaignDateRangesOverlap(first, { fechaInicio: null, fechaFin: null }), true);
});

test("campaign active points cannot exceed configured collector capacity", () => {
  const points = [
    { activo: true, estado: "activo" },
    { activo: false, estado: "inactivo" },
  ];
  assert.doesNotThrow(() => validateCampaignPointCapacity(1, points));
  assert.throws(() => validateCampaignPointCapacity(0, points), {
    statusCode: 409,
  });
  assert.throws(() => validateCampaignPointCapacity(1, [
    ...points,
    { activo: true, estado: "activo" },
  ]), { statusCode: 409 });
});

test("campaign hours require a strict valid range and accept 09:00 to 23:00", () => {
  assert.deepEqual(validateCampaignHours("09:00", "23:00"), {
    horaInicio: "09:00",
    horaFin: "23:00",
  });
  assert.throws(() => validateCampaignHours("", "23:00"), { statusCode: 400 });
  assert.throws(() => validateCampaignHours("09:00", ""), { statusCode: 400 });
  assert.throws(() => validateCampaignHours("09:00", "09:00"), { statusCode: 400 });
  assert.throws(() => validateCampaignHours("09:00", "08:59"), { statusCode: 400 });
});

test("campaign states distinguish drafts, active campaigns and finished campaigns", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");
  assert.equal(resolveCampaignState({ activa: false }, now), "borrador");
  assert.equal(
    resolveCampaignState({ activa: false, estado: "desactivada" }, now),
    "desactivada"
  );
  assert.equal(
    resolveCampaignState({ activa: true, estado: "activa" }, now),
    "activa"
  );
  assert.equal(
    resolveCampaignState({ activa: false, estado: "finalizada" }, now),
    "finalizada"
  );
  assert.equal(
    resolveCampaignState({
      activa: true,
      fechaFin: "2026-11-02T00:00:00.000Z",
    }, now),
    "finalizada"
  );
  assert.equal(
    resolveCampaignState({
      activa: false,
      estado: "desactivada",
      fechaFin: "2026-11-02T00:00:00.000Z",
    }, now),
    "finalizada"
  );
});
