import { expect, test } from "bun:test";
import { BUILDING, BRIDGE, PARK, ROAD, WATER, type CityMap } from "../src/map";
import { encodeCityMapV2, decodeCityMapV2 } from "../src/osm";
import { Sim } from "../src/sim";
import * as C from "../src/config";

// ---- Task 1: v2 codec and tall buildings
function blocks(w: number, h: number, tall = 0): CityMap {
  const tile = new Uint8Array(w * h), height = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, street = x % 20 < 4 || y % 20 < 4;
    if (street) { tile[i] = ROAD; continue; }
    tile[i] = BUILDING; height[i] = tall || 1 + ((((x / 20) | 0) * 7 + ((y / 20) | 0) * 3) % 120);
  }
  return { w, h, seed: 1, tile, height };
}

test("v2 codec round-trips heights above 14", async () => {
  const m = blocks(650, 500);
  const tiles = [ROAD, BUILDING, PARK, WATER, BRIDGE];
  for (let k = 0; k < 5; k++) m.tile[k * 7] = tiles[k];
  m.height[3] = 120;
  const d = await decodeCityMapV2(await encodeCityMapV2(m), 1);
  expect(d.w).toBe(650); expect(d.h).toBe(500);
  expect(Buffer.from(d.tile).equals(Buffer.from(m.tile))).toBe(true);
  expect(Buffer.from(d.height).equals(Buffer.from(m.height))).toBe(true);
});

test("v2 codec is compact", async () => {
  expect((await encodeCityMapV2(blocks(650, 500))).length).toBeLessThan(60_000);
});

test("roof bonus stops at 14 levels", () => {
  const m = blocks(200, 150, 60);
  const s = new Sim(1, { customMap: m, budget: 50_000_000 } as any);
  let spot: [number, number] | null = null;
  for (let y = 30; y < 120 && !spot; y++) for (let x = 30; x < 170 && !spot; x++) if (!s.canPlace("sniper", x, y)) spot = [x, y];
  expect(spot).not.toBeNull();
  expect(s.place("sniper", spot![0], spot![1])).toBeNull();
  const u = s.units[s.units.length - 1], spec = C.UNITS.sniper;
  expect(u.range).toBeCloseTo(spec.range + spec.roofBonus * 14, 5);
});

// ---- Task 2: projection and dominant street angle
import { toCell, toLatLon, dominantAngle, type Frame, type LatLon } from "../src/realcity/geo";

test("toCell/toLatLon round-trip within 0.1 cell", () => {
  const f: Frame = { lat0: 40.758, lon0: -73.986, angle: 29, w: 650, h: 500 };
  for (const c of [[0, 0], [325, 250], [649, 499], [100, 400]] as [number, number][]) {
    const back = toCell(f, toLatLon(f, c));
    expect(Math.hypot(back[0] - c[0], back[1] - c[1])).toBeLessThan(0.1);
  }
});

test("100 m north at angle 0 is 50 cells up", () => {
  const f: Frame = { lat0: 40, lon0: -100, angle: 0, w: 650, h: 500 };
  const c = toCell(f, [40 + 100 / 111195, -100]);
  expect(Math.abs(c[1] - (250 - 50))).toBeLessThan(0.2);
  expect(Math.abs(c[0] - 325)).toBeLessThan(0.01);
});

/** A 1.5 km grid of streets 80 m apart turned `deg` east of north, plus 10% noise segments. */
function synthGrid(deg: number, lat0 = 40.75, lon0 = -73.98): LatLon[][] {
  const a = deg * Math.PI / 180, mLat = 111195, mLon = 111195 * Math.cos(lat0 * Math.PI / 180);
  const pt = (u: number, v: number): LatLon => { // u across, v along the grid's "north"
    const e = u * Math.cos(a) + v * Math.sin(a), n = -u * Math.sin(a) + v * Math.cos(a);
    return [lat0 + n / mLat, lon0 + e / mLon];
  };
  const ways: LatLon[][] = [];
  for (let k = -750; k <= 750; k += 80) { ways.push([pt(k, -750), pt(k, 750)]); ways.push([pt(-750, k), pt(750, k)]); }
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 8; i++) { const u = r() * 1400 - 700, v = r() * 1400 - 700, b = r() * Math.PI; ways.push([pt(u, v), pt(u + 300 * Math.cos(b), v + 300 * Math.sin(b))]); }
  return ways;
}

test("a synthetic grid at 29 degrees reads as 29, one at -12 reads as -12", () => {
  expect(Math.abs(dominantAngle(synthGrid(29)) - 29)).toBeLessThanOrEqual(1);
  expect(Math.abs(dominantAngle(synthGrid(-12)) - -12)).toBeLessThanOrEqual(1);
  expect(dominantAngle([synthGrid(29)[0].slice(0, 1).concat([[40.7501, -73.98]])])).toBe(0); // under 2 km of road
});

