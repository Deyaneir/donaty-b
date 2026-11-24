import assert from "node:assert/strict";
import test from "node:test";
import { serializeCampaignDeliveryForDonor } from "../src/utils/campaignDelivery.js";
import { donationStatusLabel } from "../src/utils/donationStatus.js";

test("donation status labels preserve the machine state while providing Spanish display text", () => {
  assert.equal(donationStatusLabel("pendiente_recoleccion"), "Pendiente de recolección");
  assert.equal(donationStatusLabel("en_entrega"), "En entrega");
  assert.equal(donationStatusLabel("estado_desconocido"), "estado_desconocido");
});

test("donor campaign delivery returns persisted evidence with publicly accessible URLs", () => {
  const previousBaseUrl = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://api.example.test";
  try {
    const delivery = serializeCampaignDeliveryForDonor({
      _id: "delivery-example",
      campana: "campaign-example",
      evidencias: [
        {
          imagenUrl: "https://images.example.test/delivery-photo.jpg",
          fecha: new Date("2026-11-23T12:00:00.000Z"),
        },
      ],
    });

    assert.equal(delivery.registrada, true);
    assert.deepEqual(delivery.evidencias, [{
      etapa: "entrega",
      imagenUrl: "https://images.example.test/delivery-photo.jpg",
      fecha: new Date("2026-11-23T12:00:00.000Z"),
      recolector: { id: null, nombre: null, apellido: null },
    }]);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBaseUrl;
  }
});
