import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Campana from "../src/models/Campana.js";
import Recolector from "../src/models/Recolector.js";
import { listarDistribucionRecolectores } from "../src/controllers/campana_controller.js";

const campaignId = "672a3c4d5e6f708192a3b4c5";
const collectorIds = {
  requester: "672a3c4d5e6f708192a3c4c6",
  support: "672a3c4d5e6f708192a3c4c7",
  otherPoint: "672a3c4d5e6f708192a3c4c8",
  unassigned: "672a3c4d5e6f708192a3c4c9",
};

const campaign = {
  _id: campaignId,
  puntosRecoleccion: [
    {
      _id: "672a3c4d5e6f708192a3c4d0",
      nombre: "Punto A",
      latitud: -0.21,
      longitud: -78.48,
      responsableRecolector: collectorIds.requester,
      recolectores: [collectorIds.support],
    },
    {
      _id: "672a3c4d5e6f708192a3c4d1",
      nombre: "Punto B",
      responsableRecolector: collectorIds.otherPoint,
      recolectores: [collectorIds.otherPoint],
    },
    {
      _id: "672a3c4d5e6f708192a3c4d2",
      nombre: "Punto inactivo",
      activo: false,
      responsableRecolector: collectorIds.unassigned,
      recolectores: [collectorIds.unassigned],
    },
  ],
};

const invoke = async (userId, campaignRecord = campaign) => {
  const originalFindById = Campana.findById;
  const originalRecolectorFind = Recolector.find;
  let collectorFilter;
  Campana.findById = () => ({ lean: async () => campaignRecord });
  Recolector.find = (filter) => {
    collectorFilter = filter;
    return {
      select() {
        return this;
      },
      lean: async () => [
        { _id: collectorIds.requester, nombre: "Ana", apellido: "Uno" },
        { _id: collectorIds.support, nombre: "Beto", apellido: "Dos" },
      ],
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
    await listarDistribucionRecolectores(
      {
        params: { campaignId },
        user: { _id: userId, rol: "recolector" },
      },
      response
    );
    return { response, collectorFilter };
  } finally {
    Campana.findById = originalFindById;
    Recolector.find = originalRecolectorFind;
  }
};

const invokeAdmin = async (campaignRecord = campaign) => {
  const originalFindById = Campana.findById;
  const originalRecolectorFind = Recolector.find;
  Campana.findById = () => ({
    populate() {
      return this;
    },
    lean: async () => ({
      ...campaignRecord,
      numeroRecolectores: 2,
      historialAsignacionesRecolectores: [],
    }),
  });
  Recolector.find = (filter) => ({
    select() {
      return this;
    },
    lean: async () => filter?._id?.$in
      ? [
          { _id: collectorIds.requester, nombre: "Ana", apellido: "Uno" },
          { _id: collectorIds.support, nombre: "Beto", apellido: "Dos" },
        ]
      : [],
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
    await listarDistribucionRecolectores(
      {
        params: { campaignId },
        user: { _id: collectorIds.requester, rol: "admin" },
      },
      response
    );
    return response;
  } finally {
    Campana.findById = originalFindById;
    Recolector.find = originalRecolectorFind;
  }
};

describe("collector campaign distribution authorization", { concurrency: false }, () => {
test("assigned collector receives only their active point and its roster", async () => {
  const { response, collectorFilter } = await invoke(collectorIds.requester);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(collectorFilter._id.$in.sort(), [
    collectorIds.requester,
    collectorIds.support,
  ].sort());
  assert.equal(response.body.campanaId, campaignId);
  assert.equal(response.body.puntos.length, 1);
  assert.equal(response.body.puntos[0].nombre, "Punto A");
  assert.deepEqual(response.body.puntos[0].responsableRecolector, {
    _id: collectorIds.requester,
    nombre: "Ana",
    apellido: "Uno",
    rolPunto: "principal",
  });
  assert.deepEqual(
    response.body.puntos[0].recolectores.map((collector) => ({
      _id: collector._id,
      nombre: collector.nombre,
      apellido: collector.apellido,
      rolPunto: collector.rolPunto,
    })),
    [
      {
        _id: collectorIds.support,
        nombre: "Beto",
        apellido: "Dos",
        rolPunto: "apoyo",
      },
      {
        _id: collectorIds.requester,
        nombre: "Ana",
        apellido: "Uno",
        rolPunto: "principal",
      },
    ]
  );
  assert.equal(response.body.puntos[0].responsableRecolector.rolPunto, "principal");
  assert.deepEqual(
    response.body.puntos[0].recolectores
      .map(({ _id, rolPunto }) => ({ _id, rolPunto }))
      .sort((left, right) => left._id.localeCompare(right._id)),
    [
      { _id: collectorIds.requester, rolPunto: "principal" },
      { _id: collectorIds.support, rolPunto: "apoyo" },
    ].sort((left, right) => left._id.localeCompare(right._id))
  );
  assert.equal(JSON.stringify(response.body).includes("Punto B"), false);
});

test("unassigned collector cannot query campaign distribution", async () => {
  const { response, collectorFilter } = await invoke(collectorIds.unassigned);

  assert.equal(response.statusCode, 403);
  assert.equal(collectorFilter, undefined);
});

test("the sole assigned collector is reported as principal without an explicit role", async () => {
  const singleCollectorCampaign = {
    ...campaign,
    puntosRecoleccion: [{
      _id: "672a3c4d5e6f708192a3c4d3",
      nombre: "Punto único",
      responsableRecolector: null,
      recolectores: [collectorIds.requester],
    }],
  };
  const { response } = await invoke(collectorIds.requester, singleCollectorCampaign);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.puntos[0].responsableRecolector, {
    _id: collectorIds.requester,
    nombre: "Ana",
    apellido: "Uno",
    rolPunto: "principal",
  });
  assert.equal(response.body.puntos[0].recolectores[0].rolPunto, "principal");

  const adminResponse = await invokeAdmin(singleCollectorCampaign);
  const adminPoint = adminResponse.body.puntos[0];
  assert.equal(adminPoint.responsableRecolector._id, collectorIds.requester);
  assert.equal(adminPoint.recolectores[0].rolPunto, "principal");
  assert.equal(adminResponse.body.asignacionesActuales[0].rolPunto, "principal");
});

test("admin distribution includes populated principal and support collectors", async () => {
  const response = await invokeAdmin();

  assert.equal(response.statusCode, 200);
  const point = response.body.puntos.find(
    ({ id }) => id === campaign.puntosRecoleccion[0]._id
  );
  assert.deepEqual(
    point.recolectores.map(({ _id, nombre, apellido, rolPunto }) => ({
      _id: String(_id),
      nombre,
      apellido,
      rolPunto,
    })),
    [
      {
        _id: collectorIds.support,
        nombre: "Beto",
        apellido: "Dos",
        rolPunto: "apoyo",
      },
      {
        _id: collectorIds.requester,
        nombre: "Ana",
        apellido: "Uno",
        rolPunto: "principal",
      },
    ]
  );
  assert.equal(point.responsableRecolector._id, collectorIds.requester);
  assert.equal(point.responsableRecolector.rolPunto, "principal");
});
});