// ---- Task 3: roads, diagonals, connectivity
import { rasterizeArea, rasterRoads, joinLand, UNSET } from "../src/realcity/raster";
import { components } from "../src/cities/check";
import { osmFixture, gpt, LAT0, LON0 } from "./osmFixture";
import { diagonalRuns } from "../src/cities/check";
import { walkable } from "../src/map";

const fixFrame = (): Frame => {
  const d = osmFixture(), roads = d.ways.filter(w => w.tags.highway).map(w => w.geom);
  return { lat0: LAT0, lon0: LON0, angle: dominantAngle(roads), w: 650, h: 500 };
};
const roadish = (t: number) => t === ROAD || t === BRIDGE;
/** road run through (x,y) along x and along y; the street's width is the shorter one */
function runAt(m: CityMap, x: number, y: number) {
  let hx = 0, vy = 0;
  for (let k = x; k >= 0 && roadish(m.tile[y * m.w + k]); k--) hx++;
  for (let k = x + 1; k < m.w && roadish(m.tile[y * m.w + k]); k++) hx++;
  for (let k = y; k >= 0 && roadish(m.tile[k * m.w + x]); k--) vy++;
  for (let k = y + 1; k < m.h && roadish(m.tile[k * m.w + x]); k++) vy++;
  return Math.min(hx, vy);
}

test("grid comes out square", () => {
  const f = fixFrame(); expect(Math.abs(f.angle - 29)).toBeLessThanOrEqual(1);
  const m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: [] });
  expect(diagonalRuns(m)).toBe(0);
  const withB = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  const b0 = toCell(f, gpt(-300, -650)), b1 = toCell(f, gpt(250, 650));
  const nearB = (x: number, y: number) => { // distance to the Broadway centerline
    const dx = b1[0] - b0[0], dy = b1[1] - b0[1], t = Math.max(0, Math.min(1, ((x - b0[0]) * dx + (y - b0[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - b0[0] - t * dx, y - b0[1] - t * dy) < 9;
  };
  const off = { ...withB, tile: withB.tile.map((t, i) => nearB(i % withB.w, (i / withB.w) | 0) ? UNSET : t) };
  expect(diagonalRuns(off)).toBe(0);
});

test("Broadway stays diagonal and clean", () => {
  const f = fixFrame(), m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  let checked = 0;
  for (let i = 1; i < 20; i++) {
    const c = toCell(f, gpt(-300 + 550 * i / 20, -650 + 1300 * i / 20));
    if (c[0] < 5 || c[1] < 5 || c[0] > m.w - 5 || c[1] > m.h - 5) continue;
    checked++;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.hypot(dx, dy) > 2.4) continue; // a 5-cell-wide cross-section all round the centerline
      expect(walkable(m.tile[Math.round(c[1] + dy) * m.w + Math.round(c[0] + dx)])).toBe(true);
    }
  }
  expect(checked).toBeGreaterThanOrEqual(10);
});

test("widths are true: residential 5, primary 8", () => {
  const f = fixFrame(), m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: [] });
  const res = toCell(f, gpt(80, -400 + 40)), pri = toCell(f, gpt(0, -400 + 40)); // between two avenues
  expect(Math.abs(runAt(m, Math.round(res[0]), Math.round(res[1])) - 5)).toBeLessThanOrEqual(1);
  expect(Math.abs(runAt(m, Math.round(pri[0]), Math.round(pri[1])) - 8)).toBeLessThanOrEqual(1);
});

test("tunnels are skipped; the bridge is BRIDGE", () => {
  const f = fixFrame(), m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: [] });
  const t = toCell(f, gpt(-120, -200));
  expect(roadish(m.tile[Math.round(t[1]) * m.w + Math.round(t[0])])).toBe(false);
  const b = toCell(f, gpt(0, 0));
  expect(m.tile[Math.round(b[1]) * m.w + Math.round(b[0])]).toBe(BRIDGE);
});

test("one road component covers 98% of road cells", () => {
  const f = fixFrame(), m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  const seen = new Uint8Array(m.w * m.h); let total = 0, best = 0;
  for (let i = 0; i < seen.length; i++) if (roadish(m.tile[i])) total++;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !roadish(m.tile[i])) continue;
    let n = 0; const q = [i]; seen[i] = 1;
    while (q.length) { const c = q.pop()!, x = c % m.w; n++;
      for (const k of [x > 0 ? c - 1 : -1, x < m.w - 1 ? c + 1 : -1, c - m.w, c + m.w]) if (k >= 0 && k < seen.length && !seen[k] && roadish(m.tile[k])) { seen[k] = 1; q.push(k); } }
    best = Math.max(best, n);
  }
  expect(best / total).toBeGreaterThanOrEqual(0.98);
});

// ---- Task 4: water, parks, buildings, heights, rail
import { buildingLevels } from "../src/realcity/raster";
import { thinFixture, coastFixture } from "./osmFixture";

