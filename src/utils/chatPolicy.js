const TERMINAL_DONATION_STATES = new Set(["entregada", "cancelada", "devuelta"]);

const getDonationRoomAccess = (user, donation, mode = "read") => {
  if (!user || !donation) return { ok: false, status: 401, msg: "No autenticado" };
  if (!donation.donante || !donation.recolector) {
    return { ok: false, status: 404, msg: "La donación todavía no tiene una conversación asignada" };
  }

  const role = String(user.rol || "").toLowerCase();
  const isDonor = role === "donante" && String(donation.donante) === String(user._id);
  const isAssignedCollector = role === "recolector" && donation.recolector &&
    String(donation.recolector) === String(user._id);
  if (!isDonor && !isAssignedCollector) {
    return { ok: false, status: 403, msg: "No autorizado para esta conversación" };
  }
  if (mode === "write" && TERMINAL_DONATION_STATES.has(donation.estado)) {
    return { ok: false, status: 409, msg: "La donación está finalizada; el chat es de solo lectura" };
  }
  return { ok: true, donation };
};

const adminCollectorRoom = (adminId, collectorId) =>
  `admin:${adminId}:recolector:${collectorId}`;

const parseAdminCollectorRoom = (room) => {
  const match = /^admin:([a-f\d]{24}):recolector:([a-f\d]{24})$/i.exec(String(room || ""));
  return match ? { adminId: match[1], collectorId: match[2] } : null;
};

export {
  TERMINAL_DONATION_STATES,
  adminCollectorRoom,
  getDonationRoomAccess,
  parseAdminCollectorRoom,
};