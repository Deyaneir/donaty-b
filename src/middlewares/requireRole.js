const requireRole = (...roles) => {
  const allowed = roles.map((role) => String(role).toLowerCase());
  return (req, res, next) => {
    const operationId = String(
      req.get?.("Idempotency-Key")
      || req.body?.operationId
      || req.body?.idempotencyKey
      || ""
    ).trim();
    const syncMetadata = operationId
      ? {
          operationId,
          sincronizacion: {
            operationId,
            estado: "permission_denied",
            createdAtLocal: req.body?.createdAtLocal ?? req.body?.localCreatedAt ?? null,
            receivedAt: new Date().toISOString(),
            processedAt: null,
          },
        }
      : {};
    const userRole = String(req.user?.rol || req.donanteHeader?.rol || "").toLowerCase();
    if (!userRole) {
      return res.status(401).json({
        msg: "No autenticado",
        ...(operationId
          ? {
              ...syncMetadata,
              codigo: "AUTHENTICATION_REQUIRED",
              sincronizacion: { ...syncMetadata.sincronizacion, estado: "authentication_required" },
            }
          : {}),
      });
    }
    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        msg: "No autorizado",
        ...(operationId ? { ...syncMetadata, codigo: "PERMISSION_DENIED" } : {}),
      });
    }
    return next();
  };
};

export default requireRole;
