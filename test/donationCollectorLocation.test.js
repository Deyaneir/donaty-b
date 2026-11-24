import test from "node:test";
import assert from "node:assert/strict";
import Donacion from "../src/models/Donacion.js";
import Recolector from "../src/models/Recolector.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Campana from "../src/models/Campana.js";
import { leerDonacionQR } from "../src/controllers/donacion_controller.js";

test("donation QR returns the assigned collector's current real location without point-bound GPS metadata", async () => {
  const ids = {
    donor: "507f1f77bcf86cd799439011",
    collector: "507f1f77bcf86cd799439012",
    campaign: "507f1f77bcf86cd799439013",
    point: "507f1f77bcf86cd799439014",
    donation: "507f1f77bcf86cd799439015",
  };
  const capturedAt = new Date();
  const receivedAt = new Date(capturedAt.getTime() + 100);
  const campaign = new Campana({
    _id: ids.campaign,
    nombre: "Campaña de prueba",
    puntosRecoleccion: [{
      _id: ids.point,
      nombre: "Punto de prueba",
      responsableRecolector: ids.collector,
      recolectores: [ids.collector],
    }],
  });
  const donation = new Donacion({
    _id: ids.donation,
    donante: ids.donor,
    recolector: ids.collector,
    campana: campaign,
    puntoRecoleccionRef: ids.point,
    ubicacionRecoleccion: {
      latitude: -0.210145,
      longitude: -78.488712,
      source: "map",
      isSimulated: false,
      buildingId: 16,
      buildingName: "Facultad de Ingeniería",
    },
    evidencias: [{
      etapa: "finalizacion",
      recolector: ids.collector,
      fecha: receivedAt,
      imagenUrl: "https://images.example.test/individual-delivery.jpg",
      imagenPublicId: "delivery-proof",
      idempotencyKey: "delivery-once",
    }],
    historialEstados: [],
    historialRecolectores: [],
    estado: "asignada",
  });
  const collector = {
    _id: ids.collector,
    nombre: "Recolector",
    apellido: "Asignado",
    status: true,
    ubicacionGps: {
      latitud: -0.1807,
      longitud: -78.4678,
      precisionMetros: 8,
      capturadoEn: capturedAt,
      actualizadoEn: receivedAt,
      campana: null,
      puntoRecoleccion: null,
    },
  };
  const originals = {
    findDonation: Donacion.findById,
    findCollectors: Recolector.find,
    findCollector: Recolector.findById,
    findDelivery: EntregaCampana.findOne,
  };
  let deliveryFilter;
  Donacion.findById = () => ({
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(donation).then(resolve, reject);
    },
  });
  Recolector.find = () => ({
    select() {
      return this;
    },
    lean: async () => [collector],
  });
  Recolector.findById = () => ({
    select() {
      return this;
    },
    lean: async () => collector,
  });
  EntregaCampana.findOne = (filter) => {
    deliveryFilter = filter;
    return {
    select() {
      return this;
    },
    lean: async () => ({
      _id: "delivery-example",
      campana: ids.campaign,
      evidencias: [{
        imagenUrl: "https://images.example.test/campaign-delivery.jpg",
        fecha: receivedAt,
      }],
    }),
    };
  };

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
  try {
    await leerDonacionQR(
      {
        user: { _id: ids.donor, rol: "donante" },
        params: { id: ids.donation },
      },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.donacion.ubicacionRecoleccion, {
      latitude: -0.210145,
      longitude: -78.488712,
      source: "map",
      isSimulated: false,
      buildingId: 16,
      buildingName: "Facultad de Ingeniería",
    });
    assert.deepEqual(response.body.ubicacionResponsable.coordenadas, {
      latitud: -0.1807,
      longitud: -78.4678,
    });
    assert.equal(response.body.ubicacionResponsable.estadoGeografico, "fuera");
    assert.equal(String(deliveryFilter.campana), ids.campaign);
    assert.equal(
      String(deliveryFilter["donaciones.donacion"]),
      ids.donation
    );
    assert.equal(
      response.body.evidenciasPorEtapa.finalizacion[0].fotografias[0].imagenUrl,
      "https://images.example.test/individual-delivery.jpg"
    );
    assert.equal(
      response.body.entregaGeneralCampana.evidencias[0].imagenUrl,
      "https://images.example.test/campaign-delivery.jpg"
    );
    assert.equal(
      response.body.ubicacionResponsable.actualizadoEn.toISOString(),
      receivedAt.toISOString()
    );
  } finally {
    Donacion.findById = originals.findDonation;
    Recolector.find = originals.findCollectors;
    Recolector.findById = originals.findCollector;
    EntregaCampana.findOne = originals.findDelivery;
  }
});
