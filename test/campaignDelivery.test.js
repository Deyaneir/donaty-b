import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeliveryGoodsDescription,
  buildDeliveryInventory,
  createCampaignDelivery,
  findCampaignPrincipalPoint,
  getCampaignDeliveryReadiness,
} from "../src/services/campaignDelivery.js";
import Clasificacion from "../src/models/Clasificacion.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Campana from "../src/models/Campana.js";
import Donacion from "../src/models/Donacion.js";
import { serializeCampaignDeliveryForDonor } from "../src/utils/campaignDelivery.js";
import {
  buildPointAssignmentsAfterRoleChange,
  normalizeCampaignResponsibilities,
} from "../src/controllers/campana_controller.js";
import { consultarEntregaGeneral } from "../src/controllers/entrega_campana_controller.js";
import { listarCampanasAdmin } from "../src/controllers/campana_admin_controller.js";
import { marcarEntregada } from "../src/controllers/donacion_controller.js";
import campaignRouter from "../src/routers/campana_routes.js";

const campaign = {
  _id: "campaign-1",
  assignmentVersion: 0,
  estado: "finalizada",
  activa: false,
  puntosRecoleccion: [
    {
      _id: "point-1",
      nombre: "Punto uno",
      recolectores: ["collector-1", "collector-2"],
      responsableRecolector: "collector-1",
    },
    {
      _id: "point-2",
      nombre: "Punto dos",
      recolectores: ["collector-3"],
      responsableRecolector: "collector-3",
    },
  ],
  responsablesCampana: [
    { _id: "lead-1", nombreCompleto: "Ana Responsable", cargo: "Coordinadora" },
  ],
};

const donations = [
  {
    _id: "donation-1",
    campana: "campaign-1",
    puntoRecoleccionRef: "point-1",
    clasificacionId: "classification-1",
    recolector: "collector-2",
    nombreBien: "Atún en agua",
    categoria: "Comida",
    subcategoria: "Enlatados",
    metadata: { cantidad: 4 },
    productosClasificados: [{
      categoria: "Enlatados",
      producto: "Atún",
      nombreBien: "Atún en agua",
      cantidad: 4,
    }],
    estado: "en_entrega",
  },
  {
    _id: "donation-2",
    campana: "campaign-1",
    puntoRecoleccionRef: "point-2",
    clasificacionId: "classification-2",
    recolector: "collector-3",
    nombreBien: "Atún en agua",
    categoria: "Comida",
    subcategoria: "Enlatados",
    metadata: { cantidad: 2 },
    productosClasificados: [{
      categoria: "Enlatados",
      producto: "Atún",
      nombreBien: "Atún en agua",
      cantidad: 2,
    }],
    estado: "en_entrega",
  },
];

const query = (resolve) => ({
  session() { return this; },
  lean() { return this; },
  then(onFulfilled, onRejected) {
    return Promise.resolve().then(resolve).then(onFulfilled, onRejected);
  },
});

const makeModels = ({
  campaignRecord = structuredClone(campaign),
  donationRecords = structuredClone(donations),
  existingDelivery = null,
  enabledCollector = true,
} = {}) => {
  const saved = [];
  let currentDelivery = existingDelivery;
  let transactionTail = Promise.resolve();
  const sessionFactory = async () => ({
    async withTransaction(operation) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        await operation();
      } finally {
        release();
      }
    },
    async endSession() {},
  });
  return {
    campaignModel: {
      findById: () => query(() => campaignRecord),
      updateOne: async () => {
        campaignRecord.assignmentVersion += 1;
        return { modifiedCount: 1 };
      },
    },
    donationModel: {
      find: () => query(() => donationRecords),
      updateMany: async (filter) => {
        const selected = donationRecords.filter((donation) =>
          filter._id.$in.some((id) => String(id) === String(donation._id))
          && donation.estado === filter.estado
        );
        selected.forEach((donation) => {
          donation.estado = "entregada";
        });
        return { matchedCount: selected.length, modifiedCount: selected.length };
      },
    },
    deliveryModel: {
      findOne: () => query(() => currentDelivery),
      create: async ([delivery]) => {
        saved.push(delivery);
        currentDelivery = delivery;
        return [delivery];
      },
    },
    collectorModel: {
      findOne: () => query(() => enabledCollector
        ? { _id: "collector-1", nombre: "Ana", apellido: "Recolectora" }
        : null),
    },
    classificationModel: {
      find: () => query(() => [
        {
          _id: "classification-1",
          campana: "campaign-1",
          puntoRecoleccionRef: "point-1",
          nombre: "Enlatados",
        },
        {
          _id: "classification-2",
          campana: "campaign-1",
          puntoRecoleccionRef: "point-2",
          nombre: "Enlatados",
        },
      ]),
    },
    sessionFactory,
    saved,
    campaignRecord,
    donationRecords,
  };
};

