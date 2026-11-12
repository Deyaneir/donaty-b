import test from "node:test";
import assert from "node:assert/strict";
import { getAcademicPeriodStartMonth, resolveAcademicPeriod } from "../src/utils/academicPeriod.js";

test("academic period uses the campaign date and configured semester boundary", () => {
  const previousBoundary = process.env.ACADEMIC_PERIOD_B_START_MONTH;
  process.env.ACADEMIC_PERIOD_B_START_MONTH = "8";
  try {
    assert.equal(getAcademicPeriodStartMonth(), 8);
    assert.equal(resolveAcademicPeriod("2026-07-31T12:00:00.000Z"), "2026-A");
    assert.equal(resolveAcademicPeriod("2026-08-01T12:00:00.000Z"), "2026-B");
  } finally {
    if (previousBoundary === undefined) delete process.env.ACADEMIC_PERIOD_B_START_MONTH;
    else process.env.ACADEMIC_PERIOD_B_START_MONTH = previousBoundary;
  }
});

test("academic period rejects invalid dates and returns null for missing dates", () => {
  assert.equal(resolveAcademicPeriod(null), null);
  assert.throws(() => resolveAcademicPeriod("not-a-date"), { statusCode: 400 });
});

test("academic period rejects invalid boundary configuration", () => {
  const previousBoundary = process.env.ACADEMIC_PERIOD_B_START_MONTH;
  process.env.ACADEMIC_PERIOD_B_START_MONTH = "13";
  try {
    assert.throws(() => resolveAcademicPeriod("2026-08-01"), /ACADEMIC_PERIOD_B_START_MONTH/);
  } finally {
    if (previousBoundary === undefined) delete process.env.ACADEMIC_PERIOD_B_START_MONTH;
    else process.env.ACADEMIC_PERIOD_B_START_MONTH = previousBoundary;
  }
});
