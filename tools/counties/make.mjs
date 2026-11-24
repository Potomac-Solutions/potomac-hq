// Makes src/websites/infrastructure/counties.json: the counties a client's
// service area can be picked from, with their outlines. HQ ships the file and
// needs nothing at run time; run this only to add states.
//
//   npx -y -p us-atlas@3 -p topojson-client@3 node tools/counties/make.mjs <path to us-atlas/counties-10m.json>
//
// The shapes are the US Census Bureau's cartographic boundaries, as packaged
// by us-atlas (ISC licence), at 1:10,000,000.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { feature } = require("topojson-client");

// Maryland, West Virginia, Virginia, Pennsylvania, Delaware and Washington DC: where Potomac's clients are.
const STATES = { 10: "DE", 11: "DC", 24: "MD", 42: "PA", 51: "VA", 54: "WV" };
const atlas = JSON.parse(readFileSync(process.argv[2], "utf8"));
const round = (n) => Math.round(n * 1e3) / 1e3;

const counties = feature(atlas, atlas.objects.counties)
  .features.filter((county) => STATES[String(county.id).slice(0, 2)])
  .map((county) => {
    const fips = String(county.id).padStart(5, "0");
    const state = STATES[fips.slice(0, 2)];
    // Virginia's independent cities are counted as counties but aren't called one.
    const city = state === "VA" && Number(fips.slice(2)) >= 500;
    const name = state === "DC" ? "Washington, DC" : city ? `${county.properties.name} (city)` : `${county.properties.name} County`;
    const polygons = county.geometry.type === "Polygon" ? [county.geometry.coordinates] : county.geometry.coordinates;
    // The outer ring of each piece, without its closing point. Lakes inside a county are left out.
    const rings = polygons.map((polygon) => polygon[0].slice(0, -1).map(([lon, lat]) => [round(lon), round(lat)])).sort((a, b) => b.length - a.length);
    return { fips, name, state, rings };
  })
  .sort((a, b) => a.fips.localeCompare(b.fips));

writeFileSync(new URL("../../src/websites/infrastructure/counties.json", import.meta.url), `${JSON.stringify(counties)}\n`);
console.log(`${counties.length} counties`);