const makeDelivery = (models, options = {}) =>
  createCampaignDelivery({
    campaignId: "campaign-1",
    collectorId: "collector-1",
    receptor: "Centro de acogida",
    fechaEntrega: new Date("2026-03-01T10:00:00.000Z"),
    evidencias: [{ imagenUrl: "https://images.example/evidence.jpg", imagenPublicId: "evidence-1" }],
    ...models,
    ...options,
  });

const responseStub = () => ({
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const getReadiness = (models, options = {}) =>
  getCampaignDeliveryReadiness({
    campaign: models.campaignRecord,
    collectorId: "collector-1",
    ...models,
    ...options,
  });

test("delivery aggregates classified products and preserves donation assignment traces", () => {
  const inventory = buildDeliveryInventory(donations, campaign);

  assert.equal(inventory.products.length, 2);
  assert.equal(inventory.products[0].donacionId, "donation-1");
  assert.equal(inventory.products[0].clasificacionNombre, "Enlatados");
  assert.equal(inventory.products[0].puntoRecoleccionRef, "point-1");
  assert.equal(inventory.products[0].cantidad, 4);
  assert.deepEqual(inventory.products[0].donaciones, ["donation-1"]);
  assert.equal(inventory.products[1].cantidad, 2);
  assert.notEqual(inventory.products[0].donacionId, inventory.products[1].donacionId);
  assert.equal(inventory.traces.length, donations.length);
  assert.equal(inventory.traces[0].recolectorAsignado, "collector-2");
});

test("campaign leads require explicit names and roles without inventing defaults", () => {
  assert.deepEqual(normalizeCampaignResponsibilities([
    { nombreCompleto: "  Ana Responsable ", cargo: " Coordinadora " },
  ]), [
    { nombreCompleto: "Ana Responsable", cargo: "Coordinadora" },
  ]);
  assert.deepEqual(normalizeCampaignResponsibilities([]), []);
  assert.throws(
    () => normalizeCampaignResponsibilities([{ nombreCompleto: "Ana" }]),
    { statusCode: 400 }
  );
  assert.throws(() => normalizeCampaignResponsibilities("Ana, Coordinadora"), {
    statusCode: 400,
  });
});

test("point roles keep one principal and assign all other collectors as support", () => {
  const point = {
    _id: "point-1",
    recolectores: ["collector-1", "collector-2", "collector-3"],
    responsableRecolector: "collector-1",
  };
  const promoted = buildPointAssignmentsAfterRoleChange(
    [point],
    "collector-2",
    "point-1",
    "principal"
  );
  assert.equal(promoted[0].responsableRecolector, "collector-2");
  assert.deepEqual(promoted[0].recolectores, point.recolectores);

  const support = buildPointAssignmentsAfterRoleChange(
    promoted,
    "collector-3",
    "point-1",
    "apoyo"
  );
  assert.equal(support[0].responsableRecolector, "collector-2");
  assert.deepEqual(support[0].recolectores, point.recolectores);
});

test("replacing a collector preserves the point role and leaves the old collector unassigned", () => {
  const point = {
    _id: "point-1",
    recolectores: ["collector-1", "collector-2"],
    responsableRecolector: "collector-1",
  };
  const replaced = buildPointAssignmentsAfterRoleChange(
    [point],
    "collector-3",
    "point-1",
    null,
    "collector-2"
  );

  assert.deepEqual(replaced[0].recolectores, ["collector-1", "collector-3"]);
  assert.equal(replaced[0].responsableRecolector, "collector-1");
  assert.throws(
    () => buildPointAssignmentsAfterRoleChange(
      [point],
      "collector-3",
      "point-1",
      null,
      "collector-missing"
    ),
    { statusCode: 409 }
  );
});

test("the stored principal remains authorized when legacy point data omits it from recolectores", () => {
  const legacyCampaign = {
    puntosRecoleccion: [{
      _id: "point-legacy",
      responsableRecolector: "collector-1",
      recolectores: ["collector-2"],
    }],
  };
  assert.equal(
    findCampaignPrincipalPoint(legacyCampaign, "collector-1")._id,
    "point-legacy"
  );
});

test("a point cannot assign support without a principal or remove its only principal", () => {
  assert.throws(
    () => buildPointAssignmentsAfterRoleChange(
      [{ _id: "point-1", recolectores: [], responsableRecolector: null }],
      "collector-1",
      "point-1",
      "apoyo"
    ),
    { statusCode: 409 }
  );
  assert.throws(
    () => buildPointAssignmentsAfterRoleChange(
      [{
        _id: "point-1",
        recolectores: ["collector-1"],
        responsableRecolector: "collector-1",
      }],
      "collector-1",
      "point-1",
      "apoyo"
    ),
    { statusCode: 409 }
  );
});

test("a point principal registers one campaign-wide delivery without changing assignments", async () => {
  const models = makeModels();
  const delivery = await makeDelivery(models, {
    recibeIdentificacion: "1234567890",
    recibeInstitucion: "Centro de acogida",
    observacion: "Entrega recibida conforme",
  });

  assert.equal(delivery.recolectorPrincipal, "collector-1");
  assert.equal(delivery.puntoRecoleccionRef, "point-1");
  assert.equal(delivery.donaciones.length, 2);
  assert.equal(delivery.productos.length, 2);
  assert.equal(delivery.productos[0].donacionId, "donation-1");
  assert.equal(delivery.clasificaciones.length, 2);
  assert.equal(delivery.productos[0].cantidad, 4);
  assert.equal(delivery.recibeIdentificacion, "1234567890");
  assert.equal(delivery.recibeInstitucion, "Centro de acogida");
  assert.equal(delivery.observacion, "Entrega recibida conforme");
  assert.equal(delivery.productos[0].categoria, "Enlatados");
  assert.equal(delivery.productos[0].subcategoria, "Atún");
  assert.match(delivery.descripcionBienes, /Enlatados \/ Atún \/ Atún en agua: 4 unidades/);
  assert.equal(delivery.responsablesCampana[0].responsableCampanaRef, "lead-1");
  assert.deepEqual(
    delivery.donaciones.map((trace) => trace.recolectorAsignado),
    ["collector-2", "collector-3"]
  );
  assert.equal(models.saved.length, 1);
  assert.ok(models.donationRecords.every((donation) => donation.estado === "entregada"));
  assert.equal(models.campaignRecord.assignmentVersion, 1);
});

test("delivery keeps repeated donation names as separate rows and totals by classification ID", () => {
  const repeatedDonations = [
    { ...donations[0], clasificacionId: "classification-1" },
    { ...donations[1], clasificacionId: "classification-1" },
  ];
  const inventory = buildDeliveryInventory(
    repeatedDonations,
    campaign,
    [{ _id: "classification-1", nombre: "Alimentos" }]
  );

  assert.equal(inventory.products.length, 2);
  assert.deepEqual(inventory.products.map((item) => item.donacionId), [
    "donation-1",
    "donation-2",
  ]);
  assert.deepEqual(inventory.products.map((item) => item.nombreBien), [
    "Atún en agua",
    "Atún en agua",
  ]);
  assert.deepEqual(inventory.products.map((item) => item.cantidad), [4, 2]);
  assert.deepEqual(inventory.classifications, [{
    clasificacionId: "classification-1",
    nombre: "Alimentos",
    cantidadTotal: 6,
    donacionesSinCantidad: 0,
    totalDonaciones: 2,
  }]);
});

test("campaign goods description derives from classified inventory", () => {
  assert.equal(
    buildDeliveryGoodsDescription([{
      categoria: "Enlatados",
      subcategoria: "Atún",
      nombreBien: "Atún en agua",
      cantidad: 10,
      donacionesSinCantidad: 1,
    }]),
    "Enlatados / Atún / Atún en agua: 10 unidades; 1 donación(es) sin cantidad registrada"
  );
});

test("a secondary collector cannot register the general delivery", async () => {
  const models = makeModels();
  await assert.rejects(
    makeDelivery(models, { collectorId: "collector-2" }),
    { statusCode: 403 }
  );
  assert.equal(models.saved.length, 0);
});

test("concurrent delivery requests cannot create two records for one campaign", async () => {
  const models = makeModels();
  const results = await Promise.allSettled([
    makeDelivery(models),
    makeDelivery(models),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(models.saved.length, 1);
});

test("delivery requires at least one donation and every donation in en_entrega", async () => {
  await assert.rejects(
    makeDelivery(makeModels({ donationRecords: [] })),
    { statusCode: 409, message: "La campaña no tiene donaciones para entregar" }
  );

  const pending = structuredClone(donations);
  pending[1].estado = "clasificada";
  await assert.rejects(
    makeDelivery(makeModels({ donationRecords: pending })),
    { statusCode: 409, message: /debe estar en "en_entrega"/ }
  );

  const withoutClassification = structuredClone(donations);
  withoutClassification[0].clasificacionId = null;
  await assert.rejects(
    makeDelivery(makeModels({ donationRecords: withoutClassification })),
    { statusCode: 409, message: /no tiene una clasificación asociada/ }
  );
});

test("delivery is not reported as saved when any donation update fails", async () => {
  const models = makeModels();
  models.donationModel.updateMany = async () => ({
    matchedCount: 1,
    modifiedCount: 1,
  });
  await assert.rejects(
    makeDelivery(models),
    { statusCode: 409, message: /No se pudieron actualizar todas las donaciones/ }
  );
  assert.equal(models.saved.length, 0);
});

test("individual delivery is blocked once a finalized campaign is ready for general delivery", async () => {
  const originals = {
    findDonation: Donacion.findById,
    countDonations: Donacion.countDocuments,
    findCampaign: Campana.findById,
  };
  const donationId = "507f1f77bcf86cd799439011";
  const campaignId = "507f1f77bcf86cd799439012";
  const collectorId = "507f1f77bcf86cd799439013";
  Donacion.findById = () => ({
    select() {
      return this;
    },
    then(resolve) {
      return Promise.resolve({
        _id: donationId,
        tipo: "fisica",
        recolector: collectorId,
        estado: "en_entrega",
        campana: campaignId,
        entregas: [],
      }).then(resolve);
    },
  });
  Donacion.countDocuments = async (filter) =>
    filter.estado === undefined ? 2 : 0;
  Campana.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: campaignId,
      estado: "finalizada",
      activa: false,
    }),
  });
  const response = responseStub();

  try {
    await marcarEntregada(
      {
        user: { _id: collectorId, rol: "recolector" },
        params: { id: donationId },
        body: {
          nombresReceptor: "Ana",
          apellidosReceptor: "Ejemplo",
          telefonoReceptor: "0991234567",
          cargoReceptor: "Coordinadora",
          descripcionBienes: "Recepción de donaciones de campaña",
        },
        files: { imagen: { name: "evidencia.jpg" } },
        get: () => "delivery-idempotency-key",
      },
      response
    );
    assert.equal(response.statusCode, 409);
    assert.match(response.body.msg, /entrega general de campaña/);
  } finally {
    Donacion.findById = originals.findDonation;
    Donacion.countDocuments = originals.countDonations;
    Campana.findById = originals.findCampaign;
  }
});

