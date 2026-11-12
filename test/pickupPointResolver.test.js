import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { resolverPuntoId } from "../src/utils/pickupPointResolver.js";

const campaignId = "60f1f89c8b7e4c0012345678";
const principalId = "60f1f89c8b7e4c0012345679";
const secondaryId = "60f1f89c8b7e4c0012345680";
const otherPointId = "60f1f89c8b7e4c0012345681";
const collectorId = "60f1f89c8b7e4c0012345682";
const campaign = {
  _id: campaignId,
  puntosRecoleccion: [
    {
      _id: new mongoose.Types.ObjectId(principalId),
      responsableRecolector: new mongoose.Types.ObjectId(collectorId),
      recolectores: [new mongoose.Types.ObjectId(collectorId)],
    },
    {
      _id: new mongoose.Types.ObjectId(secondaryId),
      recolectores: [new mongoose.Types.ObjectId("60f1f89c8b7e4c0012345683")],
    },
  ],
};

test("collector point resolution ignores client input and uses the assigned principal point", () => {
  assert.equal(
    resolverPuntoId(
      { _id: collectorId, rol: "recolector" },
      otherPointId,
      campaign
    ),
    principalId
  );
});

test("classification can resolve only the donation's assigned point", () => {
  assert.equal(
    resolverPuntoId(
      { _id: collectorId, rol: "recolector" },
      null,
      campaign,
      principalId
    ),
    principalId
  );
  assert.throws(
    () => resolverPuntoId(
      { _id: collectorId, rol: "recolector" },
      null,
      campaign,
      secondaryId
    ),
    { statusCode: 400, message: `El punto ${secondaryId} no está asignado al recolector en la campaña ${campaignId}` }
  );
});

test("admin point resolution requires a valid point belonging to the campaign", () => {
  assert.throws(
    () => resolverPuntoId({ _id: collectorId, rol: "admin" }, null, campaign),
    { statusCode: 400, message: "Debes indicar el puntoId de la campaña" }
  );
  assert.throws(
    () => resolverPuntoId({ _id: collectorId, rol: "admin" }, otherPointId, campaign),
    { statusCode: 400, message: `El punto ${otherPointId} no pertenece a la campaña ${campaignId}` }
  );
  assert.equal(
    resolverPuntoId({ _id: collectorId, rol: "admin" }, principalId, campaign),
    principalId
  );
});
