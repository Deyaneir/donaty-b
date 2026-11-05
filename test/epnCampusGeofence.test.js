import assert from "node:assert/strict";
import test from "node:test";

import { EPN_CAMPUS_BOUNDARY, isInsideEpnCampus } from "../src/utils/epnCampusGeofence.js";

test("the OSM EPN polygon contains the reference campus coordinate", () => {
  assert.equal(isInsideEpnCampus(-0.210145, -78.488712), true);
  assert.equal(EPN_CAMPUS_BOUNDARY.length, 52);
});

test("the OSM EPN polygon excludes locations outside the campus", () => {
  assert.equal(isInsideEpnCampus(-0.1807, -78.4678), false);
  assert.equal(isInsideEpnCampus(0, 0), false);
});

test("the polygon perimeter is included", () => {
  const [first, second] = EPN_CAMPUS_BOUNDARY;
  assert.equal(isInsideEpnCampus(...first), true);
  assert.equal(
    isInsideEpnCampus(
      (first[0] + second[0]) / 2,
      (first[1] + second[1]) / 2,
    ),
    true,
  );
});
