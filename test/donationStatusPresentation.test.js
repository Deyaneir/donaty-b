import assert from "node:assert/strict";
import test from "node:test";
import {
  createIndividualDonationDeliveryRecord,
  serializeCampaignDeliveryForDonor,
  serializeIndividualDonationDelivery,
} from "../src/utils/campaignDelivery.js";
import { donationStatusLabel } from "../src/utils/donationStatus.js";

test("donation status labels preserve the machine state while providing Spanish display text", () => {
  assert.equal(donationStatusLabel("pendiente_recoleccion"), "Pendiente de recolección");
  assert.equal(donationStatusLabel("en_entrega"), "En entrega");
  assert.equal(donationStatusLabel("estado_desconocido"), "estado_desconocido");
});

test("individual delivery exposes persisted receiver fields and their stored date", () => {
  const date = new Date("2026-11-23T12:00:00.000Z");
  const record = createIndividualDonationDeliveryRecord({
    nombresReceptor: "Nombre",
    apellidosReceptor: "Ficticio",
    recibeIdentificacion: "ID-FICTICIO",
    recibeInstitucion: "Institución ficticia",
    telefonoReceptor: "0000000000",
    cargoReceptor: "Responsable",
    descripcionBienes: "Bienes de ejemplo",
    recolector: "collector-example",
    fecha: date,
    imagen: {
      imagenUrl: "https://images.example.test/delivery-photo.jpg",
      imagenPublicId: "private-delivery-id",
    },
    idempotencyKey: "delivery-key",
  });
  const delivery = serializeIndividualDonationDelivery({
    _id: "delivery-example",
    ...record,
  });

  assert.equal(record.recibeIdentificacion, "ID-FICTICIO");
  assert.equal(record.recibeInstitucion, "Institución ficticia");
  assert.equal(record.imagenUrl, "https://images.example.test/delivery-photo.jpg");
  assert.equal(record.fecha, date);
  assert.equal(delivery.recibeNombre, "Nombre Ficticio");
  assert.equal(delivery.recibeIdentificacion, "ID-FICTICIO");
  assert.equal(delivery.recibeInstitucion, "Institución ficticia");
  assert.equal(delivery.fecha, date);
  assert.equal(delivery.fechaEntrega, date);
  assert.equal(delivery.imagenUrl, "https://images.example.test/delivery-photo.jpg");
});

test("individual delivery leaves unavailable identification and institution absent as null", () => {
  const delivery = serializeIndividualDonationDelivery({
    nombresReceptor: "Nombre",
    apellidosReceptor: "Ficticio",
    fecha: new Date("2026-11-23T12:00:00.000Z"),
  });

  assert.equal(delivery.recibeNombre, "Nombre Ficticio");
  assert.equal(delivery.recibeIdentificacion, null);
  assert.equal(delivery.recibeInstitucion, null);
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
