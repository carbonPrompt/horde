import { expect, test } from "bun:test";
import { buildCity } from "../src/cities/build";
import { fixture } from "./cityFixture";
import { BRIDGE, BUILDING, PARK, ROAD, WATER } from "../src/map";

const roadish = (t: number) => t === ROAD || t === BRIDGE;

test("buildCity is deterministic", () => {
  const a = buildCity(fixture()), b = buildCity(fixture());
  expect(Buffer.from(a.tile).equals(Buffer.from(b.tile))).toBe(true);
  expect(Buffer.from(a.height).equals(Buffer.from(b.height))).toBe(true);
});

test("size and water: the river is a band of its width", () => {
  const f = fixture(), m = buildCity(f);
  expect(m.w).toBe(160); expect(m.h).toBe(120);
  let water = 0; for (const t of m.tile) if (t === WATER) water++;
  expect(water).toBeGreaterThan(0);
  // a column away from the bridges and the lake: water exactly from at - width/2 for width cells
  const x = 70; let wcount = 0;
  for (let y = 0; y < m.h; y++) if (m.tile[y * m.w + x] === WATER) { wcount++; expect(Math.abs(y - 60)).toBeLessThanOrEqual(4); }
  expect(wcount).toBe(8);
});

// a road cell whose 4 neighbours hold no road but which touches road diagonally = a diagonal step
function diagonalRunsLocal(m: { w: number; h: number; tile: Uint8Array }) {
  let n = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!roadish(m.tile[y * m.w + x])) continue;
    const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && roadish(m.tile[yy * m.w + xx]);
    if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) continue;
    if (at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1)) n++;
  }
  return n;
}

test("streets are axis-aligned", () => {
  const f = fixture(), m = buildCity(f);
  expect(diagonalRunsLocal(m)).toBe(0);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!roadish(m.tile[y * m.w + x])) continue;
    let hx = 1, vy = 1;
    for (let k = x - 1; k >= 0 && roadish(m.tile[y * m.w + k]); k--) hx++;
    for (let k = x + 1; k < m.w && roadish(m.tile[y * m.w + k]); k++) hx++;
    for (let k = y - 1; k >= 0 && roadish(m.tile[k * m.w + x]); k--) vy++;
    for (let k = y + 1; k < m.h && roadish(m.tile[k * m.w + x]); k++) vy++;
    expect(Math.max(hx, vy)).toBeGreaterThanOrEqual(f.grid.street);
  }
});

test("bridges only where listed, and each links both banks", () => {
  const f = fixture(), m = buildCity(f), reach = Math.max(f.grid.street, f.grid.avenue) + f.grid.block[0];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.tile[y * m.w + x] !== BRIDGE) continue;
    expect(f.bridges.some(b => Math.abs(b.x - x) <= reach && Math.abs(b.y - y) <= 8)).toBe(true);
  }
  for (const b of f.bridges) {
    // somewhere near the listed x, a column runs land - bridge - land across the river
    let ok = false;
    for (let x = b.x - reach; x <= b.x + reach && !ok; x++) {
      const t = (y: number) => m.tile[y * m.w + x];
      if (t(60) === BRIDGE && roadish(t(54)) && roadish(t(66))) ok = true;
    }
    expect(ok).toBe(true);
  }
});

test("park is all PARK; stadium is a field ringed by low stands", () => {
  const f = fixture(), m = buildCity(f), p = f.parks[0], s = f.stadiums![0];
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) expect(m.tile[y * m.w + x]).toBe(PARK);
  const ix = Math.round(s.w * 0.2), iy = Math.round(s.h * 0.2);
  for (let y = s.y + iy; y < s.y + s.h - iy; y++) for (let x = s.x + ix; x < s.x + s.w - ix; x++) expect(m.tile[y * m.w + x]).toBe(PARK);
  let ring = 0;
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
    const inner = x >= s.x + ix && x < s.x + s.w - ix && y >= s.y + iy && y < s.y + s.h - iy;
    if (inner) continue;
    const i = y * m.w + x;
    if (m.tile[i] === BUILDING) { ring++; expect(m.height[i]).toBeGreaterThanOrEqual(2); expect(m.height[i]).toBeLessThanOrEqual(4); }
  }
  expect(ring).toBeGreaterThan(0);
});

