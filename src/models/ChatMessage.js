import { Schema, model } from "mongoose";

const chatMessageSchema = new Schema(
  {
    room: { type: String, required: true, index: true },
    donacion: { type: Schema.Types.ObjectId, ref: "Donacion", default: null },
    senderId: { type: Schema.Types.ObjectId, required: true, index: true },
    senderRol: { type: String, required: true, lowercase: true, trim: true },
    senderNombre: { type: String, default: "", trim: true },
    senderApellido: { type: String, default: "", trim: true },
    senderEmail: { type: String, default: "", trim: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const ChatMessage = model("ChatMessage", chatMessageSchema, "chat_messages");
export default ChatMessage;
