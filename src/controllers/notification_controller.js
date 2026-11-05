import FcmDevice from "../models/FcmDevice.js";
import CollectorLocationEvent from "../models/CollectorLocationEvent.js";

const VALID_ROLES = new Set(["donante", "recolector", "admin"]);
const VALID_PLATFORMS = new Set(["android", "ios", "web"]);

const registerDevice = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const token = String(req.body?.token || "").trim();
    const platform = String(req.body?.platform || "").trim().toLowerCase();
    const role = String(user?.rol || "").trim().toLowerCase();

    if (!user || !token || token.length > 4096) {
      return res.status(400).json({ msg: "El token FCM es obligatorio y válido" });
    }
    if (!VALID_PLATFORMS.has(platform) || !VALID_ROLES.has(role)) {
      return res.status(400).json({ msg: "Plataforma o rol inválido" });
    }

    await FcmDevice.findOneAndUpdate(
      { token },
      {
        $set: {
          userId: user._id,
          role,
          platform,
          active: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(204).send();
  } catch (error) {
    console.error("Error registrando dispositivo FCM:", error);
    return res.status(500).json({ msg: "No se pudo registrar el dispositivo" });
  }
};

const deactivateDevice = async (req, res) => {
  try {
    const user = req.user || req.donanteHeader;
    const token = String(req.body?.token || "").trim();
    if (!user || !token) {
      return res.status(400).json({ msg: "El token FCM es obligatorio" });
    }
    await FcmDevice.updateOne(
      { token, userId: user._id },
      { $set: { active: false, lastSeenAt: new Date() } }
    );
    return res.status(204).send();
  } catch (error) {
    console.error("Error desactivando dispositivo FCM:", error);
    return res.status(500).json({ msg: "No se pudo desactivar el dispositivo" });
  }
};

const listarEventosUbicacionRecolectores = async (req, res) => {
  try {
    const events = await CollectorLocationEvent.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json({ items: events });
  } catch (error) {
    console.error("Error consultando alertas de ubicación:", error.message || error);
    return res.status(500).json({
      msg: "No se pudieron consultar las alertas de ubicación",
    });
  }
};

export {
  deactivateDevice,
  listarEventosUbicacionRecolectores,
  registerDevice,
};
