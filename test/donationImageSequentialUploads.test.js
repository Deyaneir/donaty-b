import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import Campana from "../src/models/Campana.js";
import Categoria from "../src/models/Categoria.js";
import { analyzeDonationImage } from "../src/controllers/donacion_imagen_controller.js";

const createResponse = () => ({
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  set() {
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("two different images uploaded sequentially are sent separately for analysis", async () => {
  const images = [
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("first-image-content")]),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("second-image-content")]),
  ];
  const originals = {
    findCampaign: Campana.findById,
    findCategories: Categoria.find,
    fetch: globalThis.fetch,
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL,
    apiUrl: process.env.GROQ_API_URL,
    consoleInfo: console.info,
    consoleWarn: console.warn,
  };
  const tempFiles = [];
  const sentImageUrls = [];

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
    const requestBody = JSON.parse(request.body);
    const imageUrl = requestBody.messages[0].content.find(
      (part) => part.type === "image_url"
    ).image_url.url;
    sentImageUrls.push(imageUrl);
    const isFirstImage = imageUrl === `data:image/jpeg;base64,${images[0].toString("base64")}`;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            nombreBien: isFirstImage ? "Imagen uno" : "Imagen dos",
            descripcion: isFirstImage ? "Descripción uno" : "Descripción dos",
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
    const suggestions = [];
    for (const image of images) {
      const tempFilePath = `/tmp/donaty-sequential-image-${randomUUID()}.jpg`;
      tempFiles.push(tempFilePath);
      await writeFile(tempFilePath, image);

      const response = createResponse();
      await analyzeDonationImage({
        user: { _id: "507f1f77bcf86cd799439012", rol: "recolector" },
        body: { campanaId: "507f1f77bcf86cd799439011" },
        files: {
          imagen: {
            tempFilePath,
            mimetype: "image/jpeg",
            size: image.length,
          },
        },
      }, response);

      assert.equal(response.statusCode, 200);
      suggestions.push(response.body.sugerencias.nombreBien);
    }

    assert.deepEqual(suggestions, ["Imagen uno", "Imagen dos"]);
    assert.deepEqual(sentImageUrls, images.map((image) =>
      `data:image/jpeg;base64,${image.toString("base64")}`
    ));
    assert.notEqual(sentImageUrls[0], sentImageUrls[1]);
  } finally {
    Campana.findById = originals.findCampaign;
    Categoria.find = originals.findCategories;
    globalThis.fetch = originals.fetch;
    console.info = originals.consoleInfo;
    console.warn = originals.consoleWarn;
    if (originals.apiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originals.apiKey;
    if (originals.model === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originals.model;
    if (originals.apiUrl === undefined) delete process.env.GROQ_API_URL;
    else process.env.GROQ_API_URL = originals.apiUrl;
    await Promise.all(tempFiles.map((path) =>
      unlink(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      })
    ));
  }
});
