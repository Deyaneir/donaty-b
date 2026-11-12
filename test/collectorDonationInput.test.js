import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCollectorDonorFields,
  parseCollectorDonationMetadata,
  parseExternalDonor,
} from "../src/utils/collectorDonationInput.js";
import { validateDonationMetadata } from "../src/utils/categoryFields.js";

test("parses external donor JSON without mixing its fields", () => {
  assert.deepEqual(
    parseExternalDonor(
      '{"nombre":"María","apellido":"Paz","telefono":"0999999999","direccion":"Quito"}'
    ),
    {
      nombre: "María",
      apellido: "Paz",
      telefono: "0999999999",
    }
  );
});

test("does not persist donor address and keeps delivery contact fields separate", () => {
  assert.deepEqual(buildCollectorDonorFields({
    donor: {
      nombre: "María",
      apellido: "Paz",
      telefono: "0999999999",
      direccion: "Quito",
    },
    coordinates: { latitud: -0.21, longitud: -78.48 },
  }), {
    donanteExterno: {
      nombre: "María",
      apellido: "Paz",
      telefono: "0999999999",
      latitud: -0.21,
      longitud: -78.48,
    },
    direccionEntrega: "",
    telefonoContacto: "",
  });
  assert.deepEqual(buildCollectorDonorFields({
    donor: {
      nombre: "Ana",
      apellido: "Ejemplo",
      direccion: "Quito",
      telefono: "0999999999",
    },
    direccionEntrega: "Otra dirección",
    telefonoContacto: "0222222222",
  }), {
    donanteExterno: {
      nombre: "Ana",
      apellido: "Ejemplo",
      telefono: "0999999999",
    },
    direccionEntrega: "Otra dirección",
    telefonoContacto: "0222222222",
  });
});

test("rejects malformed or non-object external donor JSON", () => {
  assert.throws(() => parseExternalDonor("{bad json}"), {
    statusCode: 400,
    message: "donanteExterno debe contener un JSON válido",
  });
  assert.throws(() => parseExternalDonor("[]"), {
    statusCode: 400,
    message: "donanteExterno debe ser un objeto JSON",
  });
});

test("maps multipart quantity to metadata.cantidad", () => {
  assert.deepEqual(
    validateDonationMetadata(
      parseCollectorDonationMetadata(undefined, "6"),
      []
    ).metadata,
    { campos: {}, cantidad: 6 }
  );
});

test("requires direct and metadata quantities to match", () => {
  assert.throws(
    () => parseCollectorDonationMetadata('{"cantidad":5}', "6"),
    { statusCode: 400, message: "cantidad y metadata.cantidad deben coincidir" }
  );
});

test("rejects non-positive or non-integer multipart quantities", () => {
  for (const quantity of ["0", "1.5", "no-numérica"]) {
    assert.throws(
      () => parseCollectorDonationMetadata(undefined, quantity),
      { statusCode: 400, message: "La cantidad debe ser un entero positivo" }
    );
  }
});
