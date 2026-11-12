import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClassificationByPoint,
  normalizeClassifiedProducts,
} from "../src/utils/donationClassification.js";
import {
  normalizeClassificationName,
  resolveDonationClassification,
} from "../src/services/donationClassifications.js";
import Campana from "../src/models/Campana.js";
import Clasificacion from "../src/models/Clasificacion.js";
import Donacion from "../src/models/Donacion.js";
import { consultarClasificacionesDePunto } from "../src/controllers/campana_admin_controller.js";
import { marcarClasificada } from "../src/controllers/donacion_controller.js";

const donation = {
  categoria: "Alimentos",
  subcategoria: "Enlatados",
  nombreBien: "Atún en agua",
  metadata: { cantidad: 10 },
};

test("classification accepts multiple products and preserves all requested fields", () => {
  const products = normalizeClassifiedProducts(
    [
      {
        categoria: "Enlatados",
        producto: "Atún",
        nombreBien: "Atún en agua",
        cantidad: 10,
      },
      {
        categoria: "Enlatados",
        producto: "Maíz",
        nombreBien: "Maíz dulce",
        cantidad: 5,
      },
    ],
    donation,
    "collector-1",
    new Date("2026-11-08T10:00:00.000Z")
  );

  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    categoria: "Enlatados",
    producto: "Atún",
    nombreBien: "Atún en agua",
    cantidad: 10,
    recolector: "collector-1",
    fecha: new Date("2026-11-08T10:00:00.000Z"),
  });
  assert.equal(products[1].cantidad, 5);
});

test("legacy classification uses the donation's existing item without replacing its source fields", () => {
  const products = normalizeClassifiedProducts(
    undefined,
    donation,
    "collector-1",
    new Date("2026-11-08T10:00:00.000Z")
  );

  assert.deepEqual(products.map(({ categoria, producto, nombreBien, cantidad }) => ({
    categoria,
    producto,
    nombreBien,
    cantidad,
  })), [{
    categoria: "Enlatados",
    producto: "Atún en agua",
    nombreBien: "Atún en agua",
    cantidad: 10,
  }]);
});

test("classification rejects invalid quantities, missing fields, and duplicate products", () => {
  assert.throws(() => normalizeClassifiedProducts([
    { categoria: "Enlatados", producto: "Atún", nombreBien: "Atún", cantidad: 0 },
  ], donation, "collector-1"), { statusCode: 400 });
  assert.throws(() => normalizeClassifiedProducts([
    { categoria: "Enlatados", producto: "Atún", nombreBien: "Atún" },
  ], donation, "collector-1"), { statusCode: 400 });
  assert.throws(() => normalizeClassifiedProducts([
    { categoria: "Enlatados", producto: "Atún", nombreBien: "Atún", cantidad: 1 },
    { categoria: "enlatados", producto: "atún", nombreBien: "ATÚN", cantidad: 1 },
  ], donation, "collector-1"), { statusCode: 409 });
});

test("classification summaries are isolated by point and retain individual donors and quantities", () => {
  const result = buildClassificationByPoint([
    {
      _id: "donation-a",
      puntoRecoleccionRef: "point-a",
      donante: { nombre: "María", apellido: "Uno" },
      productosClasificados: [
        { categoria: "Muñecas", producto: "Barbie", nombreBien: "Barbie", cantidad: 6 },
      ],
    },
    {
      _id: "donation-b",
      puntoRecoleccionRef: "point-a",
      donanteExterno: { nombre: "Josefina", apellido: "Dos" },
      productosClasificados: [
        { categoria: "Muñecas", producto: "Trapo", nombreBien: "Muñeca de trapo", cantidad: 3 },
      ],
    },
    {
      _id: "donation-c",
      puntoRecoleccionRef: "point-b",
      donante: { nombre: "Pedro", apellido: "Tres" },
      productosClasificados: [
        { categoria: "Muñecas", producto: "Muñeca", nombreBien: "Muñeca", cantidad: 4 },
      ],
    },
  ], [
    { _id: "point-a", nombre: "Punto A" },
    { _id: "point-b", nombre: "Punto B" },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].categorias[0].cantidadTotal, 9);
  assert.deepEqual(result[0].categorias[0].detalles.map((item) => item.donante.nombre), [
    "María",
    "Josefina",
  ]);
  assert.equal(result[1].categorias[0].cantidadTotal, 4);
  assert.equal(result[1].categorias[0].detalles[0].donacionId, "donation-c");
});

test("reusing a classification preserves its ID and validates its campaign and point", async () => {
  const existing = {
    _id: "classification-1",
    campana: "campaign-1",
    puntoRecoleccionRef: "point-1",
    nombre: "Alimentos",
  };
  let filter;
  let createCalled = false;
  const result = await resolveDonationClassification({
    campaignId: "campaign-1",
    pointId: "point-1",
    classificationId: "classification-1",
    classificationName: "Alimentos",
    classificationModel: {
      findOne: (query) => {
        filter = query;
        return { lean: async () => existing };
      },
      findOneAndUpdate: async () => {
        createCalled = true;
      },
    },
  });

  assert.equal(result._id, "classification-1");
  assert.equal(filter._id, "classification-1");
  assert.equal(filter.campana, "campaign-1");
  assert.equal(filter.puntoRecoleccionRef, "point-1");
  assert.equal(createCalled, false);
});

