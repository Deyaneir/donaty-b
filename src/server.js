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
import { appLinkPage } from "./controllers/app_link_controller.js";
import adminUsuariosRouter from "./routers/admin_usuarios_router.js";

const app = express();

const sanitizeUrl = (url = "") => url.trim().replace(/\/+$/, "");

const corsWhitelist = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(sanitizeUrl)
  .filter(Boolean);

const extraOrigins = [
  sanitizeUrl(process.env.CLIENT_URL),
  sanitizeUrl(process.env.URL_FRONTEND),
].filter(Boolean);

const allowedOrigins = [
  ...new Set([...corsWhitelist, ...extraOrigins]),
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permite solicitudes que no incluyen el encabezado Origin.
    if (!origin) {
      return callback(null, true);
    }

    // Compara los orígenes configurados en el .env.
    const isConfigured = allowedOrigins.includes(
      sanitizeUrl(origin)
    );

    // Permite puertos dinámicos de Flutter Web en desarrollo.
    const isFlutterWebLocal =
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

    if (isConfigured || isFlutterWebLocal) {
      return callback(null, true);
    }

    console.error(`CORS bloqueado para origen: ${origin}`);

    return callback(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  credentials: true,
};

app.set("trust proxy", 1);

// ===== MIDDLEWARES =====

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());

app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "./tmp",
    limits: { fileSize: 5 * 1024 * 1024 },
  })
);

// ===== RUTAS =====

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "donaty-api",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "donaty-api",
  });
});

// Confirmación y recuperación de contraseña.
app.get("/confirmar/:token", confirmarMail);
app.get("/recuperarpassword/:token", comprobarTokenPasword);
app.get("/donante/confirmar/:token", confirmarMail);
app.get("/donante/recuperarpassword/:token", comprobarTokenPasword);

// Páginas puente que abren la app móvil desde el correo.
app.get("/app/confirmar/:token", appLinkPage("confirmar"));
app.get("/app/recuperar/:token", appLinkPage("recuperar"));

// Rutas principales.
app.use("/api", router);

app.use("/api/admin/usuarios", adminUsuariosRouter);
// Ruta no encontrada.
app.use((_req, res) => {
  res.status(404).send("Endpoint no encontrado - 404");
});

export default app;