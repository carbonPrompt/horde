// What the capture tool fetches for a city: cache paths and Overpass queries (shared by fetch.ts and bake.ts).
import { homedir } from "node:os";
import { join } from "node:path";
import type { LatLon } from "../../src/realcity/geo";
import type { AreaSpec, CitySpec } from "../../src/realcity/catalogue";
import { AREA_H, AREA_W } from "../../src/realcity/overview";

export const CACHE = process.env.HORDE_OSM_CACHE ?? join(homedir(), ".cache", "horde-osm");
export const cityDir = (c: CitySpec) => join(CACHE, c.id);
export const TILE_DEG = 0.25, AREA_BUFFER_M = 1000;

type BBox = { s: number; w: number; n: number; e: number };
const bstr = (b: BBox) => `${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)}`;

export function boundaryQuery(rel: number) { return `[out:json][timeout:180];rel(${rel});out geom;`; }

export function overviewQuery(b: BBox) {
  const x = bstr(b);
  // 2026-11-14: single-tag indexed lookups only (no double-tag or regex scans) so Overpass answers in 1-3 s
  return `[out:json][timeout:60];(` +
    `way["natural"="coastline"](${x});way["waterway"="river"](${x});way["waterway"="riverbank"](${x});` +
    `way["highway"="motorway"](${x});way["highway"="trunk"](${x});` +
    `);out geom;`;
}

/** The area's box: its half-diagonal plus `buffer` m (roads, water and land use need the surroundings; buildings don't). */
export function areaBBox(a: AreaSpec, buffer = AREA_BUFFER_M): BBox {
  const r = Math.hypot(AREA_W, AREA_H) / 2 * 2 + buffer; // half-diagonal in m (2 m cells) + buffer
  const dLat = r / 111195, dLon = r / (111195 * Math.cos(a.at[0] * Math.PI / 180));
  return { s: a.at[0] - dLat, n: a.at[0] + dLat, w: a.at[1] - dLon, e: a.at[1] + dLon };
}

/** Everything but buildings, over the buffered box. */
export function areaQuery(b: BBox) {
  const x = bstr(b);
  return `[out:json][timeout:180];(` +
    `way["highway"](${x});way["railway"](${x});node["railway"="station"](${x});` +
    `way["waterway"](${x});way["natural"="water"](${x});way["natural"="coastline"](${x});way["natural"="wood"](${x});way["natural"="scrub"](${x});way["water"](${x});` +
    `relation["natural"="water"](${x});relation["waterway"="riverbank"](${x});` +
    `way["leisure"](${x});relation["leisure"="park"](${x});relation["leisure"="stadium"](${x});` +
    `way["landuse"](${x});relation["landuse"](${x});way["amenity"="parking"](${x});` +
    `);out geom;`;
}
export const BUILDING_BUFFER_M = 60;
/** Buildings only, over the area's own box (a tenth of the data of the buffered box). */
export function buildingQuery(b: BBox) {
  const x = bstr(b);
  return `[out:json][timeout:180];(way["building"](${x}););out geom;`;
}

export function tiles(b: BBox): BBox[] {
  const out: BBox[] = [];
  for (let s = Math.floor(b.s / TILE_DEG) * TILE_DEG; s < b.n; s += TILE_DEG)
    for (let w = Math.floor(b.w / TILE_DEG) * TILE_DEG; w < b.e; w += TILE_DEG)
      out.push({ s: +s.toFixed(4), w: +w.toFixed(4), n: +(s + TILE_DEG).toFixed(4), e: +(w + TILE_DEG).toFixed(4) });
  return out;
}

export function ringsBBox(rings: LatLon[][]): BBox {
  let s = 90, n = -90, w = 180, e = -180;
  for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const pad = 0.01; return { s: s - pad, n: n + pad, w: w - pad, e: e + pad };
}
