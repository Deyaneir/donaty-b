import { Schema, model } from "mongoose";

const offlineOperationSchema = new Schema(
  {
    operationId: { type: String, required: true, maxlength: 128 },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    ownerRole: { type: String, required: true, enum: ["admin", "donante", "recolector"] },
    action: { type: String, required: true },
    status: { type: String, required: true, enum: ["processing", "completed"] },
    localCreatedAt: { type: String, default: null },
    entityId: { type: String, default: null },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "offline_operations" }
);

offlineOperationSchema.index({ operationId: 1 }, { unique: true });
offlineOperationSchema.index({ ownerId: 1, createdAt: -1 });

const OfflineOperation = model("OfflineOperation", offlineOperationSchema);

export default OfflineOperation;
