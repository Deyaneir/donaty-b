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
      ...(evidence._id ? { id: String(evidence._id) } : {}),
      etapa: "entrega",
      imagenUrl: urlPublica(evidence.imagenUrl),
      fecha: evidence.fecha ?? null,
      recolector: {
        id: delivery.recolectorPrincipal?._id
          ? String(delivery.recolectorPrincipal._id)
          : delivery.recolectorPrincipal
            ? String(delivery.recolectorPrincipal)
            : null,
        nombre: delivery.recolectorPrincipalNombre || null,
        apellido: delivery.recolectorPrincipalApellido || null,
      },
    })),
    estado: delivery.estado,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
};

export { serializeCampaignDeliveryForDonor };
