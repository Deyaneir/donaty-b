import { unlink } from "node:fs/promises";
import OfflineOperation from "../models/OfflineOperation.js";

const getOperationId = (req) => String(
  req.get?.("Idempotency-Key")
  || req.body?.operationId
  || req.body?.idempotencyKey
  || ""
).trim();

const getLocalCreatedAt = (body = {}) => {
  const value = body.createdAtLocal ?? body.localCreatedAt;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    const error = new Error("createdAtLocal debe ser una fecha ISO válida");
    error.statusCode = 400;
    throw error;
  }
  return value;
};

const getTempFiles = (files = {}) => Object.values(files)
  .flatMap((value) => value == null ? [] : Array.isArray(value) ? value : [value])
  .filter((file) => file && typeof file === "object");

const cleanupTempFiles = async (files) => {
  await Promise.all(files.map(async (file) => {
    if (!file.tempFilePath) return;
    try {
      await unlink(file.tempFilePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("No se pudo limpiar un archivo temporal de sincronización:", error);
      }
    }
  }));
};

const validateFiles = (files) => {
  for (const file of files) {
    if (
      typeof file.name !== "string"
      || !file.name.trim()
      || typeof file.mimetype !== "string"
      || !file.mimetype.startsWith("image/")
      || !Number.isFinite(Number(file.size))
      || Number(file.size) <= 0
      || (!file.tempFilePath && !Buffer.isBuffer(file.data))
    ) {
      const error = new Error("El archivo adjunto está vacío o no es una imagen válida");
      error.statusCode = 400;
      throw error;
    }
  }
};

const classifyResponse = (status) => {
  if (status >= 200 && status < 300) return "created";
  if (status === 401) return "authentication_required";
  if (status === 403) return "permission_denied";
  if (status === 409) return "conflict";
  if (status >= 400 && status < 500) return "invalid";
  return "temporary_error";
};

const buildSyncResponse = ({
  operationId,
  body,
  status,
  localCreatedAt,
  receivedAt,
  processedAt,
}) => {
  const response = body && typeof body === "object" && !Array.isArray(body)
    ? { ...body }
    : { result: body };
  response.operationId = operationId;
  response.codigo = ({
    created: "OPERATION_CREATED",
    authentication_required: "AUTHENTICATION_REQUIRED",
    permission_denied: "PERMISSION_DENIED",
    conflict: "CONFLICT",
    invalid: "INVALID_OPERATION",
    temporary_error: "TEMPORARY_ERROR",
  })[classifyResponse(status)];
  response.sincronizacion = {
    operationId,
    estado: classifyResponse(status),
    createdAtLocal: localCreatedAt,
    receivedAt: receivedAt.toISOString(),
    processedAt: processedAt?.toISOString() ?? null,
  };
  return response;
};

const sendSyncError = (res, status, operationId, message, localCreatedAt, receivedAt) =>
  res.status(status).json(buildSyncResponse({
    operationId,
    body: { msg: message },
    status,
    localCreatedAt,
    receivedAt,
    processedAt: null,
  }));

const isDuplicateKeyError = (error) => error?.code === 11000;

const serializeResponse = (body) => JSON.parse(JSON.stringify(body));
const getEntityId = (body, req) =>
  req.params?.id
  ?? req.params?.campaignId
  ?? req.params?.campanaId
  ?? body?.donacion?._id
  ?? body?.entregaGeneral?.campana?.id
  ?? null;

