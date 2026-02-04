import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

console.log("[ENV] keys:", Object.keys(process.env).length);
console.log("[ENV] STRIPE_SECRET_KEY:", process.env.STRIPE_SECRET_KEY ? "OK" : "MISSING");

const { default: app } = await import("./server.js");
const { default: connectDB } = await import("./database.js");
const { default: attachSocket } = await import("./sockets/index.js");

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/donaty";

const startServer = async () => {
  await connectDB(MONGODB_URI);
  const server = http.createServer(app);
  const io = attachSocket(server);
  app.set("io", io);

  server.listen(PORT, () => {
    console.log(`Donaty API corriendo en puerto ${PORT}`);
  });
};

startServer();
