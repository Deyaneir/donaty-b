import test from "node:test";
import assert from "node:assert/strict";
import { urlPublica } from "../src/utils/publicUrl.js";

test("public URLs preserve secure CDN links", () => {
  const url = "https://res.cloudinary.com/example/image/upload/photo.jpg";
  assert.equal(urlPublica(url, "https://api.example.test"), url);
});

test("public URLs resolve relative paths using the configured public base", () => {
  assert.equal(
    urlPublica("/uploads/photo.jpg", "https://api.example.test/"),
    "https://api.example.test/uploads/photo.jpg"
  );
});

test("public URLs replace local or insecure origins when a public base is configured", () => {
  assert.equal(
    urlPublica("http://10.0.2.2:3000/uploads/photo.jpg", "https://api.example.test"),
    "https://api.example.test/uploads/photo.jpg"
  );
});
