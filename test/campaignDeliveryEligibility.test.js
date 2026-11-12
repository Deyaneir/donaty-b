import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularPuedeEntregar,
  normalizeDonationState,
} from "../src/services/campaignDelivery.js";

const collectorId = "60f1f89c8b7e4c0012345678";
const campaign = {
  _id: "60f1f89c8b7e4c0012345679",
  estado: "finalizada",
  puntosRecoleccion: [
    { responsableRecolector: collectorId },
  ],
};

test("delivery eligibility normalizes equivalent states and ignores cancelled donations", () => {
  const result = calcularPuedeEntregar(
    campaign,
    { id: collectorId },
    [
      { _id: "donation-1", estado: "EN_ENTREGA" },
      { _id: "donation-2", estado: "en entrega" },
      { _id: "donation-3", estado: "enEntrega" },
      { _id: "donation-4", estado: "cancelada" },
      { _id: "donation-5", estado: "rechazado" },
    ]
  );

  assert.equal(normalizeDonationState(" En-Entrega "), "enentrega");
  assert.equal(result.esPrincipal, true);
  assert.equal(result.finalizada, true);
  assert.equal(result.todasEnEntrega, true);
  assert.equal(result.totalDonaciones, 3);
  assert.equal(result.enEntrega, 3);
  assert.deepEqual(result.estadosNoEntrega, []);
  assert.equal(result.puedeEntregar, true);
});

test("delivery eligibility requires a valid donation and no existing delivery", () => {
  const noDonations = calcularPuedeEntregar(
    campaign,
    { _id: collectorId },
    [{ _id: "cancelled", estado: "cancelada" }]
  );
  const alreadyDelivered = calcularPuedeEntregar(
    campaign,
    { _id: collectorId },
    [{ _id: "ready", estado: "en_entrega" }],
    { _id: "delivery-1" }
  );

  assert.equal(noDonations.puedeEntregar, false);
  assert.equal(noDonations.todasEnEntrega, false);
  assert.equal(alreadyDelivered.puedeEntregar, false);
  assert.equal(alreadyDelivered.yaEntregada, true);
});

test("delivery debug includes literal states for donations that are not ready", () => {
  const result = calcularPuedeEntregar(
    campaign,
    { _id: collectorId },
    [
      { _id: "ready", estado: "en_entrega" },
      { _id: "pending", estado: " Pendiente_recolección " },
    ]
  );

  assert.equal(result.puedeEntregar, false);
  assert.deepEqual(result.estadosNoEntrega, [
    { donacionId: "pending", estado: " Pendiente_recolección " },
  ]);
});
