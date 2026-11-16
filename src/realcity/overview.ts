// 0.36 real cities: the whole-city map the player picks a battle area on. North-up, the way people know the city,
// coarse (8 m per pixel or more, longer side 900 px): outside, land, built-up, park, water, major road, rail.
import { toLatLon, type Frame, type LatLon } from "./geo";
import type { OsmData } from "./osmtypes";

export const OV_OUT = 0, OV_LAND = 1, OV_BUILT = 2, OV_PARK = 3, OV_WATER = 4, OV_ROAD = 5, OV_RAIL = 6;
export const AREA_W = 650, AREA_H = 500; // battle area in cells
const MAX_SIDE = 900, MIN_M_PER_PX = 8, SHORE_M = 600;
const MLAT = 111195;

export interface Overview { w: number; h: number; mPerPx: number; lat0: number; lon0: number; px: Uint8Array }

const mLon = (lat0: number) => MLAT * Math.cos(lat0 * Math.PI / 180);
export function ovPx(o: Overview, p: LatLon): [number, number] {
  return [o.w / 2 + (p[1] - o.lon0) * mLon(o.lat0) / o.mPerPx, o.h / 2 - (p[0] - o.lat0) * MLAT / o.mPerPx];
}

function scanFill(o: { w: number; h: number }, pts: [number, number][], cb: (i: number) => void) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(o.h - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5; xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + (cy - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(o.w - 1, Math.floor(xs[k + 1] - 0.5)); x++) cb(y * o.w + x);
  }
}
function line(o: Overview, pts: [number, number][], r: number, v: number, keep?: (old: number) => boolean) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let s = 0; s <= n; s++) {
      const cx = ax + (bx - ax) * s / n, cy = ay + (by - ay) * s / n;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(o.h - 1, Math.ceil(cy + r - 1)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(o.w - 1, Math.ceil(cx + r - 1)); x++) {
          const i = y * o.w + x; if (o.px[i] === OV_OUT || (keep && keep(o.px[i]))) continue; o.px[i] = v;
        }
    }
  }
}
const closed = (g: LatLon[]) => g.length >= 4 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];

