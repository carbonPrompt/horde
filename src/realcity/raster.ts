// 0.36 real cities: one battle area from OpenStreetMap data, at true 2 m scale, turned so the street grid is square
// to the screen (design 2026-11-12). Plain data in, CityMap out, deterministic; the browser runs it for live captures.
import { walkable, BRIDGE, CityMap, INFRA_HIGHWAY, INFRA_NONE, INFRA_RAIL, INFRA_STATION, ROAD, BUILDING, PARK, WATER, rng } from "../map";
import { CELL_M } from "../config";
import { toCell, type Frame, type LatLon } from "./geo";
import type { OsmData, OsmWay } from "./osmtypes";

/** Land nothing has claimed yet. Task 4's layers resolve it; it is never walkable. */
export const UNSET = 7;
export interface RasterOpts { frame: Frame; seed: number; diagonals: string[]; seaPoints?: LatLon[] }

export const SNAP_DEG = 20; // a way within this of an axis is drawn as one straight axis run
/** A way snaps only when it is nearly straight: no point strays more than STRAY cells from its end-to-end line. */
export const STRAY = 6;
function straight(pts: [number, number][]) {
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay);
  if (L < 1) return false;
  return pts.every(([x, y]) => Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L <= STRAY);
}
export const EXTEND = 4; // straightened ways reach this far past their ends so cross streets meet
const LANDISH = [UNSET, BUILDING, PARK, ROAD];
export const MAX_BLOCK = 6000; // cells (2.4 ha); bigger unbuilt land holding an OPEN_R square is open country, never filled
export const OPEN_R = 30; // half-side in cells of the unclaimed square (120 m) that makes land open country, not blocks merged by a thin strip
const MAX_RIVER_M = 300;
const SMALL_COMPONENT = 200, JOIN_REACH = 40, JOIN_W = 4;

/** True width in cells (rounded up), at least 4 so big units fit; 0 = not drawn as a road. */
export function roadWidth(t: Record<string, string>): number {
  switch (t.highway) {
    case "motorway": case "trunk": case "motorway_link": case "trunk_link": return 12;
    case "primary": case "primary_link": return 8;
    case "secondary": case "secondary_link": return 7;
    case "tertiary": case "tertiary_link": return 6;
    case "residential": case "unclassified": case "living_street": case "road": return 5;
    case "service": return 4;
    default: return 0;
  }
}
const isPath = (t: Record<string, string>) => t.highway === "pedestrian" || t.highway === "footway" || t.highway === "path" || t.highway === "cycleway";
const isBridge = (t: Record<string, string>) => t.bridge === "yes" || t.bridge === "movable" || t.bridge === "viaduct" || t.bridge === "bascule" || t.bridge === "drawbridge" || t.bridge === "Lift_bridge";
function skip(t: Record<string, string>) {
  return t.tunnel === "yes" || t.tunnel === "building_passage" || t.highway === "steps" || t.area === "yes" || t.access === "private" || t.layer?.startsWith("-");
}
const wayLenM = (w: OsmWay) => { let s = 0; for (let i = 1; i < w.geom.length; i++) { const k = Math.cos(w.geom[i][0] * Math.PI / 180); s += Math.hypot((w.geom[i][0] - w.geom[i - 1][0]) * 111195, (w.geom[i][1] - w.geom[i - 1][1]) * 111195 * k); } return s; };

/** The street layer alone (blank land stays UNSET): what rasterizeArea draws its roads with. */
export function rasterRoads(d: OsmData, o: RasterOpts): CityMap {
  const { w, h } = o.frame;
  const m: CityMap = { w, h, seed: o.seed, tile: new Uint8Array(w * h).fill(UNSET), height: new Uint8Array(w * h) };
  drawRoads(m, d, o); edgeRing(m); joinComponents(m);
  return m;
}

