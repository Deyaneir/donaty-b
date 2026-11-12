
import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import requirePerfilCompleto from "../middlewares/requirePerfilCompleto.js";
import rejectClosedCampaignMutation from "../middlewares/rejectClosedCampaignMutation.js";
import { analyzeDonationImage } from "../controllers/donacion_imagen_controller.js";
import { subirEvidenciaDonacion } from "../controllers/donacion_evidencia_controller.js";

import {
  crearDonacion,
  crearDonacionRecolector,
  listarMisDonaciones,
  listarDonaciones,
  listarPendientesRecolector,
  listarAsignadasRecolector,
  asignarRecolector,
  marcarPendienteRecoleccion,
  marcarRecolectada,
  marcarClasificada,
  iniciarEntrega,
  marcarEntregada,
  solicitarDevolucion,
  confirmarDevolucion,
  actualizarEstado,
  listarDonacionesPublic,
  leerDonacionQR,
  actualizarMiDonacion,
  eliminarMiDonacion,
  eliminarDonacionAdmin,
} from "../controllers/donacion_controller.js";

const router = Router();

// Listado público.
router.get("/public", listarDonacionesPublic);

router.use(auth);

router.post(
  "/analizar-imagen",
  requireRole("donante", "recolector"),
  analyzeDonationImage
);
router.post(
  "/:id/evidencias",
  requireRole("recolector"),
  rejectClosedCampaignMutation("donation"),
  subirEvidenciaDonacion
);

router.post(
  "/qr",
  requireRole("admin", "donante", "recolector"),
  leerDonacionQR
);

// Donante con cuenta.
router.post(
  "/",
  requireRole("donante"),
  rejectClosedCampaignMutation("donationCreate"),
  crearDonacion
);

router.get("/mis", requireRole("donante"), listarMisDonaciones);

router.patch(
  "/:id",
  requireRole("donante"),
  rejectClosedCampaignMutation("donation"),
  actualizarMiDonacion
);

router.delete(
  "/:id",
  requireRole("donante"),
  requirePerfilCompleto,
  rejectClosedCampaignMutation("donation"),
  eliminarMiDonacion
);

// Administrador.
router.get("/", requireRole("admin"), listarDonaciones);
router.patch("/:id/estado", requireRole("admin"), rejectClosedCampaignMutation("donation"), actualizarEstado);
router.delete("/:id/admin", requireRole("admin"), rejectClosedCampaignMutation("donation"), eliminarDonacionAdmin);

// Recolector: registrar una donación de una persona sin cuenta.
router.post(
  "/registrar-por-recolector",
  requireRole("recolector"),
  rejectClosedCampaignMutation("donationCreate"),
  crearDonacionRecolector
);

// Recolector: gestionar recogidas.
router.get("/pendientes", requireRole("recolector"), listarPendientesRecolector);
router.get("/asignadas", requireRole("recolector"), listarAsignadasRecolector);
router.get(
  "/:id",
  requireRole("admin", "donante", "recolector"),
  leerDonacionQR
);
router.patch("/:id/asignar", requireRole("recolector"), rejectClosedCampaignMutation("donation"), asignarRecolector);
router.patch("/:id/pendiente-recoleccion", requireRole("recolector"), rejectClosedCampaignMutation("donation"), marcarPendienteRecoleccion);
router.patch("/:id/recolectar", requireRole("recolector"), rejectClosedCampaignMutation("donation"), marcarRecolectada);
router.patch("/:id/clasificar", requireRole("recolector"), rejectClosedCampaignMutation("donation"), marcarClasificada);
router.patch("/:id/iniciar-entrega", requireRole("recolector"), rejectClosedCampaignMutation("donation"), iniciarEntrega);
router.patch("/:id/devolucion", requireRole("recolector"), rejectClosedCampaignMutation("donation"), solicitarDevolucion);
router.patch("/:id/confirmar-devolucion", requireRole("recolector"), rejectClosedCampaignMutation("donation"), confirmarDevolucion);
router.patch("/:id/entregar", requireRole("recolector"), rejectClosedCampaignMutation("donation"), marcarEntregada);

export default router;