test("delivery readiness reports principal and all donations ready using POST rules", async () => {
  const readiness = await getReadiness(makeModels());

  assert.equal(readiness.esRecolectorPrincipal, true);
  assert.equal(readiness.campanaFinalizada, true);
  assert.equal(readiness.todasEnEntrega, true);
  assert.equal(readiness.totalDonaciones, 2);
  assert.equal(readiness.donacionesPendientes, 0);
  assert.equal(readiness.entregaRegistrada, false);
  assert.equal(readiness.puedeRegistrarEntrega, true);
});

test("campaign delivery requires a finalized campaign even when all donations are ready", async () => {
  const models = makeModels({
    campaignRecord: {
      ...structuredClone(campaign),
      estado: "activa",
      activa: true,
      fechaFin: "2099-12-31T00:00:00.000Z",
    },
  });
  const readiness = await getReadiness(models);

  assert.equal(readiness.campanaFinalizada, false);
  assert.equal(readiness.todasEnEntrega, true);
  assert.equal(readiness.puedeRegistrarEntrega, false);
  await assert.rejects(makeDelivery(models), {
    statusCode: 409,
    message: "La campaña todavía no ha finalizado",
  });
});

test("delivery readiness blocks missing donations, pending donations and existing deliveries", async () => {
  const empty = await getReadiness(makeModels({ donationRecords: [] }));
  assert.equal(empty.todasEnEntrega, false);
  assert.equal(empty.totalDonaciones, 0);
  assert.equal(empty.puedeRegistrarEntrega, false);

  const pendingDonations = structuredClone(donations);
  pendingDonations[1].estado = "clasificada";
  const pending = await getReadiness(makeModels({ donationRecords: pendingDonations }));
  assert.equal(pending.todasEnEntrega, false);
  assert.equal(pending.donacionesPendientes, 1);
  assert.equal(pending.puedeRegistrarEntrega, false);

  const missingClassification = structuredClone(donations);
  missingClassification[0].clasificacionId = null;
  const classificationReadiness = await getReadiness(
    makeModels({ donationRecords: missingClassification })
  );
  assert.equal(classificationReadiness.donacionesSinClasificacion, 1);
  assert.equal(classificationReadiness.puedeRegistrarEntrega, false);

  const registered = await getReadiness(
    makeModels({ existingDelivery: { _id: "delivery-existing" } })
  );
  assert.equal(registered.entregaRegistrada, true);
  assert.equal(registered.puedeRegistrarEntrega, false);
});

