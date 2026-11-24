import { urlPublica } from "./publicUrl.js";

const serializeCampaignDeliveryForDonor = (delivery, campaignId = null) => {
  if (!delivery) {
    return {
      registrada: false,
      mensaje: campaignId
        ? "La entrega general de esta campaña aún no ha sido registrada"
        : "La donación no está asociada a una campaña",
    };
  }
  return {
    registrada: true,
    _id: delivery._id,
    campana: delivery.campana?._id ?? delivery.campana ?? campaignId,
    receptor: delivery.receptor,
    nombresReceptor: delivery.nombresReceptor || "",
    apellidosReceptor: delivery.apellidosReceptor || "",
    telefonoReceptor: delivery.telefonoReceptor || "",
    cargoReceptor: delivery.cargoReceptor || "",
    descripcionBienes: delivery.descripcionBienes || "",
    fechaEntrega: delivery.fechaEntrega,
    responsablesCampana: (delivery.responsablesCampana || []).map((person) => ({
      nombreCompleto: person.nombreCompleto,
      cargo: person.cargo,
    })),
    evidencias: (delivery.evidencias || []).map((evidence) => ({
      imagenUrl: urlPublica(evidence.imagenUrl),
      fecha: evidence.fecha,
    })),
    estado: delivery.estado,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
};

export { serializeCampaignDeliveryForDonor };
