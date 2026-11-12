import assert from "node:assert/strict";
import test from "node:test";
import { getCampaignDonationRegistrationError } from "../src/controllers/donacion_controller.js";

test("campaigns marked inactive or finished reject new donation registrations", () => {
  const inactive = getCampaignDonationRegistrationError({
    activa: false,
    estado: "desactivada",
  });
  assert.equal(inactive.statusCode, 409);
  assert.match(inactive.message, /no acepta nuevas donaciones/);

  const finished = getCampaignDonationRegistrationError({
    activa: false,
    estado: "finalizada",
  });
  assert.equal(finished.statusCode, 409);
  assert.match(finished.message, /finalizó/);
});
