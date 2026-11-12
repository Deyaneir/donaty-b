import assert from "node:assert/strict";
import test from "node:test";
import Campana from "../src/models/Campana.js";
import Recolector from "../src/models/Recolector.js";
import { listarUbicacionesRecolectores } from "../src/controllers/campana_controller.js";

test("campaign map returns the assigned collector GPS separately from the fixed pickup point", async () => {
  const ids = {
    campaign: "507f1f77bcf86cd799439031",
    point: "507f1f77bcf86cd799439032",
    collector: "507f1f77bcf86cd799439033",
  };
  const capturedAt = new Date(Date.now() - 10_000);
  const originals = {
    findCampaign: Campana.findById,
    findCollectors: Recolector.find,
    simulator: process.env.ENABLE_GPS_SIMULATOR,
  };
  Campana.findById = () => ({
    lean: async () => ({
      _id: ids.campaign,
      puntosRecoleccion: [{
        _id: ids.point,
        nombre: "Punto A",
        latitud: -0.21,
        longitud: -78.48,
        responsableRecolector: ids.collector,
        recolectores: [ids.collector],
      }],
    }),
  });
  Recolector.find = () => ({
    select() { return this; },
    lean: async () => [{
      _id: ids.collector,
      nombre: "Ana",
      apellido: "Pérez",
      status: true,
      ubicacionGps: {
        latitud: -0.18,
        longitud: -78.4678,
        precisionMetros: 8,
        capturadoEn: capturedAt,
        actualizadoEn: capturedAt,
      },
    }],
  });
  process.env.ENABLE_GPS_SIMULATOR = "false";

  try {
    const response = {
      statusCode: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await listarUbicacionesRecolectores({
      params: { campaignId: ids.campaign },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ubicaciones.length, 1);
    assert.deepEqual(response.body.ubicaciones[0].punto, {
      _id: ids.point,
      nombre: "Punto A",
    });
    assert.deepEqual(response.body.ubicaciones[0].coordenadas, {
      latitud: -0.18,
      longitud: -78.4678,
    });
    assert.notDeepEqual(
      response.body.ubicaciones[0].coordenadas,
      { latitud: -0.21, longitud: -78.48 }
    );
  } finally {
    Campana.findById = originals.findCampaign;
    Recolector.find = originals.findCollectors;
    if (originals.simulator === undefined) delete process.env.ENABLE_GPS_SIMULATOR;
    else process.env.ENABLE_GPS_SIMULATOR = originals.simulator;
  }
});
