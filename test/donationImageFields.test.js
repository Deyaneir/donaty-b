import test from "node:test";
import assert from "node:assert/strict";
import {
  getImageWritableFields,
  normalizeImageFieldSuggestions,
} from "../src/utils/donationImageFields.js";

const fields = [
  { key: "material", label: "Material", type: "shortText" },
  { key: "detalle", label: "Detalle", type: "longText" },
  { key: "unidades", label: "Unidades visibles", type: "integer", min: 1, max: 8 },
  { key: "peso", label: "Peso visible", type: "decimal", min: 0.1, max: 20 },
  { key: "peso_unit", label: "Peso con unidad", type: "unit", min: 0.1, max: 20 },
  { key: "unidad", label: "Unidad", type: "unit", options: [{ value: "kg", label: "Kilogramos" }] },
  { key: "estado", label: "Estado", type: "multiSelect", options: [{ value: "nuevo", label: "Nuevo" }] },
  { key: "inactivo", label: "Campo inactivo", type: "shortText", active: false },
];

test("exposes only active editable text and numeric fields to image analysis", () => {
  assert.deepEqual(
    getImageWritableFields(fields).map(({ key }) => key),
    ["material", "detalle", "unidades", "peso", "peso_unit"]
  );
});

test("normalizes only valid suggestions for the selected category fields", () => {
  assert.deepEqual(
    normalizeImageFieldSuggestions({
      material: "  Algodón  ",
      detalle: "Tela azul visible",
      unidades: "3",
      peso: 0.5,
      peso_unit: "2.5",
      unidad: "kg",
      estado: ["nuevo"],
      inactivo: "ignorar",
      campo_externo: "ignorar",
    }, fields),
    {
      material: "Algodón",
      detalle: "Tela azul visible",
      unidades: 3,
      peso: 0.5,
      peso_unit: 2.5,
    }
  );
});

test("drops values with the wrong type or outside configured bounds", () => {
  assert.deepEqual(
    normalizeImageFieldSuggestions({
      material: "x".repeat(256),
      unidades: 1.5,
      peso: 25,
    }, fields),
    {}
  );
});
