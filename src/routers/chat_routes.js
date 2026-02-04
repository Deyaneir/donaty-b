import { Router } from "express";
import auth from "../middlewares/JWT.js";
import { getRoomMessages } from "../controllers/chat_controller.js";

const router = Router();

router.use(auth);
router.get("/:roomId", getRoomMessages);

export default router;
