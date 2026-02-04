const isBlank = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
};

const requireFields = (obj, fields = []) => {
  const missing = [];
  for (const field of fields) {
    const value = obj ? obj[field] : undefined;
    if (isBlank(value)) missing.push(field);
  }
  return missing;
};

export { isBlank, requireFields };
