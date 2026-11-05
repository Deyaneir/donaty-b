import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
	getRoomMessages,
	listConversations,
	openAdminCollectorConversation,
	postRoomMessage,
} from "../controllers/chat_controller.js";

const router = Router();

router.use(auth);
router.get("/conversations", listConversations);
router.post("/direct/:collectorId", requireRole("admin"), openAdminCollectorConversation);
router.post("/:roomId/messages", postRoomMessage);
router.get("/:roomId", getRoomMessages);

export default router;
