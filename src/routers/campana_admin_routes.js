import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import rejectClosedCampaignMutation from "../middlewares/rejectClosedCampaignMutation.js";
// ⚠️ Si tu controller de campañas tiene otro nombre, corrige este import.
import {
  crearCampana,
  actualizarCampana,
} from "../controllers/campana_controller.js";
import {
  listarCampanasAdmin,
  listarPuntosDeCampana,
  donacionesDeCampana,
  eliminarCampana,
  crearPuntoRecoleccion,
  actualizarPuntoRecoleccion,
  eliminarPuntoRecoleccion,
} from "../controllers/campana_admin_controller.js";

const router = Router();

router.use(auth);

router.get("/admin/lista", requireRole("admin"), listarCampanasAdmin);
router.get(
  "/:campanaId/puntos",
  requireRole("admin", "donante", "recolector"),
  listarPuntosDeCampana
);
router.post("/:campaignId/puntos", requireRole("admin"), rejectClosedCampaignMutation("campaign"), crearPuntoRecoleccion);
router.patch("/:campaignId/puntos/:pointId", requireRole("admin"), rejectClosedCampaignMutation("campaign"), actualizarPuntoRecoleccion);
router.delete("/:campaignId/puntos/:pointId", requireRole("admin"), rejectClosedCampaignMutation("campaign"), eliminarPuntoRecoleccion);
router.get("/:id/donaciones", requireRole("admin", "recolector"), donacionesDeCampana);
router.delete("/:id", requireRole("admin"), rejectClosedCampaignMutation("campaign"), eliminarCampana);

// Respaldo: solo se usan si campana_routes.js no define estas rutas.
router.post("/", requireRole("admin"), crearCampana);
router.patch("/:id", requireRole("admin"), rejectClosedCampaignMutation("campaign"), actualizarCampana);
router.put("/:id", requireRole("admin"), rejectClosedCampaignMutation("campaign"), actualizarCampana);

export default router;