test("buildingLevels", () => {
  expect(buildingLevels({ building: "yes", "building:levels": "60" })).toBe(60);
  expect(buildingLevels({ building: "yes", height: "35" })).toBe(10);
  expect(buildingLevels({ building: "house" })).toBe(2);
  expect(buildingLevels({ building: "yes" })).toBeNull();
  expect(buildingLevels({ building: "yes", "building:levels": "400" })).toBe(120);
});

const count = (m: CityMap, t: number) => { let n = 0; for (const x of m.tile) if (x === t) n++; return n; };
const at = (m: CityMap, c: [number, number]) => Math.round(c[1]) * m.w + Math.round(c[0]);

test("fixture area: water >= 4%, the park is PARK, the 40-level tower keeps 40, the bridge is over water", () => {
  const f = fixFrame(), m = rasterizeArea(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  expect(count(m, WATER) / (m.w * m.h)).toBeGreaterThanOrEqual(0.04);
  expect(m.tile[at(m, toCell(f, gpt(200, 200)))]).toBe(PARK);
  const tw = at(m, toCell(f, gpt(-210, 280)));
  expect(m.tile[tw]).toBe(BUILDING); expect(m.height[tw]).toBe(40);
  const b = toCell(f, gpt(0, 0)); // bridge centre: water beside it across the river's width
  expect(m.tile[at(m, [b[0] + 8, b[1]])] === WATER || m.tile[at(m, [b[0] - 8, b[1]])] === WATER).toBe(true);
  expect(count(m, UNSET)).toBe(0); // everything resolved
});

test("thin data gets filled: no empty blocks", () => {
  const f = fixFrame(), m = rasterizeArea(thinFixture(), { frame: f, seed: 1, diagonals: [] });
  let land = 0; for (const t of m.tile) if (t !== WATER) land++;
  expect(count(m, BUILDING) / land).toBeGreaterThanOrEqual(0.25);
  // no 20 x 20 square of open ground away from the park and the edge
  const park = toCell(f, gpt(200, 200));
  for (let y = 60; y < m.h - 80; y += 10) for (let x = 60; x < m.w - 80; x += 10) { // the fixture grid doesn't reach the frame corners
    if (Math.hypot(x + 10 - park[0], y + 10 - park[1]) < 60) continue;
    let bld = 0, wat = 0; for (let dy = 0; dy < 20; dy++) for (let dx = 0; dx < 20; dx++) { const t = m.tile[(y + dy) * m.w + x + dx]; if (t === BUILDING) bld++; if (t === WATER) wat++; }
    if (wat === 0) expect(bld, `empty at ${x},${y}`).toBeGreaterThan(0);
  }
});

test("sea fill stays out at sea", () => {
  const f: Frame = { lat0: LAT0, lon0: LON0, angle: 0, w: 650, h: 500 };
  const m = rasterizeArea(coastFixture(), { frame: f, seed: 1, diagonals: [], seaPoints: [gpt(500, 0, 0)] });
  const coastX = toCell(f, gpt(200, 0, 0))[0];
  for (let y = 5; y < m.h - 5; y += 25) {
    expect(m.tile[y * m.w + Math.round(coastX) + 20]).toBe(WATER);
    expect(m.tile[y * m.w + Math.round(coastX) - 20]).not.toBe(WATER);
  }
});

test("rasterizeArea is deterministic", () => {
  const f = fixFrame(), a = rasterizeArea(osmFixture(), { frame: f, seed: 3, diagonals: ["Broadway"] }), b = rasterizeArea(osmFixture(), { frame: f, seed: 3, diagonals: ["Broadway"] });
  expect(Buffer.from(a.tile).equals(Buffer.from(b.tile))).toBe(true);
  expect(Buffer.from(a.height).equals(Buffer.from(b.height))).toBe(true);
});

// ---- Task 5: checkArea and findStands
import { checkArea, findStands } from "../src/realcity/check";
import { parseOverpass } from "../src/realcity/osmtypes";

/** blocks map with a water mask */
function blocksWith(water: (x: number, y: number) => boolean): CityMap {
  const m = blocks(650, 500);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (water(x, y)) { m.tile[y * m.w + x] = WATER; m.height[y * m.w + x] = 0; }
  for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x++) if (m.tile[y * m.w + x] === BUILDING) m.height[y * m.w + x] = Math.max(3, m.height[y * m.w + x] % 9);
  for (let y = 200; y < 300; y++) for (let x = 100; x < 160; x++) if (m.tile[y * m.w + x] !== WATER) m.tile[y * m.w + x] = PARK; // a park
  return m;
}

test("findStands finds the fixture park first", () => {
  const f = fixFrame(), m = rasterizeArea(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  const st = findStands(m), park = toCell(f, gpt(200, 200));
  expect(st.length).toBeGreaterThanOrEqual(2);
  expect(Math.hypot(st[0].x - park[0], st[0].y - park[1])).toBeLessThan(30);
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) expect(Math.hypot(st[i].x - st[j].x, st[i].y - st[j].y)).toBeGreaterThanOrEqual(80);
});

