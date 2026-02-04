const requireRole = (...roles) => {
  const allowed = roles.map((role) => String(role).toLowerCase());
  return (req, res, next) => {
    const userRole = String(req.user?.rol || req.donanteHeader?.rol || "").toLowerCase();
    if (!userRole) {
      return res.status(401).json({ msg: "No autenticado" });
    }
    if (!allowed.includes(userRole)) {
      return res.status(403).json({ msg: "No autorizado" });
    }
    return next();
  };
};

export default requireRole;
