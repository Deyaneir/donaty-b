const IMAGE_WRITABLE_FIELD_TYPES = new Set([
  "shortText",
  "longText",
  "integer",
  "decimal",
]);

const isImageWritableField = (field) =>
  field?.active !== false && (
    IMAGE_WRITABLE_FIELD_TYPES.has(field?.type)
    || (field?.type === "unit" && (!field.options || field.options.length === 0))
  );

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const getImageWritableFields = (fields = []) =>
  fields
    .filter(isImageWritableField)
    .map(({ key, label, type, min, max }) => ({ key, label, type, min, max }));

const normalizeImageFieldSuggestions = (suggestions, fields = []) => {
  if (!isPlainObject(suggestions)) return {};

  const normalized = {};
  for (const field of getImageWritableFields(fields)) {
    const value = suggestions[field.key];
    if (field.type === "shortText" || field.type === "longText") {
      if (typeof value !== "string") continue;
      const text = value.trim();
      const maxLength = field.type === "shortText" ? 255 : 5000;
      if (!text || text.length > maxLength) continue;
      if (
        (field.min !== null && field.min !== undefined && text.length < field.min)
        || (field.max !== null && field.max !== undefined && text.length > field.max)
      ) {
        continue;
      }
      normalized[field.key] = text;
      continue;
    }

    const number = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
    if (!Number.isFinite(number)) continue;
    if (field.type === "integer" && !Number.isInteger(number)) continue;
    if (
      (field.min !== null && field.min !== undefined && number < field.min)
      || (field.max !== null && field.max !== undefined && number > field.max)
    ) {
      continue;
    }
    normalized[field.key] = number;
  }
  return normalized;
};

export { getImageWritableFields, normalizeImageFieldSuggestions };
