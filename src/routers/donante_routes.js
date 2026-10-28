// src/routers/donante_routes.js
import { Router } from "express";
import {
  registro,
  reenviarConfirmacion,
  solicitarContactoAdmin,
  confirmarMail,
  recuperarPassword,
  comprobarTokenPasword,
  crearNuevoPassword,
  login,
  refreshDonanteSession,
  perfil,
  actualizarPerfil,
  actualizarPassword
} from "../controllers/donante_controller.js";
import auth from "../middlewares/JWT.js";
import requirePerfilCompleto from "../middlewares/requirePerfilCompleto.js";
import passport from "passport";
import {
  googleCallback,
  googleMobileLogin,
} from "../controllers/google_controller.js";

const router = Router();

router.post("/registro", registro);
router.post("/reenviar-confirmacion", reenviarConfirmacion);
router.post("/contacto-admin", solicitarContactoAdmin);
router.get("/confirmar/:token", confirmarMail);

router.post("/recuperarpassword", recuperarPassword);
router.get("/recuperarpassword/:token", comprobarTokenPasword);
router.post("/nuevopassword/:token", crearNuevoPassword);

router.post("/login", login);
router.post("/refresh", refreshDonanteSession);
router.get("/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ msg: "Google OAuth no configurado" });
  }
  return passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })(req, res, next);
});
router.get("/google/callback", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ msg: "Google OAuth no configurado" });
  }
  return googleCallback(req, res, next);
});
router.post("/google", googleMobileLogin);

router.get("/perfil", auth, perfil);
router.put("/actualizarperfil/:id", auth, actualizarPerfil);
// si insistes en usar id en la URL: router.put("/actualizarpassword/:id", auth, actualizarPassword);
router.put("/actualizarpassword/:id", auth, requirePerfilCompleto, actualizarPassword);

export default router;
