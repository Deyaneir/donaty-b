import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Campana from "../src/models/Campana.js";
import Categoria from "../src/models/Categoria.js";
import Donacion from "../src/models/Donacion.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Recolector from "../src/models/Recolector.js";
import { listarCategorias } from "../src/controllers/categoria_controller.js";
import { listarHistorialCampanas } from "../src/controllers/campana_admin_controller.js";
import { listarMisDonaciones } from "../src/controllers/donacion_controller.js";

const donorId = "672a3c4d5e6f708192a3c4c1";
const campaignId = "672a3c4d5e6f708192a3c4c2";
const closedCampaign = {
  _id: campaignId,
  nombre: "Campaña histórica",
  activa: false,
  estado: "finalizada",
  fechaInicio: new Date("2020-01-01T00:00:00.000Z"),
  fechaFin: new Date("2020-01-02T00:00:00.000Z"),
  periodoAcademico: "2020-A",
  imagenUrl: "https://images.example.test/campaign.jpg",
  toObject: () => ({
    _id: campaignId,
    nombre: "Campaña histórica",
    activa: false,
    estado: "finalizada",
    fechaInicio: new Date("2020-01-01T00:00:00.000Z"),
    fechaFin: new Date("2020-01-02T00:00:00.000Z"),
    periodoAcademico: "2020-A",
    imagenUrl: "https://images.example.test/campaign.jpg",
    categoriasPermitidas: [
      { _id: "672a3c4d5e6f708192a3c4c3", nombre: "Ropa", activa: false },
    ],
    puntosRecoleccion: [],
  }),
};

const makeResponse = () => ({
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

describe("donor campaign history", { concurrency: false }, () => {
test("donor campaign history contains only own campaigns and required campaign fields", async () => {
  const originalDistinct = Donacion.distinct;
  const originalAggregate = Donacion.aggregate;
  const originalFind = Campana.find;
  const originalCollectorFind = Recolector.find;
  const originalDeliveryDistinct = EntregaCampana.distinct;
  let campaignFilter;
  Donacion.distinct = async () => [campaignId];
  Donacion.aggregate = async () => [{ _id: campaignId, totalDonaciones: 2 }];
  Campana.find = (filter) => {
    campaignFilter = filter;
    return {
      sort() {
        return this;
      },
      lean: async () => [closedCampaign],
    };
  };
  Recolector.find = () => ({
    select() {
      return this;
    },
    lean: async () => [],
  });
  EntregaCampana.distinct = async () => [];
  const response = makeResponse();
  try {
    await listarHistorialCampanas(
      { user: { _id: donorId, rol: "donante" }, query: {} },
      response
    );
    assert.deepEqual(campaignFilter._id.$in, [campaignId]);
    assert.equal(response.body.total, 1);
    assert.deepEqual(
      {
        _id: response.body.campanas[0]._id,
        nombre: response.body.campanas[0].nombre,
        estado: response.body.campanas[0].estado,
        fechaInicio: response.body.campanas[0].fechaInicio,
        fechaFin: response.body.campanas[0].fechaFin,
        periodoAcademico: response.body.campanas[0].periodoAcademico,
        imagenUrl: response.body.campanas[0].imagenUrl,
      },
      {
        _id: campaignId,
        nombre: "Campaña histórica",
        estado: "finalizada",
        fechaInicio: new Date("2020-01-01T00:00:00.000Z"),
        fechaFin: new Date("2020-01-02T00:00:00.000Z"),
        periodoAcademico: "2020-A",
        imagenUrl: "https://images.example.test/campaign.jpg",
      }
    );
    assert.equal(
      Object.hasOwn(response.body.campanas[0], "historialAsignaciones"),
      true
    );
    assert.deepEqual(response.body.campanas[0].historialAsignaciones, []);
    assert.deepEqual(response.body.campanas[0].recolectores, []);
  } finally {
    Donacion.distinct = originalDistinct;
    Donacion.aggregate = originalAggregate;
    Campana.find = originalFind;
    Recolector.find = originalCollectorFind;
    EntregaCampana.distinct = originalDeliveryDistinct;
  }
});

test("donor can query inactive categories and subcategories from a donated campaign", async () => {
  const originalDistinct = Donacion.distinct;
  const originalFind = Campana.find;
  const originalCategoryFind = Categoria.find;
  Donacion.distinct = async () => [campaignId];
  Campana.find = () => ({
    select() {
      return this;
    },
    lean: async () => [closedCampaign],
  });
  Categoria.find = () => ({
    sort() {
      return this;
    },
    lean: async () => [{
      _id: "672a3c4d5e6f708192a3c4c3",
      campana: campaignId,
      activa: false,
      nombre: "Ropa",
      subcategorias: [
        { nombre: "Abrigos", activa: true },
        { nombre: "Uniformes", activa: false },
      ],
    }],
  });
  const response = makeResponse();
  try {
    await listarCategorias(
      { user: { _id: donorId, rol: "donante" }, query: {} },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.body.categorias[0].subcategorias.map(({ nombre }) => nombre),
      ["Abrigos", "Uniformes"]
    );
  } finally {
    Donacion.distinct = originalDistinct;
    Campana.find = originalFind;
    Categoria.find = originalCategoryFind;
  }
});

test("donor donation history retains all statuses and populated campaign covers", async () => {
  const originalDonationFind = Donacion.find;
  const originalDeliveryFind = EntregaCampana.find;
  let donationFilter;
  const items = ["asignada", "entregada", "cancelada"].map((estado, index) => ({
    campana: {
      _id: campaignId,
      imagenUrl: "https://images.example.test/campaign.jpg",
    },
    toObject: () => ({
      _id: `donation-${index}`,
      estado,
      campana: {
        _id: campaignId,
        imagenUrl: "https://images.example.test/campaign.jpg",
      },
    }),
  }));
  Donacion.find = (filter) => {
    donationFilter = filter;
    return {
      sort() {
        return this;
      },
      populate() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(items).then(resolve, reject);
      },
    };
  };
  EntregaCampana.find = () => ({
    select() {
      return this;
    },
    lean: async () => [],
  });
  const response = makeResponse();
  try {
    await listarMisDonaciones({ user: { _id: donorId } }, response);
    assert.deepEqual(donationFilter, { donante: donorId });
    assert.deepEqual(response.body.items.map((item) => item.estado), [
      "asignada",
      "entregada",
      "cancelada",
    ]);
    assert.ok(response.body.items.every(
      (item) => item.campana.imagenUrl === "https://images.example.test/campaign.jpg"
    ));
  } finally {
    Donacion.find = originalDonationFind;
    EntregaCampana.find = originalDeliveryFind;
  }
});
});
