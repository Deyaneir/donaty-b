// src/server.js
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import "dotenv/config";

import router from "./routers/index.js";
import passport from "./config/passport.js";
import {
  confirmarMail,
  comprobarTokenPasword,
} from "./controllers/donante_controller.js";
import { stripeWebhook } from "./controllers/stripe_controller.js";

const app = express();
const sanitizeUrl = (url = "") => url.replace(/\/$/, "").trim();
const corsWhitelist = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => sanitizeUrl(origin))
  .filter(Boolean);
const extraOrigins = [
  sanitizeUrl(process.env.CLIENT_URL),
  sanitizeUrl(process.env.URL_FRONTEND),
].filter(Boolean);
const allowedOrigins = [...new Set([...corsWhitelist, ...extraOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0) return callback(null, true);
    const isAllowed = allowedOrigins.some((allowed) =>
      origin.startsWith(allowed)
    );
    return isAllowed
      ? callback(null, true)
      : callback(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  credentials: true,
};
app.set("trust proxy", 1); // necesario en Render/hosting detrás de proxy

// ====== MIDDLEWARES BÁSICOS ======

// Webhook de Stripe (requiere raw body)
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

// Permitir JSON en req.body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS con lista blanca desde .env
app.use(cors(corsOptions));

// Passport (Google OAuth)
app.use(passport.initialize());

// (Opcional) si usas subida de archivos en otro lado del proyecto:
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "./tmp",
  })
);

// ====== RUTAS ======

// Landing simple para la raíz
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "donaty-api" });
});

// Health check (para probar rápido que el backend vive)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "donaty-api" });
});

// Rutas directas para confirmar y recuperar
app.get("/confirmar/:token", confirmarMail);
app.get("/recuperarpassword/:token", comprobarTokenPasword);
app.get("/donante/confirmar/:token", confirmarMail);
app.get("/donante/recuperarpassword/:token", comprobarTokenPasword);

// Rutas principales de la API (prefijo /api)
app.use("/api", router);

// Ruta no encontrada
app.use((_req, res) => {
  res.status(404).send("Endpoint no encontrado - 404");
});

export default app;
