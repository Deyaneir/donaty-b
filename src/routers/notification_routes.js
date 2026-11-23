import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  contarNotificacionesNoLeidas,
  deactivateDevice,
  listarEventosUbicacionRecolectores,
  listarNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  registerDevice,
} from "../controllers/notification_controller.js";

const router = Router();

router.use(auth);
router.get("/", listarNotificaciones);
router.get("/unread-count", contarNotificacionesNoLeidas);
router.patch("/read-all", marcarTodasLeidas);
router.patch("/:id/read", marcarNotificacionLeida);
router.put("/device", registerDevice);
router.delete("/device", deactivateDevice);
router.get(
  "/collector-location-events",
  requireRole("admin"),
  listarEventosUbicacionRecolectores
);

export default router;
