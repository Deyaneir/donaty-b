const requiredProfileFields = [
  "ciudad",
  "sector",
  "fechaNacimiento",
  "universidad",
  "carrera",
  "semestre",
];

const isValidBirthDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && parsed <= new Date();
};

const validateMobileRegistrationProfile = (body = {}) => {
  const required = requiredProfileFields.filter((field) =>
    typeof body[field] !== "string" || !body[field].trim()
  );
  if (required.length) {
    return { error: "Completa todos los datos personales y universitarios" };
  }
  if (!isValidBirthDate(body.fechaNacimiento)) {
    return { error: "La fecha de nacimiento no es válida" };
  }
  if (typeof body.perteneceAsociacion !== "boolean") {
    return { error: "Indica si perteneces a una asociación estudiantil" };
  }
  if (body.perteneceAsociacion) {
    if (
      typeof body.asociacionEstudiantil !== "string"
      || !body.asociacionEstudiantil.trim()
    ) {
      return { error: "Indica la asociación estudiantil a la que perteneces" };
    }
    if (
      typeof body.cargoAsociacion !== "string"
      || !body.cargoAsociacion.trim()
    ) {
      return { error: "Indica tu cargo dentro de la asociación" };
    }
  }
  if (body.aceptaTerminos !== true || body.aceptaPrivacidad !== true) {
    return { error: "Debes aceptar los términos y el aviso de privacidad" };
  }

  return {
    profile: {
      ciudad: body.ciudad.trim(),
      sector: body.sector.trim(),
      fechaNacimiento: new Date(`${body.fechaNacimiento}T00:00:00.000Z`),
      universidad: body.universidad.trim(),
      carrera: body.carrera.trim(),
      semestre: body.semestre.trim(),
      perteneceAsociacion: body.perteneceAsociacion,
      asociacionEstudiantil: body.perteneceAsociacion
        ? body.asociacionEstudiantil.trim()
        : "",
      cargoAsociacion: body.perteneceAsociacion
        ? body.cargoAsociacion.trim()
        : "",
      aceptaTerminos: true,
      aceptaPrivacidad: true,
    },
  };
};

export { validateMobileRegistrationProfile };