export function rasterizeArea(d: OsmData, o: RasterOpts): CityMap {
  const { w, h } = o.frame;
  const tile = new Uint8Array(w * h).fill(UNSET), height = new Uint8Array(w * h);
  const m: CityMap = { w, h, seed: o.seed, tile, height };
  const lu = landuse(m, d, o.frame);
  drawWater(m, d, o);
  drawParks(m, d, o.frame);
  const bld = drawBuildings(m, d, o.frame);
  drawRoads(m, d, o);
  drawRail(m, d, o.frame);
  const open = fillBlocks(m, lu, bld, o.seed);
  // leftover land reads as ground (PARK): open country, grass, yards; only commercial/industrial blocks are paved (ROAD)
  for (let i = 0; i < tile.length; i++) if (tile[i] === UNSET) { tile[i] = lu[i] === LU_COM || lu[i] === LU_IND ? (open[i] ? PARK : ROAD) : PARK; height[i] = 0; }
  edgeRing(m);
  joinComponents(m);
  joinLand(m);
  return m;
}

/** Fill an axis rect (inclusive bounds, clipped). `only` = overwrite only these tiles. */
function fill(m: CityMap, x0: number, y0: number, x1: number, y1: number, t: number, inf: number, only?: number[]) {
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(m.w - 1, Math.max(x0, x1));
  const ay = Math.max(0, Math.min(y0, y1)), by = Math.min(m.h - 1, Math.max(y0, y1));
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const i = y * m.w + x;
    if (only && !only.includes(m.tile[i])) continue;
    m.tile[i] = t; m.height[i] = inf;
  }
}
/** A horizontal or vertical street of width `wd` centred on the line. */
function hRun(m: CityMap, xa: number, xb: number, yc: number, wd: number, t: number, inf: number, only?: number[]) {
  const y0 = Math.round(yc) - (wd >> 1); fill(m, Math.round(Math.min(xa, xb)), y0, Math.round(Math.max(xa, xb)), y0 + wd - 1, t, inf, only);
}
function vRun(m: CityMap, ya: number, yb: number, xc: number, wd: number, t: number, inf: number, only?: number[]) {
  const x0 = Math.round(xc) - (wd >> 1); fill(m, x0, Math.round(Math.min(ya, yb)), x0 + wd - 1, Math.round(Math.max(ya, yb)), t, inf, only);
}

function drawRoads(m: CityMap, d: OsmData, o: RasterOpts) {
  const f = o.frame;
  const ways = d.ways.filter(w => w.tags.highway && !skip(w.tags) && w.geom.length >= 2);
  // paths first (only onto open land), then roads, then bridges on top
  const order = (w: OsmWay) => isPath(w.tags) ? 0 : isBridge(w.tags) ? 2 : 1;
  ways.sort((a, b) => order(a) - order(b) || a.id - b.id);
  for (const way of ways) {
    const t = way.tags, path = isPath(t), wd = path ? 3 : roadWidth(t);
    if (!wd) continue;
    if (t.highway === "service" && wayLenM(way) < 60) continue;
    const tileT = path ? PARK : isBridge(t) ? BRIDGE : ROAD;
    const inf = path ? 0 : roadWidth(t) === 12 ? INFRA_HIGHWAY : INFRA_NONE;
    const only = path ? [UNSET] : tileT === BRIDGE ? undefined : LANDISH;
    const pts = way.geom.map(p => toCell(f, p));
    if (!path && t.name && o.diagonals.includes(t.name)) { thickLine(m, pts, wd + 2, tileT, inf); continue; }
    const first = pts[0], last = pts[pts.length - 1];
    let ang = Math.abs(Math.atan2(last[1] - first[1], last[0] - first[0]) * 180 / Math.PI) % 180; // 0..180
    const offH = Math.min(ang, 180 - ang), offV = Math.abs(90 - ang);
    if (Math.min(offH, offV) <= SNAP_DEG && straight(pts)) {
      // one straight run at the length-weighted mean of the cross coordinate
      const horiz = offH <= offV;
      let sum = 0, len = 0, lo = Infinity, hi = -Infinity;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        sum += l * (horiz ? pts[i][1] + pts[i - 1][1] : pts[i][0] + pts[i - 1][0]) / 2; len += l;
      }
      for (const p of pts) { const a = horiz ? p[0] : p[1]; lo = Math.min(lo, a); hi = Math.max(hi, a); }
      const c = len ? sum / len : horiz ? first[1] : first[0];
      if (horiz) hRun(m, lo - EXTEND, hi + EXTEND, c, wd, tileT, inf, only);
      else vRun(m, lo - EXTEND, hi + EXTEND, c, wd, tileT, inf, only);
    } else {
      // leftover angled street: true to shape and clean (the 8-cell lattice steps read as staircases, Castle Rock bake)
      thickLine(m, pts, wd, tileT, inf, only);
    }
  }
}

