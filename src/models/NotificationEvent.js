import { Schema, model } from "mongoose";

const notificationEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, required: true, index: true },
    recipientRole: {
      type: String,
      enum: ["donante", "recolector", "admin"],
      required: true,
      lowercase: true,
      trim: true,
    },
    type: { type: String, required: true, trim: true, maxlength: 100 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    donationId: { type: Schema.Types.ObjectId, ref: "Donacion", default: null, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campana", default: null, index: true },
    conversationId: { type: String, default: "", trim: true, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null, index: true },
    pushStatus: { type: String, default: "pending", trim: true, maxlength: 50 },
    pushSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "notification_events" }
);

notificationEventSchema.index(
  { eventKey: 1, recipientId: 1, recipientRole: 1 },
  { unique: true }
);
notificationEventSchema.index({ recipientId: 1, recipientRole: 1, readAt: 1, createdAt: -1 });

const NotificationEvent = model("NotificationEvent", notificationEventSchema);

export default NotificationEvent;
