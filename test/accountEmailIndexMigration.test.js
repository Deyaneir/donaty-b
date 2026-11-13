import test from "node:test";
import assert from "node:assert/strict";
import { findPublicAccountEmailConflict } from "../src/utils/accountEmail.js";
import { migratePublicAccountEmailIndexes } from "../src/services/accountEmailIndexMigration.js";

const fakeModel = (collectionName, indexes, duplicates = []) => {
  const calls = [];
  const collection = {
    collectionName,
    listIndexes: () => ({ toArray: async () => indexes }),
    aggregate: () => ({ toArray: async () => duplicates }),
    updateMany: async (...args) => calls.push(["updateMany", ...args]),
    createIndex: async (...args) => calls.push(["createIndex", ...args]),
    dropIndex: async (...args) => calls.push(["dropIndex", ...args]),
  };
  return { Model: { collection }, calls };
};

test("email-role migration dry run lists only related legacy indexes without modifying data", async () => {
  const { Model, calls } = fakeModel("donantes", [
    { name: "_id_", key: { _id: 1 } },
    { name: "email_1", key: { email: 1 }, unique: true },
    { name: "createdAt_1", key: { createdAt: 1 } },
  ]);

  const result = await migratePublicAccountEmailIndexes({
    models: [Model],
  });

  assert.deepEqual(result, [{
    collectionName: "donantes",
    legacyIndexesToDrop: ["email_1"],
    targetIndexExists: false,
    targetIndexesToReplace: [],
  }]);
  assert.deepEqual(calls, []);
});

test("email-role migration creates the compound index before dropping the legacy index", async () => {
  const { Model, calls } = fakeModel("recolectores", [
    { name: "_id_", key: { _id: 1 } },
    { name: "email_1", key: { email: 1 }, unique: true },
  ]);

  const result = await migratePublicAccountEmailIndexes({
    models: [Model],
    apply: true,
  });

  assert.deepEqual(result, [{ collectionName: "recolectores", migrated: true }]);
  assert.deepEqual(calls.map(([name]) => name), [
    "updateMany",
    "createIndex",
    "dropIndex",
  ]);
  assert.deepEqual(calls[1], [
    "createIndex",
    { email: 1, rol: 1 },
    { unique: true, name: "email_1_rol_1" },
  ]);
  assert.deepEqual(calls[2], ["dropIndex", "email_1"]);
});

test("email-role validation blocks the same role but allows the same email across donor and collector", async () => {
  const models = {
    admin: {
      findOne: async ({ email }) => (email === "admin@demo.com" ? { _id: "admin-1" } : null),
    },
    donante: {
      findOne: async ({ email }) => (email === "shared@demo.com" ? { _id: "donante-1" } : null),
    },
    recolector: {
      findOne: async ({ email }) => (email === "other@demo.com" ? { _id: "recolector-1" } : null),
    },
  };

  assert.ok(await findPublicAccountEmailConflict("shared@demo.com", "donante", models));
  assert.equal(await findPublicAccountEmailConflict("shared@demo.com", "recolector", models), null);
  assert.ok(await findPublicAccountEmailConflict("admin@demo.com", "recolector", models));
});

test("email-role migration refuses normalized duplicate accounts without changing indexes", async () => {
  const { Model, calls } = fakeModel("donantes", [], [{ _id: {}, total: 2 }]);

  await assert.rejects(
    migratePublicAccountEmailIndexes({ models: [Model], apply: true }),
    /correos duplicados para el mismo rol normalizado/
  );
  assert.deepEqual(calls, []);
});
