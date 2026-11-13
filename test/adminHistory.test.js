import assert from "node:assert/strict";
import test from "node:test";
import router from "../src/routers/admin_routes.js";
import Campana from "../src/models/Campana.js";
import Donacion from "../src/models/Donacion.js";
import Donante from "../src/models/Donante.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Recolector from "../src/models/Recolector.js";
import {
  listDonationTrace,
  listDonorCampaignDonations,
  listHistorialDonanteDetail,
  listHistorialDonantes,
  listHistorialRecolectorDetail,
  listHistorialRecolectores,
} from "../src/controllers/admin_history_controller.js";

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const queryFor = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  lean() { return Promise.resolve(value); },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

test("admin history routes are registered after authentication and admin-role middleware", () => {
  const protectedIndex = router.stack.findIndex(
    (layer) => layer.name === "authMiddleware"
  );
  const expectedPaths = [
    "/historial/recolectores",
    "/historial/recolectores/:recolectorId",
    "/historial/donantes",
    "/historial/donantes/:donanteId",
    "/historial/donantes/:donanteId/campanas/:campanaId/donaciones",
    "/historial/donaciones/:donacionId/trazabilidad",
  ];

  assert.ok(protectedIndex >= 0);
  for (const routePath of expectedPaths) {
    const routeIndex = router.stack.findIndex((layer) => layer.route?.path === routePath);
    assert.ok(routeIndex > protectedIndex, `${routePath} must follow admin authentication`);
    assert.equal(router.stack[routeIndex].route.methods.get, true);
  }
});

