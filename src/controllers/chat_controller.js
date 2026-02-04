import ChatMessage from "../models/ChatMessage.js";
import { canAccessRoom } from "../utils/chatRoom.js";

const getRoomMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const user = req.user || req.donanteHeader;

    const access = await canAccessRoom(user, roomId);
    if (!access.ok) {
      return res.status(access.status).json({ msg: access.msg });
    }

    const items = await ChatMessage.find({ room: roomId })
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ items: items.reverse() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

export { getRoomMessages };
