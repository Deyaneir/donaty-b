import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDonationCollectionLocation,
  realGpsCoordinates,
} from "../src/utils/donationLocation.js";

const formDataLocation = JSON.stringify({
  latitude: -0.210145,
  longitude: -78.488712,
  source: "gps_real",
  isSimulated: false,
  buildingId: 16,
  buildingName: "Facultad de Ingeniería Eléctrica y Electrónica",
});

test("parses and normalizes a location from FormData JSON", () => {
  const location = parseDonationCollectionLocation(formDataLocation);
  assert.deepEqual(location, {
    latitude: -0.210145,
    longitude: -78.488712,
    source: "gps_real",
    isSimulated: false,
    buildingId: 16,
    buildingName: "Facultad de Ingeniería Eléctrica y Electrónica",
  });
  assert.deepEqual(realGpsCoordinates(location), {
    latitud: -0.210145,
    longitud: -78.488712,
  });
});

test("allows a selected location outside campus without building metadata", () => {
  const location = parseDonationCollectionLocation({
    latitude: -0.21,
    longitude: -78.48,
    source: "map",
    isSimulated: false,
  });
  assert.equal(location.buildingId, null);
  assert.equal(location.buildingName, "");
  assert.equal(realGpsCoordinates(location), null);
});

test("does not classify simulated coordinates as real GPS", () => {
  const location = parseDonationCollectionLocation({
    latitude: -0.21,
    longitude: -78.48,
    source: "gps_real",
    isSimulated: true,
  });
  assert.equal(location.source, "simulated");
  assert.equal(location.isSimulated, true);
  assert.equal(realGpsCoordinates(location), null);
});

test("rejects malformed, incomplete or out-of-range locations", () => {
  assert.throws(() => parseDonationCollectionLocation("{bad json"), { statusCode: 400 });
  assert.throws(() => parseDonationCollectionLocation({ latitude: 0 }), { statusCode: 400 });
  assert.throws(
    () => parseDonationCollectionLocation({
      latitude: 91,
      longitude: 0,
      source: "gps_real",
      isSimulated: false,
    }),
    { statusCode: 400 }
  );
  assert.equal(parseDonationCollectionLocation(undefined), undefined);
});
