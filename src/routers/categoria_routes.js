import { Router } from "express";
import auth from "../middlewares/JWT.js";
import requireRole from "../middlewares/requireRole.js";
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

router.get("/", listarCategorias);
router.get("/admin/lista", auth, requireRole("admin"), listarCategoriasAdmin);
router.get("/:id/donaciones", auth, requireRole("admin", "donante", "recolector"), listarDonacionesDeCategoria);
router.get("/:id/subcategorias", listarSubcategorias);
router.get("/:id", auth, requireRole("admin", "donante", "recolector"), obtenerCategoria);
router.post("/", auth, requireRole("admin"), crearCategoria);
router.patch("/:id", auth, requireRole("admin"), actualizarCategoria);
router.delete("/:id", auth, requireRole("admin"), eliminarCategoria);

export default router;