test("delivery readiness denies secondary and disabled collectors", async () => {
  const models = makeModels();
  const secondary = await getReadiness(models, { collectorId: "collector-2" });
  assert.equal(secondary.esRecolectorPrincipal, false);
  assert.equal(secondary.puedeRegistrarEntrega, false);

  const disabled = await getReadiness(makeModels({ enabledCollector: false }));
  assert.equal(disabled.recolectorHabilitado, false);
  assert.equal(disabled.puedeRegistrarEntrega, false);
});

test("delivery rejects existing records and disabled principals", async () => {
  await assert.rejects(
    makeDelivery(makeModels({ existingDelivery: { _id: "delivery-existing" } })),
    { statusCode: 409, message: "La entrega general de esta campaña ya fue registrada" }
  );
  await assert.rejects(
    makeDelivery(makeModels({ enabledCollector: false })),
    { statusCode: 403, message: "El recolector principal no está habilitado" }
  );
});

test("the delivery model enforces one record per campaign", () => {
  assert.ok(
    EntregaCampana.schema.indexes().some(([keys, options]) =>
      keys.campana === 1 && options.unique === true
    )
  );
});

test("classification records are unique per campaign, point, and normalized name", () => {
  assert.ok(
    Clasificacion.schema.indexes().some(([keys, options]) =>
      keys.campana === 1
      && keys.puntoRecoleccionRef === 1
      && keys.nombreClave === 1
      && options.unique === true
    )
  );
});

