const isPerfilCompleto = (user) => {
  if (!user) return false;
  if (user.perfilCompleto === true) return true;
  return Boolean(
    (user.nombre || "").trim() &&
      (user.apellido || "").trim() &&
      (user.direccion || "").trim() &&
      (user.telefono || "").trim()
  );
};

const requirePerfilCompleto = (req, res, next) => {
  const user = req.user || req.donanteHeader;
  if (!isPerfilCompleto(user)) {
    return res.status(403).json({
      msg: "Completa tu perfil (nombre, apellido, dirección y teléfono)",
    });
  }
  return next();
};

export default requirePerfilCompleto;