test("checkArea fails a map that is mostly sea with one land edge", () => {
  const m = blocksWith((x, y) => !(x < 260 && y > 120 && y < 380)); // a peninsula off the west edge
  const r = checkArea(m, findStands(m));
  expect(r.ok).toBe(false);
  expect(r.why.join(" ")).toContain("entries");
});

test("checkArea fails an island with no bridge", () => {
  const m = blocksWith((x) => x >= 300 && x < 340);
  const r = checkArea(m, findStands(m));
  expect(r.ok).toBe(false);
  expect(r.why.join(" ")).toContain("land components");
});

test("checkArea passes the fixture area", () => {
  const f = fixFrame(), m = rasterizeArea(osmFixture(), { frame: f, seed: 1, diagonals: ["Broadway"] });
  const r = checkArea(m, findStands(m));
  expect(r.why).toEqual([]);
  expect(r.ok).toBe(true);
}, 60000);

test("a silly OSM width tag can't blow up the raster (live capture reads untrusted data)", () => {
  const d = coastFixture(); d.coast = [];
  d.ways.push({ id: 9, tags: { waterway: "river", width: "1e9" }, geom: [gpt(0, -900, 0), gpt(0, 900, 0)] });
  const f: Frame = { lat0: LAT0, lon0: LON0, angle: 0, w: 650, h: 500 };
  const t0 = performance.now(), m = rasterizeArea(d, { frame: f, seed: 1, diagonals: [] });
  expect(performance.now() - t0).toBeLessThan(5000);
  let wcount = 0; for (let x = 0; x < m.w; x++) if (m.tile[250 * m.w + x] === WATER) wcount++;
  expect(wcount).toBeLessThanOrEqual(150); // clamped to 300 m
});

// ---- Task 6: catalogue
import { CATALOGUE } from "../src/realcity/catalogue";
import * as P from "../src/progress";

test("catalogue: 13 cities, old ids kept, 6 to 8 areas each, clean ids, real trials, no em dash", () => {
  expect(CATALOGUE.length).toBe(13);
  const ids = CATALOGUE.map(c => c.id);
  expect(new Set(ids).size).toBe(13);
  for (const old of ["castle-rock", "denver", "portland", "boston", "chicago", "pittsburgh", "paris", "manhattan"]) expect(ids).toContain(old);
  for (const c of CATALOGUE) {
    expect(c.areas.length).toBeGreaterThanOrEqual(6); expect(c.areas.length).toBeLessThanOrEqual(8);
    expect(new Set(c.areas.map(a => a.id)).size).toBe(c.areas.length);
    for (const a of c.areas) expect(a.id).toMatch(/^[a-z0-9-]+$/);
    expect(c.trial in P.UNLOCK_XP).toBe(true);
  }
  expect(JSON.stringify(CATALOGUE)).not.toContain("—");
  expect(CATALOGUE.find(c => c.id === "manhattan")!.name).toBe("New York, NY");
});

// ---- Task 7: overview
import { buildOverview, encodeOverview, decodeOverview, areaQuad } from "../src/realcity/overview";

const boundary = (): LatLon[][] => [[gpt(-900, -900, 0), gpt(900, -900, 0), gpt(900, 900, 0), gpt(-900, 900, 0), gpt(-900, -900, 0)]];

test("overview round-trips and draws the fixture's classes", () => {
  const o = buildOverview(osmFixture(), boundary(), []);
  expect(o.mPerPx).toBe(8);
  const back = decodeOverview(encodeOverview(o));
  expect(back.w).toBe(o.w); expect(back.h).toBe(o.h); expect(back.mPerPx).toBe(o.mPerPx);
  expect(Buffer.from(back.px).equals(Buffer.from(o.px))).toBe(true);
  const seen = new Set(o.px); for (const k of [1, 2, 3, 4, 5]) expect(seen.has(k), `class ${k}`).toBe(true);
});

test("areaQuad: axis rectangle at angle 0; the 1 km edge bears the angle at 29 degrees", () => {
  const o = buildOverview(osmFixture(), boundary(), []);
  const q0 = areaQuad(o, [LAT0, LON0], 0);
  expect(Math.abs(q0[1][0] - q0[0][0] - 1300 / o.mPerPx)).toBeLessThan(0.5);
  expect(Math.abs(q0[1][1] - q0[0][1])).toBeLessThan(0.01);
  const q = areaQuad(o, [LAT0, LON0], 29);
  // corners go top-left, top-right, bottom-right, bottom-left; the left edge runs from bottom-left up to top-left
  const dx = q[0][0] - q[3][0], dy = q[3][1] - q[0][1]; // px east, px north
  expect(Math.abs(Math.atan2(dx, dy) * 180 / Math.PI - 29)).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.hypot(dx, dy) - 1000 / o.mPerPx)).toBeLessThan(0.5);
});

