import { Router } from "express";
import donanteRoutes from "./donante_routes.js";
import adminRoutes from "./admin_routes.js";
import recolectorRoutes from "./recolector_routes.js";
import aiRoutes from "./ai_routes.js";
import donacionRoutes from "./donacion_routes.js";
import donacionFisicaRoutes from "./donacion_fisica_routes.js";
import chatRoutes from "./chat_routes.js";
import campanaRoutes from "./campana_routes.js";
import campanaAdminRoutes from "./campana_admin_routes.js";
import categoriaRoutes from "./categoria_routes.js";

const router = Router();

// Prefijo principal: /api/donante/...
router.use("/donante", donanteRoutes);
router.use("/admin", adminRoutes);
router.use("/recolector", recolectorRoutes);
router.use("/donacion", donacionRoutes);
router.use("/donaciones-fisicas", donacionFisicaRoutes);
router.use("/ai", aiRoutes);
router.use("/chat", chatRoutes);
router.use("/campanas", campanaRoutes);
// Gestión de campañas del administrador (eliminar, conteos, donaciones).
router.use("/campanas", campanaAdminRoutes);
router.use("/categorias", categoriaRoutes);


export default router;