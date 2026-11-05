import { Server as SocketServer } from "socket.io";
import jwt from "jsonwebtoken";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import { canAccessRoom, emitToAuthorizedRoom } from "../utils/chatRoom.js";
import { sendRoomMessage } from "../controllers/chat_controller.js";

const JWT_SECRET =
  process.env.JWT_SECRET || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

const sanitizeUrl = (url = "") => url.replace(/\/$/, "").trim();
const getAllowedOrigins = () => {
  const corsWhitelist = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => sanitizeUrl(origin))
    .filter(Boolean);
  const extraOrigins = [
    sanitizeUrl(process.env.CLIENT_URL),
    sanitizeUrl(process.env.URL_FRONTEND),
  ].filter(Boolean);
  return [...new Set([...corsWhitelist, ...extraOrigins])];
};

const extractToken = (socket) => {
  const header = socket.handshake.headers?.authorization || "";
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;
  if (authToken) return authToken;
  if (header.startsWith("Bearer ")) return header.replace("Bearer ", "");
  if (queryToken) return queryToken;
  return null;
};

const getModelByRole = (role = "") => {
  const rol = String(role).toLowerCase();
  if (rol === "admin") return Admin;
  if (rol === "recolector") return Recolector;
  return Donante;
};

const attachSocket = (server) => {
  const allowedOrigins = getAllowedOrigins();
  const io = new SocketServer(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error("Token requerido"));

      const decoded = jwt.verify(token, JWT_SECRET);
      const model = getModelByRole(decoded?.rol);
      const user = await model.findById(decoded?.id);
      if (!user) return next(new Error("Usuario no autorizado"));
      if (user.status === false) return next(new Error("Usuario inactivo"));

      socket.data.user = {
        _id: user._id,
        rol: user.rol,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
      };
      return next();
    } catch (error) {
      return next(new Error("Token inválido"));
    }
  });

  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true, user: socket.data.user });

    socket.on("joinRoom", async ({ roomId } = {}) => {
      try {
        const access = await canAccessRoom(socket.data.user, roomId, "read");
        if (!access.ok) return socket.emit("error", { msg: access.msg, code: access.status });
        socket.join(String(roomId));
        return socket.emit("joinedRoom", { roomId: String(roomId) });
      } catch (error) {
        console.error("Socket joinRoom error:", error);
        return socket.emit("error", { msg: "No se pudo abrir la conversación" });
      }
    });

    socket.on("leaveRoom", ({ roomId } = {}) => {
      if (!roomId) return;
      socket.leave(roomId);
      socket.emit("leftRoom", { roomId });
    });

    socket.on("typing", async ({ roomId } = {}) => {
      try {
        const access = await canAccessRoom(socket.data.user, roomId, "write");
        if (!access.ok) return socket.emit("error", { msg: access.msg, code: access.status });
        await emitToAuthorizedRoom(
          io,
          roomId,
          "typing",
          { roomId: String(roomId), user: socket.data.user },
          socket.id
        );
      } catch (error) {
        console.error("Socket typing error:", error);
        socket.emit("error", { msg: "No se pudo enviar el estado de escritura" });
      }
    });

    socket.on("message", async ({ roomId, text } = {}) => {
      try {
        const result = await sendRoomMessage(socket.data.user, roomId, text);
        if (result.error) {
          return socket.emit("error", { msg: result.error.msg, code: result.error.status });
        }
        return emitToAuthorizedRoom(io, roomId, "message", result.message);
      } catch (error) {
        console.error("Socket message error:", error);
        return socket.emit("error", { msg: "Error al enviar el mensaje" });
      }
    });
  });

  return io;
};

export default attachSocket;