test("new classification names are reused per campaign and point, not globally", async () => {
  let upsertFilter;
  const existing = { _id: "classification-2", nombre: "Áreas comunes" };
  const result = await resolveDonationClassification({
    campaignId: "campaign-1",
    pointId: "point-2",
    classificationName: "Areas   comunes",
    classificationModel: {
      findOneAndUpdate: (filter, update, options) => {
        upsertFilter = { filter, update, options };
        return { lean: async () => existing };
      },
    },
  });

  assert.equal(result._id, "classification-2");
  assert.deepEqual(upsertFilter.filter, {
    campana: "campaign-1",
    puntoRecoleccionRef: "point-2",
    nombreClave: "areas comunes",
  });
  assert.equal(upsertFilter.options.upsert, true);
  assert.equal(normalizeClassificationName(" Áreas   comunes "), "areas comunes");
});

test("classification query scopes IDs to the selected point and preserves duplicate donation names", async () => {
  const originals = {
    findCampaign: Campana.findById,
    findClassifications: Clasificacion.find,
    findDonations: Donacion.find,
  };
  const campaignId = "507f1f77bcf86cd799439011";
  const pointId = "507f1f77bcf86cd799439012";
  Campana.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: campaignId,
      puntosRecoleccion: [{
        _id: pointId,
        nombre: "Punto uno",
        recolectores: ["507f1f77bcf86cd799439013"],
      }],
    }),
  });
  Clasificacion.find = (filter) => ({
    sort() {
      assert.equal(String(filter.campana), campaignId);
      assert.equal(String(filter.puntoRecoleccionRef), pointId);
      return this;
    },
    lean: async () => [{
      _id: "507f1f77bcf86cd799439014",
      nombre: "Alimentos",
    }],
  });
  Donacion.find = (filter) => ({
    select() {
      assert.deepEqual(filter.clasificacionId.$in, ["507f1f77bcf86cd799439014"]);
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    lean: async () => [
      {
        _id: "507f1f77bcf86cd799439015",
        clasificacionId: "507f1f77bcf86cd799439014",
        nombreBien: "Atún en agua",
        metadata: { cantidad: 4 },
        estado: "clasificada",
        donanteExterno: { nombre: "María" },
      },
      {
        _id: "507f1f77bcf86cd799439016",
        clasificacionId: "507f1f77bcf86cd799439014",
        nombreBien: "Atún en agua",
        metadata: { cantidad: 2 },
        estado: "clasificada",
        donanteExterno: { nombre: "José" },
      },
    ],
  });
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
    await consultarClasificacionesDePunto(
      {
        params: { campaignId },
        query: { puntoId: "null" },
        user: { _id: "507f1f77bcf86cd799439013", rol: "recolector" },
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [{
      id: "507f1f77bcf86cd799439014",
      nombre: "Alimentos",
      total: 6,
    }]);
  } finally {
    Campana.findById = originals.findCampaign;
    Clasificacion.find = originals.findClassifications;
    Donacion.find = originals.findDonations;
  }
});

test("classifying by name reuses the saved ID and transitions directly to en_entrega", async () => {
  const originals = {
    findDonation: Donacion.findById,
    findCampaign: Campana.findById,
    findOneAndUpdate: Donacion.findOneAndUpdate,
    findDonations: Donacion.find,
    findOrCreateClassification: Clasificacion.findOneAndUpdate,
  };
  const donationId = "507f1f77bcf86cd799439011";
  const campaignId = "507f1f77bcf86cd799439012";
  const pointId = "507f1f77bcf86cd799439013";
  const classificationId = "507f1f77bcf86cd799439014";
  const donation = {
    _id: donationId,
    tipo: "fisica",
    recolector: "507f1f77bcf86cd799439015",
    estado: "recolectada",
    campana: campaignId,
    puntoRecoleccionRef: pointId,
    subcategoria: "Peluche",
    nombreBien: "Oso de peluche",
    metadata: { cantidad: 3 },
  };
  Campana.findById = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: campaignId,
      puntosRecoleccion: [{
        _id: pointId,
        responsableRecolector: donation.recolector,
        recolectores: [donation.recolector],
      }],
    }),
  });
  let savedUpdate;
  Donacion.findById = () => ({
    select() {
      return this;
    },
    then(resolve) {
      return Promise.resolve(donation).then(resolve);
    },
  });
  Clasificacion.findOneAndUpdate = () => ({
    lean: async () => ({
      _id: classificationId,
      nombre: "Peluches",
    }),
  });
  Donacion.findOneAndUpdate = (_filter, update) => {
    savedUpdate = update;
    const updated = {
      ...donation,
      estado: update.$set.estado,
      clasificacionId: update.$set.clasificacionId,
      productosClasificados: update.$set.productosClasificados,
    };
    return {
      populate() {
        return this;
      },
      then(resolve) {
        return Promise.resolve(updated).then(resolve);
      },
    };
  };
  Donacion.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ metadata: { cantidad: 3 } }],
  });
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
    await marcarClasificada(
      {
        params: { id: donationId },
        user: { _id: donation.recolector, rol: "recolector" },
        body: { nombre: "Peluches" },
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(savedUpdate.$set.estado, "en_entrega");
    assert.equal(savedUpdate.$set.clasificacionId, classificationId);
    assert.equal(response.body.donacion.estado, "en_entrega");
    assert.deepEqual(response.body.clasificacion, {
      id: classificationId,
      nombre: "Peluches",
      total: 3,
    });
    assert.equal(response.body.donacion.metadata.cantidad, 3);
  } finally {
    Donacion.findById = originals.findDonation;
    Campana.findById = originals.findCampaign;
    Donacion.findOneAndUpdate = originals.findOneAndUpdate;
    Donacion.find = originals.findDonations;
    Clasificacion.findOneAndUpdate = originals.findOrCreateClassification;
  }
});
