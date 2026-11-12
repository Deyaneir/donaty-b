import test from "node:test";
import assert from "node:assert/strict";
import { transferCampaignCollectorDonations } from "../src/services/campaignCollectorReassignment.js";

const makeSessionFactory = () => async () => ({
  async withTransaction(operation) {
    await operation();
  },
  async endSession() {},
});

test("transfers each assigned donation in one transaction without changing its state", async () => {
  const campaign = {
    _id: "campaign-1",
    __v: 3,
  };
  const donations = [
    { _id: "donation-1", estado: "recolectada" },
    { _id: "donation-2", estado: "en_entrega" },
  ];
  const currentCampaign = {
    _id: campaign._id,
    __v: 3,
    puntosRecoleccion: [{
      _id: "point-1",
      activo: true,
      recolectores: ["collector-old"],
      responsableRecolector: "collector-old",
    }],
    toObject() {
      return this;
    },
  };
  let campaignUpdate;
  let donationUpdates;
  let reservationOptions;
  const updatedCampaign = { _id: campaign._id, puntosRecoleccion: [] };
  const result = await transferCampaignCollectorDonations({
    campaign,
    points: [],
    history: [{
      _id: "history-1",
      recolector: "collector-new",
      recolectorAnterior: "collector-old",
      fecha: new Date("2026-11-08T12:00:00Z"),
    }],
    historyEntryId: "history-1",
    previousCollectorId: "collector-old",
    nextCollectorId: "collector-new",
    pointId: "point-1",
    administratorId: "admin-1",
    motive: "Sustitución",
    sessionFactory: makeSessionFactory(),
    campaignModel: {
      findById() {
        return {
          session() {
            return this;
          },
          async then(resolve) {
            resolve(currentCampaign);
          },
        };
      },
      async findOneAndUpdate(filter, update, options) {
        campaignUpdate = { filter, update, options };
        return updatedCampaign;
      },
    },
    validateAssignableCollectors: async () => {},
    reserveCollectorsForCampaign: async (_candidate, _ids, options) => {
      reservationOptions = options;
    },
    donationModel: {
      find() {
        return {
          select() {
            return this;
          },
          session() {
            return this;
          },
          async lean() {
            return donations;
          },
        };
      },
      async bulkWrite(updates) {
        donationUpdates = updates;
        return { matchedCount: updates.length };
      },
    },
    collectorModel: {
      async updateOne() {},
    },
  });

  assert.equal(result.campaign, updatedCampaign);
  assert.deepEqual(result.donations, donations);
  assert.ok(reservationOptions.session);
  assert.equal(campaignUpdate.options.session, reservationOptions.session);
  assert.deepEqual(
    campaignUpdate.update.$set.historialAsignacionesRecolectores[0].donacionesTransferidas,
    donations.map(({ _id, estado }) => ({ donacion: _id, estado }))
  );
  assert.deepEqual(
    donationUpdates.map(({ updateOne }) => ({
      id: updateOne.filter._id,
      expectedState: updateOne.filter.estado,
      newCollector: updateOne.update.$set.recolector,
      historyState: updateOne.update.$push.historialRecolectores.estado,
    })),
    [
      {
        id: "donation-1",
        expectedState: "recolectada",
        newCollector: "collector-new",
        historyState: "recolectada",
      },
      {
        id: "donation-2",
        expectedState: "en_entrega",
        newCollector: "collector-new",
        historyState: "en_entrega",
      },
    ]
  );
  assert.equal(donationUpdates[0].updateOne.update.$set.estado, undefined);
});

test("rejects a partial donation transfer instead of returning success", async () => {
  const donations = [{ _id: "donation-1", estado: "recolectada" }];
  await assert.rejects(
    transferCampaignCollectorDonations({
      campaign: { _id: "campaign-1", __v: 0 },
      points: [],
      history: [{ _id: "history-1", fecha: new Date() }],
      historyEntryId: "history-1",
      previousCollectorId: "collector-old",
      nextCollectorId: "collector-new",
      pointId: "point-1",
      administratorId: "admin-1",
      motive: "",
      sessionFactory: makeSessionFactory(),
      campaignModel: {
        findById() {
          return {
            session() {
              return Promise.resolve({
                _id: "campaign-1",
                __v: 0,
                puntosRecoleccion: [{
                  _id: "point-1",
                  recolectores: ["collector-old"],
                }],
                toObject() {
                  return this;
                },
              });
            },
          };
        },
        async findOneAndUpdate() {
          return {};
        },
      },
      donationModel: {
        find() {
          return {
            select() {
              return this;
            },
            session() {
              return this;
            },
            async lean() {
              return donations;
            },
          };
        },
        async bulkWrite() {
          return { matchedCount: 0 };
        },
      },
      collectorModel: {
        async updateOne() {},
      },
      reserveCollectorsForCampaign: async () => {},
    }),
    { statusCode: 409 }
  );
});

test("does not commit campaign or donation changes when new collector reservation fails", async () => {
  let campaignUpdateCalled = false;
  const currentCampaign = {
    _id: "campaign-1",
    __v: 0,
    puntosRecoleccion: [{
      _id: "point-1",
      recolectores: ["collector-old"],
    }],
    toObject() {
      return this;
    },
  };

  await assert.rejects(
    transferCampaignCollectorDonations({
      campaign: { _id: "campaign-1", __v: 0 },
      points: [],
      history: [{ _id: "history-1", fecha: new Date() }],
      historyEntryId: "history-1",
      previousCollectorId: "collector-old",
      nextCollectorId: "collector-new",
      pointId: "point-1",
      administratorId: "admin-1",
      motive: "",
      sessionFactory: makeSessionFactory(),
      campaignModel: {
        findById() {
          return {
            session() {
              return Promise.resolve(currentCampaign);
            },
          };
        },
        async findOneAndUpdate() {
          campaignUpdateCalled = true;
          return {};
        },
      },
      donationModel: {
        find() {
          return {
            select() {
              return this;
            },
            session() {
              return this;
            },
            async lean() {
              return [];
            },
          };
        },
      },
      reserveCollectorsForCampaign: async () => {
        throw Object.assign(new Error("Collector reservation conflict"), {
          statusCode: 409,
        });
      },
    }),
    { statusCode: 409, message: "Collector reservation conflict" }
  );
  assert.equal(campaignUpdateCalled, false);
});
