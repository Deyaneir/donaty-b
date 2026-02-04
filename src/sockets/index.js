import { Server as SocketServer } from "socket.io";
import jwt from "jsonwebtoken";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";
import ChatMessage from "../models/ChatMessage.js";
import { canAccessRoom } from "../utils/chatRoom.js";
import { isBlank } from "../utils/validation.js";

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
      const access = await canAccessRoom(socket.data.user, roomId);
      if (!access.ok) {
        return socket.emit("error", { msg: access.msg });
      }
      socket.join(roomId);
      return socket.emit("joinedRoom", { roomId });
    });

    socket.on("leaveRoom", ({ roomId } = {}) => {
      if (!roomId) return;
      socket.leave(roomId);
      socket.emit("leftRoom", { roomId });
    });

    socket.on("typing", ({ roomId } = {}) => {
      if (!roomId) return;
      socket.to(roomId).emit("typing", {
        roomId,
        user: socket.data.user,
      });
    });

    socket.on("message", async ({ roomId, text } = {}) => {
      if (isBlank(roomId) || isBlank(text)) {
        return socket.emit("error", { msg: "roomId y text son requeridos" });
      }

      const access = await canAccessRoom(socket.data.user, roomId);
      if (!access.ok) {
        return socket.emit("error", { msg: access.msg });
      }

      const message = await ChatMessage.create({
        room: roomId,
        donacion: access.donacion?._id || null,
        senderId: socket.data.user._id,
        senderRol: socket.data.user.rol,
        senderNombre: socket.data.user.nombre || "",
        senderApellido: socket.data.user.apellido || "",
        senderEmail: socket.data.user.email || "",
        text: String(text).trim(),
      });

      return io.to(roomId).emit("message", message.toObject());
    });
  });

  return io;
};

export default attachSocket;