/** A famous diagonal: discs of diameter `dia` every half cell along it, so it has no pinch and no staircase. */
function thickLine(m: CityMap, pts: [number, number][], dia: number, t: number, inf: number, only?: number[]) {
  const r = dia / 2, r2 = r * r;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let s = 0; s <= steps; s++) {
      const cx = ax + (bx - ax) * s / steps, cy = ay + (by - ay) * s / steps;
      if (cx + r < 0 || cy + r < 0 || cx - r >= m.w || cy - r >= m.h) continue;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
        const k = y * m.w + x;
        if (only ? !only.includes(m.tile[k]) : t === ROAD && (m.tile[k] === BRIDGE || m.tile[k] === WATER)) continue;
        m.tile[k] = t; m.height[k] = inf;
      }
    }
  }
}

/** The 2-cell map edge is walkable so edge waves can always come in (water stays water). */
function edgeRing(m: CityMap) {
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (x > 1 && y > 1 && x < m.w - 2 && y < m.h - 2) continue;
    const i = y * m.w + x;
    if (m.tile[i] === UNSET || m.tile[i] === BUILDING) { m.tile[i] = ROAD; m.height[i] = INFRA_NONE; }
  }
}

const roadish = (t: number) => t === ROAD || t === BRIDGE;
function components(m: CityMap): Int32Array {
  const lab = new Int32Array(m.w * m.h).fill(-1); let n = 0;
  for (let i = 0; i < lab.length; i++) {
    if (lab[i] >= 0 || !roadish(m.tile[i])) continue;
    const q = [i]; lab[i] = n;
    while (q.length) {
      const c = q.pop()!, x = c % m.w;
      for (const k of [x > 0 ? c - 1 : -1, x < m.w - 1 ? c + 1 : -1, c - m.w, c + m.w])
        if (k >= 0 && k < lab.length && lab[k] < 0 && roadish(m.tile[k])) { lab[k] = n; q.push(k); }
    }
    n++;
  }
  return lab;
}

/** Road fragments under SMALL_COMPONENT cells join the biggest network by an axis L (or go, if it's too far). */
function joinComponents(m: CityMap) {
  const lab = components(m), size = new Map<number, number>();
  for (const l of lab) if (l >= 0) size.set(l, (size.get(l) ?? 0) + 1);
  let main = -1, best = 0;
  for (const [l, s] of size) if (s > best) { best = s; main = l; }
  if (main < 0) return;
  for (const [l, s] of size) {
    if (l === main || s >= SMALL_COMPONENT) continue;
    // nearest main-network cell within JOIN_REACH (Chebyshev rings out from the fragment's cells)
    const cells: number[] = []; for (let i = 0; i < lab.length; i++) if (lab[i] === l) cells.push(i);
    let found: [number, number, number] | null = null; // from cell, to cell, distance
    for (const c of cells) {
      const cx = c % m.w, cy = (c / m.w) | 0;
      for (let r = 1; r <= JOIN_REACH && (!found || r < found[2]); r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
          if (lab[y * m.w + x] === main && (!found || r < found[2])) found = [c, y * m.w + x, r];
        }
      }
    }
    if (found) {
      const ax = found[0] % m.w, ay = (found[0] / m.w) | 0, bx = found[1] % m.w, by = (found[1] / m.w) | 0;
      hRun(m, ax, bx, ay, JOIN_W, ROAD, INFRA_NONE, [UNSET, BUILDING, PARK]);
      vRun(m, ay, by, bx, JOIN_W, ROAD, INFRA_NONE, [UNSET, BUILDING, PARK]);
    } else for (const c of cells) { m.tile[c] = UNSET; m.height[c] = 0; }
  }
}

