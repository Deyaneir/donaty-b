import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";

import {
  listarDonacionesAdmin,
  listarRecolectoresAsignables,
  asignarDonacionAdmin,
} from "../controllers/donacion_admin_controller.js";

const router = Router();

router.use(auth);
router.use(requireRole("admin"));

router.get("/admin/lista", listarDonacionesAdmin);
router.get("/admin/recolectores", listarRecolectoresAsignables);
router.patch("/:id/admin-asignar", asignarDonacionAdmin);

export default router;
