import type { CityMap } from "./map";
import { REAL_MAP_H, REAL_MAP_W } from "./config";
import { parseOverpass } from "./realcity/osmtypes";
import { dominantAngle, toCell, type Frame } from "./realcity/geo";
import { rasterizeArea } from "./realcity/raster";

export interface OsmBbox { s: number; w: number; n: number; e: number }

/** Run-length encode a CityMap (tile in low 3 bits, height/infra in high 5 bits) to base64. */
export function encodeCityMap(m: CityMap): string {
  const n = m.w * m.h;
  const out: number[] = [];
  let prev = (m.tile[0] & 7) | ((m.height[0] & 15) << 3);
  let run = 1;
  for (let i = 1; i < n; i++) {
    const v = (m.tile[i] & 7) | ((m.height[i] & 15) << 3);
    if (v === prev && run < 255) run++;
    else { out.push(run, prev); prev = v; run = 1; }
  }
  out.push(run, prev);
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(out).toString("base64");
}

/** Decode an RLE base64 string into a CityMap synchronously (< 0.5 ms). */
export function decodeCityMap(b64: string, seed: number, w = REAL_MAP_W, h = REAL_MAP_H): CityMap {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const tile = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  let k = 0;
  for (let i = 0; i + 1 < bin.length && k < w * h; i += 2) {
    const run = bin.charCodeAt(i), v = bin.charCodeAt(i + 1);
    const t = v & 7, lv = (v >> 3) & 15;
    for (let j = 0; j < run && k < w * h; j++, k++) {
      tile[k] = t;
      height[k] = lv;
    }
  }
  return { w, h, seed, tile, height };
}

/** 0.36: v2 codec. "v2:<w>x<h>:<base64 gzip(tile plane + height plane)>", so real building heights (up to 255
 *  levels) survive. Async because it uses the platform's (De)CompressionStream; about 50 KB per 650 x 500 area. */
async function gz(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(t));
  return new Uint8Array(await out.arrayBuffer());
}
const b64enc = (u: Uint8Array) => { let bin = ""; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(bin); };
const b64dec = (s: string) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export async function encodeCityMapV2(m: CityMap): Promise<string> {
  const raw = new Uint8Array(m.w * m.h * 2); raw.set(m.tile); raw.set(m.height, m.w * m.h);
  return `v2:${m.w}x${m.h}:` + b64enc(await gz(raw, new CompressionStream("gzip")));
}
export async function decodeCityMapV2(s: string, seed: number): Promise<CityMap> {
  const m = /^v2:(\d+)x(\d+):/.exec(s);
  if (!m) throw new Error("not a v2 city map");
  const w = +m[1], h = +m[2], n = w * h;
  const raw = await gz(b64dec(s.slice(m[0].length)), new DecompressionStream("gzip"));
  if (raw.length !== n * 2) throw new Error(`v2 city map is ${raw.length} bytes, expected ${n * 2}`);
  return { w, h, seed, tile: raw.slice(0, n), height: raw.slice(n) };
}

/** Live geocoding + Overpass fetch for any real place (online only): a 1.3 x 1.0 km battle around it at true 2 m
 *  scale, turned to its street grid (0.36: the same rasterizer as the baked cities; open sea shows only where OSM
 *  has water polygons, since a live capture has no sea points). */
export const LIVE_MAX_BYTES = 60 * 1024 * 1024; // untrusted reply: refuse anything bigger
export async function fetchLiveOsmCity(query: string, seed = 777, f: typeof fetch = fetch): Promise<{ name: string; map: CityMap }> {
  const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const gRes = await f(geoUrl, { headers: { Accept: "application/json" } });
  if (!gRes.ok) throw new Error("Could not look up that place on OpenStreetMap.");
  const places = await gRes.json();
  if (!places || !places.length) throw new Error(`No place found for "${query}".`);
  const lat = parseFloat(places[0].lat), lon = parseFloat(places[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("OpenStreetMap returned a bad location.");
  const name = String(places[0].display_name ?? query).split(",").slice(0, 2).join(",");
  const r = 1120, dLat = r / 111195, dLon = r / (111195 * Math.cos(lat * Math.PI / 180)); // half-diagonal + 300 m
  const x = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  const q = `[out:json][timeout:25];(way["highway"](${x});way["railway"](${x});node["railway"="station"](${x});way["waterway"](${x});` +
    `way["natural"~"^(water|wood|scrub)$"](${x});relation["natural"="water"](${x});way["water"](${x});way["leisure"](${x});way["landuse"](${x});` +
    `way["amenity"="parking"](${x});way["building"](${x}););out body geom;`;
  const oRes = await f("https://overpass-api.de/api/interpreter", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(30000),
  });
  if (!oRes.ok) throw new Error("OpenStreetMap Overpass server is busy; try a built-in real city.");
  const text = await oRes.text();
  if (text.length > LIVE_MAX_BYTES) throw new Error("That place has too much map data to load live; try a smaller place or a built-in real city.");
  const d = parseOverpass(JSON.parse(text), true);
  const probe: Frame = { lat0: lat, lon0: lon, angle: 0, w: 650, h: 500 };
  const roads = d.ways.filter(w => w.tags.highway && w.geom.some(p => { const c = toCell(probe, p); return Math.hypot(c[0] - 325, c[1] - 250) < 350; })).map(w => w.geom);
  const frame = { ...probe, angle: dominantAngle(roads) };
  return { name, map: rasterizeArea(d, { frame, seed, diagonals: [] }) };
}
