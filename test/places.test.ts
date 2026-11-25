import { expect, test } from "bun:test";
import { buildPlaces } from "../src/places";
import { Sim } from "../src/sim";
import { ROAD, type CityMap } from "../src/map";
import * as C from "../src/config";

const tinyMap: CityMap = { w: 50, h: 4, seed: 1, tile: new Uint8Array(200).fill(ROAD), height: new Uint8Array(200) };

test("generated names: deterministic, most road cells named", () => {
  const s = new Sim(42);
  const a = buildPlaces(s.map, 42, { generate: true, schools: s.schools.length });
  const b = buildPlaces(s.map, 42, { generate: true, schools: s.schools.length });
  const roadCells = [...s.map.tile.keys()].filter(i => s.map.tile[i] === ROAD);
  expect(roadCells.map(i => a.streetAt(i))).toEqual(roadCells.map(i => b.streetAt(i)));
  expect(roadCells.filter(i => a.streetAt(i)).length / roadCells.length).toBeGreaterThan(0.6);
  expect(new Set(roadCells.map(i => a.streetAt(i)).filter(Boolean)).size).toBeGreaterThan(8);
});

test("a different seed names the streets differently", () => {
  const s = new Sim(42);
  const a = buildPlaces(s.map, 1, { generate: true, schools: 0 }), b = buildPlaces(s.map, 2, { generate: true, schools: 0 });
  const roadCells = [...s.map.tile.keys()].filter(i => s.map.tile[i] === ROAD);
  expect(roadCells.some(i => a.streetAt(i) !== b.streetAt(i))).toBe(true);
});

test("given OSM streets are used verbatim and nothing is generated", () => {
  const p = buildPlaces(tinyMap, 1, { generate: false, streets: [["Wilcox Street", [105, 15, 145, 15]]], schools: 0 }); // (10.5,1.5) to (14.5,1.5)
  expect(p.streetAt(1 * 50 + 12)).toBe("Wilcox Street");
  expect(p.streetAt(40)).toBeNull();
});

test("real city without streets names nothing", () => {
  expect(buildPlaces(tinyMap, 1, { generate: false, schools: 0 }).streetAt(12)).toBeNull();
});

test("school names are stable and end in School", () => {
  const p = buildPlaces(tinyMap, 9, { generate: false, schools: 5 });
  expect(p.school(0)).toBe(p.school(0));
  for (let i = 0; i < 5; i++) expect(p.school(i)).toMatch(/ (Elementary|Middle|High) School$/);
  expect(p.school(99)).toMatch(/School$/); // out of range still names one
});

test("a -1 separates two ways of one name: no cells named between them", () => {
  const p = buildPlaces(tinyMap, 1, { generate: false, streets: [["Main Street", [5, 5, 45, 5, -1, 405, 5, 445, 5]]], schools: 0 });
  expect(p.streetAt(2)).toBe("Main Street"); expect(p.streetAt(42)).toBe("Main Street"); expect(p.streetAt(20)).toBeNull();
});

test("names never contain an em-dash", () => {
  const s = new Sim(42); const p = buildPlaces(s.map, 42, { generate: true, schools: 10 });
  const all = [...s.map.tile.keys()].map(i => p.streetAt(i) ?? "").join("|") + [...Array(10).keys()].map(i => p.school(i)).join("|");
  expect(all).not.toContain("—");
});

test("baked streets: Castle Rock downtown has real names, Boston has none", async () => {
  const { realAreaStreets } = await import("../src/realcity/load");
  const cr = C.REAL_CITIES.find(c => c.id === "castle-rock")!.areas!.find(a => a.key.includes("downtown"))!;
  const st = realAreaStreets(cr.key);
  expect(st && st.length).toBeGreaterThan(10);
  expect(st!.some(([n]) => /Wilcox Street/.test(n))).toBe(true);
  const bos = C.REAL_CITIES.find(c => c.id === "boston")!.areas![0];
  expect(realAreaStreets(bos.key)).toBeUndefined();
});

test("adding street names leaves the baked maps unchanged", async () => {
  const { REAL_DATA } = await import("../src/realcity/data");
  const pre = await Bun.file(new URL("./fixtures/prebake-0.56.json", import.meta.url).pathname).json();
  const h = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  for (const id of ["castle-rock", "manhattan"]) {
    expect(h(REAL_DATA[id].overview)).toBe(pre[id].overview);
    for (const [k, v] of Object.entries(REAL_DATA[id].areas)) expect(h(v.map), `${id}/${k}`).toBe(pre[id].areas[k]);
  }
});

test("streetNear finds the street beside a doorstep cell", () => {
  const m: CityMap = { w: 10, h: 10, seed: 1, tile: new Uint8Array(100).fill(1), height: new Uint8Array(100) }; // all BUILDING
  for (let x = 0; x < 10; x++) m.tile[5 * 10 + x] = ROAD;
  const p = buildPlaces(m, 1, { generate: false, streets: [["Elm Avenue", [5, 55, 95, 55]]], schools: 0 });
  expect(p.streetNear(4 * 10 + 3)).toBe("Elm Avenue"); // one row above the road
  expect(p.streetNear(0)).toBeNull(); // too far
});
