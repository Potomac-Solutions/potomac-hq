// Where a business goes: its service area, as named outlines on a map. A
// towing company, a mobile mechanic or a cleaner says "we come out this far",
// and that is rarely a list of counties: it is a shape. An area is either a
// whole county, picked from the map, or an outline drawn by hand.
//
// The site draws the areas from the `serviceArea` block of its content file.
// A site whose file has no such block has no service area to change.
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** [longitude, latitude], in degrees. */
export type Point = readonly [number, number];

export type Area = {
  readonly name: string;
  /** The county's five-digit FIPS code when the area is that whole county. Null when it was drawn. */
  readonly county: string | null;
  /** The outline, not closed: the last point joins back to the first. */
  readonly ring: readonly Point[];
};

export type ServiceArea = { readonly areas: readonly Area[] };

export const MAX_AREAS = 20;
export const MAX_POINTS = 2000;
export const MAX_NAME = 60;
/** An area wider or taller than this many degrees (about 350 miles) is a slip of the hand, not a service area. */
export const MAX_SPAN = 5;

export type AreaError = "areas-invalid" | "too-many-areas" | "area-name-missing" | "area-name-too-long" | "area-too-few-points" | "area-too-many-points" | "area-too-big" | "county-unknown";

/** What the browser sends for one area: a county by its code, or a drawn outline. */
export type AreaInput = { readonly name?: unknown; readonly county?: unknown; readonly ring?: unknown };

