import test from "node:test";
import assert from "node:assert/strict";
import { isCampaignLocked } from "../src/middlewares/rejectClosedCampaignMutation.js";

test("campaign edits are locked only after finalization and a recorded delivery", () => {
  const finishedCampaign = { estado: "finalizada" };
  const activeCampaign = { estado: "activa" };

  assert.equal(isCampaignLocked(finishedCampaign, true), true);
  assert.equal(isCampaignLocked(finishedCampaign, false), false);
  assert.equal(isCampaignLocked(activeCampaign, true), false);
});
