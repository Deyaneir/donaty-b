import Admin from "../models/Admin.js";
import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";

const findPublicAccountEmailConflict = async (
  email,
  role,
  models = { admin: Admin, donante: Donante, recolector: Recolector }
) => {
  const accountModel = role === "donante"
    ? models.donante
    : role === "recolector"
      ? models.recolector
      : null;
  if (!accountModel) {
    throw new Error("El rol público de cuenta no es válido");
  }

  // La regla de negocio es por rol: un correo puede reutilizarse entre
  // donante y recolector, pero no dentro del mismo tipo de cuenta ni para admin.
  const [sameRoleAccount, adminAccount] = await Promise.all([
    accountModel.findOne({ email }),
    models.admin.findOne({ email }),
  ]);
  return sameRoleAccount || adminAccount || null;
};

const registrationConflictMessage = (role) => {
  const label = role === "donante" ? "donante" : "recolector";
  return `El email ya se encuentra registrado para este tipo de cuenta (${label})`;
};

export { findPublicAccountEmailConflict, registrationConflictMessage };