export function buildOverview(d: OsmData, boundary: LatLon[][], seaPoints: LatLon[]): Overview {
  // Drop distant offshore island rings (> 0.25 deg from the main boundary ring, e.g. Farallon Islands in SF)
  if (boundary.length > 1) {
    const main = boundary.reduce((a, b) => a.length >= b.length ? a : b);
    const mLat = main.reduce((acc, p) => acc + p[0], 0) / main.length, mLon = main.reduce((acc, p) => acc + p[1], 0) / main.length;
    const near = boundary.filter(r => r.some(p => Math.hypot(p[0] - mLat, p[1] - mLon) < 0.25));
    if (near.length) boundary = near;
  }
  let s = 90, n = -90, w = 180, e = -180;
  for (const r of boundary) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const lat0 = (s + n) / 2, lon0 = (w + e) / 2;
  const hm = (n - s) * MLAT + 2 * SHORE_M, wm = (e - w) * mLon(lat0) + 2 * SHORE_M;
  const mPerPx = Math.max(MIN_M_PER_PX, Math.ceil(Math.max(hm, wm) / MAX_SIDE));
  const o: Overview = { w: Math.ceil(wm / mPerPx), h: Math.ceil(hm / mPerPx), mPerPx, lat0, lon0, px: new Uint8Array(0) };
  o.px = new Uint8Array(o.w * o.h);
  const P = (g: LatLon[]) => g.map(p => ovPx(o, p));
  // inside the city limits, plus a SHORE_M margin so the far shore of a boundary river shows
  const inside = new Uint8Array(o.w * o.h);
  for (const r of boundary) scanFill(o, P(r), i => { inside[i] = 1; });
  const grow = Math.round(SHORE_M / mPerPx), dist = new Int32Array(o.w * o.h).fill(-1), q: number[] = [];
  for (let i = 0; i < inside.length; i++) if (inside[i]) { dist[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], x = c % o.w; if (dist[c] >= grow) continue;
    for (const k of [x > 0 ? c - 1 : -1, x < o.w - 1 ? c + 1 : -1, c - o.w, c + o.w]) if (k >= 0 && k < dist.length && dist[k] < 0) { dist[k] = dist[c] + 1; q.push(k); }
  }
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) o.px[i] = OV_LAND;
  const area = (cls: number, test: (t: Record<string, string>) => boolean) => {
    for (const way of d.ways) if (closed(way.geom) && test(way.tags)) scanFill(o, P(way.geom), i => { if (o.px[i] !== OV_OUT) o.px[i] = cls; });
  };
  area(OV_BUILT, t => t.landuse === "residential" || t.landuse === "commercial" || t.landuse === "retail" || t.landuse === "industrial" || !!t.building);
  area(OV_PARK, t => t.leisure === "park" || t.leisure === "garden" || t.leisure === "golf_course" || t.leisure === "stadium" || t.landuse === "grass" || t.landuse === "recreation_ground" || t.natural === "wood" || t.landuse === "cemetery");
  area(OV_WATER, t => !t._inner && (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || !!t.water));
  area(OV_LAND, t => !!t._inner && (t.natural === "water" || t.waterway === "riverbank" || !!t.water));
  for (const way of d.ways) if (way.tags.waterway === "river" && way.tags.tunnel !== "yes") line(o, P(way.geom), Math.max(1, 40 / mPerPx / 2), OV_WATER);
  // sea: coastline walls, flood from the sea points (outside cells count too, so open sea fills)
  if (d.coast.length && seaPoints.length) {
    const wall = new Uint8Array(o.w * o.h), sea = new Uint8Array(o.w * o.h), sq: number[] = [];
    for (const c of d.coast) { const pts = P(c); for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2)); for (let t = 0; t <= k; t++) { const x = Math.floor(ax + (bx - ax) * t / k), y = Math.floor(ay + (by - ay) * t / k); if (x >= 0 && y >= 0 && x < o.w && y < o.h) wall[y * o.w + x] = 1; } } }
    for (const sp of seaPoints) { const [x, y] = ovPx(o, sp).map(Math.floor); if (x >= 0 && y >= 0 && x < o.w && y < o.h && !wall[y * o.w + x]) { sea[y * o.w + x] = 1; sq.push(y * o.w + x); } }
    while (sq.length) { const c = sq.pop()!, x = c % o.w; for (const k of [x > 0 ? c - 1 : -1, x < o.w - 1 ? c + 1 : -1, c - o.w, c + o.w]) if (k >= 0 && k < sea.length && !sea[k] && !wall[k]) { sea[k] = 1; sq.push(k); } }
    for (let i = 0; i < sea.length; i++) if (sea[i] && o.px[i] !== OV_OUT) o.px[i] = OV_WATER;
  }
  for (const way of d.ways) {
    const h = way.tags.highway;
    if ((h === "motorway" || h === "trunk" || h === "primary") && way.tags.tunnel !== "yes") line(o, P(way.geom), 1, OV_ROAD, old => old === OV_WATER && way.tags.bridge !== "yes");
    else if ((way.tags.railway === "rail" || way.tags.railway === "light_rail") && way.tags.tunnel !== "yes" && !way.tags.service) line(o, P(way.geom), 0.5, OV_RAIL, old => old === OV_WATER || old === OV_ROAD);
  }
  return o;
}

export function encodeOverview(o: Overview): string {
  const out: number[] = []; let prev = o.px[0], run = 1;
  for (let i = 1; i < o.px.length; i++) { if (o.px[i] === prev && run < 255) run++; else { out.push(run, prev); prev = o.px[i]; run = 1; } }
  out.push(run, prev);
  let bin = ""; for (let i = 0; i < out.length; i += 8192) bin += String.fromCharCode(...out.slice(i, i + 8192));
  return `ov1:${o.w}:${o.h}:${o.mPerPx}:${o.lat0}:${o.lon0}:` + btoa(bin);
}
export function decodeOverview(s: string): Overview {
  const parts = s.split(":"); if (parts[0] !== "ov1" || parts.length < 7) throw new Error("not an overview");
  const [w, h, mPerPx, lat0, lon0] = parts.slice(1, 6).map(Number), bin = atob(parts.slice(6).join(":"));
  const px = new Uint8Array(w * h); let k = 0;
  for (let i = 0; i + 1 < bin.length && k < px.length; i += 2) { const run = bin.charCodeAt(i), v = bin.charCodeAt(i + 1); px.fill(v, k, Math.min(px.length, k + run)); k += run; }
  return { w, h, mPerPx, lat0, lon0, px };
}

/** The four overview pixels (top-left, top-right, bottom-right, bottom-left of the battle) of an area's turned box. */
export function areaQuad(o: Overview, at: LatLon, angle: number): [number, number][] {
  const f: Frame = { lat0: at[0], lon0: at[1], angle, w: AREA_W, h: AREA_H };
  return ([[0, 0], [AREA_W, 0], [AREA_W, AREA_H], [0, AREA_H]] as [number, number][]).map(c => ovPx(o, toLatLon(f, c)));
}