/** Where an area's outline comes from when it is a whole county: HQ's own map, never what was sent. */
export type CountyLookup = (fips: string) => { readonly name: string; readonly ring: readonly Point[] } | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Four decimal places: about 10 metres, finer than anyone draws. */
const round = (value: number) => Math.round(value * 1e4) / 1e4;
const line = (text: unknown) => (typeof text === "string" ? text : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** A list of points as given, cleaned: rounded, repeats dropped, the closing point dropped. Null if any point isn't one. */
export function cleanRing(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const out: Point[] = [];
  for (const item of value as unknown[]) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [lon, lat] = item as unknown[];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 85) return null;
    const point: Point = [round(lon), round(lat)];
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

export function boundsOf(points: readonly Point[]): { west: number; south: number; east: number; north: number } | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function checkArea(name: string, county: string | null, ring: Point[]): Result<Area, AreaError> {
  if (!name) return err("area-name-missing");
  if (name.length > MAX_NAME) return err("area-name-too-long");
  if (ring.length < 3) return err("area-too-few-points");
  if (ring.length > MAX_POINTS) return err("area-too-many-points");
  const box = boundsOf(ring);
  if (!box || box.east - box.west > MAX_SPAN || box.north - box.south > MAX_SPAN) return err("area-too-big");
  return ok({ name, county, ring });
}

/**
 * A service area from what someone chose: counties by their code, outlines
 * drawn by hand. A county's outline is HQ's own, from `counties`, and its
 * name is the county's unless one was typed. The same county twice counts once.
 */
export function serviceAreaFrom(input: unknown, counties: CountyLookup): Result<ServiceArea, AreaError> {
  if (!Array.isArray(input)) return err("areas-invalid");
  if (input.length > MAX_AREAS) return err("too-many-areas");
  const areas: Area[] = [];
  const seen = new Set<string>();
  for (const item of input as unknown[]) {
    if (!isRecord(item)) return err("areas-invalid");
    const typed = line(item["name"]);
    if (item["county"] !== undefined && item["county"] !== null) {
      const fips = typeof item["county"] === "string" && /^\d{5}$/.test(item["county"]) ? item["county"] : null;
      const found = fips ? counties(fips) : null;
      if (!fips || !found) return err("county-unknown");
      if (seen.has(fips)) continue;
      seen.add(fips);
      const area = checkArea(typed || found.name, fips, cleanRing(found.ring) ?? []);
      if (!area.ok) return area;
      areas.push(area.value);
      continue;
    }
    const ring = cleanRing(item["ring"]);
    if (!ring) return err("areas-invalid");
    const area = checkArea(typed, null, ring);
    if (!area.ok) return area;
    areas.push(area.value);
  }
  return ok({ areas });
}

// ── The site's own file ──────────────────────────────────────────────────

/** The `serviceArea` block of the site's content file. */
export function serviceAreaBlock(area: ServiceArea): Record<string, unknown> {
  return { areas: area.areas.map((one) => ({ name: one.name, ...(one.county ? { county: one.county } : {}), ring: one.ring.map(([lon, lat]) => [lon, lat]) })) };
}

/**
 * The service area in a content file. Null when the file has no
 * `serviceArea` block: that site has none to change. An area that can't be
 * read is left out, so a file changed by hand still opens.
 */
export function readServiceArea(json: string): ServiceArea | null {
  let block: unknown;
  try {
    block = (JSON.parse(json) as { serviceArea?: unknown }).serviceArea;
  } catch {
    return null;
  }
  if (!isRecord(block)) return null;
  const list = Array.isArray(block["areas"]) ? (block["areas"] as unknown[]) : [];
  const areas: Area[] = [];
  for (const item of list.slice(0, MAX_AREAS)) {
    if (!isRecord(item)) continue;
    const county = typeof item["county"] === "string" && /^\d{5}$/.test(item["county"]) ? item["county"] : null;
    const ring = cleanRing(item["ring"]);
    const area = ring ? checkArea(line(item["name"]).slice(0, MAX_NAME) || "Area", county, ring) : null;
    if (area?.ok) areas.push(area.value);
  }
  return { areas };
}

export const sameServiceArea = (a: ServiceArea | null, b: ServiceArea | null): boolean => JSON.stringify(a ? serviceAreaBlock(a) : null) === JSON.stringify(b ? serviceAreaBlock(b) : null);

/** "Garrett County, Allegany County and Deep Creek Lake loop". */
export function areaNames(area: ServiceArea): string {
  const names = area.areas.map((one) => one.name);
  if (names.length === 0) return "no areas";
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ── Drawing it ───────────────────────────────────────────────────────────

/** The map's drawing size: the site's own map is drawn in the same box. */
export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 440;

/**
 * Where the map looks: the box around the areas with room to spare, or
 * `fallback` when there are none. `wider` steps further out, each step
 * doubling the room.
 */
export function viewFor(area: ServiceArea, fallback: { west: number; south: number; east: number; north: number }, wider = 0): { west: number; south: number; east: number; north: number } {
  const box = boundsOf(area.areas.flatMap((one) => one.ring)) ?? fallback;
  const grow = 2 ** Math.max(0, Math.min(wider, 3));
  const padX = Math.max((box.east - box.west) * 0.5, 0.45) * grow;
  const padY = Math.max((box.north - box.south) * 0.5, 0.3) * grow;
  return { west: box.west - padX, south: box.south - padY, east: box.east + padX, north: box.north + padY };
}

/**
 * Turns longitudes and latitudes into points in the map's box, and back. A
 * plain projection stretched by the cosine of the middle latitude: at the
 * size of a county or a region, it looks right, and the browser can undo it
 * with the same three numbers.
 */
export type Frame = { readonly west: number; readonly north: number; readonly scale: number; readonly stretch: number; readonly offsetX: number; readonly offsetY: number };

export function frameFor(view: { west: number; south: number; east: number; north: number }): Frame {
  const stretch = Math.cos((((view.north + view.south) / 2) * Math.PI) / 180);
  const wide = (view.east - view.west) * stretch;
  const tall = view.north - view.south;
  const scale = Math.min(MAP_WIDTH / wide, MAP_HEIGHT / tall);
  return { west: view.west, north: view.north, scale, stretch, offsetX: (MAP_WIDTH - wide * scale) / 2, offsetY: (MAP_HEIGHT - tall * scale) / 2 };
}

export const project = (frame: Frame, [lon, lat]: Point): Point => [Math.round((frame.offsetX + (lon - frame.west) * frame.stretch * frame.scale) * 10) / 10, Math.round((frame.offsetY + (frame.north - lat) * frame.scale) * 10) / 10];

export const unproject = (frame: Frame, [x, y]: Point): Point => [round(frame.west + (x - frame.offsetX) / (frame.stretch * frame.scale)), round(frame.north - (y - frame.offsetY) / frame.scale)];

/** An SVG path for outlines, closed. */
export const pathOf = (frame: Frame, rings: readonly (readonly Point[])[]): string =>
  rings
    .filter((ring) => ring.length > 1)
    .map((ring) => `M${ring.map((point) => project(frame, point).join(",")).join("L")}Z`)
    .join("");
