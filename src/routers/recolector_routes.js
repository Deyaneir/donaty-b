import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import {
  confirmarMail,
  reenviarConfirmacion,
} from "../controllers/donante_controller.js";
import {
  registroRecolector,
  recuperarPasswordRecolector,
  comprobarTokenPasswordRecolector,
  crearNuevoPasswordRecolector,
  loginRecolector,
  refreshRecolectorSession,
  perfilRecolector,
  actualizarPerfilRecolector,
  actualizarPasswordRecolector,
} from "../controllers/recolector_controller.js";
import { googleRecolectorMobileLogin } from "../controllers/google_controller.js";

const router = Router();

router.post("/registro", registroRecolector);
router.post("/reenviar-confirmacion", reenviarConfirmacion);
router.post("/google", googleRecolectorMobileLogin);
router.post("/login", loginRecolector);
router.post("/refresh", refreshRecolectorSession);
router.get("/confirmar/:token", confirmarMail);
router.post("/recuperarpassword", recuperarPasswordRecolector);
router.get("/recuperarpassword/:token", comprobarTokenPasswordRecolector);
router.post("/nuevopassword/:token", crearNuevoPasswordRecolector);
router.get("/nuevopassword/:token", (_req, res) => {
  res.status(405).json({ msg: "Usa POST para cambiar el password" });
});

router.use(auth, requireRole("recolector"));

router.get("/perfil", perfilRecolector);
router.put("/actualizarperfil/:id", actualizarPerfilRecolector);
router.put("/actualizarpassword/:id", actualizarPasswordRecolector);

export default router;
