// 0.60.1: the deferred minors from the 0.60 final review.
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { Sim } from "../src/sim";
import { BUILDING } from "../src/map";
import { SE_CHINOOK, SE_CHINOOK_ABORT, SE_ENGINEER_LOST, SE_OUT_OF_AMMO } from "../src/stats";
import { engineerBoost, pathStats } from "../src/engineers";
import { selectionGrid } from "../src/hud";
import { waitingList } from "../src/inventory";
import { PING_STYLE } from "../src/minimap";
import { zone, zoneRoof, zoneStreet } from "./troopsFixture";

function mkZ(diff: C.Difficulty = "medium"): Sim { const s = new Sim(42, { budget: 400_000_000, difficulty: diff } as any); expect(s.setZone(zone(s))).toBeNull(); return s; }
function battle(s: Sim, bites = false) { s.dev.bites = bites; s.dev.waves = false; s.startBattle(); s.devClearInfected(); }
const run = (s: Sim, secs: number) => { for (let t = 0; t < secs; t += C.DT) s.step(C.DT); };
function zoneRoofs(s: Sim): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.inZone.length && out.length < 400; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) out.push([i % s.w, (i / s.w) | 0]);
  return out;
}
function placeSup(s: Sim, kind: C.SupportKind): { x: number; y: number } {
  for (const [x, y] of zoneRoofs(s)) if (s.placeSupport(kind, x, y) === null) return s.supports[s.supports.length - 1];
  throw new Error("could not place " + kind);
}

test("minor 1: Command Post and Radio Tower speed engineers (walk and work)", () => {
  const s = mkZ();
  const c = placeSup(s, "command"); placeSup(s, "radio");
  battle(s); run(s, 15); // both deployed
  expect(s.hasActiveSupport("command", c.x, c.y)).toBe(true);
  expect(s.hasActiveSupport("radio", c.x, c.y)).toBe(true);
  expect(engineerBoost(s, c.x, c.y)).toBeCloseTo(C.COMMAND_RATE_MUL * C.ENGINEER_RADIO_MUL, 6);
  expect(engineerBoost(s, 1, 1)).toBe(1); // a map corner, under no aura
  expect(C.ENGINEER_RADIO_MUL).toBeGreaterThan(1);
}, 60000);

test("minor 2a: an out-of-ammo unit's selection tile is marked dry", () => {
  const g = selectionGrid([{ kind: "garrison", hp: 1, max: 1, dry: true }, { kind: "apc", hp: 1, max: 1 }]);
  expect(g.mode).toBe("units");
  if (g.mode === "units") { expect(g.items[0].dry).toBe(true); expect(g.items[1].dry).toBe(false); }
});

test("minor 2b: the Inventory lists dry units first, then at the wall, then on the way", () => {
  const list = waitingList([
    { label: "APC 1", state: "way" }, { label: "Troops 2", state: "wall" }, { label: "Sniper 3", state: "dry" }, { label: "Troops 4", state: "dry" },
  ]);
  expect(list).toEqual(["Sniper 3 (no ammo)", "Troops 4 (no ammo)", "Troops 2 (at the wall)", "APC 1 (on the way)"]);
});