const makeMiddleware = ({
  operationModel = OfflineOperation,
  now = () => new Date(),
} = {}) => (action) => async (req, res, next) => {
  const operationId = getOperationId(req);
  const receivedAt = now();
  let localCreatedAt = null;
  let files = getTempFiles(req.files);
  let operation;
  try {
    if (!operationId || operationId.length > 128) {
      await cleanupTempFiles(files);
      return sendSyncError(
        res,
        400,
        operationId || null,
        "Debes enviar un operationId o Idempotency-Key válido (máximo 128 caracteres)",
        localCreatedAt,
        receivedAt
      );
    }
    const user = req.user || req.donanteHeader;
    if (!user?._id || !user?.rol) {
      await cleanupTempFiles(files);
      return sendSyncError(
        res,
        401,
        operationId,
        "Se requiere una cuenta autenticada para sincronizar",
        localCreatedAt,
        receivedAt
      );
    }
    req.body ??= {};
    if (req.body && !req.body.idempotencyKey) {
      req.body.idempotencyKey = operationId;
    }

    try {
      operation = await operationModel.create({
        operationId,
        ownerId: user._id,
        ownerRole: user.rol,
        action,
        status: "processing",
        localCreatedAt: typeof (req.body?.createdAtLocal ?? req.body?.localCreatedAt) === "string"
          ? req.body.createdAtLocal ?? req.body.localCreatedAt
          : null,
        entityId: req.params?.id ?? req.params?.campaignId ?? req.params?.campanaId ?? null,
        receivedAt,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await operationModel.findOne({ operationId }).lean();
      if (!existing) throw error;
      if (
        String(existing.ownerId) !== String(user._id)
        || existing.ownerRole !== user.rol
      ) {
        await cleanupTempFiles(files);
        return sendSyncError(
          res,
          409,
          operationId,
          "El operationId ya pertenece a otro usuario",
          localCreatedAt,
          receivedAt
        );
      }
      if (existing.action !== action) {
        await cleanupTempFiles(files);
        return sendSyncError(
          res,
          409,
          operationId,
          "El operationId ya fue utilizado para otra operación",
          localCreatedAt,
          receivedAt
        );
      }
      if (existing.status !== "completed" || !existing.responseBody) {
        await cleanupTempFiles(files);
        return sendSyncError(
          res,
          409,
          operationId,
          "La operación aún se está procesando; reintenta con el mismo operationId",
          existing.localCreatedAt,
          receivedAt
        );
      }
      await cleanupTempFiles(files);
      const replayedState = existing.responseStatus >= 200 && existing.responseStatus < 300
        ? "already_processed"
        : existing.responseBody.sincronizacion?.estado;
      const responseBody = {
        ...existing.responseBody,
        operationId,
        duplicada: true,
        sincronizacion: {
          ...existing.responseBody.sincronizacion,
          operationId,
          estado: replayedState,
          replayed: true,
          receivedAt: receivedAt.toISOString(),
        },
      };
      return res.status(existing.responseStatus).json(responseBody);
    }

    localCreatedAt = getLocalCreatedAt(req.body);
    validateFiles(files);
    req.offlineSync = {
      operationId,
      localCreatedAt,
      receivedAt,
      action,
    };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const processedAt = status < 500 ? now() : null;
      const responseBody = buildSyncResponse({
        operationId,
        body,
        status,
        localCreatedAt,
        receivedAt,
        processedAt,
      });
      const entityId = getEntityId(body, req);
      return operationModel.updateOne(
        { _id: operation._id, status: "processing" },
        {
          $set: {
            status: "completed",
            processedAt,
            ...(entityId ? { entityId: String(entityId) } : {}),
            responseStatus: status,
            responseBody: serializeResponse(responseBody),
          },
        }
      ).then((result) => {
        if (result.modifiedCount !== 1) {
          throw new Error("MongoDB no confirmó el resultado de sincronización");
        }
        return originalJson(responseBody);
      }).catch((error) => {
        console.error("No se pudo persistir el resultado de sincronización:", error);
        return operationModel.findOneAndUpdate(
          { _id: operation._id, status: "processing" },
          {
            $set: {
              status: "completed",
              processedAt,
              responseStatus: 503,
              responseBody: {
                msg: "La operación se procesó, pero no se pudo guardar su respuesta; consulta el estado antes de reintentar",
                operationId,
                sincronizacion: {
                  operationId,
                  estado: "temporary_error",
                  createdAtLocal: localCreatedAt,
                  receivedAt: receivedAt.toISOString(),
                  processedAt: processedAt?.toISOString() ?? null,
                },
              },
            },
          },
          { new: true }
        ).then(() => originalJson({
          msg: "No se pudo confirmar la persistencia del resultado; consulta la operación antes de reintentar",
          operationId,
          sincronizacion: {
            operationId,
            estado: "temporary_error",
            createdAtLocal: localCreatedAt,
            receivedAt: receivedAt.toISOString(),
            processedAt: processedAt?.toISOString() ?? null,
          },
        })).catch((persistError) => {
          console.error("No se pudo marcar la operación offline como completada:", persistError);
          return originalJson({
            msg: "No se pudo confirmar el resultado; consulta la operación antes de reintentar",
            operationId,
            sincronizacion: {
              operationId,
              estado: "temporary_error",
              createdAtLocal: localCreatedAt,
              receivedAt: receivedAt.toISOString(),
              processedAt: processedAt?.toISOString() ?? null,
            },
          });
        });
      });
    };
    return next();
  } catch (error) {
    await cleanupTempFiles(files);
    const status = error.statusCode || 503;
    if (error.statusCode) {
      localCreatedAt ??= typeof req.body?.createdAtLocal === "string"
        ? req.body.createdAtLocal
        : typeof req.body?.localCreatedAt === "string"
          ? req.body.localCreatedAt
          : null;
    } else {
      console.error("Error preparando sincronización offline:", error);
    }
    if (operation) {
      const processedAt = status >= 500 ? null : now();
      const responseBody = buildSyncResponse({
        operationId,
        body: {
          msg: error.statusCode
            ? error.message
            : "No se pudo preparar la operación para sincronización",
        },
        status,
        localCreatedAt,
        receivedAt,
        processedAt,
      });
      try {
        const result = await operationModel.updateOne(
          { _id: operation._id, status: "processing" },
          {
            $set: {
              status: "completed",
              processedAt,
              responseStatus: status,
              responseBody: serializeResponse(responseBody),
            },
          }
        );
        if (result.modifiedCount !== 1) {
          throw new Error("MongoDB no confirmó el rechazo de la operación");
        }
      } catch (persistError) {
        console.error("No se pudo persistir el rechazo de sincronización:", persistError);
      }
      return res.status(status).json(responseBody);
    }
    return sendSyncError(
      res,
      status,
      operationId || null,
      error.statusCode ? error.message : "No se pudo preparar la operación para sincronización",
      localCreatedAt,
      receivedAt
    );
  }
};

export { getOperationId, makeMiddleware };
export default makeMiddleware();
