import { Schema, model } from "mongoose";

const notificationEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true, collection: "notification_events" }
);

const NotificationEvent = model("NotificationEvent", notificationEventSchema);

export default NotificationEvent;
