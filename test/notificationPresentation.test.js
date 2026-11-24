import assert from "node:assert/strict";
import test from "node:test";
import Admin from "../src/models/Admin.js";
import Campana from "../src/models/Campana.js";
import Donacion from "../src/models/Donacion.js";
import Donante from "../src/models/Donante.js";
import NotificationEvent from "../src/models/NotificationEvent.js";
import Recolector from "../src/models/Recolector.js";
import { listarNotificaciones } from "../src/controllers/notification_controller.js";

const query = (items) => ({
  sort() { return this; },
  limit() { return this; },
  select() { return this; },
  populate() { return this; },
  lean: async () => items,
});

test("notification list presents donation details and readable status labels", async () => {
  const originals = {
    notificationFind: NotificationEvent.find,
    notificationCount: NotificationEvent.countDocuments,
    donationFind: Donacion.find,
    campaignFind: Campana.find,
    donorFind: Donante.find,
    collectorFind: Recolector.find,
    adminFind: Admin.find,
  };
  NotificationEvent.find = () => query([{
    _id: "notification-example",
    type: "donation_status",
    title: "Estado actualizado",
    body: "La donación ID cambió de pendiente_recoleccion a recolectada.",
    donationId: "donation-example",
    campaignId: "campaign-example",
    recipientId: "donor-example",
    recipientRole: "donante",
    readAt: null,
    createdAt: new Date("2026-11-23T12:00:00.000Z"),
    data: {
      donationId: "donation-example",
      campaignId: "campaign-example",
      donorId: "donor-example",
      collectorId: "collector-example",
      changedById: "collector-example",
      previousStatus: "pendiente_recoleccion",
      newStatus: "recolectada",
    },
  }]);
  NotificationEvent.countDocuments = async () => 1;
  Donacion.find = () => query([{
    _id: "donation-example",
    nombreBien: "Ropa de abrigo",
    descripcion: "Prendas para clima frío",
    donante: "donor-example",
    recolector: "collector-example",
    campana: "campaign-example",
  }]);
  Campana.find = () => query([{ _id: "campaign-example", nombre: "Campaña de invierno" }]);
  Donante.find = () => query([{ _id: "donor-example", nombre: "Donante", apellido: "Ejemplo" }]);
  Recolector.find = () => query([{ _id: "collector-example", nombre: "Recolector", apellido: "Ejemplo" }]);
  Admin.find = () => query([]);

  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await listarNotificaciones({
      user: { _id: "donor-example", rol: "donante" },
      query: {},
    }, response);

    const [item] = response.body.items;
    assert.equal(response.statusCode, 200);
    assert.match(item.message, /Ropa de abrigo/);
    assert.doesNotMatch(item.message, /donation-example/);
    assert.equal(item.data.previousStatusLabel, "Pendiente de recolección");
    assert.equal(item.data.newStatusLabel, "Recolectada");
    assert.equal(item.data.donorName, "Donante Ejemplo");
    assert.equal(item.data.collectorName, "Recolector Ejemplo");
    assert.equal(item.data.campaignName, "Campaña de invierno");
  } finally {
    NotificationEvent.find = originals.notificationFind;
    NotificationEvent.countDocuments = originals.notificationCount;
    Donacion.find = originals.donationFind;
    Campana.find = originals.campaignFind;
    Donante.find = originals.donorFind;
    Recolector.find = originals.collectorFind;
    Admin.find = originals.adminFind;
  }
});
