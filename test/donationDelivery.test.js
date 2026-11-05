import test from "node:test";
import assert from "node:assert/strict";
import { resolveDonationDelivery } from "../src/utils/donationDelivery.js";

const profile = {
  nombre: "Ada",
  apellido: "Lovelace",
  telefono: "0991234567",
  direccion: "Domicilio registrado",
};

const campaign = {
  puntosRecoleccion: [
    {
      _id: "point-active",
      estado: "activo",
      activo: true,
      nombre: "Punto central",
      direccion: "Av. Principal 100",
      referenciasLugar: "Junto a recepción",
    },
    {
      _id: "point-inactive",
      estado: "inactivo",
      activo: false,
      nombre: "Punto cerrado",
    },
  ],
};

test("uses profile contact details and domicile address by default", () => {
  const result = resolveDonationDelivery({ profile, campaign });

  assert.deepEqual(result, {
    nombreDonante: "Ada Lovelace",
    telefonoContacto: "0991234567",
    metodoEntrega: "domicilio",
    direccionEntrega: "Domicilio registrado",
    puntoRecoleccionRef: null,
    referenciasEntrega: "",
  });
});

test("uses an explicitly selected alternative address for home pickup", () => {
  const result = resolveDonationDelivery({
    profile,
    campaign,
    method: "domicilio",
    alternativeAddress: "Dirección alternativa",
  });

  assert.equal(result.direccionEntrega, "Dirección alternativa");
  assert.equal(result.puntoRecoleccionRef, null);
});

test("uses the active campaign pickup point without requiring a profile address", () => {
  const result = resolveDonationDelivery({
    profile: { ...profile, direccion: "" },
    campaign,
    method: "punto_recoleccion",
    pointId: "point-active",
  });

  assert.equal(result.metodoEntrega, "punto_recoleccion");
  assert.equal(result.direccionEntrega, "Av. Principal 100, Punto central");
  assert.equal(result.puntoRecoleccionRef, "point-active");
  assert.equal(result.referenciasEntrega, "Junto a recepción");
});

test("does not use a client-supplied phone instead of the profile phone", () => {
  assert.throws(
    () => resolveDonationDelivery({
      profile: { ...profile, telefono: "" },
      campaign,
      telefonoContacto: "0999999999",
    }),
    {
      statusCode: 400,
      message: "Completa tu perfil: registra un teléfono de contacto antes de crear la donación",
    }
  );
});

test("rejects unavailable points and point IDs sent with domicile delivery", () => {
  assert.throws(
    () => resolveDonationDelivery({
      profile,
      campaign,
      method: "punto_recoleccion",
      pointId: "point-inactive",
    }),
    { statusCode: 400 }
  );
  assert.throws(
    () => resolveDonationDelivery({
      profile,
      campaign,
      method: "domicilio",
      pointId: "point-active",
    }),
    { statusCode: 400 }
  );
});
