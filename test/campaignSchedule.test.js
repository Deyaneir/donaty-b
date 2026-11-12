import test from "node:test";
import assert from "node:assert/strict";
import {
  getCampaignDateKey,
  getEcuadorDateTime,
  isCampaignAvailableNow,
  isCampaignDateRangeValid,
  isCampaignScheduleFinished,
  normalizeCampaignDate,
} from "../src/utils/campaignSchedule.js";

const campaign = {
  activa: true,
  estado: "activa",
  fechaInicio: new Date("2026-11-05T00:00:00.000Z"),
  fechaFin: new Date("2026-11-08T00:00:00.000Z"),
  horaInicio: "09:00",
  horaFin: "17:00",
};

test("campaign dates are stored as calendar dates without shifting the submitted day", () => {
  const dateOnly = normalizeCampaignDate("2026-11-05");
  const dateTime = normalizeCampaignDate("2026-11-05T00:00:00-05:00");

  assert.equal(dateOnly.toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(dateTime.toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(getCampaignDateKey(dateTime), "2026-11-05");
  assert.equal(normalizeCampaignDate("2026-02-30"), null);
  assert.equal(normalizeCampaignDate("2026-11-05T"), null);
  assert.equal(isCampaignDateRangeValid(
    normalizeCampaignDate("2026-11-05"),
    normalizeCampaignDate("2026-11-05")
  ), true);
  assert.equal(isCampaignDateRangeValid(
    normalizeCampaignDate("2026-11-06"),
    normalizeCampaignDate("2026-11-05")
  ), false);
});

test("campaign scheduling uses Ecuador local date and time", () => {
  assert.deepEqual(
    getEcuadorDateTime(new Date("2026-11-05T14:00:00.000Z")),
    { dateKey: "2026-11-05", minutes: 540 }
  );
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-05T13:59:59.000Z")
  ), false);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-05T14:00:00.000Z")
  ), true);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-06T14:00:00.000Z")
  ), true);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-07T21:59:59.000Z")
  ), true);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-07T22:00:01.000Z")
  ), false);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-08T14:00:00.000Z")
  ), true);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-08T22:00:00.000Z")
  ), true);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-08T22:00:01.000Z")
  ), false);
  assert.equal(isCampaignAvailableNow(
    campaign,
    new Date("2026-11-09T14:00:00.000Z")
  ), false);
});

test("invalid schedule data and non-published states are never available", () => {
  assert.equal(isCampaignAvailableNow({
    ...campaign,
    estado: "borrador",
  }, new Date("2026-11-06T16:00:00.000Z")), false);
  assert.equal(isCampaignAvailableNow({
    ...campaign,
    horaFin: "08:00",
  }, new Date("2026-11-06T16:00:00.000Z")), false);
  assert.equal(isCampaignAvailableNow({
    ...campaign,
    fechaInicio: new Date("2026-11-09T00:00:00.000Z"),
  }, new Date("2026-11-06T16:00:00.000Z")), false);
});

test("campaign finish uses its final local date and closing hour", () => {
  assert.equal(isCampaignScheduleFinished(
    campaign,
    new Date("2026-11-08T22:00:00.000Z")
  ), false);
  assert.equal(isCampaignScheduleFinished(
    campaign,
    new Date("2026-11-08T22:00:01.000Z")
  ), true);
  assert.equal(isCampaignScheduleFinished(
    campaign,
    new Date("2026-11-09T05:00:00.000Z")
  ), true);
});
