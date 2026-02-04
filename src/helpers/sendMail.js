// src/helpers/sendMail.js
import sendMail from "../config/nodemailer.js";

const buildFrontUrl = () => {
  const raw =
    process.env.URL_FRONTEND ||
    process.env.CLIENT_URL ||
    "http://localhost:5173";
  return raw.replace(/\/$/, "");
};

const FRONT_URL = buildFrontUrl();

/**
 * Correo de registro / confirmación de cuenta
 */
const sendMailToRegister = (userMail, token) => {
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
 * Correo para recuperar contraseña
 */
const sendMailToRecoveryPassword = (userMail, token) => {
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

export { sendMailToRegister, sendMailToRecoveryPassword };
