import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
// ⚠️ Si tu controller de campañas tiene otro nombre, corrige este import.
import {
  crearCampana,
  actualizarCampana,
} from "../controllers/campana_controller.js";
import {
  listarCampanasAdmin,
  donacionesDeCampana,
  eliminarCampana,
} from "../controllers/campana_admin_controller.js";

const router = Router();

router.use(auth);

router.get("/admin/lista", requireRole("admin"), listarCampanasAdmin);
router.get("/:id/donaciones", requireRole("admin"), donacionesDeCampana);
router.delete("/:id", requireRole("admin"), eliminarCampana);

// Respaldo: solo se usan si campana_routes.js no define estas rutas.
router.post("/", requireRole("admin"), crearCampana);
router.patch("/:id", requireRole("admin"), actualizarCampana);
router.put("/:id", requireRole("admin"), actualizarCampana);

export default router;