test("collector listing validates combined filters and uses paginated aggregation", async (t) => {
  const originalAggregate = Recolector.aggregate;
  let pipeline;
  t.after(() => { Recolector.aggregate = originalAggregate; });
  Recolector.aggregate = async (value) => {
    pipeline = value;
    return [{
      metadata: [{ total: 1 }],
      items: [{ _id: "collector-id", totalCampanas: 2 }],
    }];
  };
  const res = response();

  await listHistorialRecolectores({
    query: {
      q: "Ana",
      campanaId: "672a3c4d5e6f708192a3c4c1",
      periodoAcademico: "2025-A",
      estadoCuenta: "activa",
      rol: "apoyo",
      fechaDesde: "2025-01-01",
      fechaHasta: "2025-02-01",
      page: "2",
      limit: "10",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.page, 2);
  assert.equal(res.body.limit, 10);
  assert.equal(res.body.totalPages, 1);
  assert.ok(pipeline.some((stage) => stage.$facet));
  const lookup = pipeline.find((stage) => stage.$lookup)?.$lookup;
  assert.equal(lookup.from, Campana.collection.name);
  assert.equal(
    lookup.pipeline[0].$match._id.toString(),
    "672a3c4d5e6f708192a3c4c1"
  );
  assert.ok(lookup.pipeline.some((stage) =>
    JSON.stringify(stage).includes("secundario")
  ));
});

test("collector detail includes stored historic and current campaign assignments", async (t) => {
  const originals = {
    collectorById: Recolector.findById,
    donationDistinct: Donacion.distinct,
    campaignFind: Campana.find,
    donationCount: Donacion.countDocuments,
    donationFind: Donacion.find,
  };
  t.after(() => {
    Recolector.findById = originals.collectorById;
    Donacion.distinct = originals.donationDistinct;
    Campana.find = originals.campaignFind;
    Donacion.countDocuments = originals.donationCount;
    Donacion.find = originals.donationFind;
  });
  const collectorId = "672a3c4d5e6f708192a3c4c1";
  const oldPointId = "672a3c4d5e6f708192a3c4c2";
  const currentPointId = "672a3c4d5e6f708192a3c4c3";
  Recolector.findById = () => queryFor({
    _id: collectorId,
    nombre: "Ana",
    apellido: "Recolectora",
    email: "ana@example.test",
    status: true,
  });
  Donacion.distinct = async () => [];
  Campana.find = () => queryFor([{
    _id: "672a3c4d5e6f708192a3c4c4",
    nombre: "Campaña histórica",
    periodoAcademico: "2025-A",
    puntosRecoleccion: [{
      _id: currentPointId,
      nombre: "Punto actual",
      responsableRecolector: collectorId,
      recolectores: [collectorId],
    }],
    historialAsignacionesRecolectores: [
      {
        recolector: collectorId,
        puntoNuevo: oldPointId,
        fecha: new Date("2025-01-01T10:00:00Z"),
        vigente: false,
        rolPunto: "secundario",
      },
      {
        recolector: collectorId,
        puntoAnterior: oldPointId,
        puntoNuevo: null,
        fecha: new Date("2025-02-01T10:00:00Z"),
        vigente: false,
      },
      {
        recolector: collectorId,
        puntoNuevo: currentPointId,
        fecha: new Date("2025-03-01T10:00:00Z"),
        vigente: true,
        rolPunto: "principal",
      },
    ],
  }]);
  Donacion.countDocuments = async () => 0;
  Donacion.find = () => queryFor([]);
  const res = response();

  await listHistorialRecolectorDetail({
    params: { recolectorId: collectorId },
    query: {},
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.donaciones.total, 0);
  assert.equal(res.body.campanas.length, 2);
  const historical = res.body.campanas.find((item) =>
    String(item.puntoRecoleccion._id) === oldPointId
  );
  const current = res.body.campanas.find((item) =>
    String(item.puntoRecoleccion._id) === currentPointId
  );
  assert.equal(historical.rolDesempenado, "secundario");
  assert.equal(historical.estadoParticipacion, "finalizada");
  assert.equal(historical.fechaDesvinculacion.toISOString(), "2025-02-01T10:00:00.000Z");
  assert.equal(current.rolDesempenado, "principal");
  assert.equal(current.estadoParticipacion, "vigente");
});

test("donor listing applies combined donation filters in the database and returns pagination", async (t) => {
  const originalAggregate = Donante.aggregate;
  const originalDistinct = Campana.distinct;
  let pipeline;
  t.after(() => {
    Donante.aggregate = originalAggregate;
    Campana.distinct = originalDistinct;
  });
  Campana.distinct = async () => ["672a3c4d5e6f708192a3c4c2"];
  Donante.aggregate = async (value) => {
    pipeline = value;
    return [{
      metadata: [{ total: 3 }],
      items: [{
        _id: "donor-id",
        totalCampanas: 1,
        totalDonaciones: 2,
        donacionesFisicas: 2,
        donacionesMonetarias: 0,
      }],
    }];
  };
  const res = response();

  await listHistorialDonantes({
    query: {
      q: "donante",
      campanaId: "672a3c4d5e6f708192a3c4c1",
      periodoAcademico: "2025-A",
      tipo: "fisica",
      estado: "entregada",
      fechaDesde: "2025-01-01",
      fechaHasta: "2025-01-31",
      page: "2",
      limit: "5",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.page, 2);
  assert.equal(res.body.items[0].donacionesFisicas, 2);
  const matchingLookup = pipeline.find((stage) =>
    stage.$lookup?.as === "_matchingDonations"
  );
  assert.ok(matchingLookup);
  const donationMatch = matchingLookup.$lookup.pipeline.find((stage) =>
    stage.$match?.tipo
  ).$match;
  assert.equal(donationMatch.tipo, "fisica");
  assert.equal(donationMatch.estado, "entregada");
  assert.equal(donationMatch.campana.toString(), "672a3c4d5e6f708192a3c4c1");
  assert.ok(donationMatch.$and);
});

test("invalid donor filters are rejected and empty listing results preserve pagination shape", async (t) => {
  const originalAggregate = Donante.aggregate;
  let called = false;
  t.after(() => { Donante.aggregate = originalAggregate; });
  Donante.aggregate = async () => {
    called = true;
    return [{ metadata: [], items: [] }];
  };
  const invalidResponse = response();
  await listHistorialDonantes({ query: { tipo: "otro" } }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(called, false);

  const emptyResponse = response();
  await listHistorialDonantes({ query: { page: "3", limit: "25" } }, emptyResponse);
  assert.deepEqual(emptyResponse.body, {
    total: 0,
    page: 3,
    limit: 25,
    totalPages: 0,
    items: [],
  });
});

test("donor detail uses recorded donations for campaigns and handles donors with none", async (t) => {
  const originalDonorFind = Donante.findById;
  const originalDonationAggregate = Donacion.aggregate;
  t.after(() => {
    Donante.findById = originalDonorFind;
    Donacion.aggregate = originalDonationAggregate;
  });
  const donorId = "672a3c4d5e6f708192a3c4c1";
  Donante.findById = () => queryFor({
    _id: donorId,
    nombre: "Donante",
    apellido: "Histórico",
    email: "donante@example.test",
    password: "must-not-be-returned",
    token: "must-not-be-returned",
  });
  let campaignResults = [{
    campanaId: "672a3c4d5e6f708192a3c4c2",
    campanaNombre: "Campaña participada",
    periodoAcademico: "2025-A",
    fechaParticipacion: new Date("2025-01-01T10:00:00Z"),
    totalDonaciones: 2,
    estadoCampana: "finalizada",
  }];
  Donacion.aggregate = async () => campaignResults;

  const withCampaign = response();
  await listHistorialDonanteDetail({ params: { donanteId: donorId } }, withCampaign);
  assert.equal(withCampaign.body.campanas.length, 1);
  assert.equal(withCampaign.body.campanas[0].totalDonaciones, 2);
  assert.equal(Object.hasOwn(withCampaign.body.donante, "password"), false);
  assert.equal(Object.hasOwn(withCampaign.body.donante, "token"), false);

  campaignResults = [];
  const withoutCampaign = response();
  await listHistorialDonanteDetail({ params: { donanteId: donorId } }, withoutCampaign);
  assert.equal(withoutCampaign.statusCode, 200);
  assert.deepEqual(withoutCampaign.body.campanas, []);
});

test("donor campaign donation cards include classification, pickup point and delivery details", async (t) => {
  const originalDonorExists = Donante.exists;
  const originalCampaignFind = Campana.findById;
  const originalCount = Donacion.countDocuments;
  const originalFind = Donacion.find;
  const originalDeliveryFind = EntregaCampana.findOne;
  t.after(() => {
    Donante.exists = originalDonorExists;
    Campana.findById = originalCampaignFind;
    Donacion.countDocuments = originalCount;
    Donacion.find = originalFind;
    EntregaCampana.findOne = originalDeliveryFind;
  });
  const donorId = "672a3c4d5e6f708192a3c4c1";
  const campaignId = "672a3c4d5e6f708192a3c4c2";
  const donationId = "672a3c4d5e6f708192a3c4c3";
  const pointId = "672a3c4d5e6f708192a3c4c4";
  Donante.exists = async () => ({ _id: donorId });
  Campana.findById = () => queryFor({
    _id: campaignId,
    nombre: "Campaña",
    periodoAcademico: "2025-A",
    puntosRecoleccion: [{ _id: pointId, nombre: "Punto central" }],
  });
  Donacion.countDocuments = async () => 1;
  Donacion.find = () => queryFor([{
    _id: donationId,
    campana: campaignId,
    tipo: "fisica",
    estado: "entregada",
    puntoRecoleccionRef: pointId,
    clasificacionId: { _id: "class-id", nombre: "Ropa" },
    entregas: [{ fecha: new Date("2025-02-01T10:00:00Z") }],
  }]);
  EntregaCampana.findOne = () => queryFor({
    campana: campaignId,
    receptor: "Fundación",
    fechaEntrega: new Date("2025-02-02T10:00:00Z"),
    donaciones: [{ donacion: donationId, estado: "entregada" }],
  });
  const res = response();

  await listDonorCampaignDonations({
    params: { donanteId: donorId, campanaId: campaignId },
    query: {},
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].codigoQr, `DONATY:${donationId}`);
  assert.deepEqual(res.body.items[0].puntoRecoleccion, {
    _id: pointId,
    nombre: "Punto central",
  });
  assert.equal(res.body.items[0].clasificacion.nombre, "Ropa");
  assert.equal(res.body.items[0].entrega.general.receptor, "Fundación");
  assert.equal(res.body.items[0].entrega.individual.length, 1);
});

test("donation trace includes only recorded status events and exposes previous and next states", async (t) => {
  const originalFindById = Donacion.findById;
  const originalDeliveryFind = EntregaCampana.findOne;
  const originalRecolectorFind = Recolector.find;
  t.after(() => {
    Donacion.findById = originalFindById;
    EntregaCampana.findOne = originalDeliveryFind;
    Recolector.find = originalRecolectorFind;
  });
  const donationId = "672a3c4d5e6f708192a3c4c3";
  Donacion.findById = () => queryFor({
    _id: donationId,
    tipo: "fisica",
    estado: "recolectada",
    historialEstados: [
      { estado: "asignada", fecha: new Date("2025-01-01T10:00:00Z") },
      { estado: "recolectada", fecha: new Date("2025-01-02T10:00:00Z") },
    ],
    historialRecolectores: [],
    entregas: [],
    campana: null,
  });
  EntregaCampana.findOne = () => queryFor(null);
  Recolector.find = () => queryFor([]);
  const res = response();

  await listDonationTrace({ params: { donacionId: donationId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.historialEstados.length, 2);
  assert.equal(res.body.historialEstados[0].estadoAnterior, null);
  assert.equal(res.body.historialEstados[0].estadoNuevo, "asignada");
  assert.equal(res.body.historialEstados[1].estadoAnterior, "asignada");
  assert.equal(res.body.historialEstados[1].estadoNuevo, "recolectada");
});
