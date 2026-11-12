import test from "node:test";
import assert from "node:assert/strict";
import {
  countAssignedCollectors,
  getPointCollectorIds,
  campaignDateRangesOverlap,
  validateCampaignCapacity,
  validateCampaignPointCapacity,
  validateCampaignHours,
  normalizeCampaignDays,
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
    message: /usa la reasignación; no lo retires directamente/,
  });
  assert.doesNotThrow(() => validateCampaignCapacity(2, points));
});

test("campaign capacity counts a point principal even if legacy data omits it from recolectores", () => {
  const principal = "507f1f77bcf86cd799439011";
  const support = "507f1f77bcf86cd799439012";
  const points = [{
    responsableRecolector: principal,
    recolectores: [support, principal],
  }, {
    responsableRecolector: principal,
    recolectores: [],
  }];

  assert.deepEqual(getPointCollectorIds({
    responsableRecolector: principal,
    recolectores: [],
  }), [principal]);
  assert.equal(countAssignedCollectors(points), 2);
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

test("campaign days are required, unique and restricted to ISO weekdays", () => {
  assert.deepEqual(normalizeCampaignDays([1, "3", 1, 7]), [1, 3, 7]);
  assert.deepEqual(normalizeCampaignDays([]), []);
  assert.deepEqual(normalizeCampaignDays('["1",2,7]'), [1, 2, 7]);
  assert.deepEqual(normalizeCampaignDays(undefined), []);
  assert.throws(() => normalizeCampaignDays([0, 8]), { statusCode: 400 });
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

test("campaign state changes at its Ecuador-local closing time", () => {
  const campaign = {
    activa: true,
    estado: "activa",
    fechaFin: new Date("2026-11-08T00:00:00.000Z"),
    horaInicio: "09:00",
    horaFin: "17:00",
  };
  assert.equal(
    resolveCampaignState(campaign, new Date("2026-11-08T22:00:00.000Z")),
    "activa"
  );
  assert.equal(
    resolveCampaignState(campaign, new Date("2026-11-08T22:00:01.000Z")),
    "finalizada"
  );
});
