import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import Campana from "../src/models/Campana.js";
import Categoria from "../src/models/Categoria.js";
import { analyzeDonationImage } from "../src/controllers/donacion_imagen_controller.js";

const makeResponse = () => ({
  statusCode: null,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  set(name, value) {
    this.headers[name] = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("the same photo can be analyzed again in a separate multipart request", async () => {
  const imageBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    ...Buffer.from("same photo bytes"),
  ]);
  const description = "Artículo visible con distintos detalles. ".repeat(20).trim();
  const campaignId = "507f1f77bcf86cd799439011";
  const original = {
    findCampaign: Campana.findById,
    findCategories: Categoria.find,
    fetch: globalThis.fetch,
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL,
    apiUrl: process.env.GROQ_API_URL,
    consoleInfo: console.info,
    consoleWarn: console.warn,
  };
  const temporaryFiles = [];
  let providerCalls = 0;
  let providerImageUrl;

  Campana.findById = () => ({
    select() { return this; },
    lean: async () => ({ activa: true, categoriasPermitidas: [] }),
  });
  Categoria.find = () => ({
    select() { return this; },
    lean: async () => [],
  });
  process.env.GROQ_API_KEY = "test-api-key";
  process.env.GROQ_MODEL = "test-model";
  process.env.GROQ_API_URL = "https://provider.test";
  globalThis.fetch = async (_url, request) => {
    providerCalls += 1;
    const body = JSON.parse(request.body);
    providerImageUrl = body.messages[0].content.find(
      (part) => part.type === "image_url"
    ).image_url.url;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            nombreBien: "Botella",
            descripcion: description,
            campos: {},
            confianza: { nombreBien: 0.9, descripcion: 0.9, campos: {} },
          }),
        },
      }],
    }), { status: 200 });
  };
  console.info = () => {};
  console.warn = () => {};

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const tempFilePath = `/tmp/donaty-image-${randomUUID()}.jpg`;
      temporaryFiles.push(tempFilePath);
      await writeFile(tempFilePath, imageBytes);
      const response = makeResponse();
      await analyzeDonationImage({
        user: { _id: "507f1f77bcf86cd799439012", rol: "recolector" },
        body: { campanaId: campaignId },
        files: {
          imagen: {
            tempFilePath,
            mimetype: "application/octet-stream",
            size: imageBytes.length,
          },
        },
      }, response);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.sugerencias.nombreBien, "Botella");
      assert.equal(response.body.descripcion, description);
      assert.equal(response.body.sugerencias.descripcion, description);
      assert.ok(response.body.descripcion.length > 500);
      assert.equal(providerImageUrl, `data:image/jpeg;base64,${imageBytes.toString("base64")}`);
    }

    assert.equal(providerCalls, 2);
  } finally {
    Campana.findById = original.findCampaign;
    Categoria.find = original.findCategories;
    globalThis.fetch = original.fetch;
    console.info = original.consoleInfo;
    console.warn = original.consoleWarn;
    if (original.apiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = original.apiKey;
    if (original.model === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = original.model;
    if (original.apiUrl === undefined) delete process.env.GROQ_API_URL;
    else process.env.GROQ_API_URL = original.apiUrl;
    await Promise.all(temporaryFiles.map((path) =>
      unlink(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      })
    ));
  }
});