test("delivery read endpoint returns the full record to its principal and admins", async () => {
  const originalFindOne = EntregaCampana.findOne;
  const originalDonationExists = Donacion.exists;
  const delivery = {
    _id: "delivery-1",
    campana: { _id: "campaign-1", nombre: "Campaña de invierno" },
    receptor: "Centro de acogida",
    nombresReceptor: "Nombre",
    apellidosReceptor: "Ficticio",
    fechaEntrega: new Date("2026-11-23T12:00:00.000Z"),
    recibeIdentificacion: "1234567890",
    recibeInstitucion: "Centro de acogida",
    observacion: "Entrega recibida conforme",
    recolectorPrincipal: {
      _id: "collector-1",
      nombre: "Ana",
      apellido: "Recolectora",
    },
    donaciones: [{ donacion: "donation-1" }],
    clasificaciones: [{
      clasificacionId: "classification-1",
      nombre: "Alimentos",
      cantidadTotal: 6,
    }],
    productos: [
      {
        donacionId: "donation-1",
        clasificacionId: "classification-1",
        nombreBien: "Atún en agua",
        cantidad: 4,
      },
      {
        donacionId: "donation-2",
        clasificacionId: "classification-1",
        nombreBien: "Atún en agua",
        cantidad: 2,
      },
    ],
  };
  EntregaCampana.findOne = () => ({
    populate() {
      return this;
    },
    lean: async () => delivery,
  });
  Donacion.exists = async (filter) => {
    assert.deepEqual(filter, {
      _id: { $in: ["donation-1"] },
      campana: "507f1f77bcf86cd799439012",
      donante: "donor-1",
    });
    return { _id: "donation-1" };
  };
  const response = responseStub();
  const campaignId = "507f1f77bcf86cd799439012";

  try {
    await consultarEntregaGeneral(
      { user: { _id: "collector-1", rol: "recolector" }, params: { campaignId } },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.entrega.entregadoPor, "Ana Recolectora");
    assert.equal(response.body.entrega.recibeIdentificacion, "1234567890");
    assert.equal(response.body.entrega.recibeInstitucion, "Centro de acogida");
    assert.equal(response.body.entrega.recibeNombre, "Nombre Ficticio");
    assert.equal(response.body.entrega.fecha.toISOString(), "2026-11-23T12:00:00.000Z");
    assert.equal(response.body.entrega.observacion, "Entrega recibida conforme");
    assert.deepEqual(response.body.campana, {
      id: "campaign-1",
      nombre: "Campaña de invierno",
    });
    assert.deepEqual(response.body.tablas[0], {
      clasificacion: "Alimentos",
      filas: [
        { producto: "Atún en agua", cantidad: 4 },
        { producto: "Atún en agua", cantidad: 2 },
      ],
      total: 6,
    });
    assert.deepEqual(
      response.body.tablas[0].filas.map((item) => item.producto),
      ["Atún en agua", "Atún en agua"]
    );
    const forbiddenResponse = responseStub();
    await consultarEntregaGeneral(
      {
        user: { _id: "collector-2", rol: "recolector" },
        params: { campaignId },
      },
      forbiddenResponse
    );
    assert.equal(forbiddenResponse.statusCode, 403);

    const donorResponse = responseStub();
    await consultarEntregaGeneral({
      user: { _id: "donor-1", rol: "donante" },
      params: { campanaId: campaignId },
    }, donorResponse);
    assert.equal(donorResponse.statusCode, 200);
    assert.deepEqual(donorResponse.body.entregaGeneral, {
      recibeNombre: "Nombre Ficticio",
      recibeIdentificacion: "1234567890",
      recibeInstitucion: "Centro de acogida",
      fecha: new Date("2026-11-23T12:00:00.000Z"),
      fechaEntrega: new Date("2026-11-23T12:00:00.000Z"),
      observacion: "Entrega recibida conforme",
      entregadoPor: "Ana Recolectora",
    });
    assert.deepEqual(donorResponse.body.campana, {
      id: "campaign-1",
      nombre: "Campaña de invierno",
    });

    Donacion.exists = async () => null;
    const unrelatedDonorResponse = responseStub();
    await consultarEntregaGeneral({
      user: { _id: "donor-2", rol: "donante" },
      params: { campanaId: campaignId },
    }, unrelatedDonorResponse);
    assert.equal(unrelatedDonorResponse.statusCode, 403);
  } finally {
    EntregaCampana.findOne = originalFindOne;
    Donacion.exists = originalDonationExists;
  }
});

