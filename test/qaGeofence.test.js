import test from "node:test";
import assert from "node:assert/strict";
import { isQaGeofenceOverrideAllowed } from "../src/utils/qaGeofence.js";

const environment = (overrides = {}) => ({
  NODE_ENV: "development",
  ENABLE_QA_GEOFENCE_BYPASS: "true",
  QA_GEOFENCE_COLLECTOR_IDS: "collector-1,collector-2",
  QA_GEOFENCE_BYPASS_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ...overrides,
});

test("QA geofence bypass requires an explicitly allowlisted collector in non-production", () => {
  assert.equal(
    isQaGeofenceOverrideAllowed({ _id: "collector-1", rol: "recolector" }, environment()),
    true
  );
  assert.equal(
    isQaGeofenceOverrideAllowed({ _id: "collector-3", rol: "recolector" }, environment()),
    false
  );
  assert.equal(
    isQaGeofenceOverrideAllowed(
      { _id: "collector-1", rol: "recolector" },
      environment({ NODE_ENV: "production" })
    ),
    false
  );
  assert.equal(
    isQaGeofenceOverrideAllowed(
      { _id: "collector-1", rol: "recolector" },
      environment({
        QA_GEOFENCE_BYPASS_EXPIRES_AT: new Date(Date.now() - 1000).toISOString(),
      })
    ),
    false
  );
  assert.equal(
    isQaGeofenceOverrideAllowed({ _id: "collector-1", rol: "donante" }, environment()),
    false
  );
});
