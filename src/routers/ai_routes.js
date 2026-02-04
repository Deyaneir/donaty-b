import { Router } from "express";
import { indexAndCompare } from "../controllers/ai_controller.js";

const router = Router();

router.post("/index", indexAndCompare);

export default router;
