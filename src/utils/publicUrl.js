const urlPublica = (value, baseUrl = process.env.PUBLIC_BASE_URL) => {
  const path = String(value ?? "").trim();
  if (!path) return "";

  const configuredBase = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(path);
  } catch {
    if (!configuredBase) return path;
    return new URL(path.replace(/^\/+/, ""), `${configuredBase}/`).toString();
  }

  const localHostname = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i
    .test(parsed.hostname);
  if (
    configuredBase
    && (parsed.protocol !== "https:" || localHostname)
  ) {
    return new URL(
      `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}${parsed.hash}`,
      `${configuredBase}/`
    ).toString();
  }
  return parsed.toString();
};

export { urlPublica };
