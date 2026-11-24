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
  const originalCollectorFind = Recolector.find;
  let donationFilter;
  const items = ["asignada", "entregada", "cancelada"].map((estado, index) => {
    const donation = {
      _id: `donation-${index}`,
      estado,
      evidencias: index === 0 ? [{
        etapa: "recepcion",
        recolector: {
          _id: "672a3c4d5e6f708192a3c4c4",
          nombre: "Recolector",
          apellido: "Ejemplo",
        },
        imagenUrl: "https://images.example.test/pickup-proof.jpg",
        fecha: new Date("2026-11-23T11:00:00.000Z"),
      }] : [],
      entregas: index === 0 ? [{
        _id: "672a3c4d5e6f708192a3c4c5",
        nombresReceptor: "Nombre",
        apellidosReceptor: "Ficticio",
        recibeIdentificacion: "ID-FICTICIO",
        recibeInstitucion: "Institución ficticia",
        telefonoReceptor: "0000000000",
        cargoReceptor: "Responsable",
        descripcionBienes: "Bienes de ejemplo",
        recolector: {
          _id: "672a3c4d5e6f708192a3c4c4",
          nombre: "Recolector",
          apellido: "Ejemplo",
        },
        imagenUrl: "https://images.example.test/individual-delivery.jpg",
        fecha: new Date("2026-11-23T12:00:00.000Z"),
      }] : [],
      historialEstados: index === 0 ? [{
        estado: "recolectada",
        responsable: "672a3c4d5e6f708192a3c4c4",
        rolResponsable: "recolector",
        fecha: new Date("2026-11-23T11:30:00.000Z"),
        observaciones: "Recolección confirmada",
      }] : [],
      historialRecolectores: index === 0 ? [{
        fecha: new Date("2026-11-23T10:30:00.000Z"),
        motivo: "Cambio de turno",
        recolectorAnterior: {
          _id: "672a3c4d5e6f708192a3c4c6",
          nombre: "Recolector",
          apellido: "Anterior",
        },
        recolectorNuevo: {
          _id: "672a3c4d5e6f708192a3c4c4",
          nombre: "Recolector",
          apellido: "Ejemplo",
        },
        administrador: {
          _id: "672a3c4d5e6f708192a3c4c7",
          nombre: "Admin",
          apellido: "Ejemplo",
        },
      }] : [],
      campana: {
        _id: campaignId,
        imagenUrl: "https://images.example.test/campaign.jpg",
      },
    };
    return { campana: donation.campana, ...donation, toObject: () => donation };
  });
  const deliveryEvidence = {
    imagenUrl: "https://images.example.test/delivery-proof.jpg",
    fecha: new Date("2026-11-23T12:00:00.000Z"),
  };
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
    lean: async () => [{
      campana: campaignId,
      evidencias: [deliveryEvidence],
      donaciones: [{ donacion: "donation-0" }],
    }],
  });
  Recolector.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{
      _id: "672a3c4d5e6f708192a3c4c4",
      nombre: "Recolector",
      apellido: "Ejemplo",
    }],
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
    assert.equal(String(response.body.items[0].campana._id), campaignId);
    assert.equal(response.body.items[0].estadoLabel, "Asignada");
    assert.deepEqual(response.body.items[0].evidencias[0], {
      etapa: "recepcion",
      imagenUrl: "https://images.example.test/pickup-proof.jpg",
      fecha: new Date("2026-11-23T11:00:00.000Z"),
      recolector: {
        id: "672a3c4d5e6f708192a3c4c4",
        nombre: "Recolector",
        apellido: "Ejemplo",
      },
    });
    assert.equal(response.body.items[0].entregas[0].id, "672a3c4d5e6f708192a3c4c5");
    assert.equal(response.body.items[0].entregas[0].etapa, "finalizacion");
    assert.equal(response.body.items[0].entregas[0].recibeNombre, "Nombre Ficticio");
    assert.equal(response.body.items[0].entregas[0].recibeIdentificacion, "ID-FICTICIO");
    assert.equal(response.body.items[0].entregas[0].recibeInstitucion, "Institución ficticia");
    assert.equal(
      response.body.items[0].entregas[0].fechaEntrega.toISOString(),
      "2026-11-23T12:00:00.000Z"
    );
    assert.equal(
      response.body.items[0].entrega.recibeNombre,
      response.body.items[0].entregas[0].recibeNombre
    );
    assert.equal(
      response.body.items[0].entregas[0].recolector.nombre,
      "Recolector"
    );
    assert.equal(
      response.body.items[0].historialEstados[0].estado,
      "recolectada"
    );
    assert.equal(
      response.body.items[0].historialEstados[0].observaciones,
      "Recolección confirmada"
    );
    assert.equal(
      response.body.items[0].historialEstados[0].responsableDetalle.nombre,
      "Recolector"
    );
    assert.deepEqual(
      response.body.items[0].historialRecolectores[0].previousCollector,
      {
        id: "672a3c4d5e6f708192a3c4c6",
        fullName: "Recolector Anterior",
      }
    );
    assert.deepEqual(
      response.body.items[0].historialRecolectores[0].newCollector,
      {
        id: "672a3c4d5e6f708192a3c4c4",
        fullName: "Recolector Ejemplo",
      }
    );
    assert.deepEqual(
      response.body.items[0].historialRecolectores[0].changedBy,
      {
        id: "672a3c4d5e6f708192a3c4c7",
        fullName: "Admin Ejemplo",
      }
    );
    assert.deepEqual(
      response.body.items[0].entregaGeneralCampana.evidencias,
      [{
        etapa: "entrega",
        imagenUrl: "https://images.example.test/delivery-proof.jpg",
        fecha: deliveryEvidence.fecha,
        recolector: { id: null, nombre: null, apellido: null },
      }]
    );
    assert.deepEqual(
      response.body.items[1].entregaGeneralCampana.registrada,
      false
    );
  } finally {
    Donacion.find = originalDonationFind;
    EntregaCampana.find = originalDeliveryFind;
    Recolector.find = originalCollectorFind;
  }
});
});