test("districts set building heights", () => {
  const f = fixture(), m = buildCity(f), d = f.districts[1].rect;
  let n = 0;
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
    const i = y * m.w + x;
    if (m.tile[i] !== BUILDING) continue;
    n++; expect(m.height[i]).toBeGreaterThanOrEqual(6); expect(m.height[i]).toBeLessThanOrEqual(10);
  }
  expect(n).toBeGreaterThan(100);
});

test("rough banks: the river edge wanders, but only within `rough` cells", () => {
  const f = fixture(); f.water = [{ kind: "river", axis: "x", at: 60, width: 8, rough: 3 }]; f.bridges = [];
  const m = buildCity(f), tops = new Set<number>();
  for (let x = 0; x < m.w; x++) {
    let top = -1;
    for (let y = 0; y < m.h; y++) if (m.tile[y * m.w + x] === WATER) { if (top < 0) top = y; expect(Math.abs(y - 60)).toBeLessThanOrEqual(4 + 3); }
    tops.add(top);
  }
  expect(tops.size).toBeGreaterThan(2);
});

test("pocket parks: about that share of blocks become small parks", () => {
  const f = fixture(); f.pocketParks = 0.1; f.parks = []; f.stadiums = []; f.water = [];
  const m = buildCity(f); let park = 0, land = 0;
  for (const t of m.tile) { if (t === PARK) park++; if (t === PARK || t === BUILDING) land++; }
  expect(park / land).toBeGreaterThan(0.04); expect(park / land).toBeLessThan(0.2);
});

test("bridges are at least avenue wide", () => {
  const f = fixture(), m = buildCity(f);
  for (const b of f.bridges) {
    let n = 0; for (let x = b.x - 20; x <= b.x + 20; x++) if (m.tile[60 * m.w + x] === BRIDGE) n++;
    expect(n).toBeGreaterThanOrEqual(f.grid.avenue);
  }
});

// ---- Task 2: trains and ways in on designed maps
import { extractRailLines } from "../src/map";
import { Sim } from "../src/sim";

test("rail line extracts on a designed map", () => {
  const f = { ...fixture(), rail: { axis: "x" as const, at: 30, stations: [40, 110] } };
  const lines = extractRailLines(buildCity(f));
  expect(lines.length).toBeGreaterThanOrEqual(1);
  const span = Math.max(...lines.map(l => { const xs = l.map(p => p[0]); return Math.max(...xs) - Math.min(...xs); }));
  expect(span).toBeGreaterThanOrEqual(0.9 * f.w - 2);
});

test("entries found on a designed map, on at least 2 edges", () => {
  const s = new Sim(1, { customMap: buildCity(fixture()) } as any);
  s.startBattle(); // entries are found when the battle starts
  expect(s.entries.length).toBeGreaterThanOrEqual(3);
  expect(new Set(s.entries.map(e => e.edge)).size).toBeGreaterThanOrEqual(2);
});

// ---- Task 3: the city checker
import { checkCity, diagonalRuns } from "../src/cities/check";

test("checker: the fixture passes", () => {
  const f = fixture(), rep = checkCity(buildCity(f), f);
  expect(rep.waterFrac).toBeGreaterThanOrEqual(0.04);
  expect(rep.diagonalRuns).toBe(0);
  expect(rep.landComponents).toBe(1);
  expect(rep.entryEdges).toBeGreaterThanOrEqual(2);
  expect(rep.entries).toBeGreaterThanOrEqual(3);
  expect(rep.stands.filter(s => s.ok).length).toBeGreaterThanOrEqual(1);
  expect(diagonalRuns(buildCity(f))).toBe(0);
});

test("checker: an island with no bridge is a second land mass", () => {
  const f = fixture();
  f.water.push({ kind: "area", rects: [{ x: 126, y: 76, w: 34, h: 4 }, { x: 126, y: 76, w: 4, h: 44 }] });
  expect(checkCity(buildCity(f), f).landComponents).toBe(2);
});

test("checker: a cramped stand fails on open ground", () => {
  const f = fixture();
  f.stands = [{ name: "cramped", x: 140, y: 100, r: 6 }];
  const st = checkCity(buildCity(f), f).stands[0];
  expect(st.ok).toBe(false);
  expect(st.why).toContain("open");
});

