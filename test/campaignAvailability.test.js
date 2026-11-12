import test from "node:test";
import assert from "node:assert/strict";
import {
  countCampaignCollectorAvailability,
  filterCurrentCollectorReservations,
  getAvailableCollectorsForCampaign,
  hasCampaignScheduleOverlap,
} from "../src/utils/campaignAvailability.js";

const campaign = (overrides = {}) => ({
  fechaInicio: "2026-06-01T00:00:00.000Z",
  fechaFin: "2026-06-30T00:00:00.000Z",
  horaInicio: "09:00",
  horaFin: "17:00",
  diasAtencion: [1, 2, 3, 4, 5],
  ...overrides,
});

test("overlapping campaigns may share a collector when their actual schedules do not overlap", () => {
  const mondayOnly = [{ diaSemana: 1, horaInicio: "09:00", horaFin: "12:00" }];
  const tuesdayOnly = [{ diaSemana: 2, horaInicio: "09:00", horaFin: "12:00" }];
  assert.equal(
    hasCampaignScheduleOverlap(
      campaign(),
      { horariosAtencion: mondayOnly },
      campaign(),
      { horariosAtencion: tuesdayOnly }
    ),
    false
  );
  assert.equal(
    hasCampaignScheduleOverlap(
      campaign(),
      { horariosAtencion: mondayOnly },
      campaign(),
      { horariosAtencion: [{ diaSemana: 1, horaInicio: "12:00", horaFin: "14:00" }] }
    ),
    false
  );
});

test("overlapping campaign schedules conflict only on common days and hours", () => {
  assert.equal(
    hasCampaignScheduleOverlap(
      campaign(),
      { horariosAtencion: [{ diaSemana: 1, horaInicio: "09:00", horaFin: "12:00" }] },
      campaign(),
      { horariosAtencion: [{ diaSemana: 1, horaInicio: "11:00", horaFin: "14:00" }] }
    ),
    true
  );
  assert.equal(
    hasCampaignScheduleOverlap(
      campaign(),
      { horariosAtencion: [] },
      campaign({ fechaInicio: "2026-07-01", fechaFin: "2026-07-05" }),
      { horariosAtencion: [] }
    ),
    false
  );
});

test("availability excludes inactive accounts and scheduled conflicts but retains free collectors", () => {
  const requested = campaign({
    _id: "requested",
    puntosRecoleccion: [{ horariosAtencion: [] }],
  });
  const existing = campaign({
    _id: "existing",
    puntosRecoleccion: [{
      recolectores: ["busy"],
      horariosAtencion: [{ diaSemana: 1, horaInicio: "10:00", horaFin: "12:00" }],
    }],
  });
  const collectors = [
    { _id: "busy", status: true, aprobado: true, confirmEmail: true },
    { _id: "free", status: true, aprobado: true, confirmEmail: true },
    { _id: "inactive", status: false, aprobado: true, confirmEmail: true },
    {
      _id: "reserved",
      status: true,
      aprobado: true,
      confirmEmail: true,
      reservasHorarioCampanas: [{
        campana: "reserved-campaign",
        fechaInicio: requested.fechaInicio,
        fechaFin: requested.fechaFin,
        horaInicio: requested.horaInicio,
        horaFin: requested.horaFin,
        diasAtencion: requested.diasAtencion,
        punto: { horariosAtencion: [] },
      }],
    },
  ];

  assert.deepEqual(
    getAvailableCollectorsForCampaign(collectors, [existing], requested)
      .map((collector) => collector._id),
    ["free"]
  );
});

test("stale collector reservations do not block availability when the campaign no longer assigns them", () => {
  const collectorId = "collector-1";
  const currentCampaign = {
    _id: "current",
    estado: "borrador",
    puntosRecoleccion: [{
      _id: "point-current",
      responsableRecolector: collectorId,
      recolectores: [collectorId],
    }],
  };
  const reservations = [
    { campana: "current", punto: { _id: "point-current" } },
    { campana: "removed-assignment", punto: { _id: "point-old" } },
    { campana: "deleted-campaign", punto: { _id: "point-deleted" } },
    { campana: "disabled-campaign", punto: { _id: "point-disabled" } },
  ];
  const campaigns = [
    currentCampaign,
    {
      _id: "removed-assignment",
      estado: "borrador",
      puntosRecoleccion: [{ _id: "point-old", recolectores: [] }],
    },
    {
      _id: "disabled-campaign",
      estado: "desactivada",
      puntosRecoleccion: [{ _id: "point-disabled", recolectores: [collectorId] }],
    },
  ];

  assert.deepEqual(
    filterCurrentCollectorReservations(reservations, campaigns, collectorId)
      .map((reservation) => reservation.campana),
    ["current"]
  );
});

test("campaign availability counts preassigned collectors toward the required total", () => {
  const principalId = "collector-principal";
  assert.deepEqual(
    countCampaignCollectorAvailability([], [principalId]),
    {
      asignados: 1,
      disponiblesAdicionales: 0,
      disponibles: 1,
    }
  );
  assert.deepEqual(
    countCampaignCollectorAvailability(
      [{ _id: principalId }, { _id: "collector-free" }],
      [principalId]
    ),
    {
      asignados: 1,
      disponiblesAdicionales: 1,
      disponibles: 2,
    }
  );
});
