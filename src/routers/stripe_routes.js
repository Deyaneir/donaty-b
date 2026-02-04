import { Router } from "express";
import {
  createCheckoutSession,
  confirmCheckoutSession,
} from "../controllers/stripe_controller.js";

const router = Router();

router.post("/checkout", createCheckoutSession);
router.post("/confirm", confirmCheckoutSession);

export default router;
