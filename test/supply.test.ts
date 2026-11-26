import { expect, test } from "bun:test";
import * as C from "../src/config";
import { ammoClass, storePoint, pickJob, wantsAuto, useRate, chinookEta, startingStock, autoDefault, crateRounds, cratePrice, engineerPrice } from "../src/supply";

test("ammo classes", () => {
  for (const k of ["garrison", "sniper", "turret", "police", "militia", "para"] as const) expect(ammoClass(k)).toBe("small");
  for (const k of ["apc", "tank"] as const) expect(ammoClass(k)).toBe("vehicle");
  for (const k of ["mortar", "howitzer"] as const) expect(ammoClass(k)).toBe("shells");
  expect(ammoClass("himars")).toBe("rockets");
  for (const k of ["apache", "reaper", "gunboat", "battleship"] as const) expect(ammoClass(k)).toBe(null);
});

test("store point order", () => {
  expect(storePoint({ depot: [1, 1], evac: [2, 2], center: [3, 3] })).toEqual([1, 1]);
  expect(storePoint({ depot: null, evac: [2, 2], center: [3, 3] })).toEqual([2, 2]);
  expect(storePoint({ depot: null, evac: null, center: [3, 3] })).toEqual([3, 3]);
});

test("job priority and nearest first", () => {
  const j = { units: [{ id: 1, x: 3, y: 0, frac: 0.3, outside: false, reach: true }], walls: [{ id: 7, x: 1, y: 0, frac: 0.2 }], prio: "ammo" as const };
  expect(pickJob(0, 0, j, new Set())).toEqual({ kind: "reload", id: 1 });
  expect(pickJob(0, 0, { ...j, prio: "repair" }, new Set())).toEqual({ kind: "repair", id: 7 });
  expect(pickJob(0, 0, { ...j, units: [{ ...j.units[0], frac: 0.5 }] }, new Set())).toEqual({ kind: "repair", id: 7 });
  expect(pickJob(0, 0, j, new Set(["reload:1"]))).toEqual({ kind: "repair", id: 7 });
  expect(pickJob(0, 0, { ...j, units: [{ ...j.units[0], reach: false }], walls: [] }, new Set())).toBe(null);
  const two = { units: [{ id: 1, x: 9, y: 0, frac: 0.1, outside: false, reach: true }, { id: 2, x: 2, y: 0, frac: 0.3, outside: false, reach: true }], walls: [], prio: "ammo" as const };
  expect(pickJob(0, 0, two, new Set())).toEqual({ kind: "reload", id: 2 });
});

test("auto restock rule", () => {
  expect(wantsAuto(24, 100, false, true)).toBe(true);
  expect(wantsAuto(25, 100, false, true)).toBe(false);
  expect(wantsAuto(10, 100, true, true)).toBe(false);
  expect(wantsAuto(10, 100, false, false)).toBe(false);
});

test("use rate", () => {
  expect(useRate([[0, 100], [30, 100], [70, 100]], 80)).toBe(200);
  expect(useRate([], 80)).toBe(0);
});

test("chinook eta", () => {
  expect(chinookEta(0, false)).toBe(C.CHINOOK_ETA_MIN);
  expect(chinookEta(1e6, false)).toBe(C.CHINOOK_ETA_MAX);
  expect(chinookEta(0, true)).toBe(C.CHINOOK_ETA_MIN * 1.5);
});

test("starting stock scales", () => {
  const s = (d: C.Difficulty) => startingStock(d, false).small;
  expect(s("easy")).toBeGreaterThan(s("medium")); expect(s("medium")).toBeGreaterThan(s("hard")); expect(s("hard")).toBeGreaterThan(s("insane"));
  expect(startingStock("medium", true).small).toBe(startingStock("medium", false).small / 2);
  expect(startingStock("medium", false).small % crateRounds("small")).toBe(0);
});

test("auto default", () => {
  expect(autoDefault("easy")).toBe(true); expect(autoDefault("medium")).toBe(true);
  expect(autoDefault("hard")).toBe(false); expect(autoDefault("insane")).toBe(false);
});

test("prices", () => {
  expect(cratePrice("small")).toBe(C.CRATE_PRICE_SMALL);
  expect(engineerPrice(0, "easy")).toBe(C.ENGINEER_PRICE);
  expect(engineerPrice(2, "hard")).toBeGreaterThan(C.ENGINEER_PRICE);
});

