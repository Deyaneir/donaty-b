import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { migratePublicAccountEmailIndexes } from "../src/services/accountEmailIndexMigration.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDirectory, "..", ".env") });

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/donaty";
const apply = process.argv.includes("--apply");

try {
  await mongoose.connect(uri);
  const result = await migratePublicAccountEmailIndexes({ apply });
  if (!apply) {
    console.log("Simulación completada; no se modificó MongoDB:");
    console.log(JSON.stringify(result, null, 2));
    console.log("Revisa el resultado y ejecuta de nuevo con --apply para migrar.");
  } else {
    console.log("Migración de índices por correo y rol completada:");
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error("No se pudo completar la migración de correo y rol:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