test("campaign delivery GET route allows donors to reach the ownership-checked controller", () => {
  const deliveryRoute = campaignRouter.stack.find(
    (layer) => layer.route?.path === "/:campanaId/entrega"
      && layer.route.methods.get
  );
  assert.ok(deliveryRoute);
  assert.equal(deliveryRoute.route.stack.at(-1).name, "consultarEntregaGeneral");
  assert.equal(deliveryRoute.route.stack.length, 3);
});

test("admin campaign list exposes whether a general delivery is registered", async () => {
  const originals = {
    findCampaigns: Campana.find,
    countDonations: Donacion.aggregate,
    findDeliveries: EntregaCampana.find,
  };
  const campaignId = "507f1f77bcf86cd799439011";
  Campana.find = () => ({
    sort() {
      return this;
    },
    lean: async () => [{
      _id: campaignId,
      estado: "finalizada",
      activa: false,
      fechaInicio: new Date("2026-01-01T00:00:00.000Z"),
      puntosRecoleccion: [],
    }],
  });
  Donacion.aggregate = async () => [];
  EntregaCampana.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ _id: "delivery-1", campana: campaignId }],
  });
  const response = responseStub();

  try {
    await listarCampanasAdmin({}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.campanas[0].entregaRegistrada, true);
    assert.equal(response.body.campanas[0].entregaGeneralId, "delivery-1");
  } finally {
    Campana.find = originals.findCampaigns;
    Donacion.aggregate = originals.countDonations;
    EntregaCampana.find = originals.findDeliveries;
  }
});