// ---------- Task 2: zone stock, finite magazines, battery reserve ----------
import { Sim } from "../src/sim";
import { SE_OUT_OF_AMMO } from "../src/stats";
import { zone, zoneRoof, zoneStreet } from "./troopsFixture";

function mkZ(diff: C.Difficulty = "medium"): Sim { const s = new Sim(42, { budget: 400_000_000, difficulty: diff } as any); expect(s.setZone(zone(s))).toBeNull(); return s; }
function battle(s: Sim) { s.dev.bites = false; s.dev.waves = false; s.startBattle(); s.devClearInfected(); }
const unitAt = (s: Sim, kind: string) => s.units.find(u => u.kind === kind)!;

test("supply follows zones (add, clear)", () => {
  const s = mkZ();
  const z2: [number, number][] = zone(s, 10).map(([x, y]) => [x + 90, y + 90] as [number, number]);
  expect(s.addZone(z2)).toBeNull();
  expect(s.supply.length).toBe(s.zones.length);
  expect(s.supply[0].small).toBe(startingStock("medium", false).small);
  expect(s.supply[0].auto).toBe(true);
  s.clearZone();
  expect(s.supply.length).toBe(0);
});

test("no endless ammo in a zone", () => {
  const s = mkZ();
  const [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  const u = unitAt(s, "garrison");
  expect(u.ammo).toBe(C.UNITS.garrison.ammo);
  battle(s);
  for (let i = 0; i < 20; i++) s.spawnInfected(x + 6 + (i % 4), y + 6 + ((i / 4) | 0), C.INF_HP);
  for (let i = 0; i < 300 && u.ammo === C.UNITS.garrison.ammo; i++) s.step(C.DT);
  expect(Number.isFinite(u.ammo)).toBe(true);
  expect(u.ammo).toBeLessThan(C.UNITS.garrison.ammo);
});

test("battery reloads from reserve", () => {
  const s = mkZ();
  const [x, y] = zoneStreet(s);
  expect(s.place("mortar", x, y)).toBeNull();
  const u = unitAt(s, "mortar");
  expect(u.reserve).toBe(startingStock("medium", false).reserve * C.UNITS.mortar.ammo);
  battle(s);
  u.deployT = 0; u.ammo = 0; u.reserve = 120;
  for (let t = 0; t < C.APC_RELOAD_S + 0.2; t += C.DT) s.step(C.DT);
  expect(u.ammo).toBe(C.UNITS.mortar.ammo);
  expect(u.reserve).toBe(120 - C.UNITS.mortar.ammo);
});

test("empty unit pings once", () => {
  const s = mkZ();
  const [x, y] = zoneStreet(s);
  expect(s.place("turret", x, y)).toBeNull();
  battle(s);
  const u = unitAt(s, "turret"); u.deployT = 0; u.ammo = 0; u.reserve = 0;
  for (let t = 0; t < 5; t += C.DT) s.step(C.DT);
  expect(s.pingLog.filter(p => p.kind === "ammo").length).toBe(1);
  expect(s.stats.ev.k.filter(k => k === SE_OUT_OF_AMMO).length).toBe(1);
});

test("air and boats unchanged", () => {
  expect(C.UNITS.battleship.ammo).toBe(Infinity);
  const s = mkZ();
  const [x, y] = zoneStreet(s);
  expect(s.place("apache", x, y)).toBeNull();
  expect(unitAt(s, "apache").reserve).toBeUndefined();
});

// ---------- Task 3: orders, Chinooks, auto-restock ----------
import { SE_CHINOOK, SE_CHINOOK_ABORT } from "../src/stats";

test("planning purchase is on site", () => {
  const s = mkZ(), m0 = s.remaining(), s0 = s.supply[0].small;
  expect(s.buySupply(0, "small", 5)).toBeNull();
  expect(s.supply[0].small).toBe(s0 + 5 * C.CRATE_SMALL);
  expect(m0 - s.remaining()).toBe(5 * C.CRATE_PRICE_SMALL);
});

test("battle order arrives", () => {
  const s = mkZ(); battle(s);
  const s0 = s.supply[0].small, m0 = s.remaining();
  expect(s.buySupply(0, "small", 3)).toBeNull();
  expect(s.supply[0].small).toBe(s0);
  expect(m0 - s.remaining()).toBe(3 * C.CRATE_PRICE_SMALL);
  for (let t = 0; t < C.CHINOOK_ETA_MAX + 4; t += C.DT) s.step(C.DT);
  expect(s.supply[0].small).toBe(s0 + 3 * C.CRATE_SMALL);
  expect(s.stats.ev.k.filter(k => k === SE_CHINOOK).length).toBe(1);
}, 60000);

test("wave off and retry", () => {
  const s = mkZ(); battle(s);
  const s0 = s.supply[0].small, [sx, sy] = s.supply[0].store;
  expect(s.buySupply(0, "small", 2)).toBeNull();
  s.supply[0].orders[0].at = s.time + 1;
  for (let i = 0; i < 20; i++) s.spawnInfected(sx + 0.5 + (i % 5) * 0.3, sy + 0.5 + ((i / 5) | 0) * 0.3, 1e6);
  for (let t = 0; t < 2; t += C.DT) s.step(C.DT);
  expect(s.stats.ev.k.filter(k => k === SE_CHINOOK_ABORT).length).toBe(1);
  expect(s.supply[0].small).toBe(s0);
  s.devClearInfected();
  for (let t = 0; t < C.CHINOOK_RETRY_S + 2; t += C.DT) s.step(C.DT);
  expect(s.supply[0].small).toBe(s0 + 2 * C.CRATE_SMALL);
}, 60000);

test("auto-restock fires under 25%", () => {
  const s = mkZ("medium"); battle(s);
  const cap = startingStock("medium", false).small;
  s.supply[0].small = Math.floor(cap * 0.2);
  for (let t = 0; t < 3; t += C.DT) s.step(C.DT);
  expect(s.supply[0].orders.filter(o => o.cls === "small" && o.auto).length).toBe(1);
  for (let t = 0; t < 3; t += C.DT) s.step(C.DT);
  expect(s.supply[0].orders.filter(o => o.cls === "small" && o.auto).length).toBe(1);
});

test("auto off on hard by default", () => {
  const s = mkZ("hard"); battle(s);
  s.supply[0].small = 0;
  for (let t = 0; t < 4; t += C.DT) s.step(C.DT);
  expect(s.supply[0].orders.length).toBe(0);
  s.setAuto(0, true);
  for (let t = 0; t < 3; t += C.DT) s.step(C.DT);
  expect(s.supply[0].orders.length).toBeGreaterThan(0);
});

test("auto-restock waits for money", () => {
  const s = new Sim(42, { budget: 5_000_000, difficulty: "medium" } as any); expect(s.setZone(zone(s, 12))).toBeNull(); battle(s);
  s.budget = -1e9; // nothing left
  s.supply[0].small = 0;
  for (let t = 0; t < 4; t += C.DT) s.step(C.DT);
  expect(s.supply[0].orders.length).toBe(0);
  expect(s.supply[0].waitingMoney).toBe(true);
  expect(s.buySupply(0, "small", 1)).not.toBeNull();
});

test("battery reserve order goes to the battery", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  expect(s.place("mortar", x, y)).toBeNull();
  const u = s.units.find(v => v.kind === "mortar")!, r0 = u.reserve!;
  expect(s.buyReserve(u, 2)).toBeNull();
  expect(u.reserve).toBe(r0 + 2 * C.UNITS.mortar.ammo);
  battle(s); u.deployT = 0;
  expect(s.buyReserve(u, 1)).toBeNull();
  for (let t = 0; t < C.CHINOOK_ETA_MAX + 4; t += C.DT) s.step(C.DT);
  expect(u.reserve).toBeGreaterThanOrEqual(r0 + 3 * C.UNITS.mortar.ammo - C.UNITS.mortar.ammo); // it may have reloaded one magazine meanwhile
}, 60000);

