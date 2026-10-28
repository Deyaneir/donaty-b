import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  listarUsuarios,
  cambiarEstadoUsuario,
} from "../controllers/admin_usuarios_controller.js";

const router = Router();

router.use(auth);

router.get("/", requireRole("admin"), listarUsuarios);
router.patch("/:rol/:id/estado", requireRole("admin"), cambiarEstadoUsuario);

export default router;