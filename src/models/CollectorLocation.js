import { Schema, model } from "mongoose";

const collectorLocationSchema = new Schema(
  {
    collector: {
      type: Schema.Types.ObjectId,
      ref: "Recolector",
      required: true,
      index: true,
    },
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
    accuracyMeters: { type: Number, min: 0, default: null },
    capturedAt: { type: Date, default: null },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "collector_locations" }
);

collectorLocationSchema.index({ collector: 1, receivedAt: -1 });

const CollectorLocation = model("CollectorLocation", collectorLocationSchema);

export default CollectorLocation;
