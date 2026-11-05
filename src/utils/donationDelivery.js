const deliveryError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeDeliveryMethod = (value, { pointId, fallback } = {}) => {
  const raw = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!raw) return pointId ? "punto_recoleccion" : "domicilio";
  if (["punto_recoleccion", "punto", "pickup_point"].includes(raw)) {
    return "punto_recoleccion";
  }
  if (["domicilio", "home_pickup"].includes(raw)) return "domicilio";
  throw deliveryError("El método de entrega debe ser punto_recoleccion o domicilio");
};

const isPointActive = (point) =>
  point?.activo !== false
  && String(point?.estado ?? "").toLowerCase() !== "inactivo";

const resolveDonationDelivery = ({
  profile,
  campaign,
  method,
  pointId,
  alternativeAddress,
  legacyDeliveryAddress,
  references,
  defaultMethod,
  defaultPointId,
}) => {
  const phone = String(profile?.telefono ?? "").trim();
  if (!phone) {
    throw deliveryError("Completa tu perfil: registra un teléfono de contacto antes de crear la donación");
  }

  const selectedPointId = pointId ?? defaultPointId ?? null;
  const methodFinal = normalizeDeliveryMethod(method, {
    pointId: selectedPointId,
    fallback: defaultMethod,
  });
  const name = [profile?.nombre, profile?.apellido]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");

  if (methodFinal === "punto_recoleccion") {
    if (!selectedPointId) {
      throw deliveryError("Selecciona un punto de recolección");
    }
    const point = campaign?.puntosRecoleccion?.find(
      (item) => String(item._id ?? item.id) === String(selectedPointId)
    );
    if (!point || !isPointActive(point)) {
      throw deliveryError("El punto seleccionado no existe o no está disponible");
    }

    const address = [
      point.direccion,
      point.edificio || point.nombreEdificio,
      point.piso,
      point.aula,
      point.nombre,
    ].map((part) => String(part ?? "").trim()).filter(Boolean).join(", ");
    const pointReferences = String(
      point.referenciasLugar ?? point.referencias ?? ""
    ).trim();
    const deliveryReferences = String(references ?? pointReferences).trim();
    if (deliveryReferences.length > 1000) {
      throw deliveryError("Las referencias de entrega no pueden superar 1000 caracteres");
    }

    return {
      nombreDonante: name,
      telefonoContacto: phone,
      metodoEntrega: methodFinal,
      direccionEntrega: address,
      puntoRecoleccionRef: point._id ?? point.id,
      referenciasEntrega: deliveryReferences,
    };
  }

  if (selectedPointId) {
    throw deliveryError("No envíes puntoRecoleccionId cuando el método es domicilio");
  }
  const address = String(
    alternativeAddress ?? legacyDeliveryAddress ?? profile?.direccion ?? ""
  ).trim();
  if (!address) {
    throw deliveryError("Completa la dirección de tu perfil o indica una dirección alternativa");
  }
  const deliveryReferences = String(references ?? "").trim();
  if (deliveryReferences.length > 1000) {
    throw deliveryError("Las referencias de entrega no pueden superar 1000 caracteres");
  }

  return {
    nombreDonante: name,
    telefonoContacto: phone,
    metodoEntrega: methodFinal,
    direccionEntrega: address,
    puntoRecoleccionRef: null,
    referenciasEntrega: deliveryReferences,
  };
};

export { resolveDonationDelivery };
