import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  deactivateDevice,
  listarEventosUbicacionRecolectores,
  registerDevice,
} from "../controllers/notification_controller.js";

const router = Router();

router.use(auth);
router.put("/device", registerDevice);
router.delete("/device", deactivateDevice);
router.get(
  "/collector-location-events",
  requireRole("admin"),
  listarEventosUbicacionRecolectores
);

export default router;
