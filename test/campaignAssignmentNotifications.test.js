import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssignmentNotification,
  buildAssignmentNotificationChanges,
} from "../src/services/campaignAssignmentNotifications.js";

const principalId = "principal-1";
const supportId = "support-1";
const point = {
  _id: "point-1",
  nombre: "Punto Norte",
  responsableRecolector: principalId,
  recolectores: [supportId],
};

test("assignment changes notify only recipients whose point or role changed", () => {
  const previous = [{
    ...point,
    recolectores: [principalId, supportId],
  }];
  const next = [{
    ...point,
    responsableRecolector: supportId,
    recolectores: [principalId, supportId],
  }];
  const changes = buildAssignmentNotificationChanges(previous, next);

  assert.deepEqual(
    changes.map(({ collectorId, previous: before, current }) => ({
      collectorId,
      previousRole: before.rolPunto,
      currentRole: current.rolPunto,
    })),
    [
      { collectorId: principalId, previousRole: "principal", currentRole: "apoyo" },
      { collectorId: supportId, previousRole: "apoyo", currentRole: "principal" },
    ]
  );
});

test("assignment notification payload carries the campaign, point, roster and recipient role", () => {
  const campaign = {
    _id: "campaign-1",
    nombre: "Campaña de invierno",
    __v: 4,
    puntosRecoleccion: [point],
  };
  const change = {
    collectorId: supportId,
    previous: null,
    current: { point, pointId: "point-1", rolPunto: "apoyo" },
  };
  const collectors = new Map([
    [principalId, { _id: principalId, nombre: "Ana", apellido: "Paz" }],
    [supportId, { _id: supportId, nombre: "Luis", apellido: "Sol" }],
  ]);
  const notification = buildAssignmentNotification(
    campaign,
    change,
    collectors,
    "campaign-test"
  );

  assert.equal(notification.eventKey, "campaign-test:campaign-1:4:support-1:apoyo");
  assert.deepEqual(notification.recipients, [{
    userId: supportId,
    role: "recolector",
  }]);
  assert.ok(notification.title);
  assert.ok(notification.body);
  assert.deepEqual(notification.data, {
    type: "collector_point_assignment",
    campaignId: "campaign-1",
    campanaId: "campaign-1",
    campaignName: "Campaña de invierno",
    pointId: "point-1",
    puntoRecoleccionId: "point-1",
    pointName: "Punto Norte",
    principalId,
    principalNombre: "Ana",
    principalApellido: "Paz",
    collectorId: supportId,
    collectorName: "Luis Sol",
    previousCollectorId: "",
    previousCollectorName: "",
    newCollectorId: supportId,
    newCollectorName: "Luis Sol",
    changedById: "",
    changedByName: "",
    changedByRole: "",
    recolectores: JSON.stringify([
      {
        _id: supportId,
        nombre: "Luis",
        apellido: "Sol",
        rolPunto: "apoyo",
      },
      {
        _id: principalId,
        nombre: "Ana",
        apellido: "Paz",
        rolPunto: "principal",
      },
    ]),
    rolPunto: "apoyo",
  });
});
