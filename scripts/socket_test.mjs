import { io } from "socket.io-client";

const token = process.env.SOCKET_TOKEN || "";
const roomId = process.env.SOCKET_ROOM || "";
const serverUrl = process.env.SOCKET_URL || "http://localhost:4000";

if (!token || !roomId) {
  console.error(
    "Faltan variables. Usa: SOCKET_TOKEN=... SOCKET_ROOM=... node scripts/socket_test.mjs"
  );
  process.exit(1);
}

const socket = io(serverUrl, {
  auth: { token },
});

socket.on("connected", (data) => {
  console.log("connected:", data);
  socket.emit("joinRoom", { roomId });
  socket.emit("message", { roomId, text: "Hola desde socket!" });
});

socket.on("joinedRoom", (data) => console.log("joined:", data));
socket.on("message", (msg) => console.log("message:", msg));
socket.on("typing", (data) => console.log("typing:", data));
socket.on("error", (err) => console.log("error:", err));
