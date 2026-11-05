import mongoose from "mongoose";
import { isInsideEpnCampus } from "./epnCampusGeofence.js";

const SCENARIO_COORDINATES = {
  dentro: { latitude: -0.210145, longitude: -78.488712 },
  fuera: { latitude: -0.1807, longitude: -78.4678 },
};

const isCollectorLocationSimulatorEnabled = ({
  nodeEnv = process.env.NODE_ENV,
  enabled = process.env.ENABLE_GPS_SIMULATOR,
  databaseName = mongoose.connection.name,
  allowedDatabaseName = process.env.GPS_SIMULATOR_DATABASE_NAME,
} = {}) => {
  const isDevelopmentDatabase =
    typeof databaseName === "string"
    && databaseName === allowedDatabaseName
    && /(?:^|[-_])(dev|development|test|testing)(?:[-_]|$)/i.test(databaseName);
  return (
    (nodeEnv === "development" || nodeEnv === "test")
    && enabled === "true"
    && isDevelopmentDatabase
  );
};

const createCollectorLocationScenario = (scenario, now = Date.now()) => {
  if (scenario === "sin_gps") {
    return {
      scenario,
      collectorActive: true,
      capturedAt: null,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      insideGeofence: false,
      now,
    };
  }

  const coordinates =
    SCENARIO_COORDINATES[scenario === "desactualizado" ? "dentro" : scenario];
  if (!coordinates) {
    throw new RangeError(`Escenario geográfico desconocido: ${scenario}`);
  }

  return {
    scenario,
    collectorActive: true,
    capturedAt: new Date(
      scenario === "desactualizado" ? now - 6 * 60 * 1000 : now - 10_000
    ),
    ...coordinates,
    accuracyMeters: 20,
    insideGeofence: isInsideEpnCampus(
      coordinates.latitude,
      coordinates.longitude
    ),
    now,
  };
};

export {
  createCollectorLocationScenario,
  isCollectorLocationSimulatorEnabled,
};
