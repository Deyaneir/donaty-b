import test from "node:test";
import assert from "node:assert/strict";
import {
  adminCollectorRoom,
  getDonationRoomAccess,
  parseAdminCollectorRoom,
} from "../src/utils/chatPolicy.js";

const donation = {
  _id: "donation-1",
  donante: "donor-1",
  recolector: "collector-1",
  estado: "asignada",
};

test("donation chat permits only its donor and currently assigned collector", () => {
  assert.equal(getDonationRoomAccess({ _id: "donor-1", rol: "donante" }, donation).ok, true);
  assert.equal(getDonationRoomAccess({ _id: "collector-1", rol: "recolector" }, donation).ok, true);
  assert.equal(getDonationRoomAccess({ _id: "collector-old", rol: "recolector" }, donation).status, 403);
  assert.equal(getDonationRoomAccess({ _id: "admin-1", rol: "admin" }, donation).status, 403);
});

test("terminal donation states allow history but reject new messages", () => {
  for (const estado of ["entregada", "cancelada", "devuelta"]) {
    const finishedDonation = { ...donation, estado };
    assert.equal(getDonationRoomAccess({ _id: "donor-1", rol: "donante" }, finishedDonation, "read").ok, true);
    assert.equal(getDonationRoomAccess({ _id: "donor-1", rol: "donante" }, finishedDonation, "write").status, 409);
  }
});

test("donation chat is unavailable until an account donor and collector are assigned", () => {
  const pending = { ...donation, recolector: null, estado: "pendiente" };
  assert.equal(getDonationRoomAccess({ _id: "donor-1", rol: "donante" }, pending).status, 404);
});

test("direct admin-collector room ids have a stable parseable format", () => {
  const room = adminCollectorRoom("aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb");
  assert.deepEqual(parseAdminCollectorRoom(room), {
    adminId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    collectorId: "bbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(parseAdminCollectorRoom("donation-room"), null);
});