import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCollectorGeofenceState,
  getCollectorGeofenceTransition,
} from "../src/utils/collectorLocation.js";
import { isInsideEpnCampus } from "../src/utils/epnCampusGeofence.js";
import donationRoutes from "../src/routers/donacion_routes.js";
import collectorLocationRoutes from "../src/routers/recolector_ubicacion_routes.js";
import requireCollectorGeofence from "../src/middlewares/requireCollectorGeofence.js";
import { createCollectorLocationScenario } from "./helpers/collectorLocationSimulator.js";
import { isCollectorLocationSimulatorEnabled } from "../src/utils/devCollectorLocationSimulator.js";
import {
  actualizarSimulacionUbicacionRecolector,
  consultarSimuladorUbicacionRecolector,
  limpiarSimulacionUbicacionRecolector,
} from "../src/controllers/recolector_controller.js";

const now = Date.parse("2026-11-04T20:00:00.000Z");
const validFix = {
  collectorActive: true,
  capturedAt: new Date(now - 10_000),
  accuracyMeters: 20,
  now,
};

test("classifies a fresh GPS fix within the existing EPN polygon", () => {
  assert.equal(
    classifyCollectorGeofenceState(
      createCollectorLocationScenario("dentro", now)
    ),
    "dentro"
  );
});

test("classifies a fresh GPS fix outside the existing EPN polygon", () => {
  assert.equal(
    classifyCollectorGeofenceState(
      createCollectorLocationScenario("fuera", now)
    ),
    "fuera"
  );
});

test("blocks absent, stale, and inaccurate GPS fixes", () => {
  assert.equal(
    classifyCollectorGeofenceState(
      createCollectorLocationScenario("sin_gps", now)
    ),
    "sin_registro"
  );
  assert.equal(
    classifyCollectorGeofenceState(
      createCollectorLocationScenario("desactualizado", now)
    ),
    "desactualizado"
  );
  assert.equal(
    classifyCollectorGeofenceState({
      ...validFix,
      accuracyMeters: 51,
      latitude: -0.210145,
      longitude: -78.488712,
      insideGeofence: true,
    }),
    "impreciso"
  );
});

test("the test simulator does not modify the production geofence or default timestamp", () => {
  assert.throws(() => createCollectorLocationScenario("unknown", now), RangeError);
  assert.equal(isInsideEpnCampus(-0.210145, -78.488712), true);
  assert.equal(isInsideEpnCampus(-0.1807, -78.4678), false);
});

test("phone simulator scenarios remain distinct from real GPS and are dev-only", () => {
  for (const [scenario, expected] of [
    ["dentro", "dentro"],
    ["fuera", "fuera"],
    ["sin_gps", "sin_registro"],
    ["desactualizado", "desactualizado"],
  ]) {
    assert.equal(
      classifyCollectorGeofenceState(
        createCollectorLocationScenario(scenario, now)
      ),
      expected
    );
  }
  assert.equal(
    isCollectorLocationSimulatorEnabled({
      nodeEnv: "development",
      enabled: "true",
      databaseName: "donaty_dev",
      allowedDatabaseName: "donaty_dev",
    }),
    true
  );
  assert.equal(
    isCollectorLocationSimulatorEnabled({
      nodeEnv: "development",
      enabled: "true",
      databaseName: "donaty_dev",
      allowedDatabaseName: "donaty_test",
    }),
    false
  );
  assert.equal(
    isCollectorLocationSimulatorEnabled({
      nodeEnv: "production",
      enabled: "true",
      databaseName: "donaty_dev",
      allowedDatabaseName: "donaty_dev",
    }),
    false
  );
  assert.equal(
    isCollectorLocationSimulatorEnabled({
      nodeEnv: "development",
      enabled: "false",
      databaseName: "donaty_dev",
      allowedDatabaseName: "donaty_dev",
    }),
    false
  );
  assert.equal(
    isCollectorLocationSimulatorEnabled({
      nodeEnv: "development",
      enabled: "true",
      databaseName: "donaty",
      allowedDatabaseName: "donaty",
    }),
    false
  );

  for (const [method, path] of [
    ["get", "/ubicacion/simulador"],
    ["post", "/ubicacion/simulador"],
    ["delete", "/ubicacion/simulador"],
  ]) {
    assert.ok(
      collectorLocationRoutes.stack.some(
        (layer) => layer.route?.path === path && layer.route.methods[method]
      ),
      `expected ${method.toUpperCase()} ${path}`
    );
  }
});

