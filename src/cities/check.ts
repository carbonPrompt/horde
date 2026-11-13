// 0.35: measures a built city against the campaign rules (design 2026-11-12): water, grid streets, one land mass,
// ways in on two sides, and stand points with open ground, rooftops and a street wide enough for big units.
import { BRIDGE, BUILDING, CityMap, PARK, ROAD, WATER, walkable } from "../map";
import { Sim } from "../sim";
import type { CityRecipe } from "./recipe";

export interface StandReport { name: string; ok: boolean; open: number; roofs: number; wideStreet: boolean; why: string[] }
export interface CityReport { waterFrac: number; diagonalRuns: number; landComponents: number; entryEdges: number; entries: number; stands: StandReport[] }

export const STAND_OPEN = 900; // PARK/ROAD cells within r (3,600 m2 of gathering ground)
export const STAND_ROOFS = 40; // BUILDING cells of 3+ levels within r + 12
export const WIDE = 4, WIDE_LEN = 12; // a street 4 cells wide (a tank or HIMARS) for 12 cells
const MIN_COMPONENT = 30;

const roadish = (t: number) => t === ROAD || t === BRIDGE;

/** Road cells with no road beside them but road on a corner: a diagonal step. */
export function diagonalRuns(m: CityMap): number {
  const { w, h, tile } = m;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && roadish(tile[y * w + x]);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) continue;
    if (at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1)) n++;
  }
  return n;
}

/** Land components (4-way through walkable cells); returns the label grid (-1 = none) and the main label. */
function components(m: CityMap) {
  const { w, h, tile } = m, lab = new Int32Array(w * h).fill(-1), sizes: number[] = [], q = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (lab[s] !== -1 || !walkable(tile[s])) continue;
    const id = sizes.length; let qh = 0, qt = 0; q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const c = q[qh++], cx = c % w;
      for (const n of [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, c - w, c + w]) {
        if (n < 0 || n >= w * h || lab[n] !== -1 || !walkable(tile[n])) continue;
        lab[n] = id; q[qt++] = n;
      }
    }
    sizes.push(qt);
  }
  let main = 0; sizes.forEach((v, i) => { if (v > sizes[main]) main = i; });
  return { lab, main, count: sizes.filter(v => v >= MIN_COMPONENT).length };
}

/** Cells that start a WIDE x WIDE_LEN all-road band, horizontally or vertically (prefix sums). */
function wideCells(m: CityMap): Uint8Array {
  const { w, h, tile } = m, P = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) P[(y + 1) * (w + 1) + x + 1] = (roadish(tile[y * w + x]) ? 1 : 0) + P[y * (w + 1) + x + 1] + P[(y + 1) * (w + 1) + x] - P[y * (w + 1) + x];
  const sum = (x: number, y: number, rw: number, rh: number) => x + rw > w || y + rh > h ? -1 : P[(y + rh) * (w + 1) + x + rw] - P[y * (w + 1) + x + rw] - P[(y + rh) * (w + 1) + x] + P[y * (w + 1) + x];
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sum(x, y, WIDE_LEN, WIDE) === WIDE * WIDE_LEN || sum(x, y, WIDE, WIDE_LEN) === WIDE * WIDE_LEN) out[y * w + x] = 1;
  }
  return out;
}

export function checkCity(m: CityMap, r: CityRecipe): CityReport {
  const { w, h, tile, height } = m;
  let water = 0; for (const t of tile) if (t === WATER) water++;
  const comp = components(m), wide = wideCells(m);
  const s = new Sim(r.seed, { customMap: m } as any);
  s.startBattle();
  const stands = r.stands.map(st => {
    let open = 0, roofs = 0, wideStreet = false, ci = -1, cd = 1e9;
    const R = st.r, R2 = (st.r + 12) ** 2;
    for (let y = Math.max(0, st.y - R - 12); y <= Math.min(h - 1, st.y + R + 12); y++) for (let x = Math.max(0, st.x - R - 12); x <= Math.min(w - 1, st.x + R + 12); x++) {
      const i = y * w + x, d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
      if (d2 <= R * R) {
        if (tile[i] === PARK || tile[i] === ROAD) open++;
        if (wide[i]) wideStreet = true;
        if (walkable(tile[i]) && d2 < cd) { cd = d2; ci = i; }
      }
      if (d2 <= R2 && tile[i] === BUILDING && height[i] >= 3) roofs++;
    }
    const why: string[] = [];
    if (open < STAND_OPEN) why.push("open");
    if (roofs < STAND_ROOFS) why.push("roofs");
    if (!wideStreet) why.push("wide street");
    if (ci < 0 || comp.lab[ci] !== comp.main) why.push("not on the main land");
    return { name: st.name, ok: why.length === 0, open, roofs, wideStreet, why };
  });
  const land = s.entries.filter(e => e.kind !== "river");
  return { waterFrac: water / (w * h), diagonalRuns: diagonalRuns(m), landComponents: comp.count, entryEdges: new Set(land.map(e => e.edge)).size, entries: land.length, stands };
}
