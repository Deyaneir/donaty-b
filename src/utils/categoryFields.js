const FIELD_TYPES = new Set([
  "shortText",
  "longText",
  "integer",
  "decimal",
  "date",
  "dropdown",
  "multiSelect",
  "yesNo",
  "unit",
]);

const validationError = (message) =>
  Object.assign(new Error(message), { statusCode: 400 });

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const normalizeFieldConfiguration = (value = []) => {
  if (!Array.isArray(value)) {
    throw validationError("Los campos de categoría deben enviarse como una lista");
  }

  const keys = new Set();
  return value.map((field, index) => {
    if (!isPlainObject(field)) {
      throw validationError("Cada campo de categoría debe ser un objeto");
    }

    const key = typeof field.key === "string" ? field.key.trim() : "";
    const label = typeof field.label === "string" ? field.label.trim() : "";
    const type = field.type;
    const required = field.required ?? false;
    const active = field.active ?? true;
    const order = field.order ?? index;
    const options = field.options ?? [];
    const min = field.min ?? null;
    const max = field.max ?? null;
    const unit = field.unit ?? "";

    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || !label || label.length > 120) {
      throw validationError("Cada campo requiere una clave y etiqueta válidas");
    }
    if (keys.has(key)) throw validationError(`La clave de campo '${key}' está duplicada`);
    keys.add(key);
    if (!FIELD_TYPES.has(type)) throw validationError(`El tipo del campo '${key}' no es válido`);
    if (typeof required !== "boolean" || typeof active !== "boolean") {
      throw validationError(`required y active deben ser booleanos para el campo '${key}'`);
    }
    if (!Number.isInteger(order) || order < 0) {
      throw validationError(`El orden del campo '${key}' debe ser un entero no negativo`);
    }
    if (typeof unit !== "string" || unit.length > 32) {
      throw validationError(`La unidad del campo '${key}' no es válida`);
    }
    const dateBounds = type === "date";
    const supportsNumericBounds = [
      "shortText", "longText", "integer", "decimal", "multiSelect", "unit",
    ].includes(type);
    const invalidBounds = dateBounds
      ? (min !== null && !isValidDate(min)) || (max !== null && !isValidDate(max)) ||
        (min !== null && max !== null && min > max)
      : supportsNumericBounds
        ? (min !== null && (typeof min !== "number" || !Number.isFinite(min))) ||
          (max !== null && (typeof max !== "number" || !Number.isFinite(max))) ||
          (min !== null && max !== null && min > max)
        : min !== null || max !== null;
    if (invalidBounds) {
      throw validationError(`Los límites del campo '${key}' no son válidos`);
    }
    if (!Array.isArray(options) || options.some((option) =>
      !isPlainObject(option) || typeof option.value !== "string" ||
      typeof option.label !== "string" || !option.label.trim()
    )) {
      throw validationError(`Las opciones del campo '${key}' no son válidas`);
    }
    if (["dropdown", "multiSelect"].includes(type) && options.length === 0) {
      throw validationError(`El campo '${key}' requiere al menos una opción`);
    }
    const optionValues = options.map((option) => option.value);
    if (new Set(optionValues).size !== optionValues.length) {
      throw validationError(`Las opciones del campo '${key}' no pueden repetirse`);
    }

    return {
      key,
      label,
      type,
      required,
      options: options.map(({ value: optionValue, label: optionLabel }) => ({
        value: optionValue,
        label: optionLabel.trim(),
      })),
      min,
      max,
      unit: unit.trim(),
      order,
      active,
    };
  }).sort((left, right) => left.order - right.order);
};

const parseDonationMetadata = (value) => {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw validationError("metadata debe contener un JSON válido");
    }
  }
  if (!isPlainObject(value)) throw validationError("metadata debe ser un objeto JSON");
  return value;
};