test("production rejects all GPS simulator endpoints", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnabled = process.env.ENABLE_GPS_SIMULATOR;
  const previousDatabaseName = process.env.GPS_SIMULATOR_DATABASE_NAME;
  process.env.NODE_ENV = "production";
  process.env.ENABLE_GPS_SIMULATOR = "true";
  process.env.GPS_SIMULATOR_DATABASE_NAME = "donaty_dev";

  const createResponse = () => ({
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

  try {
    for (const handler of [
      consultarSimuladorUbicacionRecolector,
      actualizarSimulacionUbicacionRecolector,
      limpiarSimulacionUbicacionRecolector,
    ]) {
      const response = createResponse();
      await handler(
        { user: { _id: "507f1f77bcf86cd799439011" }, body: {} },
        response
      );
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.msg, "Simulador GPS no disponible");
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnabled === undefined) delete process.env.ENABLE_GPS_SIMULATOR;
    else process.env.ENABLE_GPS_SIMULATOR = previousEnabled;
    if (previousDatabaseName === undefined) {
      delete process.env.GPS_SIMULATOR_DATABASE_NAME;
    } else {
      process.env.GPS_SIMULATOR_DATABASE_NAME = previousDatabaseName;
    }
  }
});

test("emits one transition per exit/return and none for repeated fixes", () => {
  assert.equal(getCollectorGeofenceTransition("dentro", "fuera"), "salida");
  assert.equal(getCollectorGeofenceTransition("fuera", "fuera"), null);
  assert.equal(getCollectorGeofenceTransition("fuera", "dentro"), "retorno");
  assert.equal(getCollectorGeofenceTransition("dentro", "dentro"), null);
  assert.equal(getCollectorGeofenceTransition("sin_registro", "dentro"), null);
});

test("all collector write endpoints enforce the backend geofence", () => {
  const protectedRoutes = [
    ["post", "/registrar-por-recolector"],
    ["patch", "/:id/asignar"],
    ["patch", "/:id/pendiente-recoleccion"],
    ["patch", "/:id/recolectar"],
    ["patch", "/:id/clasificar"],
    ["patch", "/:id/iniciar-entrega"],
    ["patch", "/:id/devolucion"],
    ["patch", "/:id/confirmar-devolucion"],
    ["patch", "/:id/entregar"],
    ["post", "/:id/evidencias"],
  ];

  for (const [method, path] of protectedRoutes) {
    const route = donationRoutes.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method]
    )?.route;
    assert.ok(route, `expected ${method.toUpperCase()} ${path} to exist`);
    assert.ok(
      route.stack.some((layer) => layer.handle === requireCollectorGeofence),
      `expected ${method.toUpperCase()} ${path} to enforce the geofence`
    );
  }
});

test("read-only donation routes remain available without a location gate", () => {
  const readOnlyRoutes = [
    ["get", "/pendientes"],
    ["get", "/asignadas"],
    ["post", "/qr"],
  ];

  for (const [method, path] of readOnlyRoutes) {
    const route = donationRoutes.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method]
    )?.route;
    assert.ok(route, `expected ${method.toUpperCase()} ${path} to exist`);
    assert.equal(
      route.stack.some((layer) => layer.handle === requireCollectorGeofence),
      false,
      `did not expect ${method.toUpperCase()} ${path} to enforce the geofence`
    );
  }
});
