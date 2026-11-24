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

const serializeIndividualDonationDelivery = (delivery) => {
  const receiverName = [
    delivery.nombresReceptor,
    delivery.apellidosReceptor,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const collector = delivery.recolector;
  const collectorId = collector?._id
    ? String(collector._id)
    : collector && typeof collector !== "object"
      ? String(collector)
      : null;
  return {
    ...delivery,
    ...(delivery._id ? { id: String(delivery._id) } : {}),
    recibeNombre: receiverName || null,
    recibeIdentificacion: delivery.recibeIdentificacion || null,
    recibeInstitucion: delivery.recibeInstitucion || null,
    fechaEntrega: delivery.fecha ?? null,
    etapa: "finalizacion",
    imagenUrl: urlPublica(delivery.imagenUrl),
    recolector: {
      id: collectorId,
      nombre: collector?.nombre ?? null,
      apellido: collector?.apellido ?? null,
    },
  };
};

const createIndividualDonationDeliveryRecord = ({
  nombresReceptor,
  apellidosReceptor,
  recibeIdentificacion,
  recibeInstitucion,
  telefonoReceptor,
  cargoReceptor,
  descripcionBienes,
  recolector,
  fecha,
  imagen,
  idempotencyKey,
}) => ({
  nombresReceptor,
  apellidosReceptor,
  recibeIdentificacion: recibeIdentificacion || null,
  recibeInstitucion: recibeInstitucion || null,
  telefonoReceptor,
  cargoReceptor,
  descripcionBienes,
  recolector,
  fecha,
  ...imagen,
  idempotencyKey,
});

export {
  createIndividualDonationDeliveryRecord,
  serializeCampaignDeliveryForDonor,
  serializeIndividualDonationDelivery,
};
