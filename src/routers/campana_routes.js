import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import rejectClosedCampaignMutation from "../middlewares/rejectClosedCampaignMutation.js";
import offlineIdempotency from "../middlewares/offlineIdempotency.js";

import {
  listarCampanas,
  crearCampana,
  actualizarCampana,
  listarDistribucionRecolectores,
  distribuirRecolectores,
  reasignarRecolectorAPunto,
  retirarRecolectorDeCampana,
  listarUbicacionesRecolectores,
} from "../controllers/campana_controller.js";
import {
  listarCategoriasDeCampana,
  crearCategoriaEnCampana,
} from "../controllers/categoria_controller.js";
import {
  consultarClasificacionesDePunto,
  listarHistorialCampanas,
  listarHistorialDonacionesRecolector,
} from "../controllers/campana_admin_controller.js";
import {
  consultarEntregaGeneral,
  consultarEstadoEntregaGeneral,
  registrarEntregaGeneral,
} from "../controllers/entrega_campana_controller.js";

const router = Router();

router.get(
  "/historial",
  auth,
  requireRole("admin", "recolector", "donante"),
  listarHistorialCampanas
);
router.get(
  "/:id/historial-recolector",
  auth,
  requireRole("admin", "recolector"),
  listarHistorialDonacionesRecolector
);
router.get(
  "/:campaignId/distribucion-recolectores",
  auth,
  requireRole("admin", "recolector"),
  listarDistribucionRecolectores
);
router.post(
  "/:campaignId/distribucion-recolectores",
  auth,
  requireRole("admin"),
  rejectClosedCampaignMutation("campaign"),
  distribuirRecolectores
);
router.put(
  "/:campaignId/puntos/:pointId/reasignar",
  auth,
  requireRole("admin"),
  rejectClosedCampaignMutation("campaign"),
  reasignarRecolectorAPunto
);
router.get(
  "/:campaignId/entrega-general/estado",
  auth,
  requireRole("recolector"),
  consultarEstadoEntregaGeneral
);
router.get(
  "/:campanaId/entrega",
  auth,
  requireRole("admin", "recolector"),
  consultarEntregaGeneral
);
router.post(
  "/:campaignId/entrega-general",
  auth,
  requireRole("recolector"),
  offlineIdempotency("campaign.delivery.register"),
  registrarEntregaGeneral
);
router.post(
  "/:campanaId/entrega",
  auth,
  requireRole("recolector"),
  offlineIdempotency("campaign.delivery.register"),
  registrarEntregaGeneral
);
router.delete(
  "/:campaignId/recolectores/:collectorId",
  auth,
  requireRole("admin"),
  rejectClosedCampaignMutation("campaign"),
  retirarRecolectorDeCampana
);
router.get(
  "/:campaignId/ubicaciones-recolectores",
  auth,
  requireRole("admin"),
  listarUbicacionesRecolectores
);

// Consultar campañas:
// admin, donante y recolector.
// Los donantes y recolectores solo ven las activas.
router.get(
  "/",
  auth,
  requireRole("admin", "donante", "recolector"),
  listarCampanas
);

router.get(
  "/:campanaId/categorias",
  auth,
  requireRole("admin", "donante", "recolector"),
  listarCategoriasDeCampana
);
router.get(
  "/:campanaId/clasificaciones",
  auth,
  requireRole("admin", "recolector"),
  consultarClasificacionesDePunto
);

router.post(
  "/:campanaId/categorias",
  auth,
  requireRole("admin"),
  rejectClosedCampaignMutation("campaign"),
  (req, res) => crearCategoriaEnCampana(req, res, req.params.campanaId)
);

// Crear campañas: solo administrador.
router.post(
  "/",
  auth,
  requireRole("admin"),
  crearCampana
);

// Editar campañas y activar/desactivar: solo administrador.
router.patch(
  "/:id",
  auth,
  requireRole("admin"),
  rejectClosedCampaignMutation("campaign"),
  actualizarCampana
);

export default router;