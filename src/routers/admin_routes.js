import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  bootstrapAdmin,
  recuperarPasswordAdmin,
  comprobarTokenPasswordAdmin,
  crearNuevoPasswordAdmin,
  loginAdmin,
  listarUsuarios,
  listarRecolectores,
  obtenerUsuario,
  actualizarPerfilAdmin,
  actualizarRol,
  actualizarStatus,
  actualizarStatusRecolector,
  perfilAdmin,
  actualizarPasswordAdmin,
} from "../controllers/admin_controller.js";
import { confirmarMail } from "../controllers/donante_controller.js";
import { getDashboardStats } from "../controllers/dashboard_controller.js";

const router = Router();

// Crear el primer admin con un secreto (una sola vez)
router.post("/registro", bootstrapAdmin);
router.post("/login", loginAdmin);
router.get("/confirmar/:token", confirmarMail);
router.post("/recuperarpassword", recuperarPasswordAdmin);
router.get("/recuperarpassword/:token", comprobarTokenPasswordAdmin);
router.post("/nuevopassword/:token", crearNuevoPasswordAdmin);

// Rutas protegidas solo para admin
router.use(auth, requireRole("admin"));

router.get("/users", listarUsuarios);
router.get("/recolectores", listarRecolectores);
router.get("/perfil", perfilAdmin);
router.get("/dashboard", getDashboardStats);
router.get("/users/:id", obtenerUsuario);
router.put("/actualizarperfil/:id", actualizarPerfilAdmin);
router.patch("/users/:id/role", actualizarRol);
router.patch("/users/:id/status", actualizarStatus);
router.patch("/recolectores/:id/status", actualizarStatusRecolector);
router.put("/actualizarpassword/:id", actualizarPasswordAdmin);

export default router;
