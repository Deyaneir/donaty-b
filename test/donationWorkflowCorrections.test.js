import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Campana from "../src/models/Campana.js";
import ChatConversation from "../src/models/ChatConversation.js";
import Donacion from "../src/models/Donacion.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Recolector from "../src/models/Recolector.js";
import { donacionesDeCampana } from "../src/controllers/campana_admin_controller.js";
import { asignarDonacionAdmin } from "../src/controllers/donacion_admin_controller.js";
import { resolveDonationRegistrationError } from "../src/controllers/donacion_controller.js";

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

const makeQuery = (value) => ({
  sort() { return this; },
  populate() { return this; },
  select() { return this; },
  lean() { return this; },
  session() { return this; },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

test("campaign donation listing limits collectors to their assigned pickup points", async () => {
  const ids = {
    campaign: "507f1f77bcf86cd799439011",
    collectorA: "507f1f77bcf86cd799439012",
    collectorB: "507f1f77bcf86cd799439013",
    pointA: "507f1f77bcf86cd799439014",
    pointB: "507f1f77bcf86cd799439015",
  };
  const campaign = {
    _id: ids.campaign,
    nombre: "Campaña",
    puntosRecoleccion: [
      { _id: ids.pointA, nombre: "Punto A", recolectores: [ids.collectorA] },
      { _id: ids.pointB, nombre: "Punto B", recolectores: [ids.collectorB] },
    ],
    toObject() {
      return {
        _id: this._id,
        nombre: this.nombre,
        puntosRecoleccion: this.puntosRecoleccion,
      };
    },
  };
  const donations = [
    {
      _id: "507f1f77bcf86cd799439016",
      puntoRecoleccionRef: ids.pointA,
      donante: { nombre: "Ana", apellido: "Uno" },
      productosClasificados: [
        { categoria: "Muñecas", producto: "Barbie", nombreBien: "Barbie", cantidad: 2 },
      ],
    },
    {
      _id: "507f1f77bcf86cd799439017",
      puntoRecoleccionRef: ids.pointB,
      productosClasificados: [
        { categoria: "Muñecas", producto: "Muñeca", nombreBien: "Muñeca", cantidad: 9 },
      ],
    },
  ];
  const originals = {
    findCampaign: Campana.findById,
    findDonations: Donacion.find,
    findDelivery: EntregaCampana.findOne,
    findCollector: Recolector.findOne,
  };
  Campana.findById = async () => campaign;
  let donationFilter;
  Donacion.find = (filter) => {
    if (filter.puntoRecoleccionRef) {
      donationFilter = filter;
      return makeQuery(donations.filter((item) =>
        item.puntoRecoleccionRef === filter.puntoRecoleccionRef.$in[0]
      ));
    }
    return makeQuery(donations);
  };
  let deliveryQueryCount = 0;
  EntregaCampana.findOne = () => {
    deliveryQueryCount += 1;
    return makeQuery(null);
  };
  Recolector.findOne = () => makeQuery({ _id: ids.collectorA });

  try {
    const response = makeResponse();
    await donacionesDeCampana({
      params: { id: ids.campaign },
      user: { _id: ids.collectorA, rol: "recolector" },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(donationFilter.puntoRecoleccionRef.$in, [ids.pointA]);
    assert.equal(response.body.donaciones.length, 1);
    assert.deepEqual(
      response.body.clasificacionPorPunto.map((entry) => entry.puntoRecoleccion._id),
      [ids.pointA]
    );
    assert.equal(response.body.clasificacionPorPunto[0].categorias[0].cantidadTotal, 2);
    assert.equal(Object.hasOwn(response.body, "entregaGeneral"), false);
    assert.equal(deliveryQueryCount, 1);

    const unauthorized = makeResponse();
    await donacionesDeCampana({
      params: { id: ids.campaign },
      user: { _id: "507f1f77bcf86cd799439018", rol: "recolector" },
    }, unauthorized);
    assert.equal(unauthorized.statusCode, 403);
  } finally {
    Campana.findById = originals.findCampaign;
    Donacion.find = originals.findDonations;
    EntregaCampana.findOne = originals.findDelivery;
    Recolector.findOne = originals.findCollector;
  }
});

test("admin reassignment preserves the current stage and records each reassignment state", async () => {
  const ids = {
    donation: "507f1f77bcf86cd799439021",
    campaign: "507f1f77bcf86cd799439022",
    point: "507f1f77bcf86cd799439023",
    oldCollector: "507f1f77bcf86cd799439024",
    newCollector: "507f1f77bcf86cd799439025",
    admin: "507f1f77bcf86cd799439026",
  };
  let actual = {
    estado: "recolectada",
    recolector: ids.oldCollector,
    campana: ids.campaign,
    puntoRecoleccionRef: ids.point,
    historialEstados: [],
  };
  let capturedFilter;
  let capturedUpdate;
  const selectedCollector = {
    _id: ids.newCollector,
    nombre: "Mario",
    apellido: "Dos",
    status: true,
    aprobado: true,
    confirmEmail: true,
  };
  const originals = {
    findCollector: Recolector.findById,
    findDonation: Donacion.findOne,
    updateDonation: Donacion.findOneAndUpdate,
    findCampaign: Campana.findById,
    findConversation: ChatConversation.findOne,
  };
  Recolector.findById = async () => selectedCollector;
  Donacion.findOne = () => ({
    select() { return this; },
    then(resolve, reject) {
      return Promise.resolve(actual).then(resolve, reject);
    },
  });
  Campana.findById = () => ({
    select() { return this; },
    lean: async () => ({
      puntosRecoleccion: [{
        _id: ids.point,
        recolectores: [ids.oldCollector, ids.newCollector],
      }],
    }),
  });
  Donacion.findOneAndUpdate = (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return makeQuery({
      ...actual,
      ...update.$set,
      estado: actual.estado,
      _id: ids.donation,
      historialRecolectores: [update.$push.historialRecolectores],
    });
  };
  ChatConversation.findOne = async () => null;

  try {
    for (const state of ["asignada", "pendiente_recoleccion", "recolectada"]) {
      const pickupHistory = state === "recolectada"
        ? [{
            estado: "recolectada",
            responsable: ids.oldCollector,
            rolResponsable: "recolector",
          }]
        : [];
      actual = { ...actual, estado: state, historialEstados: pickupHistory };
      const response = makeResponse();
      await asignarDonacionAdmin({
        params: { id: ids.donation },
        body: { recolector: ids.newCollector, motivo: "Cambio de turno" },
        user: { _id: ids.admin },
        app: { get: () => null },
      }, response);

      const history = capturedUpdate.$push.historialRecolectores;
      assert.equal(response.statusCode, 200);
      assert.equal(capturedFilter.estado, state);
      assert.equal(capturedUpdate.$set.recolector, ids.newCollector);
      assert.equal(Object.hasOwn(capturedUpdate.$set, "estado"), false);
      assert.equal(history.recolectorAnterior, ids.oldCollector);
      assert.equal(history.recolectorNuevo, ids.newCollector);
      assert.equal(history.puntoRecoleccionNuevo, ids.point);
      assert.equal(history.estado, state);
      assert.equal(history.administrador, ids.admin);
      assert.ok(history.fecha instanceof Date);
      assert.equal(history.motivo, "Cambio de turno");
      assert.equal(response.body.donacion.estado, state);
      assert.deepEqual(response.body.donacion.historialEstados, pickupHistory);
    }
  } finally {
    Recolector.findById = originals.findCollector;
    Donacion.findOne = originals.findDonation;
    Donacion.findOneAndUpdate = originals.updateDonation;
    Campana.findById = originals.findCampaign;
    ChatConversation.findOne = originals.findConversation;
  }
});

test("collector registration errors return field validation details with a client error status", () => {
  const validation = new mongoose.Error.ValidationError();
  validation.addError("cantidad", new mongoose.Error.ValidatorError({
    message: "La cantidad es obligatoria",
    path: "cantidad",
    value: null,
  }));
  assert.deepEqual(resolveDonationRegistrationError(validation), {
    statusCode: 400,
    message: "La cantidad es obligatoria",
  });

  assert.deepEqual(resolveDonationRegistrationError(
    Object.assign(new Error("Punto fuera de campaña"), { statusCode: 409 })
  ), {
    statusCode: 409,
    message: "Punto fuera de campaña",
  });
});