// ---- Task 8 bake findings (Castle Rock): open land isn't built over; angled streets draw clean, not as staircases
test("a huge open block is left open (park), not filled with lots", () => {
  const d = thinFixture();
  // drop every street piece inside u -400..-80, v 80..400 so it becomes one big block
  const f = fixFrame(), lo = toCell(f, gpt(-400, 80)), hi = toCell(f, gpt(-80, 400));
  const box = { x0: Math.min(lo[0], hi[0]), x1: Math.max(lo[0], hi[0]), y0: Math.min(lo[1], hi[1]), y1: Math.max(lo[1], hi[1]) };
  d.ways = d.ways.flatMap(w => {
    if (!w.tags.highway) return [w];
    // cut the way's points that fall in the big block (streets in the fixture are 8-segment lines)
    const keep: LatLon[][] = [[]];
    w.geom.forEach(p => { const c = toCell(f, p); const inside = c[0] > box.x0 + 8 && c[0] < box.x1 - 8 && c[1] > box.y0 + 8 && c[1] < box.y1 - 8; if (inside) keep.push([]); else keep[keep.length - 1].push(p); });
    return keep.filter(k => k.length >= 2).map((geom, i) => ({ ...w, id: w.id * 100 + i, geom }));
  });
  const m = rasterizeArea(d, { frame: f, seed: 1, diagonals: [] });
  const c = toCell(f, gpt(-240, 240)); let park = 0, bld = 0;
  for (let dy = -40; dy < 40; dy++) for (let dx = -40; dx < 40; dx++) { const t = m.tile[Math.round(c[1] + dy) * m.w + Math.round(c[0] + dx)]; if (t === PARK) park++; if (t === BUILDING) bld++; }
  expect(bld).toBeLessThan(80 * 80 * 0.1);
  expect(park).toBeGreaterThan(80 * 80 * 0.5);
});

test("an angled street draws clean and wide, with no staircase", () => {
  const f = fixFrame(), m = rasterRoads(osmFixture(), { frame: f, seed: 1, diagonals: [] });
  const a = Math.PI * 40 / 180;
  for (let i = 2; i < 18; i++) {
    const c = toCell(f, gpt(280 + 300 * Math.sin(a) * i / 20, 280 + 300 * Math.cos(a) * i / 20));
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.hypot(dx, dy) <= 1.9) expect(walkable(m.tile[Math.floor(c[1] + dy) * m.w + Math.floor(c[0] + dx)])).toBe(true); // cell = floor of the coordinate
  }
});

test("a U-shaped loop street follows its curve instead of snapping to a straight line", () => {
  const d = coastFixture(); d.coast = [];
  const loop: LatLon[] = []; for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; loop.push(gpt(-200 + 150 * Math.cos(t), 150 * Math.sin(t) - 300, 0)); } // a U, ends 300 m apart
  d.ways.push({ id: 7, tags: { highway: "residential", name: "Loop" }, geom: loop });
  const f: Frame = { lat0: LAT0, lon0: LON0, angle: 0, w: 650, h: 500 };
  const m = rasterRoads(d, { frame: f, seed: 1, diagonals: [] });
  const bottom = toCell(f, gpt(-200, -150, 0)), chord = toCell(f, gpt(-200, -300, 0));
  expect(walkable(m.tile[Math.floor(bottom[1]) * m.w + Math.floor(bottom[0])])).toBe(true);
  expect(walkable(m.tile[Math.floor(chord[1]) * m.w + Math.floor(chord[0])])).toBe(false);
});

test("a small cut-off pocket of land is joined to the main land or removed", () => {
  const m = blocks(650, 500);
  // a 20 x 20 park walled in by buildings in the middle of a block row
  for (let y = 100; y < 140; y++) for (let x = 100; x < 140; x++) { m.tile[y * m.w + x] = BUILDING; m.height[y * m.w + x] = 3; }
  for (let y = 110; y < 130; y++) for (let x = 110; x < 130; x++) { m.tile[y * m.w + x] = PARK; m.height[y * m.w + x] = 0; }
  joinLand(m);
  const c = components(m);
  expect(c.count).toBe(1);
});

test("hordes come in from every edge that has a way in, even when one edge has many more roads", () => {
  const m = blocks(650, 500); // streets every 20 cells: ~32 entries on north/south, ~25 on east/west
  // make the north edge look busier: wider street runs there
  for (let x = 0; x < m.w; x++) for (let y = 0; y < 4; y++) if (x % 20 < 12) { m.tile[y * m.w + x] = ROAD; }
  const s = new Sim(1, { customMap: m } as any); s.startBattle();
  expect(new Set(s.entries.filter(e => e.kind !== "river").map(e => e.edge)).size).toBe(4);
});

// ---- Task 9: game wiring
import { loadRealArea, realAreaMap } from "../src/realcity/load";
import { bestOfAreas } from "../src/scoring";
import * as Save from "../src/save";

