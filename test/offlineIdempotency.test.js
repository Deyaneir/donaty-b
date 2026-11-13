import assert from "node:assert/strict";
import test from "node:test";
import OfflineOperation from "../src/models/OfflineOperation.js";
import auth, { crearTokenJWT } from "../src/middlewares/JWT.js";
import { makeMiddleware } from "../src/middlewares/offlineIdempotency.js";

const fakeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const memoryOperationModel = () => {
  const operations = new Map();
  let nextId = 0;
  return {
    operations,
    async create(operation) {
      if (operations.has(operation.operationId)) {
        const error = new Error("duplicate operation key");
        error.code = 11000;
        throw error;
      }
      const created = { ...operation, _id: String(++nextId) };
      operations.set(operation.operationId, created);
      return created;
    },
    findOne({ operationId }) {
      return { lean: async () => operations.get(operationId) ?? null };
    },
    async updateOne({ _id }, { $set }) {
      const operation = [...operations.values()].find((item) => item._id === _id);
      if (!operation) return { modifiedCount: 0 };
      Object.assign(operation, $set);
      return { modifiedCount: 1 };
    },
    async deleteOne({ _id }) {
      const operation = [...operations.values()].find((item) => item._id === _id);
      if (operation) operations.delete(operation.operationId);
      return { deletedCount: operation ? 1 : 0 };
    },
    async findOneAndUpdate({ _id }, { $set }) {
      const operation = [...operations.values()].find((item) => item._id === _id);
      if (operation) Object.assign(operation, $set);
      return operation ?? null;
    },
  };
};

const request = ({ id = "op-001", userId = "user-001", role = "recolector", body = {} } = {}) => ({
  body: { operationId: id, ...body },
  params: { id: "donation-001" },
  user: { _id: userId, rol: role },
  get: () => "",
});

test("offline operation stores its response and replays it without running the action twice", async () => {
  const operationModel = memoryOperationModel();
  const middleware = makeMiddleware({
    operationModel,
    now: (() => {
      let value = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, value++));
    })(),
  })("donation.collect");
  let calls = 0;

  const firstResponse = fakeResponse();
  await middleware(request({
    body: { createdAtLocal: "2025-12-31T23:59:58.123-05:00" },
  }), firstResponse, async () => {
    calls += 1;
    await firstResponse.status(200).json({ donacion: { _id: "donation-001" } });
  });

  const replayResponse = fakeResponse();
  await middleware(request({
    body: { createdAtLocal: "2025-12-31T23:59:58.123-05:00" },
  }), replayResponse, async () => {
    calls += 1;
  });

  assert.equal(calls, 1);
  assert.equal(firstResponse.body.codigo, "OPERATION_CREATED");
  assert.equal(firstResponse.body.operationId, "op-001");
  assert.equal(firstResponse.body.sincronizacion.createdAtLocal, "2025-12-31T23:59:58.123-05:00");
  assert.equal(firstResponse.body.sincronizacion.receivedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(firstResponse.body.sincronizacion.processedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replayResponse.body.duplicada, true);
  assert.equal(replayResponse.body.sincronizacion.estado, "already_processed");
  assert.equal(operationModel.operations.get("op-001").ownerId, "user-001");
  assert.equal(operationModel.operations.get("op-001").entityId, "donation-001");
});

test("an operation identifier cannot be reused by another user or action", async () => {
  const operationModel = memoryOperationModel();
  const idempotency = makeMiddleware({ operationModel });
  let calls = 0;
  const originalResponse = fakeResponse();
  await idempotency("donation.create")(
    request({ role: "donante" }),
    originalResponse,
    async () => {
      calls += 1;
      await originalResponse.status(201).json({ donacion: { _id: "donation-001" } });
    }
  );

  const otherUserResponse = fakeResponse();
  await idempotency("donation.create")(
    request({ userId: "user-002", role: "donante" }),
    otherUserResponse,
    async () => { calls += 1; }
  );
  assert.equal(otherUserResponse.statusCode, 409);
  assert.equal(otherUserResponse.body.codigo, "CONFLICT");
  assert.equal(otherUserResponse.body.operationId, "op-001");

  const otherActionResponse = fakeResponse();
  await idempotency("donation.collect")(
    request({ role: "donante" }),
    otherActionResponse,
    async () => { calls += 1; }
  );
  assert.equal(otherActionResponse.statusCode, 409);
  assert.match(otherActionResponse.body.msg, /otra operación/);
  assert.equal(calls, 1);
});

