import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const mailHost = process.env.MAIL_HOST || process.env.HOST_MAILTRAP || "smtp.gmail.com";
const mailPort = Number(process.env.MAIL_PORT || process.env.PORT_MAILTRAP || 465);
const mailSecureEnv = `${process.env.MAIL_SECURE ?? true}`.toLowerCase();
const mailSecure = ["true", "1", "yes"].includes(mailSecureEnv);
const mailUser = process.env.MAIL_USER || process.env.USER_MAILTRAP;
const mailPass = process.env.MAIL_PASS || process.env.PASS_MAILTRAP;
const mailFrom = process.env.MAIL_FROM || '"DONATY-EC" <no-reply@donaty.ec>';
const frontendBase =
  (process.env.URL_FRONTEND ||
    process.env.CLIENT_URL ||
    "http://localhost:5173").replace(/\/$/, "");

const transporter = nodemailer.createTransport({
  host: mailHost,
  port: mailPort,
  secure: mailSecure,
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
  auth: {
    user: mailUser,
    pass: mailPass,
  },
});

const sendMail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: mailFrom,
      to,
      subject,
      html,
    });

    console.log("Email enviado:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error enviando email:", error.message);
    throw error;
  }
};

export const sendMailToRecoveryPassword = (userMail, token) => {
  return sendMail(
    userMail,
    "Recupera tu contraseña - DONATY-EC",
    `
      <h1>DONATY-EC</h1>
      <p>Has solicitado restablecer tu contraseña.</p>

      <a href="${frontendBase}/reset/${token}">
        Clic para restablecer tu contraseña
      </a>

      <hr>
      <footer>
        El equipo de DONATY-EC está aquí para ayudarte.
      </footer>
    `
  );
};

export default sendMail;
