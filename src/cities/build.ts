// 0.35: CityRecipe -> CityMap. Deterministic: the same recipe always gives the same map.
import { BRIDGE, BUILDING, CityMap, INFRA_HIGHWAY, INFRA_NONE, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER } from "../map";
import type { CityRecipe, Rect } from "./recipe";

/** Street lines along one axis: [start, width] pairs covering 0..len. */
function lines(len: number, block: number, street: number, avenueEvery: number, avenue: number): [number, number][] {
  const out: [number, number][] = [];
  for (let pos = 0, j = 0; pos < len; j++) {
    const wd = avenueEvery > 0 && j % avenueEvery === 0 ? avenue : street;
    out.push([pos, wd]);
    pos += wd + block;
  }
  return out;
}

function hash(seed: number, a: number, b: number, c: number) {
  let h = (seed ^ Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1-D noise in -1..1: knots every 16 cells, smoothstep between. */
function noise1(seed: number, k: number, p: number) {
  const i = Math.floor(p / 16), t = p / 16 - i, u = t * t * (3 - 2 * t);
  const a = hash(seed, i, k, 7) * 2 - 1, b = hash(seed, i + 1, k, 7) * 2 - 1;
  return a + (b - a) * u;
}

export function buildCity(r: CityRecipe): CityMap {
  const { w, h } = r;
  const tile = new Uint8Array(w * h).fill(BUILDING);
  const height = new Uint8Array(w * h);
  const fixedH = new Uint8Array(w * h); // cells whose height is set already (stadium stands)
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const fill = (rc: Rect, t: number, hv = 0) => {
    for (let y = Math.max(0, rc.y); y < Math.min(h, rc.y + rc.h); y++) for (let x = Math.max(0, rc.x); x < Math.min(w, rc.x + rc.w); x++) { tile[y * w + x] = t; height[y * w + x] = hv; }
  };
  const g = r.grid;
  const xs = lines(w, g.block[0], g.street, g.avenueEvery, g.avenue), ys = lines(h, g.block[1], g.street, g.avenueEvery, g.avenue);
  for (const [x0, wd] of xs) fill({ x: x0, y: 0, w: wd, h }, ROAD);
  for (const [y0, wd] of ys) fill({ x: 0, y: y0, w, h: wd }, ROAD);
  for (const b of r.boulevards ?? []) {
    const lo = b.at - Math.floor(b.width / 2);
    fill(b.axis === "x" ? { x: 0, y: lo, w, h: b.width } : { x: lo, y: 0, w: b.width, h }, ROAD);
  }
  if (r.pocketParks) { // whole grid blocks become small parks and plazas
    for (let bi = 0; bi < xs.length; bi++) for (let bj = 0; bj < ys.length; bj++) {
      if (hash(r.seed, bi, bj, 31) >= r.pocketParks) continue;
      const x0 = xs[bi][0] + xs[bi][1], y0 = ys[bj][0] + ys[bj][1];
      const x1 = bi + 1 < xs.length ? xs[bi + 1][0] : w, y1 = bj + 1 < ys.length ? ys[bj + 1][0] : h;
      fill({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, PARK);
    }
  }
  for (const p of r.parks) fill(p, PARK);
  for (const s of r.stadiums ?? []) fill({ x: s.x - g.street, y: s.y - g.street, w: s.w + 2 * g.street, h: s.h + 2 * g.street }, ROAD); // a street all round, so every gate opens onto it
  for (const s of r.stadiums ?? []) {
    const ix = Math.round(s.w * 0.2), iy = Math.round(s.h * 0.2);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
      if (!inMap(x, y)) continue;
      const i = y * w + x, inner = x >= s.x + ix && x < s.x + s.w - ix && y >= s.y + iy && y < s.y + s.h - iy;
      // gates: a 4-cell opening in the middle of each side, so the crowd (and a tank) can get onto the field
      const gate = Math.abs(x - (s.x + s.w / 2 - 0.5)) < 2 || Math.abs(y - (s.y + s.h / 2 - 0.5)) < 2;
      if (inner) { tile[i] = PARK; height[i] = 0; }
      else if (gate) { tile[i] = ROAD; height[i] = INFRA_NONE; }
      else { tile[i] = BUILDING; height[i] = 2 + Math.floor(hash(r.seed, x >> 2, y >> 2, 99) * 3); fixedH[i] = 1; }
    }
  }
  // water
  const wet = (x: number, y: number) => { if (inMap(x, y)) { const i = y * w + x; tile[i] = WATER; height[i] = 0; fixedH[i] = 0; } };
  for (const wt of r.water) {
    if (wt.kind === "river") {
      const len = wt.axis === "x" ? w : h, bends = [...(wt.bends ?? [])].sort((a, b) => a[0] - b[0]);
      const rough = wt.rough ?? 0;
      for (let p = 0; p < len; p++) {
        let off = 0; for (const [at, o] of bends) if (p >= at) off = o;
        const lo = wt.at + off - Math.floor(wt.width / 2) + Math.round(noise1(r.seed, 1 + wt.at, p) * rough);
        const hi = wt.at + off - Math.floor(wt.width / 2) + wt.width + Math.round(noise1(r.seed, 2 + wt.at, p) * rough);
        for (let k = lo; k < hi; k++) wt.axis === "x" ? wet(p, k) : wet(k, p);
      }
    } else if (wt.kind === "lake") {
      const { x, y, w: lw, h: lh } = wt.rect, cx = x + lw / 2, cy = y + lh / 2;
      for (let yy = y; yy < y + lh; yy++) for (let xx = x; xx < x + lw; xx++) {
        const ang = Math.atan2(yy + 0.5 - cy, xx + 0.5 - cx), lim = 1 + ((wt.rough ?? 0) * 2 / Math.min(lw, lh)) * noise1(r.seed, 3, (ang + Math.PI) * 16);
        if (wt.round && ((xx + 0.5 - cx) / (lw / 2)) ** 2 + ((yy + 0.5 - cy) / (lh / 2)) ** 2 > lim * lim) continue;
        wet(xx, yy);
      }
    } else if (wt.kind === "sea") {
      const along = wt.side === "n" || wt.side === "s" ? w : h;
      for (let p = 0; p < along; p++) { // the coast, wandering by `rough`
        const d = wt.depth + Math.round(noise1(r.seed, 4, p) * (wt.rough ?? 0));
        for (let k = 0; k < d; k++) wt.side === "n" ? wet(p, k) : wt.side === "s" ? wet(p, h - 1 - k) : wt.side === "w" ? wet(k, p) : wet(w - 1 - k, p);
      }
      for (const rc of wt.coves ?? []) for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) wet(x, y);
    } else {
      for (const rc of wt.rects) for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) wet(x, y);
    }
  }
  const isWater = (x: number, y: number) => inMap(x, y) && tile[y * w + x] === WATER;
  // bridges: across the water along the street nearest the point, in the direction the water is narrower
  for (const b of r.bridges) {
    let bx = b.x, by = b.y;
    if (!isWater(bx, by)) { // nearest water within 12 cells
      let best = 1e9;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) if (isWater(b.x + dx, b.y + dy) && dx * dx + dy * dy < best) { best = dx * dx + dy * dy; bx = b.x + dx; by = b.y + dy; }
      if (best === 1e9) continue;
    }
    let runX = 0, runY = 0;
    for (let x = bx; isWater(x, by); x--) runX++; for (let x = bx + 1; isWater(x, by); x++) runX++;
    for (let y = by; isWater(bx, y); y--) runY++; for (let y = by + 1; isWater(bx, y); y++) runY++;
    const vertical = runY <= runX; // the bridge runs along y across a band that is narrow in y
    const set = vertical ? xs : ys, at = vertical ? bx : by;
    let line = set[0];
    for (const l of set) if (Math.abs(l[0] + l[1] / 2 - at) < Math.abs(line[0] + line[1] / 2 - at)) line = l;
    const bw = Math.max(line[1], g.avenue), b0 = Math.round(line[0] + line[1] / 2 - bw / 2); // at least avenue wide
    for (let k = b0; k < b0 + bw; k++) {
      const along = (p: number) => vertical ? [k, p] : [p, k];
      for (const dir of [-1, 1]) for (let p = (vertical ? by : bx) + (dir > 0 ? 1 : 0); ; p += dir) {
        const [x, y] = along(p);
        if (!isWater(x, y)) break;
        tile[y * w + x] = BRIDGE; height[y * w + x] = INFRA_NONE;
      }
    }
  }
  // rail and highway: road bands with their infra code; over water they are bridges
  const band = (axis: "x" | "y", lo: number, wd: number, infra: number) => {
    for (let p = 0; p < (axis === "x" ? w : h); p++) for (let k = lo; k < lo + wd; k++) {
      const [x, y] = axis === "x" ? [p, k] : [k, p];
      if (!inMap(x, y)) continue;
      const i = y * w + x;
      tile[i] = tile[i] === WATER || tile[i] === BRIDGE ? BRIDGE : ROAD; height[i] = infra; fixedH[i] = 0;
    }
  };
  if (r.highway) band(r.highway.axis, r.highway.at - 3, 6, INFRA_HIGHWAY);
  if (r.rail) {
    const rl = r.rail;
    band(rl.axis, rl.at, 2, INFRA_RAIL);
    for (const s of rl.stations) for (let d = -1; d <= 2; d++) for (let a = -3; a <= 3; a++) {
      const [x, y] = rl.axis === "x" ? [s + a, rl.at + d] : [rl.at + d, s + a];
      if (!inMap(x, y) || x < 2 || y < 2 || x >= w - 2 || y >= h - 2 || isWater(x, y)) continue;
      const i = y * w + x;
      tile[i] = ROAD; height[i] = d === 0 || d === 1 ? INFRA_RAIL : INFRA_STATION;
    }
  }
  // building heights: per lot (about 6 x 5 cells), within the district's levels
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (tile[i] !== BUILDING || fixedH[i]) continue;
    let lv: [number, number] = [1, 3], di = -1;
    r.districts.forEach((d, k) => { const q = d.rect; if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) { lv = d.levels; di = k; } });
    height[i] = lv[0] + Math.floor(hash(r.seed, Math.floor(x / 6), Math.floor(y / 5), di + 1) * (lv[1] - lv[0] + 1));
  }
  return { w, h, seed: r.seed, tile, height };
}