test("failed business validation is persisted and replayed without releasing the operation identifier", async () => {
  const operationModel = memoryOperationModel();
  const middleware = makeMiddleware({ operationModel })("donation.classify");
  const res = fakeResponse();
  await middleware(request(), res, async () => {
    await res.status(409).json({ msg: "La transición ya no es válida" });
  });

  assert.equal(res.body.codigo, "CONFLICT");
  assert.equal(res.body.sincronizacion.estado, "conflict");
  assert.ok(Number.isFinite(Date.parse(res.body.sincronizacion.processedAt)));
  assert.equal(operationModel.operations.get("op-001").status, "completed");
  assert.equal(operationModel.operations.get("op-001").ownerId, "user-001");

  const otherUser = fakeResponse();
  await middleware(request({ userId: "user-002" }), otherUser, async () => {
    assert.fail("a rejected operation ID must remain bound to its original user");
  });
  assert.equal(otherUser.statusCode, 409);

  const replay = fakeResponse();
  await middleware(request(), replay, async () => {
    assert.fail("a rejected operation must not be executed again");
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.codigo, "CONFLICT");
  assert.equal(replay.body.sincronizacion.estado, "conflict");
  assert.equal(replay.body.sincronizacion.replayed, true);
});

test("offline requests require a valid operation ID and a valid non-empty image", async () => {
  const middleware = makeMiddleware({
    operationModel: memoryOperationModel(),
  })("donation.evidence.upload");
  const missingId = fakeResponse();
  await middleware(request({ id: "" }), missingId, async () => {
    assert.fail("must reject requests without operation IDs");
  });
  assert.equal(missingId.statusCode, 400);
  assert.equal(missingId.body.codigo, "INVALID_OPERATION");

  const badFile = fakeResponse();
  await middleware({
    ...request(),
    files: { imagen: { name: "empty.jpg", mimetype: "image/jpeg", size: 0, data: Buffer.alloc(0) } },
  }, badFile, async () => {
    assert.fail("must reject empty image uploads");
  });
  assert.equal(badFile.statusCode, 400);
  assert.equal(badFile.body.codigo, "INVALID_OPERATION");
});

test("replayed temporary failures remain temporary errors", async () => {
  const middleware = makeMiddleware({
    operationModel: memoryOperationModel(),
  })("donation.create");
  const first = fakeResponse();
  await middleware(request(), first, async () => {
    await first.status(503).json({ msg: "Servicio temporalmente no disponible" });
  });

  const replay = fakeResponse();
  await middleware(request(), replay, async () => {
    assert.fail("a saved temporary failure must not execute a second time");
  });
  assert.equal(replay.statusCode, 503);
  assert.equal(replay.body.codigo, "TEMPORARY_ERROR");
  assert.equal(replay.body.sincronizacion.estado, "temporary_error");
  assert.equal(replay.body.sincronizacion.replayed, true);
});

test("expired access tokens are reported distinctly while retaining the queued operation ID", async () => {
  const expiredToken = crearTokenJWT(
    "507f1f77bcf86cd799439011",
    "donante",
    "-1s"
  );
  const req = {
    headers: { authorization: `Bearer ${expiredToken}` },
    body: {
      operationId: "offline-op-expired",
      createdAtLocal: "2025-06-01T10:00:00.000Z",
    },
    get: () => "",
  };
  const res = fakeResponse();

  await auth(req, res, () => assert.fail("expired access token must not authenticate"));

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "TOKEN_EXPIRED");
  assert.equal(res.body.codigo, "TOKEN_EXPIRED");
  assert.equal(res.body.operationId, "offline-op-expired");
  assert.equal(res.body.sincronizacion.estado, "authentication_required");
});

test("offline operation schema enforces globally unique identifiers and stores server timestamps", () => {
  const indexes = OfflineOperation.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.operationId === 1 && options.unique === true
  ));
  for (const field of ["localCreatedAt", "receivedAt", "processedAt", "ownerId"]) {
    assert.ok(OfflineOperation.schema.path(field));
  }
});
