import { Schema, model } from "mongoose";

const collectorLocationSimulationSchema = new Schema(
  {
    collector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      required: true,
      unique: true,
    },
    campaign: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      required: true,
    },
    point: { type: Schema.Types.ObjectId, required: true },
    scenario: {
      type: String,
      enum: ["dentro", "fuera", "sin_gps", "desactualizado"],
      required: true,
    },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    accuracyMeters: { type: Number, min: 0, default: null },
    capturedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  {
    timestamps: true,
    collection: "collector_location_simulations",
  }
);

const CollectorLocationSimulation = model(
  "CollectorLocationSimulation",
  collectorLocationSimulationSchema
);

export default CollectorLocationSimulation;
