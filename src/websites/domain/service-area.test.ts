import assert from "node:assert/strict";
import { test } from "node:test";
import { areaNames, cleanRing, frameFor, MAP_HEIGHT, MAP_WIDTH, project, readServiceArea, sameServiceArea, serviceAreaBlock, serviceAreaFrom, unproject, viewFor, type CountyLookup, type Point } from "./service-area.ts";

const GARRETT: Point[] = [[-79.4762, 39.7211], [-79.0661, 39.7228], [-79.0675, 39.4766], [-79.4874, 39.2056]];
const counties: CountyLookup = (fips) => (fips === "24023" ? { name: "Garrett County", ring: GARRETT } : null);
const DRAWN = [[-79.4, 39.5], [-79.3, 39.5], [-79.3, 39.6]];

test("a county is picked by its code and gets HQ's own outline and name; a drawn area needs a name and three points", () => {
  const made = serviceAreaFrom([{ county: "24023", ring: [[0, 0], [1, 1], [2, 0]] }, { name: " Deep Creek  Lake loop ", ring: DRAWN }], counties);
  assert.ok(made.ok);
  assert.deepEqual(made.value.areas[0], { name: "Garrett County", county: "24023", ring: GARRETT }, "the outline sent with a county is ignored");
  assert.deepEqual(made.value.areas[1], { name: "Deep Creek Lake loop", county: null, ring: DRAWN });
  assert.equal(areaNames(made.value), "Garrett County and Deep Creek Lake loop");

  assert.deepEqual(serviceAreaFrom([{ county: "99999" }], counties), { ok: false, error: "county-unknown" });
  assert.deepEqual(serviceAreaFrom([{ name: "", ring: DRAWN }], counties), { ok: false, error: "area-name-missing" });
  assert.deepEqual(serviceAreaFrom([{ name: "Two", ring: DRAWN.slice(0, 2) }], counties), { ok: false, error: "area-too-few-points" });
  assert.deepEqual(serviceAreaFrom([{ name: "Huge", ring: [[-90, 30], [-70, 30], [-70, 45]] }], counties), { ok: false, error: "area-too-big" });
  assert.deepEqual(serviceAreaFrom([{ name: "Bad", ring: [[-79, "39"], [1, 2], [3, 4]] }], counties), { ok: false, error: "areas-invalid" });
  assert.deepEqual(serviceAreaFrom("nope", counties), { ok: false, error: "areas-invalid" });
  assert.deepEqual(serviceAreaFrom(Array.from({ length: 21 }, () => ({ county: "24023" })), counties), { ok: false, error: "too-many-areas" });
});

test("the same county twice counts once; no areas at all is allowed", () => {
  const made = serviceAreaFrom([{ county: "24023" }, { county: "24023", name: "Again" }], counties);
  assert.ok(made.ok);
  assert.equal(made.value.areas.length, 1);
  assert.deepEqual(serviceAreaFrom([], counties), { ok: true, value: { areas: [] } });
});

test("points are rounded to about ten metres, repeats and the closing point dropped", () => {
  assert.deepEqual(cleanRing([[-79.123456, 39.987654], [-79.123456, 39.987654], [-79, 39], [-78.9, 39.1], [-79.123456, 39.987654]]), [[-79.1235, 39.9877], [-79, 39], [-78.9, 39.1]]);
  assert.equal(cleanRing([[200, 0]]), null);
  assert.equal(cleanRing("x"), null);
});

test("the block written to the site reads back the same; a file without one has no service area", () => {
  const made = serviceAreaFrom([{ county: "24023" }, { name: "Loop", ring: DRAWN }], counties);
  assert.ok(made.ok);
  const file = JSON.stringify({ gallery: [], serviceArea: serviceAreaBlock(made.value) });
  const read = readServiceArea(file);
  assert.ok(read && sameServiceArea(read, made.value));
  assert.equal(readServiceArea(JSON.stringify({ gallery: [] })), null);
  assert.equal(readServiceArea("not json"), null);
  assert.deepEqual(readServiceArea(JSON.stringify({ serviceArea: { areas: [{ name: "Broken", ring: [[1, 2]] }, { ring: DRAWN }] } })), { areas: [{ name: "Area", county: null, ring: DRAWN }] }, "an area that can't be read is left out");
});

test("the map is framed around the areas, and a point drawn on it turns back into the place it was drawn", () => {
  const made = serviceAreaFrom([{ county: "24023" }], counties);
  assert.ok(made.ok);
  const view = viewFor(made.value, { west: -83, south: 37, east: -75, north: 40.7 });
  assert.ok(view.west < -79.48 && view.east > -79.07 && view.south < 39.2 && view.north > 39.72);
  const frame = frameFor(view);
  for (const point of GARRETT) {
    const [x, y] = project(frame, point);
    assert.ok(x >= 0 && x <= MAP_WIDTH && y >= 0 && y <= MAP_HEIGHT, "inside the box");
    const back = unproject(frame, [x, y]);
    assert.ok(Math.abs(back[0] - point[0]) < 0.002 && Math.abs(back[1] - point[1]) < 0.002);
  }
  const wider = viewFor(made.value, { west: 0, south: 0, east: 1, north: 1 }, 1);
  assert.ok(wider.east - wider.west > view.east - view.west, "a wider view shows more");
  assert.deepEqual(viewFor({ areas: [] }, { west: -80, south: 39, east: -79, north: 40 }).west < -80, true, "no areas: the fallback, with room");
});