// ---------- Task 6: Depot is the ammo store, Repair Yard half rate, Supply Shortage redefined ----------
import { BUILDING } from "../src/map";
function zoneRoofs(s: Sim, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.inZone.length && out.length < 400; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) out.push([i % s.w, (i / s.w) | 0]);
  return out;
}
function placeSup(s: Sim, kind: any): { x: number; y: number } {
  for (const [x, y] of zoneRoofs(s, 400)) if (s.placeSupport(kind, x, y) === null) return s.supports[s.supports.length - 1];
  throw new Error("could not place " + kind);
}

test("store point moves when the depot is gone", () => {
  const s = mkZ();
  const pad = placeSup(s, "evac"), dep = placeSup(s, "supply");
  expect(s.supply[0].store).toEqual([dep.x, dep.y]);
  battle(s);
  s.sellAt(dep.x, dep.y);
  for (let t = 0; t < 60 && s.supports.some(b => b.kind === "supply"); t += C.DT) s.step(C.DT);
  expect(s.supply[0].store).toEqual([pad.x, pad.y]);
}, 60000);

test("depot adds engineers and no drones", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  placeSup(s, "supply");
  expect(s.engineersOf(0).filter(e => e.alive).length).toBe(C.ENGINEERS_FREE + C.ENGINEERS_DEPOT);
  expect(s.place("turret", x, y)).toBeNull();
  battle(s);
  const u = s.units.find(v => v.kind === "turret")!; u.deployT = 0; u.ammo = 1000;
  let drones = 0;
  for (let t = 0; t < 20; t += C.DT) { s.step(C.DT); drones += s.transports.filter(tr => tr.kind === "drone_supply").length; }
  expect(drones).toBe(0);
}, 60000);