const validateDonationMetadata = (value, configuration = []) => {
  const metadata = parseDonationMetadata(value);
  if (Object.hasOwn(metadata, "cantidad")) {
    const quantity = metadata.cantidad;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      throw validationError("metadata.cantidad debe ser un entero positivo");
    }
  }

  const submittedFields = metadata.campos ?? {};
  if (!isPlainObject(submittedFields)) {
    throw validationError("metadata.campos debe ser un objeto");
  }

  const activeFields = configuration.filter((field) => field.active !== false);
  const fieldsByKey = new Map(activeFields.map((field) => [field.key, field]));
  for (const key of Object.keys(submittedFields)) {
    if (!fieldsByKey.has(key)) {
      throw validationError(`El campo '${key}' no está activo en la categoría`);
    }
  }

  const snapshot = activeFields.map((field) => {
    const hasValue = Object.hasOwn(submittedFields, field.key);
    const fieldValue = submittedFields[field.key];
    const blankText = typeof fieldValue === "string" && fieldValue.trim() === "";
    const missing = !hasValue || fieldValue === null || fieldValue === undefined ||
      blankText || (Array.isArray(fieldValue) && fieldValue.length === 0);
    if (field.required && missing) {
      throw validationError(`El campo '${field.label}' es obligatorio`);
    }
    if (missing) return { ...field, value: null };

    const numeric = ["integer", "decimal"].includes(field.type) ||
      (field.type === "unit" && field.options.length === 0);
    if (numeric) {
      const integer = field.type === "integer";
      if (
        typeof fieldValue !== "number" || !Number.isFinite(fieldValue) ||
        (integer && !Number.isInteger(fieldValue)) ||
        (field.min !== null && field.min !== undefined && fieldValue < field.min) ||
        (field.max !== null && field.max !== undefined && fieldValue > field.max)
      ) {
        throw validationError(`El valor del campo '${field.key}' no cumple el tipo o sus límites`);
      }
    } else if (["shortText", "longText"].includes(field.type)) {
      const maxLength = field.type === "shortText" ? 255 : 5000;
      if (typeof fieldValue !== "string" || fieldValue.length > maxLength) {
        throw validationError(`El valor del campo '${field.key}' debe ser texto de hasta ${maxLength} caracteres`);
      }
      if (
        (field.min !== null && field.min !== undefined && fieldValue.length < field.min) ||
        (field.max !== null && field.max !== undefined && fieldValue.length > field.max)
      ) {
        throw validationError(`El valor del campo '${field.key}' no cumple sus límites`);
      }
    } else if (field.type === "date") {
      if (!isValidDate(fieldValue)) {
        throw validationError(`El campo '${field.key}' debe ser una fecha YYYY-MM-DD`);
      }
      if (
        (field.min !== null && field.min !== undefined && fieldValue < field.min) ||
        (field.max !== null && field.max !== undefined && fieldValue > field.max)
      ) {
        throw validationError(`La fecha del campo '${field.key}' no cumple sus límites`);
      }
    } else if (field.type === "dropdown" || field.type === "unit") {
      if (typeof fieldValue !== "string" || !field.options.some((option) => option.value === fieldValue)) {
        throw validationError(`El valor del campo '${field.key}' no está entre las opciones permitidas`);
      }
    } else if (field.type === "multiSelect") {
      const allowedValues = new Set(field.options.map((option) => option.value));
      if (
        !Array.isArray(fieldValue) ||
        fieldValue.some((item) => typeof item !== "string" || !allowedValues.has(item)) ||
        new Set(fieldValue).size !== fieldValue.length ||
        (field.min !== null && field.min !== undefined && fieldValue.length < field.min) ||
        (field.max !== null && field.max !== undefined && fieldValue.length > field.max)
      ) {
        throw validationError(`El valor del campo '${field.key}' no cumple las opciones o límites`);
      }
    } else if (field.type === "yesNo" && typeof fieldValue !== "boolean") {
      throw validationError(`El campo '${field.key}' debe ser verdadero o falso`);
    }

    return { ...field, value: fieldValue };
  });

  return { metadata: { ...metadata, campos: submittedFields }, camposSnapshot: snapshot };
};

const normalizeForConditionalField = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

const isOtherOption = (value) =>
  ["otro", "otros", "otra", "otras", "other", "others"].includes(
    normalizeForConditionalField(value)
  );

const requireAllVisibleDonationFields = (value, configuration = []) => {
  const metadata = parseDonationMetadata(value);
  const submittedFields = isPlainObject(metadata.campos) ? metadata.campos : {};
  const parentsByChild = [
    ["talla", "talla"],
    ["unidad", "unidad_medida"],
    ["alimento", "tipo_alimento"],
    ["juguete", "tipo_juguete"],
    ["prenda", "tipo_prenda"],
  ];

  return configuration.map((field) => {
    const plainField = typeof field?.toObject === "function"
      ? field.toObject()
      : field;
    if (plainField.active === false) return plainField;
    const key = normalizeForConditionalField(plainField.key);
    const label = normalizeForConditionalField(plainField.label);
    const conditional = key.includes("otro")
      || key.includes("otra")
      || label.includes("otro")
      || label.includes("otra")
      || label.includes("especifica");
    if (!conditional) return { ...plainField, required: true };

    const parent = parentsByChild.find(([marker]) => key.includes(marker));
    const visible = parent
      ? isOtherOption(submittedFields[parent[1]])
      : false;
    return { ...plainField, required: visible };
  });
};

export {
  normalizeFieldConfiguration,
  requireAllVisibleDonationFields,
  validateDonationMetadata,
};