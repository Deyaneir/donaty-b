import { Router } from "express";
import auth, { authOpcional } from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
import rejectClosedCampaignMutation from "../middlewares/rejectClosedCampaignMutation.js";
import {
  listarCategorias,
  obtenerCategoria,
  listarSubcategorias,
  listarCategoriasAdmin,
  listarDonacionesDeCategoria,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
} from "../controllers/categoria_controller.js";

const router = Router();

router.get("/", authOpcional, listarCategorias);
router.get("/admin/lista", auth, requireRole("admin"), listarCategoriasAdmin);
router.get("/:id/donaciones", auth, requireRole("admin", "donante", "recolector"), listarDonacionesDeCategoria);
router.get(
  "/:id/subcategorias",
  authOpcional,
  listarSubcategorias
);
router.get("/:id", auth, requireRole("admin", "donante", "recolector"), obtenerCategoria);
router.post("/", auth, requireRole("admin"), rejectClosedCampaignMutation("category"), crearCategoria);
router.patch("/:id", auth, requireRole("admin"), rejectClosedCampaignMutation("category"), actualizarCategoria);
router.delete("/:id", auth, requireRole("admin"), rejectClosedCampaignMutation("category"), eliminarCategoria);

export default router;