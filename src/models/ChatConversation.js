import { Schema, model } from "mongoose";

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true, lowercase: true, trim: true },
    lastReadAt: { type: Date, default: null },
  },
  { _id: false }
);

const chatConversationSchema = new Schema(
  {
    room: { type: String, required: true, unique: true },
    type: { type: String, enum: ["donation", "admin_recolector"], required: true, index: true },
    donacion: { type: Schema.Types.ObjectId, ref: "Donacion", default: null, index: true },
    campana: { type: Schema.Types.ObjectId, ref: "Campana", default: null },
    participants: { type: [participantSchema], default: [] },
  },
  { timestamps: true, collection: "chat_conversations" }
);

chatConversationSchema.index({ "participants.userId": 1, updatedAt: -1 });

const ChatConversation = model("ChatConversation", chatConversationSchema);

export default ChatConversation;