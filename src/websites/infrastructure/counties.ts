// The counties a service area can be picked from: Maryland, West Virginia,
// Virginia, Pennsylvania, Delaware and Washington DC, with their outlines.
// The file is made by tools/counties/make.mjs from the US Census Bureau's
// cartographic boundaries.
import { readFileSync } from "node:fs";
import type { County, CountyAtlas } from "../application/ports.ts";
import { boundsOf } from "../domain/service-area.ts";

export function countyAtlas(): CountyAtlas {
  const counties = JSON.parse(readFileSync(new URL("./counties.json", import.meta.url), "utf8")) as County[];
  const byFips = new Map(counties.map((county) => [county.fips, county]));
  const boxes = counties.map((county) => ({ county, box: boundsOf(county.rings.flat()) }));
  return {
    get: (fips) => byFips.get(fips) ?? null,
    within: ({ west, south, east, north }) => boxes.filter(({ box }) => box !== null && box.east > west && box.west < east && box.north > south && box.south < north).map(({ county }) => county),
  };
}
