import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFieldConfiguration,
  requireAllVisibleDonationFields,
  validateDonationMetadata,
} from "../src/utils/categoryFields.js";
import Categoria from "../src/models/Categoria.js";

const configuration = normalizeFieldConfiguration([
  {
    key: "estado_empaque",
    label: "Estado del empaque",
    type: "dropdown",
    required: true,
    options: [
      { value: "sellado", label: "Sellado" },
      { value: "abierto", label: "Abierto" },
    ],
  },
  {
    key: "cantidad_peso",
    label: "Peso",
    type: "decimal",
    min: 0.1,
    max: 20,
    unit: "kg",
  },
]);

test("normalizes field order and defaults", () => {
  const [field] = normalizeFieldConfiguration([
    { key: "nota", label: "Nota", type: "shortText" },
  ]);
  assert.equal(field.order, 0);
  assert.equal(field.required, false);
  assert.equal(field.active, true);
  assert.deepEqual(field.options, []);
});

test("validates JSON metadata and snapshots the configuration with values", () => {
  const result = validateDonationMetadata(
    JSON.stringify({
      cantidad: 5,
      campos: { estado_empaque: "sellado", cantidad_peso: 2.5 },
    }),
    configuration
  );
  assert.equal(result.metadata.cantidad, 5);
  assert.equal(result.camposSnapshot[0].label, "Estado del empaque");
  assert.equal(result.camposSnapshot[0].value, "sellado");
  assert.equal(result.camposSnapshot[1].unit, "kg");
  assert.equal(result.camposSnapshot[1].value, 2.5);
});

test("accepts an active admin-created Mongoose question with its exact key", () => {
  const key = "pregunta_1793833217084789";
  const category = new Categoria({
    nombre: "Materiales",
    nombreNormalizado: "materiales",
    campos: [
      {
        key,
        label: "Material",
        type: "shortText",
        active: true,
      },
    ],
  });
  const submittedMetadata = { campos: { [key]: "metal" } };
  const visibleFields = requireAllVisibleDonationFields(
    submittedMetadata,
    category.campos
  );
  const result = validateDonationMetadata(submittedMetadata, visibleFields);

  assert.equal(visibleFields[0].key, key);
  assert.equal(visibleFields[0].active, true);
  assert.equal(result.camposSnapshot[0].key, key);
  assert.equal(result.camposSnapshot[0].value, "metal");
});

test("validates unit fields as numeric inputs or configured selections", () => {
  const fields = normalizeFieldConfiguration([
    { key: "peso", label: "Peso", type: "unit", min: 0.1, max: 20, unit: "kg" },
    {
      key: "unidad",
      label: "Unidad",
      type: "unit",
      options: [{ value: "kg", label: "Kilogramos" }],
    },
  ]);

  assert.doesNotThrow(() => validateDonationMetadata({
    campos: { peso: 2.5, unidad: "kg" },
  }, fields));
  assert.throws(() => validateDonationMetadata({
    campos: { peso: "2.5", unidad: "g" },
  }, fields), { statusCode: 400 });
});

test("accepts legacy quantity-only metadata when no fields are configured", () => {
  assert.deepEqual(validateDonationMetadata({ cantidad: 3 }, []).metadata, {
    cantidad: 3,
    campos: {},
  });
});

test("rejects missing required fields, unknown keys, invalid options and limits", () => {
  assert.throws(() => validateDonationMetadata({ cantidad: 1 }, configuration), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata({ campos: { campo_inventado: "x" } }, configuration), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata({ campos: { estado_empaque: "usado" } }, configuration), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata({ campos: { estado_empaque: "sellado", cantidad_peso: 25 } }, configuration), { statusCode: 400 });
});

test("rejects values for fields that were deactivated in the category", () => {
  const fields = normalizeFieldConfiguration([
    { key: "pregunta_1793833217084789", label: "Material", type: "multiSelect", options: [
      { value: "metal", label: "Metal" },
    ], active: false },
  ]);
  assert.throws(
    () => validateDonationMetadata(
      { campos: { pregunta_1793833217084789: ["metal"] } },
      fields
    ),
    /no está activo en la categoría/
  );
});

test("rejects invalid field definitions and malformed metadata", () => {
  assert.throws(() => normalizeFieldConfiguration([
    { key: "estado", label: "Estado", type: "dropdown", options: [] },
  ]), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata("{invalid", []), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata({ cantidad: "5" }, []), { statusCode: 400 });
});

test("enforces required text and date bounds", () => {
  const boundedFields = normalizeFieldConfiguration([
    { key: "nota", label: "Nota", type: "shortText", required: true },
    {
      key: "fecha",
      label: "Fecha",
      type: "date",
      min: "2026-01-01",
      max: "2027-12-31",
    },
  ]);
  assert.throws(() => validateDonationMetadata({ campos: { nota: "   " } }, boundedFields), { statusCode: 400 });
  assert.throws(() => validateDonationMetadata({ campos: { nota: "válido", fecha: "2025-12-31" } }, boundedFields), { statusCode: 400 });
  assert.doesNotThrow(() => validateDonationMetadata({ campos: { nota: "válido", fecha: "2027-01-30" } }, boundedFields));
});

test("requires every visible donation field and only requires conditional fields when shown", () => {
  const fields = normalizeFieldConfiguration([
    { key: "talla", label: "Talla", type: "dropdown", options: [
      { value: "s", label: "S" },
      { value: "otro", label: "Otro" },
    ] },
    { key: "nota", label: "Nota", type: "shortText" },
    { key: "talla_otra", label: "Especifica la talla", type: "shortText" },
  ]);
  const hiddenConditionalFields = requireAllVisibleDonationFields(
    { campos: { talla: "s", nota: "donación" } },
    fields
  );
  assert.doesNotThrow(() => validateDonationMetadata(
    { campos: { talla: "s", nota: "donación" } },
    hiddenConditionalFields
  ));

  const visibleConditionalFields = requireAllVisibleDonationFields(
    { campos: { talla: "otro", nota: "donación" } },
    fields
  );
  assert.throws(() => validateDonationMetadata(
    { campos: { talla: "otro", nota: "donación" } },
    visibleConditionalFields
  ), { statusCode: 400 });
});