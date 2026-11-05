import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  actualizarUbicacionRecolector,
  actualizarSimulacionUbicacionRecolector,
  consultarUbicacionRecolector,
  consultarSimuladorUbicacionRecolector,
  limpiarSimulacionUbicacionRecolector,
} from "../controllers/recolector_controller.js";

const router = Router();

router.post("/ubicacion", auth, requireRole("recolector"), actualizarUbicacionRecolector);
router.get("/ubicacion", auth, requireRole("recolector"), consultarUbicacionRecolector);
router.get(
  "/ubicacion/simulador",
  auth,
  requireRole("recolector"),
  consultarSimuladorUbicacionRecolector
);
router.post(
  "/ubicacion/simulador",
  auth,
  requireRole("recolector"),
  actualizarSimulacionUbicacionRecolector
);
router.delete(
  "/ubicacion/simulador",
  auth,
  requireRole("recolector"),
  limpiarSimulacionUbicacionRecolector
);

export default router;
