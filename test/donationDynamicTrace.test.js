import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Donacion from "../src/models/Donacion.js";

test("donation documents preserve dynamic metadata and historical snapshots", () => {
  const metadata = {
    cantidad: 3,
    campos: {
      product_state: "sealed",
      fragile: false,
      materials: ["wood", "metal"],
    },
  };
  const snapshot = [
    {
      key: "product_state",
      label: "Estado del producto",
      type: "dropdown",
      active: false,
      value: "sealed",
    },
    {
      key: "fragile",
      label: "Frágil",
      type: "yesNo",
      value: false,
    },
    {
      key: "materials",
      label: "Materiales",
      type: "multiSelect",
      value: ["wood", "metal"],
    },
  ];
  const donation = new Donacion({
    donante: new mongoose.Types.ObjectId(),
    metadata,
    camposSnapshot: snapshot,
  });

  const serialized = donation.toObject();

  assert.deepEqual(serialized.metadata, metadata);
  assert.deepEqual(
    serialized.camposSnapshot.map(({ key, label, type, active, value }) => ({
      key,
      label,
      type,
      active,
      value,
    })),
    snapshot.map((field) => ({
      active: true,
      ...field,
    })),
  );
});