test("donor delivery serialization omits consolidated products and donation trace", () => {
  const delivery = {
    _id: "delivery-1",
    campana: "campaign-1",
    receptor: "Centro",
    fechaEntrega: new Date("2026-03-01T10:00:00.000Z"),
    responsablesCampana: [{ nombreCompleto: "Ana Responsable", cargo: "Coordinadora" }],
    evidencias: [{ imagenUrl: "https://images.example/evidence.jpg", imagenPublicId: "secret-id" }],
    productos: [{ nombreBien: "Alimentos", cantidad: 20 }],
    donaciones: [{ donacion: "donation-1", recolectorAsignado: "collector-1" }],
  };
  const response = serializeCampaignDeliveryForDonor(delivery);

  assert.equal(response.registrada, true);
  assert.equal(response.responsablesCampana[0].cargo, "Coordinadora");
  assert.equal(response.evidencias[0].imagenUrl, "https://images.example/evidence.jpg");
  assert.equal("productos" in response, false);
  assert.equal("donaciones" in response, false);
  assert.equal("imagenPublicId" in response.evidencias[0], false);
});

test("donor receives a controlled response while the campaign delivery is absent", () => {
  assert.deepEqual(serializeCampaignDeliveryForDonor(null), {
    registrada: false,
    mensaje: "La donación no está asociada a una campaña",
  });
  assert.deepEqual(serializeCampaignDeliveryForDonor(null, "campaign-1"), {
    registrada: false,
    mensaje: "La entrega general de esta campaña aún no ha sido registrada",
  });
});
