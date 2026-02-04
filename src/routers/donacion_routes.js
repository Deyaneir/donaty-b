import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import requirePerfilCompleto from "../middlewares/requirePerfilCompleto.js";
import {
  crearDonacion,
  listarMisDonaciones,
  listarDonaciones,
  listarPendientesRecolector,
  listarAsignadasRecolector,
  asignarRecolector,
  marcarEntregada,
  actualizarEstado,
  listarDonacionesPublic,

  // ✅ AGREGADO
  actualizarMiDonacion,
  eliminarMiDonacion,
  eliminarDonacionAdmin,
} from "../controllers/donacion_controller.js";

const router = Router();

// Público (landing)
router.get("/public", listarDonacionesPublic);

router.use(auth);

// Donante
router.post("/", requireRole("donante"), requirePerfilCompleto, crearDonacion);
router.get("/mis", requireRole("donante"), listarMisDonaciones);

// ✅ AGREGADO (Donante actualiza/elimina sus donaciones)
router.patch("/:id", requireRole("donante"), requirePerfilCompleto, actualizarMiDonacion);
router.delete("/:id", requireRole("donante"), requirePerfilCompleto, eliminarMiDonacion);

// Admin
router.get("/", requireRole("admin"), listarDonaciones);
router.patch("/:id/estado", requireRole("admin"), actualizarEstado);
router.delete("/:id/admin", requireRole("admin"), eliminarDonacionAdmin);

// Recolector
router.get("/pendientes", requireRole("recolector"), listarPendientesRecolector);
router.get("/asignadas", requireRole("recolector"), listarAsignadasRecolector);
router.patch("/:id/asignar", requireRole("recolector"), asignarRecolector);
router.patch("/:id/entregar", requireRole("recolector"), marcarEntregada);

export default router;
