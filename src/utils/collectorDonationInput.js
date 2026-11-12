const inputError = (message) =>
  Object.assign(new Error(message), { statusCode: 400 });

const parseObjectInput = (value, fieldName) => {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw inputError(`${fieldName} debe contener un JSON válido`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(`${fieldName} debe ser un objeto JSON`);
  }
  return value;
};

const parseExternalDonor = (value) => {
  if (value === undefined || value === null || value === "") return {};
  const parsed = parseObjectInput(value, "donanteExterno");
  const donor = { ...parsed };
  delete donor.direccion;
  return donor;
};

const parseQuantity = (value) => {
  const quantity = typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw inputError("La cantidad debe ser un entero positivo");
  }
  return quantity;
};

const parseCollectorDonationMetadata = (value, directQuantity) => {
  let metadata = value;
  if (metadata === undefined || metadata === null || metadata === "") {
    metadata = {};
  } else {
    metadata = parseObjectInput(metadata, "metadata");
  }

  const hasDirectQuantity = directQuantity !== undefined
    && directQuantity !== null
    && String(directQuantity).trim() !== "";
  const hasMetadataQuantity = Object.hasOwn(metadata, "cantidad");

  if (hasDirectQuantity) {
    const quantity = parseQuantity(directQuantity);
    if (hasMetadataQuantity && parseQuantity(metadata.cantidad) !== quantity) {
      throw inputError("cantidad y metadata.cantidad deben coincidir");
    }
    return { ...metadata, cantidad: quantity };
  }

  if (hasMetadataQuantity && typeof metadata.cantidad === "string") {
    return { ...metadata, cantidad: parseQuantity(metadata.cantidad) };
  }
  return metadata;
};

const buildCollectorDonorFields = ({
  donor,
  coordinates,
  direccionEntrega,
  telefonoContacto,
}) => ({
  donanteExterno: {
    nombre: donor.nombre,
    apellido: donor.apellido,
    telefono: donor.telefono,
    ...(coordinates || {}),
  },
  direccionEntrega: String(direccionEntrega ?? "").trim(),
  telefonoContacto: String(telefonoContacto ?? "").trim(),
});

export {
  buildCollectorDonorFields,
  parseCollectorDonationMetadata,
  parseExternalDonor,
};
