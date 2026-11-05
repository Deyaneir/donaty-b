const invalidLocation = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseDonationCollectionLocation = (value) => {
  if (value === undefined || value === null || value === "") return undefined;

  let location = value;
  if (typeof location === "string") {
    try {
      location = JSON.parse(location);
    } catch {
      throw invalidLocation("ubicacionRecoleccion debe contener un JSON válido");
    }
  }
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    throw invalidLocation("ubicacionRecoleccion debe ser un objeto JSON");
  }

  const latitudeInput = location.latitude;
  const longitudeInput = location.longitude;
  const latitude = Number(latitudeInput);
  const longitude = Number(longitudeInput);
  if (
    latitudeInput === undefined
    || latitudeInput === null
    || latitudeInput === ""
    || longitudeInput === undefined
    || longitudeInput === null
    || longitudeInput === ""
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    throw invalidLocation("La ubicación debe incluir coordenadas válidas");
  }

  const allowedSources = new Set(["gps_real", "simulated", "map"]);
  const source = String(location.source ?? "");
  if (!allowedSources.has(source)) {
    throw invalidLocation("El origen de la ubicación no es válido");
  }
  if (typeof location.isSimulated !== "boolean") {
    throw invalidLocation("isSimulated debe ser verdadero o falso");
  }

  const isSimulated = location.isSimulated || source === "simulated";
  const rawBuildingId = location.buildingId;
  const buildingId = rawBuildingId === undefined || rawBuildingId === null || rawBuildingId === ""
    ? null
    : Number(rawBuildingId);
  if (buildingId !== null && (!Number.isInteger(buildingId) || buildingId < 1)) {
    throw invalidLocation("buildingId debe ser un entero positivo");
  }

  const buildingName = location.buildingName === undefined || location.buildingName === null
    ? ""
    : String(location.buildingName).trim();
  if (buildingName.length > 160) {
    throw invalidLocation("buildingName no puede superar 160 caracteres");
  }

  return {
    latitude,
    longitude,
    source: isSimulated ? "simulated" : source,
    isSimulated,
    buildingId,
    buildingName,
  };
};

const realGpsCoordinates = (location) =>
  location?.source === "gps_real" && location.isSimulated === false
    ? { latitud: location.latitude, longitud: location.longitude }
    : null;

export { parseDonationCollectionLocation, realGpsCoordinates };