test("areaByKey and cityById find an area; the area keeps its city's knobs", () => {
  const k = "castle-rock/downtown-and-wilcox-street";
  const f = C.areaByKey(k)!;
  expect(f.city.id).toBe("castle-rock"); expect(f.area.name).toBe("Downtown and Wilcox Street");
  const d = C.cityById(k)!;
  expect(d.id).toBe(k); expect(d.realArea).toBe(k); expect(d.real).toBe(true);
  expect(d.budget).toBe(20_000_000); expect(d.trial).toBe("reaper");
  // 0.36 ships what is baked: a city shows when it has baked areas or a pre-0.36 map; the rest wait
  const { REAL_CITY_MAPS } = require("../src/realcities");
  for (const c of C.REAL_CITIES) expect(!!c.areas?.length || !!REAL_CITY_MAPS[c.id], c.id).toBe(true);
  expect(C.REAL_CITIES.map(c => c.id)).toContain("omaha");
  expect(C.REAL_CITIES.find(c => c.id === "castle-rock")!.areas!.length).toBe(6);
});

test("a Sim on every baked real area starts a battle with the full site count", async () => {
  for (const a of C.REAL_CITIES.find(c => c.id === "castle-rock")!.areas!) {
    await loadRealArea(a.key);
    const s = new Sim(a.seed, { realArea: a.key, sites: a.sites, budget: a.budget } as any);
    expect(s.w).toBe(650); expect(s.h).toBe(500);
    s.startBattle();
    expect(s.sites.length, a.key).toBe(Math.round(a.sites));
  }
}, 120000);

test("two battles on one area don't share damage (the cached map is copied)", async () => {
  const k = "castle-rock/rock-park"; await loadRealArea(k);
  const a = new Sim(1, { realArea: k } as any), b = new Sim(1, { realArea: k } as any);
  const i = a.map.height.findIndex((h, j) => h > 0 && a.map.tile[j] === BUILDING);
  a.map.height[i] = 0;
  expect(b.map.height[i]).toBeGreaterThan(0);
  expect(realAreaMap(k)!.height[i]).toBeGreaterThan(0);
  expect(() => new Sim(1, { realArea: "castle-rock/not-loaded-yet" } as any)).toThrow();
});

test("old saves: best.manhattan and plans.manhattan load; no area medal shows until one is earned", () => {
  const s = Save.clean({ settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: { manhattan: { pct: 61, medal: "Gold" } }, plans: { manhattan: { poly: [[1, 1], [9, 1], [9, 9]], walls: [], units: [], supports: [], abilities: {} } }, xp: 900 } as any);
  expect(s.best.manhattan.medal).toBe("Gold");
  const ny = C.REAL_CITIES.find(c => c.id === "manhattan")!;
  expect(bestOfAreas(s.best, (ny.areas ?? []).map(a => a.key), "medium")).toBeNull();
  for (const a of ny.areas ?? []) expect(s.plans[a.key]).toBeUndefined();
  const withArea = { ...s.best, "castle-rock/rock-park": { pct: 40, medal: "Silver" } };
  expect(bestOfAreas(withArea, C.REAL_CITIES.find(c => c.id === "castle-rock")!.areas!.map(a => a.key), "medium")!.medal).toBe("Silver");
});

test("the daily picks the same real area twice for one date", () => {
  const a = C.dailyChallengeFor("2026-11-13"), b = C.dailyChallengeFor("2026-11-13");
  expect(a.city.id).toBe(b.city.id);
  for (let d = 1; d <= 28; d++) { const c = C.dailyChallengeFor(`2026-12-${String(d).padStart(2, "0")}`).city; if (c.real && C.REAL_CITIES.find(x => c.id.startsWith(x.id))?.areas?.length) expect(c.realArea).toBeDefined(); }
});

// ---- Task 10: live capture uses the new rasterizer
import { fetchLiveOsmCity } from "../src/osm";
test("live capture of a place gives a 650 x 500 battle with its grid squared", async () => {
  const d = osmFixture();
  const overpass = { elements: d.ways.map(w => ({ type: "way", id: w.id, tags: w.tags, geometry: w.geom.map(([lat, lon]) => ({ lat, lon })) })) };
  const calls: string[] = [];
  const fake = async (url: string) => { calls.push(url); return new Response(JSON.stringify(url.includes("nominatim") ? [{ lat: String(LAT0), lon: String(LON0), display_name: "Fixture Town, Somewhere, Earth" }] : overpass)); };
  const res = await fetchLiveOsmCity("Fixture Town", 5, fake as any);
  expect(res.name).toBe("Fixture Town, Somewhere");
  expect(res.map.w).toBe(650); expect(res.map.h).toBe(500);
  expect(diagonalRuns(res.map)).toBe(0);
  expect(count(res.map, WATER)).toBeGreaterThan(1000);
  expect(calls.length).toBe(2);
});