// ---- Task 4: water, parks, buildings with real heights, the block filler, rail

const LU_NONE = 0, LU_RES = 1, LU_COM = 2, LU_IND = 3, LU_GRASS = 4;
const closed = (g: LatLon[]) => g.length >= 4 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];

/** Cells whose centres fall inside a polygon (even-odd scanline), clipped to the map. */
export function polyCells(m: CityMap, pts: [number, number][], cb: (i: number) => void) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(m.h - 1, Math.ceil(y1));
  const xs: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const cy = y + 0.5; xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + (cy - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(m.w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) cb(y * m.w + x);
    }
  }
}
const polyOf = (f: Frame, g: LatLon[]) => g.map(p => toCell(f, p));
/** Rough in-frame test so far-away features (the 1 km fetch buffer) cost nothing. */
const near = (m: CityMap, pts: [number, number][]) => pts.some(p => p[0] > -50 && p[1] > -50 && p[0] < m.w + 50 && p[1] < m.h + 50) ||
  (() => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x0 < m.w && x1 > 0 && y0 < m.h && y1 > 0; })(); // loops, not spreads: a 100k-point ring overflowed the argument list

function landuse(m: CityMap, d: OsmData, f: Frame): Uint8Array {
  const lu = new Uint8Array(m.w * m.h);
  const kind = (t: Record<string, string>) => t.landuse === "residential" ? LU_RES : t.landuse === "commercial" || t.landuse === "retail" ? LU_COM :
    t.landuse === "industrial" ? LU_IND : t.landuse === "grass" || t.landuse === "meadow" || t.landuse === "village_green" ? LU_GRASS : LU_NONE;
  for (const w of d.ways) {
    const k = kind(w.tags); if (!k || !closed(w.geom)) continue;
    const pts = polyOf(f, w.geom); if (!near(m, pts)) continue;
    polyCells(m, pts, i => { lu[i] = k; });
  }
  return lu;
}

function drawWater(m: CityMap, d: OsmData, o: RasterOpts) {
  const f = o.frame, set = (i: number) => { m.tile[i] = WATER; m.height[i] = 0; };
  for (const w of d.ways) {
    const t = w.tags; if (t._inner) continue;
    const area = t.natural === "water" || t.waterway === "riverbank" || t.waterway === "dock" || t.landuse === "reservoir" || t.landuse === "basin" || (t.water && t.natural !== "wetland");
    if (area && closed(w.geom)) { const pts = polyOf(f, w.geom); if (near(m, pts)) polyCells(m, pts, set); continue; }
    if (t.waterway === "river" || t.waterway === "canal") {
      const tw = parseFloat(t.width), wm = Math.min(MAX_RIVER_M, Number.isFinite(tw) && tw > 0 ? tw : t.waterway === "river" ? 40 : 15); // untrusted tag: clamp
      if (wm > 10 && !t.tunnel && !t.layer?.startsWith("-")) { const pts = polyOf(f, w.geom); if (near(m, pts)) thickLine(m, pts, wm / CELL_M, WATER, 0); }
    }
  }
  // Carve multipolygon inner rings back to land when they are bridged urban islands (have non-bridge surface streets inside, e.g. Ile de la Cite)
  const hasRoad = new Uint8Array(m.w * m.h);
  for (const rw of d.ways) if (roadWidth(rw.tags) > 0 && !isBridge(rw.tags) && !skip(rw.tags))
    for (const [x, y] of polyOf(f, rw.geom)) if (x >= 0 && y >= 0 && x < m.w && y < m.h) hasRoad[Math.floor(y) * m.w + Math.floor(x)] = 1;
  for (const w of d.ways) if (w.tags._inner && closed(w.geom)) {
    const pts = polyOf(f, w.geom); if (!near(m, pts)) continue;
    const cells: number[] = []; polyCells(m, pts, i => cells.push(i));
    if (cells.some(i => hasRoad[i])) for (const i of cells) { m.tile[i] = UNSET; m.height[i] = 0; }
  }
  if (!d.coast.length || !o.seaPoints?.length) return;
  // the coastline as a 1-cell wall, then flood the sea from each sea point that lands in the frame
  const wall = new Uint8Array(m.w * m.h);
  for (const c of d.coast) {
    const pts = polyOf(f, c);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let s = 0; s <= n; s++) { const x = Math.floor(ax + (bx - ax) * s / n), y = Math.floor(ay + (by - ay) * s / n); if (x >= 0 && y >= 0 && x < m.w && y < m.h) wall[y * m.w + x] = 1; }
    }
  }
  const sea = new Uint8Array(m.w * m.h), q: number[] = [];
  for (const sp of o.seaPoints) {
    const [x, y] = toCell(f, sp).map(Math.floor);
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    const i = y * m.w + x; if (!wall[i] && !sea[i]) { sea[i] = 1; q.push(i); }
  }
  while (q.length) {
    const c = q.pop()!, x = c % m.w;
    for (const k of [x > 0 ? c - 1 : -1, x < m.w - 1 ? c + 1 : -1, c - m.w, c + m.w])
      if (k >= 0 && k < sea.length && !sea[k] && !wall[k]) { sea[k] = 1; q.push(k); }
  }
  for (let i = 0; i < sea.length; i++) {
    if (sea[i]) set(i);
    else if (wall[i]) { const x = i % m.w; if ((x > 0 && sea[i - 1]) || (x < m.w - 1 && sea[i + 1]) || sea[i - m.w] || sea[i + m.w]) set(i); }
  }
}

