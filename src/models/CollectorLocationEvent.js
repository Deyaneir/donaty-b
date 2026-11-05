import { Schema, model } from "mongoose";

const collectorLocationEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    collector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      required: true,
      index: true,
    },
    campaign: {
      type: Schema.Types.ObjectId,
      ref: "Campana",
      required: true,
      index: true,
    },
    point: { type: Schema.Types.ObjectId, required: true },
    collectorName: { type: String, required: true },
    campaignName: { type: String, required: true },
    pointName: { type: String, required: true },
    state: { type: String, enum: ["dentro", "fuera"], required: true },
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
    accuracyMeters: { type: Number, min: 0, required: true },
    capturedAt: { type: Date, required: true },
    simulated: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "collector_location_events",
  }
);

collectorLocationEventSchema.index({ createdAt: -1 });

const CollectorLocationEvent = model(
  "CollectorLocationEvent",
  collectorLocationEventSchema
);

export default CollectorLocationEvent;
