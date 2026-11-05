import assert from "node:assert/strict";
import test from "node:test";
import { migrateUserRole } from "../src/services/userRoleMigration.js";

const query = (value) => ({
  select() {
    return this;
  },
  session() {
    return Promise.resolve(value);
  },
});

const memoryModel = (records = []) => {
  const documents = new Map(records.map((record) => [String(record._id), record]));
  class MemoryDocument {
    constructor(values) {
      Object.assign(this, values);
    }

    async save() {
      documents.set(String(this._id), this);
    }
  }
  return {
    documents,
    Document: MemoryDocument,
    findById(id) {
      return query(documents.get(String(id)) ?? null);
    },
    findOne() {
      return query(null);
    },
  };
};

const modelWithConstructor = (records = []) => {
  const model = memoryModel(records);
  return class extends model.Document {
    static documents = model.documents;
    static findById = model.findById;
    static findOne = model.findOne;
  };
};

const sessionFactory = (withTransaction = async (action) => action()) => async () => ({
  withTransaction,
  async endSession() {},
});

const buildModels = ({ donors = [], collectors = [], devices = [] } = {}) => {
  const Donor = modelWithConstructor(donors);
  const Collector = modelWithConstructor(collectors);
  const Admin = modelWithConstructor();
  const updatedDevices = [];
  const FcmDevice = {
    async updateMany(...args) {
      updatedDevices.push(args);
    },
  };
  return {
    models: {
      admin: Admin,
      donante: Donor,
      recolector: Collector,
      fcmDevice: FcmDevice,
    },
    Donor,
    Collector,
    updatedDevices,
    devices,
  };
};

test("migrates a donor without deleting historical role references", async () => {
  const source = {
    _id: "user-1",
    nombre: "Ana",
    apellido: "Paz",
    direccion: "Quito",
    telefono: "0991111111",
    email: "ana@example.test",
    googleId: "google-user-1",
    password: "$2b$hashed-password",
    status: true,
    confirmEmail: true,
    token: "pending-reset-token",
    tokenExpires: new Date("2026-12-01T00:00:00Z"),
    createdAt: new Date("2025-01-02T00:00:00Z"),
    rol: "donante",
    async save() {},
  };
  const { models, Donor, Collector, updatedDevices } = buildModels({
    donors: [source],
  });

  const migrated = await migrateUserRole({
    id: source._id,
    fromRole: "donante",
    toRole: "recolector",
    updates: { telefono: "0992222222" },
    models,
    sessionFactory: sessionFactory(),
  });

  assert.equal(source.rolMigradoA, "recolector");
  assert.equal(source.status, false);
  assert.equal(source.token, null);
  assert.equal(Donor.documents.get(source._id), source);
  assert.equal(migrated._id, source._id);
  assert.equal(migrated.rol, "recolector");
  assert.equal(migrated.rolMigradoA, null);
  assert.equal(migrated.telefono, "0992222222");
  assert.equal(migrated.password, source.password);
  assert.equal(migrated.googleId, source.googleId);
  assert.equal(migrated.aprobado, false);
  assert.equal(migrated.createdAt, source.createdAt);
  assert.equal(Collector.documents.get(source._id), migrated);
  assert.deepEqual(updatedDevices[0][1], { $set: { role: "recolector" } });
});

test("restores an archived target and keeps its role-specific collector data", async () => {
  const donor = {
    _id: "user-2",
    nombre: "Luis",
    apellido: "Vera",
    email: "luis@example.test",
    password: "$2b$hashed-password",
    status: true,
    confirmEmail: true,
    rol: "donante",
    async save() {},
  };
  const archivedCollector = {
    _id: "user-2",
    email: "old@example.test",
    rol: "recolector",
    rolMigradoA: "donante",
    status: false,
    aprobado: true,
    ubicacionGps: { latitud: -0.21, longitud: -78.48 },
    async save() {},
  };
  const { models, Collector } = buildModels({
    donors: [donor],
    collectors: [archivedCollector],
  });

  const restored = await migrateUserRole({
    id: donor._id,
    fromRole: "donante",
    toRole: "recolector",
    models,
    sessionFactory: sessionFactory(),
  });

  assert.equal(restored, archivedCollector);
  assert.equal(restored.rolMigradoA, null);
  assert.equal(restored.status, true);
  assert.equal(restored.aprobado, true);
  assert.deepEqual(restored.ubicacionGps, {
    latitud: -0.21,
    longitud: -78.48,
  });
  assert.equal(restored.email, donor.email);
  assert.equal(Collector.documents.get(donor._id), archivedCollector);
});

test("does not write when MongoDB transactions are unsupported", async () => {
  const source = {
    _id: "user-3",
    email: "safe@example.test",
    status: true,
    rol: "donante",
    async save() {},
  };
  const { models, Donor, Collector } = buildModels({ donors: [source] });

  await assert.rejects(
    migrateUserRole({
      id: source._id,
      fromRole: "donante",
      toRole: "recolector",
      models,
      sessionFactory: sessionFactory(async () => {
        throw Object.assign(new Error("transactions are not supported"), {
          code: 20,
        });
      }),
    }),
    { statusCode: 503 },
  );

  assert.equal(source.status, true);
  assert.equal(source.rolMigradoA, undefined);
  assert.equal(Donor.documents.get(source._id), source);
  assert.equal(Collector.documents.has(source._id), false);
});