function drawParks(m: CityMap, d: OsmData, f: Frame) {
  for (const w of d.ways) {
    const t = w.tags; if (!closed(w.geom)) continue;
    const park = t.leisure === "park" || t.leisure === "garden" || t.leisure === "pitch" || t.leisure === "golf_course" || t.leisure === "playground" ||
      t.landuse === "grass" || t.landuse === "recreation_ground" || t.landuse === "village_green" || t.natural === "wood" || t.natural === "scrub" || t.landuse === "forest" || t.landuse === "cemetery";
    const stadium = t.leisure === "stadium", parking = t.amenity === "parking";
    if (!park && !stadium && !parking) continue;
    const pts = polyOf(f, w.geom); if (!near(m, pts)) continue;
    const ok = (i: number) => m.tile[i] !== WATER;
    if (parking) { polyCells(m, pts, i => { if (ok(i)) { m.tile[i] = ROAD; m.height[i] = 0; } }); continue; }
    if (!stadium) { polyCells(m, pts, i => { if (ok(i)) { m.tile[i] = PARK; m.height[i] = 0; } }); continue; }
    // stadium: the field (inner 60% of the area) is open, the rim is 3-level stands
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    const inner = pts.map(p => [cx + (p[0] - cx) * 0.77, cy + (p[1] - cy) * 0.77] as [number, number]);
    polyCells(m, pts, i => { if (ok(i)) { m.tile[i] = BUILDING; m.height[i] = 3; } });
    polyCells(m, inner, i => { if (ok(i)) { m.tile[i] = PARK; m.height[i] = 0; } });
  }
}

/** Levels from OSM tags: building:levels, else height / 3.5 m, else by building type; null = unknown. 1..120. */
export function buildingLevels(t: Record<string, string>): number | null {
  const clamp = (v: number) => Math.max(1, Math.min(120, Math.round(v)));
  const lv = parseFloat(t["building:levels"]); if (lv > 0) return clamp(lv);
  const hm = parseFloat(t.height); if (hm > 0) return clamp(hm / 3.5);
  switch (t.building) {
    case "house": case "detached": case "terrace": case "residential": case "semidetached_house": case "bungalow": return 2;
    case "apartments": return 5;
    case "commercial": case "office": case "retail": case "hotel": return 4;
    case "industrial": case "warehouse": case "garage": case "garages": case "shed": return 2;
    case "church": case "cathedral": return 4;
    case undefined: case "yes": return null;
    default: return 3;
  }
}

