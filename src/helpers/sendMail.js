// src/helpers/sendMail.js
import { AsyncLocalStorage } from "node:async_hooks";
import sendMail from "../config/nodemailer.js";

// Guarda el "origen" de la petición actual (web o móvil) mientras se procesa.
const requestContext = new AsyncLocalStorage();
const esMovil = () => requestContext.getStore()?.origen === "movil";

const buildFrontUrl = () => {
  const raw =
    process.env.URL_FRONTEND ||
    process.env.CLIENT_URL ||
    "http://localhost:5173";
  return raw.replace(/\/$/, "");
};

const buildBackendUrl = () => {
  const raw = process.env.URL_BACKEND || "http://localhost:4000";
  return raw.replace(/\/$/, "");
};

const FRONT_URL = buildFrontUrl();
const BACKEND_URL = buildBackendUrl();

const boton = (href, texto) => `
  <a href="${href}"
     style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;
            text-decoration:none;border-radius:8px;font-weight:bold;">
    ${texto}
  </a>
`;

/**
 * Correo de registro / confirmación de cuenta (APP MÓVIL)
 * El enlace va a la página puente del backend, que abre la app.
 */
const sendMailToRegisterMobile = (userMail, token) => {
  return sendMail(
    userMail,
    "Confirma tu correo – DONATY-EC 🎁",
    `
      <h1>Confirma tu correo</h1>
      <p>Gracias por registrarte en la app DONATY-EC.</p>
      <p>Abre este mensaje desde tu celular y toca el botón para confirmar tu correo:</p>
      <p>${boton(`${BACKEND_URL}/app/confirmar/${token}`, "Confirmar mi correo")}</p>
      <hr>
      <footer>El equipo de DONATY-EC te da la más cordial bienvenida.</footer>
    `
  );
};

/**
 * Correo para recuperar contraseña (APP MÓVIL)
 */
const sendMailToRecoveryPasswordMobile = (userMail, token) => {
  return sendMail(
    userMail,
    "Recupera tu contraseña – DONATY-EC 🔐",
    `
      <h1>Recupera tu contraseña</h1>
      <p>Has solicitado restablecer tu contraseña desde la app DONATY-EC.</p>
      <p>Abre este mensaje desde tu celular y toca el botón. El enlace es válido por 1 hora:</p>
      <p>${boton(`${BACKEND_URL}/app/recuperar/${token}`, "Restablecer mi contraseña")}</p>
      <hr>
      <footer>Si no solicitaste este proceso, ignora este mensaje.</footer>
    `
  );
};

/**
 * Correo de registro / confirmación de cuenta.
 * Web: el de siempre. Si la petición viene de la app, manda el móvil.
 */
const sendMailToRegister = (userMail, token) => {
  if (esMovil()) return sendMailToRegisterMobile(userMail, token);

  return sendMail(
    userMail,
    "Confirma tu cuenta – DONATY-EC 🎁",
    `
      <h1>Confirma tu cuenta</h1>
      <p>Gracias por registrarte en DONATY-EC.</p>
      <p>Haz clic en el siguiente enlace para confirmar tu cuenta:</p>
      <a href="${FRONT_URL}/confirm/${token}">
        Confirmar cuenta
      </a>
      <hr>
      <footer>El equipo de DONATY-EC te da la más cordial bienvenida.</footer>
    `
  );
};

/**
 * Correo para recuperar contraseña.
 * Web: el de siempre. Si la petición viene de la app, manda el móvil.
 */
const sendMailToRecoveryPassword = (userMail, token) => {
  if (esMovil()) return sendMailToRecoveryPasswordMobile(userMail, token);

  return sendMail(
    userMail,
    "Recupera tu contraseña – DONATY-EC 🔐",
    `
      <h1>Recupera tu contraseña</h1>
      <p>Has solicitado restablecer tu contraseña.</p>
      <p>Haz clic en el siguiente enlace para continuar:</p>
      <a href="${FRONT_URL}/reset/${token}">
        Clic para restablecer tu contraseña
      </a>
      <hr>
      <footer>Si no solicitaste este proceso, ignora este mensaje.</footer>
    `
  );
};

export {
  requestContext,
  sendMailToRegister,
  sendMailToRecoveryPassword,
  sendMailToRegisterMobile,
  sendMailToRecoveryPasswordMobile,
};