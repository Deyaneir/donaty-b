
import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import requirePerfilCompleto from "../middlewares/requirePerfilCompleto.js";

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
  "/qr",
  requireRole("admin", "donante", "recolector"),
  leerDonacionQR
);

// Donante con cuenta.
router.post(
  "/",
  requireRole("donante"),
  requirePerfilCompleto,
  crearDonacion
);

router.get("/mis", requireRole("donante"), listarMisDonaciones);

router.patch(
  "/:id",
  requireRole("donante"),
  requirePerfilCompleto,
  actualizarMiDonacion
);

router.delete(
  "/:id",
  requireRole("donante"),
  requirePerfilCompleto,
  eliminarMiDonacion
);

// Administrador.
router.get("/", requireRole("admin"), listarDonaciones);
router.patch("/:id/estado", requireRole("admin"), actualizarEstado);
router.delete("/:id/admin", requireRole("admin"), eliminarDonacionAdmin);

// Recolector: registrar una donación de una persona sin cuenta.
router.post(
  "/registrar-por-recolector",
  requireRole("recolector"),
  crearDonacionRecolector
);

// Recolector: gestionar recogidas.
router.get("/pendientes", requireRole("recolector"), listarPendientesRecolector);
router.get("/asignadas", requireRole("recolector"), listarAsignadasRecolector);
router.patch("/:id/asignar", requireRole("recolector"), asignarRecolector);
router.patch("/:id/pendiente-recoleccion", requireRole("recolector"), marcarPendienteRecoleccion);
router.patch("/:id/recolectar", requireRole("recolector"), marcarRecolectada);
router.patch("/:id/clasificar", requireRole("recolector"), marcarClasificada);
router.patch("/:id/iniciar-entrega", requireRole("recolector"), iniciarEntrega);
router.patch("/:id/devolucion", requireRole("recolector"), solicitarDevolucion);
router.patch("/:id/confirmar-devolucion", requireRole("recolector"), confirmarDevolucion);
router.patch("/:id/entregar", requireRole("recolector"), marcarEntregada);

export default router;
