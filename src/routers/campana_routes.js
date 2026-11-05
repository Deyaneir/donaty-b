import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";

import {
  listarCampanas,
  crearCampana,
  actualizarCampana,
  listarDistribucionRecolectores,
  distribuirRecolectores,
  reasignarRecolectorAPunto,
  listarUbicacionesRecolectores,
} from "../controllers/campana_controller.js";
import {
  listarCategoriasDeCampana,
  crearCategoriaEnCampana,
} from "../controllers/categoria_controller.js";

const router = Router();

router.get(
  "/:campaignId/distribucion-recolectores",
  auth,
  requireRole("admin"),
  listarDistribucionRecolectores
);
router.post(
  "/:campaignId/distribucion-recolectores",
  auth,
  requireRole("admin"),
  distribuirRecolectores
);
router.put(
  "/:campaignId/puntos/:pointId/reasignar",
  auth,
  requireRole("admin"),
  reasignarRecolectorAPunto
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

router.post(
  "/:campanaId/categorias",
  auth,
  requireRole("admin"),
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
  actualizarCampana
);

export default router;