for (const [diff, mul] of [["medium", 1], ["hard", 0.5]] as const) test(`repair yard rate on ${diff} (0.60 lab: half on Hard and Insane only)`, () => {
  const s = mkZ(diff); s.closeAllGates();
  const y0 = placeSup(s, "repair");
  battle(s);
  for (const e of s.engineersOf(0)) e.alive = false; // engineers would repair too
  const w = s.zoneWallCells(0).filter(i => s.inZone[i] === 2).sort((a, b) => Math.hypot(a % s.w - y0.x, ((a / s.w) | 0) - y0.y) - Math.hypot(b % s.w - y0.x, ((b / s.w) | 0) - y0.y))[0];
  const yard = s.supports.find(b => b.kind === "repair")!; yard.deployT = 0;
  s.wallHp[w] = 100;
  for (let t = 0; t < 10; t += C.DT) s.step(C.DT);
  const gained = s.wallHp[w] - 100;
  expect(gained).toBeGreaterThan(C.REPAIR_WALL_HPS * mul * 10 * 0.8);
  expect(gained).toBeLessThan(C.REPAIR_WALL_HPS * mul * 10 * 1.2);
}, 60000);

test("shortage halves stock and slows chinooks", () => {
  const s = new Sim(42, { budget: 400_000_000, difficulty: "medium", mutators: ["supply_shortage"] } as any); s.setZone(zone(s));
  expect(s.supply[0].small).toBe(startingStock("medium", true).small);
  expect(chinookEta(10, true)).toBeCloseTo(chinookEta(10, false) * 1.5, 5);
  expect(C.MUTATORS.supply_shortage.short).toBe("Thin zone stock, slow Chinooks, +30% budget");
});

// ---------- Task 7: plans, saves, snapshots, the record ----------
import { encode, decode } from "../src/snapshot";
import { clean } from "../src/save";
import { makeRecord, emptyCareer, addToCareer } from "../src/battlerecord";

test("plan round trip keeps supply", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  expect(s.place("mortar", x, y)).toBeNull();
  s.buySupply(0, "small", 4); s.buySupply(0, "vehicle", 2); s.setAuto(0, false); s.setPrio(0, "repair"); s.buyEngineer(0);
  s.buyReserve(s.units[0], 3);
  const plan = s.exportSupplyPlan(s.units);
  expect(plan.supply[0]).toEqual({ small: 4, vehicle: 2, auto: false, prio: "repair", engineers: 1 });
  expect(plan.reserves).toEqual([[0, 3]]);
  const t = mkZ(); expect(t.place("mortar", x, y)).toBeNull();
  t.importSupplyPlan(plan.supply, plan.reserves, t.units);
  expect(t.supply[0].small).toBe(s.supply[0].small); expect(t.supply[0].vehicle).toBe(s.supply[0].vehicle);
  expect(t.supply[0].auto).toBe(false); expect(t.supply[0].prio).toBe("repair");
  expect(t.engineersOf(0).length).toBe(s.engineersOf(0).length);
  expect(t.units[0].reserve).toBe(s.units[0].reserve);
  expect(t.remaining()).toBe(s.remaining());
});