// ---- Task 11: shipped areas are pinned, playable and small enough
import { REAL_DATA } from "../src/realcity/data";
import { existsSync, statSync } from "node:fs";
// A re-bake that changes an area on purpose updates its number here (players' saved plans for it may stop fitting).
const LAYOUT_REAL: Record<string, number> = {
  "castle-rock/downtown-and-wilcox-street": 876335636,
  "castle-rock/festival-park-and-plum-creek": 2181363588,
  "castle-rock/rock-park": 73046250,
  "castle-rock/founders-parkway": 3033464341,
  "castle-rock/the-meadows": 553867141,
  "castle-rock/metzler-ranch": 4112923266,
  "manhattan/lower-manhattan-and-brooklyn-bridge": 1184164221,
  "manhattan/midtown-and-times-square": 532422955,
  "manhattan/central-park-south": 2844402408,
  "manhattan/harlem-and-the-upper-park": 1494143884,
  "manhattan/downtown-brooklyn-and-dumbo": 669845923,
  "manhattan/long-island-city": 1377838365,
  "manhattan/yankee-stadium": 405116098,
  "manhattan/st-george-staten-island": 1288250546,
  "los-angeles/downtown": 3675981872,
  "los-angeles/hollywood": 2586705851,
  "los-angeles/venice-beach": 2170385135,
  "los-angeles/exposition-park": 1766696712,
  "los-angeles/dodger-stadium-and-echo-park": 2917063266,
  "los-angeles/griffith-park-and-los-feliz": 1033851769,
  "los-angeles/san-pedro-waterfront": 3696841113,
  "san-francisco/financial-district-and-ferry-building": 3457547815,
  "san-francisco/fishermans-wharf": 1334211909,
  "san-francisco/mission-and-dolores-park": 3222401999,
  "san-francisco/haight-and-golden-gate-park": 3452282200,
  "san-francisco/soma-and-oracle-park": 1292874826,
  "san-francisco/the-marina": 794282419,
  "washington/capitol-and-the-mall": 1052223855,
  "washington/white-house-and-lafayette-square": 1809168507,
  "washington/navy-yard": 688964191,
  "washington/georgetown-waterfront": 2829332745,
  "washington/dupont-circle": 1043568636,
  "washington/rfk-and-the-anacostia": 1508235096,
  "boston/common-and-beacon-hill": 2038615688,
  "boston/back-bay-and-the-esplanade": 1655883527,
  "boston/north-end": 4148169023,
  "boston/fenway": 3296172520,
  "boston/seaport": 1400375944,
  "boston/charlestown-navy-yard": 1332246754,
  "chicago/the-loop-and-the-river": 1146789806,
  "chicago/grant-park": 4191563339,
  "chicago/navy-pier-and-streeterville": 1830760548,
  "chicago/wrigley-field": 3592025986,
  "chicago/lincoln-park": 3255586324,
  "chicago/museum-campus": 1353206101,
  "denver/lodo-and-confluence-park": 2617365944,
  "denver/civic-center-and-the-capitol": 2496726094,
  "denver/city-park": 290229263,
  "denver/washington-park": 1968663408,
  "denver/empower-field-and-sloans-lake": 831944451,
  "denver/rino": 1553493997,
  "omaha/downtown-and-the-riverfront": 3746919233,
  "omaha/old-market": 1045978764,
  "omaha/charles-schwab-field": 3152662567,
  "omaha/midtown-crossing": 4192187340,
  "omaha/elmwood-park": 407752588,
  "omaha/henry-doorly-zoo": 3392084907,
  "miami/downtown-and-bayfront-park": 1360717996,
  "miami/brickell": 2814110488,
  "miami/little-havana": 219073894,
  "miami/wynwood": 3724275185,
  "miami/loandepot-park": 1454797381,
  "miami/coconut-grove": 1093419686,
  "portland/downtown-and-pioneer-square": 1209973924,
  "portland/waterfront-park": 3467565904,
  "portland/pearl-district": 3207348426,
  "portland/lloyd-district-and-moda-center": 3144092774,
  "portland/providence-park": 3918007162,
  "portland/south-waterfront": 4018025471,
  "pittsburgh/point-state-park": 852505176,
  "pittsburgh/market-square": 2191252952,
  "pittsburgh/north-shore": 4243980268,
  "pittsburgh/strip-district": 3148322491,
  "pittsburgh/oakland-and-schenley-park": 2346961346,
  "pittsburgh/south-side-flats": 887897650,
  "paris/ile-de-la-cite": 1638521955,
  "paris/louvre-and-tuileries": 1867400881,
  "paris/champ-de-mars": 2040661966,
  "paris/arc-de-triomphe": 1417641841,
  "paris/bastille": 3568036691,
  "paris/montmartre": 3455357608,
  "paris/bercy": 2051525808,
};
const fnvH = (a: Uint8Array, h = 2166136261) => { for (const b of a) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h; };

