import Donacion from "../models/Donacion.js";

const userRoom = (role, id) => `user:${String(role).toLowerCase()}:${String(id)}`;
const roleRoom = (role) => `role:${String(role).toLowerCase()}`;

const publishDonationEvent = (req, eventName, donation) => {
  const io = req.app?.get("io");
  if (!io || !donation?._id) return;
  try {
    const payload = {
      donacionId: String(donation._id),
      campanaId: donation.campana?._id
        ? String(donation.campana._id)
        : donation.campana
          ? String(donation.campana)
          : null,
      puntoRecoleccionId: donation.puntoRecoleccionRef
        ? String(donation.puntoRecoleccionRef)
        : null,
      estado: donation.estado ?? null,
      recolectorId: donation.recolector?._id
        ? String(donation.recolector._id)
        : donation.recolector
          ? String(donation.recolector)
          : null,
    };
    io.to(roleRoom("admin")).emit(eventName, payload);
    if (donation.donante) {
      io.to(userRoom("donante", donation.donante?._id ?? donation.donante))
        .emit(eventName, payload);
    }
    for (const collectorId of [
      donation.recolector?._id ?? donation.recolector,
      donation.registradoPorRecolector?._id ?? donation.registradoPorRecolector,
    ].filter(Boolean).map(String)) {
      io.to(userRoom("recolector", collectorId)).emit(eventName, payload);
    }
  } catch (error) {
    console.error("No se pudo emitir el evento de donación:", error.message || error);
  }
};

const publishCampaignEvent = async (
  req,
  eventName,
  campaign,
  additionalCollectorIds = []
) => {
  const io = req.app?.get("io");
  if (!io || !campaign?._id) return;
  try {
    const [donorIds, assignedCollectorIds] = await Promise.all([
      Donacion.distinct("donante", {
        campana: campaign._id,
        donante: { $ne: null },
      }),
      Promise.resolve(
        (campaign.puntosRecoleccion || []).flatMap((point) =>
          (point.recolectores || []).map((id) => String(id))
        )
      ),
    ]);
    const payload = {
      campanaId: String(campaign._id),
      estado: campaign.estado ?? null,
      periodoAcademico: campaign.periodoAcademico ?? null,
    };
    io.to(roleRoom("admin")).emit(eventName, payload);
    for (const donorId of donorIds) {
      io.to(userRoom("donante", donorId)).emit(eventName, payload);
    }
    for (const collectorId of new Set([
      ...assignedCollectorIds,
      ...additionalCollectorIds.map(String),
    ])) {
      io.to(userRoom("recolector", collectorId)).emit(eventName, payload);
    }
  } catch (error) {
    console.error("No se pudo emitir el evento de campaña:", error.message || error);
  }
};

const publishCollectorLocationEvent = (req, collectorId, location) => {
  const io = req.app?.get("io");
  if (!io || !collectorId) return;
  try {
    const payload = {
      recolectorId: String(collectorId),
      ubicacion: {
        latitud: location.latitud,
        longitud: location.longitud,
        capturadoEn: location.capturadoEn ?? null,
        actualizadoEn: location.actualizadoEn,
        precisionMetros: location.precisionMetros ?? null,
        estadoGeografico: location.estadoGeografico,
      },
    };
    io.to(roleRoom("admin")).emit("collector.location.updated", payload);
    io.to(userRoom("recolector", collectorId)).emit("collector.location.updated", payload);
  } catch (error) {
    console.error("No se pudo emitir la actualización GPS:", error.message || error);
  }
};

export {
  publishCampaignEvent,
  publishCollectorLocationEvent,
  publishDonationEvent,
};
