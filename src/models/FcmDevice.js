import { Schema, model } from "mongoose";

const fcmDeviceSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, trim: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    role: {
      type: String,
      enum: ["donante", "recolector", "admin"],
      required: true,
      lowercase: true,
      trim: true,
    },
    platform: { type: String, enum: ["android", "ios", "web"], required: true },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "fcm_devices" }
);

const FcmDevice = model("FcmDevice", fcmDeviceSchema);

export default FcmDevice;
