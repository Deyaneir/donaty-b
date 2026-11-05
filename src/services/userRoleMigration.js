import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Donante from "../models/Donante.js";
import FcmDevice from "../models/FcmDevice.js";
import Recolector from "../models/Recolector.js";

const USER_MODELS = { donante: Donante, recolector: Recolector };

const TRANSFERABLE_FIELDS = [
  "nombre",
  "apellido",
  "direccion",
  "telefono",
  "ciudad",
  "sector",
  "fechaNacimiento",
  "universidad",
  "carrera",
  "semestre",
  "perteneceAsociacion",
  "asociacionEstudiantil",
  "cargoAsociacion",
  "aceptaTerminos",
  "aceptaPrivacidad",
  "email",
  "googleId",
  "password",
  "confirmEmail",
  "status",
  "token",
  "tokenExpires",
  "createdAt",
];

const migrationError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode });

const accountFields = (source) =>
  Object.fromEntries(
    TRANSFERABLE_FIELDS.filter((field) => source[field] !== undefined).map(
      (field) => [field, source[field]],
    ),
  );

const profileIsComplete = (account) =>
  ["nombre", "apellido", "direccion", "telefono"].every(
    (field) => String(account[field] || "").trim().length > 0,
  );

const isUnsupportedTransaction = (error) =>
  error.code === 20
  || error.codeName === "IllegalOperation"
  || /Transaction numbers are only allowed/i.test(error.message || "");

const migrateUserRole = async ({
  id,
  fromRole,
  toRole,
  updates = {},
  models = {
    admin: Admin,
    donante: Donante,
    recolector: Recolector,
    fcmDevice: FcmDevice,
  },
  sessionFactory = () => mongoose.startSession(),
}) => {
  const Source = models[fromRole];
  const Destination = models[toRole];
  if (!Source || !Destination || fromRole === toRole) {
    throw migrationError("El cambio de rol solicitado no es válido", 400);
  }

  const session = await sessionFactory();
  let migratedUser;

  try {
    await session.withTransaction(async () => {
      const source = await Source.findById(id)
        .select("+password")
        .session(session);
      if (!source) {
        throw migrationError("No existe el usuario indicado", 404);
      }
      if (source.rolMigradoA) {
        throw migrationError("La cuenta ya fue migrada a otro rol", 409);
      }

      const archivedDestination = await Destination.findById(id)
        .select("+password")
        .session(session);
      if (
        archivedDestination
        && archivedDestination.rolMigradoA !== fromRole
      ) {
        throw migrationError(
          "Ya existe una cuenta activa con ese identificador en el rol de destino",
          409,
        );
      }

      const email = updates.email ?? source.email;
      const [existingDonor, existingCollector, existingAdmin] =
        await Promise.all([
          models.donante.findOne({ email, _id: { $ne: id } }).session(session),
          models.recolector.findOne({ email, _id: { $ne: id } }).session(session),
          models.admin.findOne({ email, _id: { $ne: id } }).session(session),
        ]);
      if (existingDonor || existingCollector || existingAdmin) {
        throw migrationError("El correo ya está registrado", 409);
      }

      const data = { ...accountFields(source), ...updates };
      if (archivedDestination) {
        Object.assign(archivedDestination, data);
        archivedDestination.rolMigradoA = null;
      } else {
        migratedUser = new Destination({
          _id: source._id,
          ...data,
          rol: toRole,
          rolMigradoA: null,
        });
      }

      const destination = archivedDestination ?? migratedUser;
      destination.rol = toRole;
      destination.status = source.status;
      destination.confirmEmail = source.confirmEmail;
      destination.token = source.token;
      destination.tokenExpires = source.tokenExpires;
      destination.rolMigradoA = null;

      if (toRole === "recolector" && !archivedDestination) {
        destination.aprobado = false;
      }
      if (toRole === "donante") {
        destination.perfilCompleto = profileIsComplete(destination);
      }

      source.rolMigradoA = toRole;
      source.status = false;
      source.token = null;
      source.tokenExpires = null;

      await source.save({ session });
      await destination.save({ session });
      await models.fcmDevice.updateMany(
        { userId: source._id, role: fromRole },
        { $set: { role: toRole } },
        { session },
      );
      migratedUser = destination;
    });

    return migratedUser;
  } catch (error) {
    if (error.statusCode) throw error;
    if (
      error.hasErrorLabel?.("TransientTransactionError")
      || error.code === 112
      || error.code === 251
    ) {
      throw migrationError(
        "La cuenta cambió durante la migración; vuelve a intentarlo",
        409,
      );
    }
    if (isUnsupportedTransaction(error)) {
      throw migrationError(
        "El cambio de rol requiere una instancia MongoDB compatible con transacciones; no se modificaron los datos",
        503,
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export { migrateUserRole };
