import { Router } from "express";
import donanteRoutes from "./donante_routes.js";
import adminRoutes from "./admin_routes.js";
import recolectorRoutes from "./recolector_routes.js";
import aiRoutes from "./ai_routes.js";
import donacionRoutes from "./donacion_routes.js";
import stripeRoutes from "./stripe_routes.js";
import chatRoutes from "./chat_routes.js";

const router = Router();

// Prefijo principal: /api/donante/...
router.use("/donante", donanteRoutes);
router.use("/admin", adminRoutes);
router.use("/recolector", recolectorRoutes);
router.use("/donacion", donacionRoutes);
router.use("/ai", aiRoutes);
router.use("/stripe", stripeRoutes);
router.use("/chat", chatRoutes);


export default router;
