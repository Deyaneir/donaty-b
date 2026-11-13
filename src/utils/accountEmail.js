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

  const [sameRoleAccount, adminAccount] = await Promise.all([
    accountModel.findOne({ email }),
    models.admin.findOne({ email }),
  ]);
  return sameRoleAccount || adminAccount || null;
};

export { findPublicAccountEmailConflict };
