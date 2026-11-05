import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseBalancedAssignment,
  createDonationWithAssignment,
} from "../src/services/donationAssignment.js";

const points = [
  { _id: "point-a", activo: true, recolectores: ["collector-a"] },
  { _id: "point-b", activo: true, recolectores: ["collector-b"] },
];
const collectors = [
  { _id: "collector-a", nombre: "Ana", apellido: "Uno" },
  { _id: "collector-b", nombre: "Beto", apellido: "Dos" },
];

test("chooses a point with the lowest active workload first", () => {
  const selected = chooseBalancedAssignment({
    points,
    collectors,
    loadByPoint: new Map([["point-a", 4], ["point-b", 1]]),
    loadByCollector: new Map(),
    randomInt: () => 0,
  });

  assert.equal(selected.point._id, "point-b");
  assert.equal(selected.collector._id, "collector-b");
});

test("avoids overloading a collector when another pair has lower combined load", () => {
  const selected = chooseBalancedAssignment({
    points,
    collectors,
    loadByPoint: new Map([["point-a", 0], ["point-b", 1]]),
    loadByCollector: new Map([["collector-a", 8], ["collector-b", 0]]),
    randomInt: () => 0,
  });

  assert.equal(selected.point._id, "point-b");
  assert.equal(selected.collector._id, "collector-b");
});

test("chooses randomly among equal point and collector loads", () => {
  let bound;
  const selected = chooseBalancedAssignment({
    points,
    collectors,
    randomInt: (maximum) => {
      bound = maximum;
      return maximum - 1;
    },
  });

  assert.equal(bound, 2);
  assert.equal(selected.point._id, "point-b");
});

test("rejects assignment when no active point has an available assigned collector", () => {
  assert.throws(
    () => chooseBalancedAssignment({
      points: [{ _id: "point-off", activo: false, recolectores: ["collector-a"] }],
      collectors,
    }),
    { statusCode: 409 }
  );
  assert.throws(
    () => chooseBalancedAssignment({
      points,
      collectors: [],
    }),
    { statusCode: 409 }
  );
});

const createTransactionalModels = () => {
  const campaign = {
    _id: "campaign-a",
    activa: true,
    puntosRecoleccion: structuredClone(points),
    assignmentVersion: 0,
  };
  const donations = [];
  let transactionTail = Promise.resolve();

  const query = (resolve) => ({
    select() { return this; },
    session() { return this; },
    lean() { return this; },
    then(onFulfilled, onRejected) {
      return Promise.resolve().then(resolve).then(onFulfilled, onRejected);
    },
  });
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
      findOne: () => query(() => campaign),
      updateOne: async () => {
        campaign.assignmentVersion += 1;
        return { modifiedCount: 1 };
      },
    },
    collectorModel: {
      find: () => query(() => collectors),
    },
    donationModel: {
      aggregate: () => query(() => {
        const totals = new Map();
        for (const donation of donations) {
          if (["cancelada", "entregada", "devuelta"].includes(donation.estado)) continue;
          const key = `${donation.puntoRecoleccionRef}:${donation.recolector}`;
          totals.set(key, (totals.get(key) || 0) + 1);
        }
        return [...totals].map(([key, total]) => {
          const [point, recolector] = key.split(":");
          return { _id: { point, recolector }, total };
        });
      }),
      async create(values) {
        const [donation] = values;
        donation._id = `donation-${donations.length + 1}`;
        donations.push(donation);
        return [donation];
      },
    },
    sessionFactory,
    donations,
    campaign,
  };
};

test("serializes simultaneous registrations and balances assignments", async () => {
  const models = createTransactionalModels();
  const registrations = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createDonationWithAssignment({
        campaignId: models.campaign._id,
        ...models,
        randomInt: () => 0,
        buildDonation: ({ campaign, point, collector, assignedAt }) => ({
          campana: campaign._id,
          estado: "asignada",
          puntoRecoleccionRef: point._id,
          recolector: collector._id,
          fechaRegistro: assignedAt,
          descripcion: `donacion-${index}`,
        }),
      })
    )
  );

  assert.equal(registrations.length, 8);
  assert.equal(models.donations.length, 8);
  assert.ok(models.donations.every((donation) =>
    donation.fechaAsignacion instanceof Date
    && donation.historialRecolectores[0].puntoRecoleccionNuevo === donation.puntoRecoleccionRef
    && donation.historialRecolectores[0].recolectorNuevo === donation.recolector
  ));
  assert.ok(registrations.every(({ asignacion, donacion }) =>
    asignacion.puntoRecoleccion._id === donacion.puntoRecoleccionRef
    && asignacion.recolector._id === donacion.recolector
  ));
  assert.deepEqual(
    models.donations.reduce((loads, donation) => {
      loads[donation.puntoRecoleccionRef] =
        (loads[donation.puntoRecoleccionRef] || 0) + 1;
      return loads;
    }, {}),
    { "point-a": 4, "point-b": 4 }
  );
});

test("does not count cancelled or completed donations toward assignment load", async () => {
  const models = createTransactionalModels();
  for (const [index, estado] of ["cancelada", "entregada", "devuelta"].entries()) {
    models.donations.push({
      _id: `terminal-${index}`,
      campana: models.campaign._id,
      puntoRecoleccionRef: "point-a",
      recolector: "collector-a",
      estado,
    });
  }

  const result = await createDonationWithAssignment({
    campaignId: models.campaign._id,
    ...models,
    randomInt: () => 0,
    buildDonation: () => ({ estado: "asignada" }),
  });

  assert.equal(result.asignacion.puntoRecoleccion._id, "point-a");
});

test("returns a service-unavailable error when MongoDB transactions are unsupported", async () => {
  await assert.rejects(
    createDonationWithAssignment({
      campaignId: "campaign-a",
      buildDonation: () => ({}),
      sessionFactory: async () => ({
        withTransaction: async () => {
          throw Object.assign(
            new Error("Transaction numbers are only allowed on a replica set member"),
            { code: 20 }
          );
        },
        endSession: async () => {},
      }),
    }),
    { statusCode: 503 }
  );
});
