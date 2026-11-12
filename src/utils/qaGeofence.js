const isQaGeofenceOverrideAllowed = (user, environment = process.env) => {
  const enabled = String(environment.ENABLE_QA_GEOFENCE_BYPASS || "").toLowerCase() === "true";
  const environmentName = String(environment.NODE_ENV || "").toLowerCase();
  const allowedEnvironments = new Set(["development", "test"]);
  const expiresAt = new Date(environment.QA_GEOFENCE_BYPASS_EXPIRES_AT || "");
  const validExpiry =
    Number.isFinite(expiresAt.getTime())
    && expiresAt.getTime() > Date.now()
    && expiresAt.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000;
  const collectorIds = new Set(
    String(environment.QA_GEOFENCE_COLLECTOR_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  return enabled
    && allowedEnvironments.has(environmentName)
    && validExpiry
    && String(user?.rol || "").toLowerCase() === "recolector"
    && Boolean(user?._id)
    && collectorIds.has(String(user._id));
};

export { isQaGeofenceOverrideAllowed };