/** Building footprints with their levels. Returns the OSM building centres (cells) for the block filler. */
function drawBuildings(m: CityMap, d: OsmData, f: Frame): [number, number][] {
  const list: { cells: number[]; lv: number | null; c: [number, number] }[] = [];
  for (const w of d.ways) {
    if (!w.tags.building || w.tags.building === "no" || !closed(w.geom)) continue;
    const pts = polyOf(f, w.geom); if (!near(m, pts)) continue;
    const cells: number[] = []; polyCells(m, pts, i => { if (m.tile[i] !== WATER) cells.push(i); });
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; }
    list.push({ cells, lv: buildingLevels(w.tags), c: [cx / pts.length, cy / pts.length] });
  }
  // unknown levels: median of known buildings within 150 m (75 cells) when there are 5+, else 3
  const R = 150 / CELL_M, B = Math.ceil(R), grid = new Map<string, number[]>();
  list.forEach((b, k) => { if (b.lv !== null) { const key = `${Math.floor(b.c[0] / B)},${Math.floor(b.c[1] / B)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); } });
  for (const b of list) {
    if (b.lv !== null) continue;
    const gx = Math.floor(b.c[0] / B), gy = Math.floor(b.c[1] / B), lvs: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const k of grid.get(`${gx + dx},${gy + dy}`) ?? [])
      if (Math.hypot(list[k].c[0] - b.c[0], list[k].c[1] - b.c[1]) <= R) lvs.push(list[k].lv!);
    lvs.sort((a, c) => a - c);
    b.lv = lvs.length >= 5 ? lvs[lvs.length >> 1] : 3;
  }
  // paint; two small footprints (under 30 cells) that touch keep a one-cell gap so terraces don't melt together
  const id = new Int32Array(m.w * m.h), small = (k: number) => list[k - 1].cells.length < 30;
  list.forEach((b, k0) => {
    const k = k0 + 1;
    for (const i of b.cells) {
      if (small(k)) {
        const x = i % m.w; let clash = false;
        for (const n of [x > 0 ? i - 1 : -1, x < m.w - 1 ? i + 1 : -1, i - m.w, i + m.w]) if (n >= 0 && n < id.length && id[n] && id[n] !== k && small(id[n])) clash = true;
        if (clash) continue;
      }
      id[i] = k; m.tile[i] = BUILDING; m.height[i] = b.lv!;
    }
  });
  return list.map(b => b.c);
}

/** Railways (not in tunnels, not yards) true to shape, 3 cells wide; stations as a strip along the nearest rail. */
function drawRail(m: CityMap, d: OsmData, f: Frame) {
  for (const w of d.ways) {
    const t = w.tags;
    if (!(t.railway === "rail" || t.railway === "light_rail" || t.railway === "subway") || t.tunnel === "yes" || t.service || t.layer?.startsWith("-")) continue;
    const pts = polyOf(f, w.geom); if (!near(m, pts)) continue;
    const bridge = t.bridge === "yes", r = 1.5;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let s = 0; s <= n; s++) {
        const cx = ax + (bx - ax) * s / n, cy = ay + (by - ay) * s / n;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (x < 0 || y < 0 || x >= m.w || y >= m.h || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
          const k = y * m.w + x;
          if (m.tile[k] === WATER && !bridge) continue;
          m.tile[k] = bridge || m.tile[k] === BRIDGE || m.tile[k] === WATER ? BRIDGE : ROAD; m.height[k] = INFRA_RAIL;
        }
      }
    }
  }
  const rail = (k: number) => (m.tile[k] === ROAD || m.tile[k] === BRIDGE) && m.height[k] === INFRA_RAIL;
  for (const nd of d.nodes) {
    if (nd.tags.railway !== "station") continue;
    const [sx, sy] = toCell(f, nd.at).map(Math.round);
    let best = -1, bd = 21;
    for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
      const x = sx + dx, y = sy + dy; if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const dd = Math.hypot(dx, dy); if (dd < bd && rail(y * m.w + x)) { bd = dd; best = y * m.w + x; }
    }
    if (best < 0) continue;
    const bx = best % m.w, by = (best / m.w) | 0;
    let hz = 0, vt = 0; for (let k = -5; k <= 5; k++) { if (bx + k >= 0 && bx + k < m.w && rail(by * m.w + bx + k)) hz++; if (by + k >= 0 && by + k < m.h && rail((by + k) * m.w + bx)) vt++; }
    const along = hz >= vt;
    for (let a = -4; a < 4; a++) for (let c = -1; c <= 1; c++) {
      const x = bx + (along ? a : c), y = by + (along ? c : a); if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const k = y * m.w + x; if (m.tile[k] === WATER) continue;
      if (m.tile[k] !== BRIDGE) m.tile[k] = ROAD; m.height[k] = INFRA_STATION;
    }
  }
}

/** Thin OSM data: a street block (connected unclaimed or building land) with under 10% building cover that should be
 *  built up gets seeded lots (8 to 14 cells, 1-cell gaps), levels by land use. */
function fillBlocks(m: CityMap, lu: Uint8Array, osmBuildings: [number, number][], seed: number): Uint8Array {
  const r = rng(seed ^ 0x5eed), seen = new Uint8Array(m.w * m.h), open = new Uint8Array(m.w * m.h);
  const blockish = (t: number) => t === UNSET || t === BUILDING;
  for (let s0 = 0; s0 < seen.length; s0++) {
    if (seen[s0] || !blockish(m.tile[s0])) continue;
    const cells: number[] = [s0]; seen[s0] = 1;
    for (let qi = 0; qi < cells.length; qi++) {
      const c = cells[qi], x = c % m.w;
      for (const k of [x > 0 ? c - 1 : -1, x < m.w - 1 ? c + 1 : -1, c - m.w, c + m.w])
        if (k >= 0 && k < seen.length && !seen[k] && blockish(m.tile[k])) { seen[k] = 1; cells.push(k); }
    }
    if (cells.length < 60) continue;
    const touchesWater = cells.some(c => { const x = c % m.w; return (x > 0 && m.tile[c - 1] === WATER) || (x < m.w - 1 && m.tile[c + 1] === WATER) || m.tile[c - m.w] === WATER || m.tile[c + m.w] === WATER; });
    if (cells.length > MAX_BLOCK && (hasOpenSquare(m, cells) || (touchesWater && osmBuildings.length > 100))) { for (const c of cells) open[c] = 1; continue; } // open country or beach/shoreline, not a street block
    let bld = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, cx = 0, cy = 0;
    const votes = [0, 0, 0, 0, 0];
    for (const c of cells) {
      const x = c % m.w, y = (c / m.w) | 0;
      if (m.tile[c] === BUILDING) bld++;
      votes[lu[c]]++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); cx += x; cy += y;
    }
    if (bld / cells.length >= 0.1) continue;
    cx /= cells.length; cy /= cells.length;
    let use = 1; for (let k = 2; k < 5; k++) if (votes[k] > votes[use]) use = k;
    if (votes[use] < cells.length * 0.5) use = LU_NONE;
    if (use === LU_GRASS) continue;
    if (use === LU_NONE && osmBuildings.filter(b => Math.hypot(b[0] - cx, b[1] - cy) <= 100).length < 3) continue;
    const lv = use === LU_COM ? 3 : 2;
    const inBlock = new Set(cells);
    for (let y = y0 + 1; y <= y1 - 1;) {
      const lh = 8 + Math.floor(r() * 7);
      for (let x = x0 + 1; x <= x1 - 1;) {
        const lw = 8 + Math.floor(r() * 7);
        for (let yy = y; yy < Math.min(y + lh - 1, y1); yy++) for (let xx = x; xx < Math.min(x + lw - 1, x1); xx++) {
          const k = yy * m.w + xx;
          if (inBlock.has(k) && m.tile[k] === UNSET) { m.tile[k] = BUILDING; m.height[k] = lv; }
        }
        x += lw;
      }
      y += lh;
    }
  }
  return open;
}

/** Does this region hold a (2 * OPEN_R) square of unclaimed land? (chessboard distance transform inside the region) */
function hasOpenSquare(m: CityMap, cells: number[]): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of cells) { const x = c % m.w, y = (c / m.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = x1 - x0 + 3, H = y1 - y0 + 3, d = new Int32Array(W * H);
  for (const c of cells) { const x = c % m.w, y = (c / m.w) | 0; if (m.tile[c] === UNSET) d[(y - y0 + 1) * W + x - x0 + 1] = 1 << 20; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (d[i]) d[i] = Math.min(d[i], d[i - 1] + 1, d[i - W] + 1, d[i - W - 1] + 1, d[i - W + 1] + 1); }
  for (let y = H - 2; y >= 1; y--) for (let x = W - 2; x >= 1; x--) { const i = y * W + x; if (d[i]) { d[i] = Math.min(d[i], d[i + 1] + 1, d[i + W] + 1, d[i + W + 1] + 1, d[i + W - 1] + 1); if (d[i] >= OPEN_R) return true; } }
  return false;
}

/** Walkable pockets cut off from the main land (a courtyard park, a sliver past a fence of buildings) would strand
 *  people: join each one under SMALL_LAND cells to the main land by a 3-wide L (bridging water), or, if the main land
 *  is over JOIN_REACH away, make it rooftop (BUILDING, 1 level). Bigger separate land is left for checkArea to report. */
export const SMALL_LAND = 3000;
export function joinLand(m: CityMap) {
  const lab = new Int32Array(m.w * m.h).fill(-1), sizes: number[] = [];
  for (let s0 = 0; s0 < lab.length; s0++) {
    if (lab[s0] >= 0 || !walkable(m.tile[s0])) continue;
    const id = sizes.length, q = [s0]; lab[s0] = id;
    for (let qi = 0; qi < q.length; qi++) { const c = q[qi], x = c % m.w; for (const k of [x > 0 ? c - 1 : -1, x < m.w - 1 ? c + 1 : -1, c - m.w, c + m.w]) if (k >= 0 && k < lab.length && lab[k] < 0 && walkable(m.tile[k])) { lab[k] = id; q.push(k); } }
    sizes.push(q.length);
  }
  let main = 0; sizes.forEach((v, i) => { if (v > sizes[main]) main = i; });
  const cellsOf = new Map<number, number[]>();
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && lab[i] !== main && sizes[lab[i]] < 10000) (cellsOf.get(lab[i]) ?? cellsOf.set(lab[i], []).get(lab[i])!).push(i);
  for (const [id, cells] of cellsOf) {
    let found: [number, number, number] | null = null;
    for (const c of cells) {
      const cx = c % m.w, cy = (c / m.w) | 0;
      for (let r = 1; r <= JOIN_REACH && (!found || r < found[2]); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        if (lab[y * m.w + x] === main && (!found || r < found[2])) found = [c, y * m.w + x, r];
      }
    }
    if (!found) { if (sizes[id] < SMALL_LAND) for (const c of cells) { m.tile[c] = BUILDING; m.height[c] = 1; } continue; }
    const ax = found[0] % m.w, ay = (found[0] / m.w) | 0, bx = found[1] % m.w, by = (found[1] / m.w) | 0;
    if (sizes[id] >= SMALL_LAND) {
      // 3000..6000 cells: only join enclosed inland courtyards/stadium bowls (never cross water)
      let crossesWater = false;
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) if (m.tile[ay * m.w + x] === WATER) crossesWater = true;
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) if (m.tile[y * m.w + bx] === WATER) crossesWater = true;
      if (crossesWater) continue;
    }
    const pave = (x: number, y: number) => { if (x < 0 || y < 0 || x >= m.w || y >= m.h) return; const k = y * m.w + x; if (walkable(m.tile[k])) return; m.tile[k] = m.tile[k] === WATER ? BRIDGE : ROAD; m.height[k] = INFRA_NONE; };
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) for (let d = -1; d <= 1; d++) pave(x, ay + d);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let d = -1; d <= 1; d++) pave(bx + d, y);
  }
}
