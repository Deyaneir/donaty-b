import test, { mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import Donante from "../src/models/Donante.js";
import Recolector from "../src/models/Recolector.js";
import Admin from "../src/models/Admin.js";
import Campana from "../src/models/Campana.js";
import {
  crearTokenJWT,
} from "../src/middlewares/JWT.js";
import auth from "../src/middlewares/JWT.js";
import requireRole from "../src/middlewares/requireRole.js";
import { findPublicAccountEmailConflict } from "../src/utils/accountEmail.js";
import { listAvailableCollectorsForCampaign } from "../src/controllers/campana_controller.js";
import {
  crearNuevoPassword,
  login,
  recuperarPassword,
  reenviarConfirmacion,
} from "../src/controllers/donante_controller.js";
import {
  crearNuevoPasswordRecolector,
  loginRecolector,
} from "../src/controllers/recolector_controller.js";

const response = () => ({
  statusCode: 200,
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
  select() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const mockAccountLookup = (t, Model, method, result) =>
  t.mock.method(Model, method, () => queryFor(result));

test("public email policy allows the same address across donor and collector roles only", async () => {
  const email = "shared@example.test";
  const models = {
    admin: { findOne: async () => null },
    donante: { findOne: async () => null },
    recolector: { findOne: async () => null },
  };

  assert.equal(await findPublicAccountEmailConflict(email, "donante", models), null);
  assert.equal(await findPublicAccountEmailConflict(email, "recolector", models), null);

  const donor = { _id: "donor-id", email, rol: "donante" };
  models.donante.findOne = async () => donor;
  assert.equal(await findPublicAccountEmailConflict(email, "donante", models), donor);
  assert.equal(await findPublicAccountEmailConflict(email, "recolector", models), null);

  const collector = { _id: "collector-id", email, rol: "recolector" };
  models.recolector.findOne = async () => collector;
  assert.equal(await findPublicAccountEmailConflict(email, "recolector", models), collector);

  const admin = { _id: "admin-id", email, rol: "admin" };
  models.recolector.findOne = async () => null;
  models.admin.findOne = async () => admin;
  assert.equal(await findPublicAccountEmailConflict(email, "recolector", models), admin);
  await assert.rejects(
    findPublicAccountEmailConflict(email, "admin", models),
    /rol público de cuenta/
  );
});

test("donor and collector model records keep separate IDs and enforce a compound email-role index", () => {
  const email = "shared@example.test";
  const donor = new Donante({
    nombre: "A",
    apellido: "Persona",
    email,
    password: "donor-hash",
  });
  const collector = new Recolector({
    nombre: "A",
    apellido: "Persona",
    email,
    password: "collector-hash",
  });

  assert.notEqual(String(donor._id), String(collector._id));
  assert.equal(donor.email, collector.email);
  assert.equal(donor.rol, "donante");
  assert.equal(collector.rol, "recolector");
  for (const Model of [Donante, Recolector]) {
    assert.ok(Model.schema.indexes().some(([keys, options]) =>
      keys.email === 1 && keys.rol === 1 && options.unique === true
    ));
    assert.equal(Model.schema.indexes().some(([keys, options]) =>
      Object.keys(keys).length === 1 && keys.email === 1 && options.unique === true
    ), false);
  }
  assert.ok(Admin.schema.indexes().some(([keys, options]) =>
    Object.keys(keys).length === 1 && keys.email === 1 && options.unique === true
  ));
});

test("donor and collector logins independently issue role-scoped JWTs", async (t) => {
  const donor = {
    _id: "507f1f77bcf86cd799439011",
    nombre: "Don",
    apellido: "Test",
    direccion: "",
    telefono: "",
    email: "shared@example.test",
    rol: "donante",
    perfilCompleto: true,
    status: true,
    confirmEmail: true,
    matchPassword: async () => true,
  };
  const collector = {
    _id: "507f1f77bcf86cd799439012",
    nombre: "Col",
    apellido: "Test",
    direccion: "",
    telefono: "",
    email: "shared@example.test",
    rol: "recolector",
    status: true,
    confirmEmail: true,
    aprobado: true,
    matchPassword: async () => true,
  };
  mockAccountLookup(t, Donante, "findOne", donor);
  mockAccountLookup(t, Recolector, "findOne", collector);

  const donorResponse = response();
  await login({
    body: { email: donor.email, password: "donor-password" },
  }, donorResponse);
  const collectorResponse = response();
  await loginRecolector({
    body: {
      email: collector.email,
      password: "collector-password",
      rol: "recolector",
    },
  }, collectorResponse);

  const donorClaims = jwt.decode(donorResponse.body.token);
  const collectorClaims = jwt.decode(collectorResponse.body.token);
  assert.equal(donorClaims.id, donor._id);
  assert.equal(donorClaims.rol, "donante");
  assert.equal(collectorClaims.id, collector._id);
  assert.equal(collectorClaims.rol, "recolector");
  assert.notEqual(donorClaims.id, collectorClaims.id);
});

test("login rejects a selected role that does not match the existing role-specific route", async () => {
  const donorResponse = response();
  await login({
    body: { email: "shared@example.test", password: "pass", rol: "recolector" },
  }, donorResponse);
  assert.equal(donorResponse.statusCode, 400);
  assert.match(donorResponse.body.msg, /rol seleccionado/);

  const collectorResponse = response();
  await loginRecolector({
    body: { email: "shared@example.test", password: "pass", rol: "donante" },
  }, collectorResponse);
  assert.equal(collectorResponse.statusCode, 400);
  assert.match(collectorResponse.body.msg, /rol seleccionado/);
});

test("JWT authentication selects the claimed account model and role guard blocks cross-role access", async (t) => {
  const donor = { _id: "donor-id", rol: "donante", status: true };
  const collector = { _id: "collector-id", rol: "recolector", status: true };
  t.mock.method(Donante, "findById", async () => donor);
  t.mock.method(Recolector, "findById", async () => collector);

  for (const account of [donor, collector]) {
    let authenticatedUser = null;
    const req = {
      headers: {
        authorization: `Bearer ${crearTokenJWT(account._id, account.rol)}`,
      },
    };
    const res = response();
    await auth(req, res, () => {
      authenticatedUser = req.user;
    });
    assert.equal(authenticatedUser, account);

    const protectedResponse = response();
    const allowedRole = account === donor ? "recolector" : "donante";
    requireRole(allowedRole)(
      { user: authenticatedUser },
      protectedResponse,
      () => assert.fail("Un rol distinto no debe autorizar el acceso")
    );
    assert.equal(protectedResponse.statusCode, 403);
  }
});

test("password-reset tokens update only the account model for the selected role", async (t) => {
  const token = "a".repeat(32);
  const donor = {
    token,
    tokenExpires: null,
    password: "old-donor-password",
    async encryptPassword(password) {
      return `donor:${password}`;
    },
    async save() {
      this.saved = true;
    },
  };
  const collector = {
    token: "b".repeat(32),
    tokenExpires: null,
    password: "old-collector-password",
    async encryptPassword(password) {
      return `collector:${password}`;
    },
    async save() {
      this.saved = true;
    },
  };
  mock.method(Donante, "findOne", async (filter) =>
    filter.token === donor.token ? donor : null
  );
  mock.method(Recolector, "findOne", async (filter) =>
    filter.token === collector.token ? collector : null
  );

  const donorResponse = response();
  await crearNuevoPassword({
    params: { token },
    body: { password: "new-donor", confirmPassword: "new-donor" },
  }, donorResponse);
  assert.equal(donorResponse.statusCode, 200);
  assert.equal(donor.password, "donor:new-donor");
  assert.equal(collector.password, "old-collector-password");

  const collectorResponse = response();
  await crearNuevoPasswordRecolector({
    params: { token: collector.token },
    body: { password: "new-collector", confirmPassword: "new-collector" },
  }, collectorResponse);
  assert.equal(collectorResponse.statusCode, 200);
  assert.equal(collector.password, "collector:new-collector");
  assert.equal(donor.password, "donor:new-donor");
});

test("shared-email recovery requires a role when both public accounts exist", async (t) => {
  mock.method(Donante, "findOne", async () => ({ rol: "donante" }));
  mock.method(Recolector, "findOne", async () => ({ rol: "recolector" }));
  t.mock.method(console, "error", () => {});

  const res = response();
  await recuperarPassword({
    body: { email: "shared@example.test", origen: "movil" },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.msg, /indica si deseas recuperar donante o recolector/);
});

test("duplicate recovery tokens are rejected without changing either account", async (t) => {
  const token = "c".repeat(32);
  const donor = {
    token,
    tokenExpires: null,
    password: "donor-password",
    async encryptPassword() {
      assert.fail("Ambiguous tokens must not hash or save a password");
    },
    async save() {
      assert.fail("Ambiguous tokens must not modify either account");
    },
  };
  const collector = { token, tokenExpires: null, password: "collector-password" };
  mock.method(Donante, "findOne", async () => donor);
  mock.method(Recolector, "findOne", async () => collector);
  t.mock.method(console, "error", () => {});

  const res = response();
  await crearNuevoPassword({
    params: { token },
    body: { password: "new", confirmPassword: "new" },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(donor.password, "donor-password");
  assert.equal(collector.password, "collector-password");
});

test("confirmation resend refuses to choose between multiple pending accounts", async (t) => {
  const email = "shared@example.test";
  mock.method(Donante, "findOne", async () => ({ email, confirmEmail: false }));
  mock.method(Recolector, "findOne", async () => ({ email, confirmEmail: false }));
  mock.method(Admin, "findOne", async () => null);

  const res = response();
  await reenviarConfirmacion({ body: { email } }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.msg, /indica el rol/);
});

test("campaign availability listing reads reservation campaigns without an undeclared session", async (t) => {
  const collector = {
    _id: "collector-id",
    confirmEmail: true,
    status: true,
    aprobado: true,
    reservasHorarioCampanas: [],
    campanaReservada: null,
  };
  t.mock.method(Recolector, "find", () => ({
    select() {
      return this;
    },
    async lean() {
      return [collector];
    },
  }));
  t.mock.method(Campana, "find", () => ({
    select() {
      return this;
    },
    async lean() {
      return [];
    },
  }));

  const available = await listAvailableCollectorsForCampaign({
    _id: "campaign-id",
    puntosRecoleccion: [],
  });
  assert.deepEqual(available.map(({ _id }) => _id), ["collector-id"]);
});