test("checker: sea on three sides leaves one edge to come in by", () => {
  const f = fixture();
  f.water = [{ kind: "sea", side: "n", depth: 10 }, { kind: "sea", side: "e", depth: 10 }, { kind: "sea", side: "w", depth: 10 }];
  f.bridges = [];
  expect(checkCity(buildCity(f), f).entryEdges).toBeLessThan(2);
});

// ---- Task 4: Sim builds campaign maps from recipes
import * as C from "../src/config";

test("Sim uses the recipe for its map", () => {
  const s = new Sim(1, { recipe: fixture() } as any);
  expect(s.w).toBe(160); expect(s.h).toBe(120);
  expect(Buffer.from(s.map.tile).equals(Buffer.from(buildCity(fixture()).tile))).toBe(true);
});

test("outbreak sites are all found on a water map", () => {
  const f = fixture(), st = f.stands[0];
  const s = new Sim(1, { recipe: f, sites: 3 } as any);
  expect(s.setZone([[st.x - 14, st.y - 10], [st.x + 14, st.y - 10], [st.x + 14, st.y + 10], [st.x - 14, st.y + 10]])).toBeNull();
  s.startBattle();
  expect(s.sites.length).toBe(Math.max(1, Math.round(3 * s.diff.sitesMul)));
});

test("battle snapshot round-trips a recipe map", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = new Sim(1, { recipe: fixture(), civilians: 300 } as any);
  const snap = await unpack(await pack(C.VERSION, "t", s, {}));
  expect(snap.sim.w).toBe(160); expect(snap.sim.h).toBe(120);
  expect(Buffer.from(snap.sim.map.tile).equals(Buffer.from(s.map.tile))).toBe(true);
});

// ---- Task 5: the nine campaign cities meet the rules
import { CAMPAIGN_RECIPES } from "../src/cities/campaign";

const IDS = ["fairhaven", "pike-landing", "stonebridge", "lakemont", "highgate", "tidewater", "seven-isles", "marrow-delta", "port-royal"];
test("every campaign city meets the design rules", () => {
  expect(Object.keys(CAMPAIGN_RECIPES)).toEqual(IDS);
  for (const id of IDS) {
    const r = CAMPAIGN_RECIPES[id], rep = checkCity(buildCity(r), r);
    const why = `${id}: ` + JSON.stringify(rep);
    expect(rep.waterFrac, why).toBeGreaterThanOrEqual(0.04);
    expect(rep.diagonalRuns, why).toBe(0);
    expect(rep.landComponents, why).toBe(1);
    expect(rep.entryEdges, why).toBeGreaterThanOrEqual(2);
    expect(rep.entries, why).toBeGreaterThanOrEqual(3);
    expect(rep.stands.filter(s => s.ok).length, why).toBeGreaterThanOrEqual(2);
  }
  for (const id of ["fairhaven", "pike-landing"]) { const r = CAMPAIGN_RECIPES[id]; expect(r.w <= 480 && r.h <= 360).toBe(true); }
  for (const id of ["tidewater", "seven-isles", "marrow-delta", "port-royal"]) { const r = CAMPAIGN_RECIPES[id]; expect([r.w, r.h]).toEqual([650, 500]); }
});

// ---- Final review #3: the published cities must not change by accident (saved plans hold map coordinates).
// If a change to build.ts or a recipe is meant to reshape a city, update its number here on purpose and say so
// in the release notes: players' saved plans for that city may no longer fit.
const LAYOUT: Record<string, number> = {
  "fairhaven": 1914070323,
  "pike-landing": 2880700061,
  "stonebridge": 2649176119,
  "lakemont": 4084931591,
  "highgate": 1418368101,
  "tidewater": 1046570978,
  "seven-isles": 1349281653,
  "marrow-delta": 2346056691,
  "port-royal": 1039656590,
};
test("campaign city layouts are pinned", () => {
  const fnv = (a: Uint8Array, h = 2166136261) => { for (const b of a) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h; };
  for (const id of IDS) { const m = buildCity(CAMPAIGN_RECIPES[id]); expect(fnv(m.height, fnv(m.tile)), id).toBe(LAYOUT[id]); }
});