test("old plan loads with none bought", () => {
  const t = mkZ(); t.importSupplyPlan(undefined, undefined, t.units);
  expect(t.supply[0].small).toBe(startingStock("medium", false).small);
  expect(t.supply[0].auto).toBe(true);
});

test("save cleans plan supply", () => {
  const d = clean({ settings: {} as any, best: {}, plans: { fairhaven: { poly: [], walls: [], units: [], supply: [{ small: 1e9, vehicle: -5, auto: "x", prio: "bad", engineers: 3 }], reserves: [[0, 2], ["a", 1]] } as any } });
  expect(d.plans.fairhaven.supply).toEqual([{ small: 10000, vehicle: 0, auto: true, prio: "ammo", engineers: 3 }]);
  expect(d.plans.fairhaven.reserves).toEqual([[0, 2]]);
});

test("snapshot round trip mid-delivery", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  s.place("garrison", x, y); battle(s);
  const u = s.units.find(v => v.kind === "garrison")!; u.deployT = 0; u.ammo = 40;
  s.buySupply(0, "small", 2);
  for (let t = 0; t < 8; t += C.DT) s.step(C.DT); // an engineer is on the way, a Chinook is in the air
  expect(s.supply[0].orders.length).toBe(1);
  const t2 = decode(encode({ sim: s as any }, new Set([s]))).sim as any; Object.setPrototypeOf(t2, Sim.prototype);
  for (let t = 0; t < 120; t += C.DT) { s.step(C.DT); t2.step(C.DT); }
  expect(t2.supply[0].small).toBe(s.supply[0].small);
  expect(t2.engineersOf(0).map((e: any) => [e.x, e.y])).toEqual(s.engineersOf(0).map(e => [e.x, e.y]));
  expect(t2.stats.c).toEqual(s.stats.c);
}, 300000); // two whole-city sims for 120 s each: 135 s on an idle 8-thread machine

test("record has supply totals; career adds supply spent", () => {
  const s = mkZ(); s.buySupply(0, "small", 3); battle(s); s.buySupply(0, "small", 1);
  s.syncCounters();
  expect(s.stats.c.supplySpent).toBe(4 * C.CRATE_PRICE_SMALL);
  const score = { saved: 0, pct: 0, medal: null, reason: "", intact: 100, bonus: null, xp: 0, waves: 0, round: false, damage: 0, spent: 0, score: 0, parts: { saved: 0, speed: 0, city: 0, kills: 0 }, kills: 0 } as any;
  const r = makeRecord({ id: "x", date: "2026-11-25", version: "0.60.0", cityId: "q", cityName: "Q", kind: "quick", difficulty: "medium", sirenMin: 600, flags: { dev: false, modded: false } },
    { medal: null, score: 0, parts: { saved: 0, speed: 0, city: 0, kills: 0 }, roundComplete: false, abandoned: true, keepFighting: false }, score, s.stats, { roundAt: null, nukes: 0, bridges: 0, crushed: 0, budget: 1 });
  expect(r.totals.supplySpent).toBe(4 * C.CRATE_PRICE_SMALL);
  const c = emptyCareer(); addToCareer(c, r, 1);
  expect(c.supplySpent).toBe(4 * C.CRATE_PRICE_SMALL);
});

test("review I3: a battery is found by its stable id after another unit goes", () => {
  const s = mkZ(); const [x, y] = zoneStreet(s);
  expect(s.place("turret", x, y)).toBeNull();
  let placed = false; for (let d = 3; d < 30 && !placed; d++) if (s.place("mortar", x + d, y) === null || s.place("mortar", x, y + d) === null) placed = true;
  expect(placed).toBe(true);
  const m = s.units.find(u => u.kind === "mortar")!, sid = s.sidOf(m);
  s.units.splice(0, 1); // the turret goes: array indices shift
  expect(s.unitBySid(sid)).toBe(m);
  expect(s.unitBySid(9999)).toBeUndefined();
});