test("minor 3 + 7: a lost engineer has its own alert; with the whole crew gone the zone still restocks (wave-off, then landing)", () => {
  expect(PING_STYLE.crew.label).toMatch(/engineer/i);
  const s = mkZ(); const [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  battle(s, true);
  const [sx, sy] = s.supply[0].store;
  for (let i = 0; i < 30; i++) s.spawnInfected(sx + 0.5 + (i % 6) * 0.4 - 1, sy + 0.5 + ((i / 6) | 0) * 0.4 - 1, 1e6);
  run(s, 20);
  const lost = s.stats.ev.k.filter(k => k === SE_ENGINEER_LOST).length;
  expect(lost).toBeGreaterThan(0);
  expect(s.pingLog.some(p => p.kind === "crew")).toBe(true);
  for (const e of s.engineersOf(0)) e.alive = false; // the rest go too
  expect(s.engineersOf(0).filter(e => e.alive).length).toBe(0);
  const s0 = s.supply[0].small;
  expect(s.buySupply(0, "small", 2)).toBeNull();
  s.supply[0].orders[0].at = s.time + 1;
  run(s, 2); // the store point is still crowded: it waves off
  expect(s.stats.ev.k.filter(k => k === SE_CHINOOK_ABORT).length).toBeGreaterThanOrEqual(1);
  s.devClearInfected();
  run(s, C.CHINOOK_RETRY_S + 2);
  expect(s.stats.ev.k.filter(k => k === SE_CHINOOK).length).toBe(1);
  expect(s.supply[0].small).toBe(s0 + 2 * C.CRATE_SMALL); // nobody carries it off: no crew
}, 120000);

test("minor 4: an engineer with no path home does not search again every step", () => {
  const s = mkZ(); battle(s);
  for (const e of s.engineersOf(0)) { e.x = 1.5; e.y = 1.5; e.job = null; e.path = []; } // a map corner, far outside the leash: no way back
  const n0 = pathStats.searches;
  run(s, 10);
  // 10 s is 150 engineer steps; with the cooldown each of the 4 engineers searches about once per ENGINEER_NOPATH_S
  expect(pathStats.searches - n0).toBeLessThanOrEqual(4 * (Math.ceil(10 / C.ENGINEER_NOPATH_S) + 1));
  expect(C.ENGINEER_NOPATH_S).toBeGreaterThanOrEqual(2);
}, 60000);

test("minor 5a: supply spent keeps a planning reserve after its battery is lost", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  expect(s.place("mortar", x, y)).toBeNull();
  const u = s.units.find(v => v.kind === "mortar")!;
  expect(s.buyReserve(u, 2)).toBeNull();
  battle(s);
  s.syncCounters(); const before = s.stats.c.supplySpent;
  expect(before).toBe(2 * C.CRATE_PRICE_SHELLS);
  u.hp = -1; s.units.splice(s.units.indexOf(u), 1); // the battery is gone
  s.syncCounters();
  expect(s.stats.c.supplySpent).toBe(before);
}, 60000);

test("minor 5b: paratroopers and APC dismounts running dry raise no out-of-ammo alert and are not listed as dry", () => {
  const s = mkZ(); battle(s);
  const [x, y] = zoneRoof(s);
  s.units.push({ kind: "para", x, y, range: 10, ammo: 0, cooldown: 1, kills: 0, shotX: 0, shotY: 0, shotT: -1, mode: "near", post: [x, y], hp: 100, ai: "hunt", thinkT: 0 } as any);
  const p = s.units[s.units.length - 1];
  run(s, 1);
  expect(s.stats.ev.k.filter(k => k === SE_OUT_OF_AMMO).length).toBe(0);
  expect(s.pingLog.some(pg => pg.kind === "ammo")).toBe(false);
  expect(s.isSupplied(p)).toBe(false);
  expect(s.isSupplied({ ...p, kind: "militia", parentUnit: {} } as any)).toBe(false);
  expect(s.isSupplied({ ...p, kind: "garrison" } as any)).toBe(true);
}, 60000);

test("minor 5c: removing a Depot in planning at the engineer cap keeps the paid engineers", () => {
  const s = mkZ();
  for (let i = 0; i < C.ENGINEERS_MAX - C.ENGINEERS_FREE; i++) expect(s.buyEngineer(0)).toBeNull();
  const paid = s.engineersOf(0).length;
  expect(paid).toBe(C.ENGINEERS_MAX);
  placeSup(s, "supply"); // at the cap: it adds nobody
  expect(s.engineersOf(0).length).toBe(C.ENGINEERS_MAX);
  expect(s.removeEntity({ support: s.supports.find(b => b.kind === "supply")! })).toBe(true);
  expect(s.supports.some(b => b.kind === "supply")).toBe(false);
  expect(s.engineersOf(0).length).toBe(C.ENGINEERS_MAX);
});

test("minor 6: a reserve order for a battery that is gone is refunded", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  expect(s.place("mortar", x, y)).toBeNull();
  const u = s.units.find(v => v.kind === "mortar")!;
  battle(s); u.deployT = 0;
  const m0 = s.spent();
  expect(s.buyReserve(u, 2)).toBeNull();
  expect(s.spent() - m0).toBe(2 * C.CRATE_PRICE_SHELLS);
  u.hp = -1; s.units.splice(s.units.indexOf(u), 1);
  run(s, C.CHINOOK_ETA_MAX + 4);
  expect(s.supply[0].orders.length).toBe(0);
  expect(s.spent()).toBe(m0); // refunded
  s.syncCounters();
  expect(s.stats.c.supplySpent).toBe(0);
}, 60000);