test("every shipped real area is pinned and passes checkArea", async () => {
  const keys: string[] = [];
  for (const [c, d] of Object.entries(REAL_DATA)) for (const [a, v] of Object.entries(d.areas)) {
    const k = `${c}/${a}`, m = await decodeCityMapV2(v.map, 1); keys.push(k);
    expect(fnvH(m.height, fnvH(m.tile)), k).toBe(LAYOUT_REAL[k]);
    const r = checkArea(m, v.stands);
    expect(r.why, k).toEqual([]);
  }
  expect(keys.sort()).toEqual(Object.keys(LAYOUT_REAL).sort());
}, 300000);

test("baked data stays small: the single-file game under 18 MB (0.60: street names for all 13 cities took it past 15)", () => {
  let total = 0; for (const d of Object.values(REAL_DATA)) { total += d.overview.length; for (const a of Object.values(d.areas)) total += a.map.length + JSON.stringify(a.stands).length; }
  expect(total).toBeLessThan(9 * 1024 * 1024);
  const html = new URL("../dist/horde.html", import.meta.url).pathname;
  if (existsSync(html)) expect(statSync(html).size).toBeLessThan(18 * 1024 * 1024);
});

import { REAL_SAVED } from "../src/realcity/pace";
test("every shipped real area is winnable by the bot (15% or more saved)", () => {
  for (const c of C.REAL_CITIES) for (const a of c.areas ?? []) {
    expect(REAL_SAVED[a.key], `${a.key} not measured`).toBeDefined();
    expect(REAL_SAVED[a.key], a.key).toBeGreaterThanOrEqual(15);
  }
});

// ---- Final review fixes
test("area bests and plans survive a save round trip (review #1)", () => {
  const raw = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: { "castle-rock/rock-park": { pct: 50, medal: "Gold" }, "castle-rock/rock-park@hard": { pct: 30, medal: "Bronze" } },
    plans: { "castle-rock/rock-park": { poly: [[1, 1], [9, 1], [9, 9]], walls: [], units: [], supports: [], abilities: {} } }, xp: 1 } as any;
  const s = Save.clean(JSON.parse(JSON.stringify(raw)));
  expect(s.best["castle-rock/rock-park"].medal).toBe("Gold");
  expect(s.best["castle-rock/rock-park@hard"].medal).toBe("Bronze");
  expect(s.plans["castle-rock/rock-park"]).toBeDefined();
  expect(Save.clean({ ...raw, best: { "../../etc": { pct: 1, medal: null }, "a/b/c": { pct: 1, medal: null } } }).best).toEqual({});
});

test("two loads of one area at once share one decode (review #3)", async () => {
  const k = "castle-rock/metzler-ranch";
  const a = loadRealArea(k), b = loadRealArea(k);
  expect(a).toBe(b);
  expect(await a).toBe(await b);
});

test("live capture input is bounded: huge relations skipped, long far rings safe, oversize replies refused (review #4)", async () => {
  const members = Array.from({ length: 400 }, (_, k) => ({ type: "way", role: "outer", geometry: [{ lat: 40 + k * 1e-4, lon: -74 }, { lat: 40 + (k + 1) * 1e-4, lon: -74 }] }));
  expect(parseOverpass({ elements: [{ type: "relation", id: 1, tags: { natural: "water" }, members }] }, true).ways.length).toBe(0);
  expect(parseOverpass({ elements: [{ type: "relation", id: 1, tags: { natural: "water" }, members }] }).ways.length).toBeGreaterThan(0); // the bake keeps it
  const far: LatLon[] = Array.from({ length: 200_001 }, (_, k) => [50 + k * 1e-7, 10] as LatLon); far.push(far[0]);
  const f: Frame = { lat0: LAT0, lon0: LON0, angle: 0, w: 650, h: 500 };
  expect(() => rasterizeArea({ ways: [{ id: 1, tags: { natural: "water" }, geom: far }], nodes: [], coast: [] }, { frame: f, seed: 1, diagonals: [] })).not.toThrow();
  const big = async (url: string) => url.includes("nominatim") ? new Response(JSON.stringify([{ lat: "40", lon: "-74", display_name: "X" }])) : new Response("x".repeat(61 * 1024 * 1024));
  await expect(fetchLiveOsmCity("X", 1, big as any)).rejects.toThrow(/too much/);
}, 60000);

import * as Snap from "../src/snapshot";
test("a 0.35 battle snapshot of a real city is refused as another version (review #5)", async () => {
  const s = new Sim(1, { realCityId: "denver" } as any);
  const gz = await Snap.pack("0.35.1", "Denver, CO", s, { cityId: "castle-rock" });
  const meta = await Snap.peek(gz);
  expect(C.VERSION).toBe("0.60.0");
  expect(meta!.version === C.VERSION).toBe(false); // main.ts loadBattle refuses it
}, 60000);
