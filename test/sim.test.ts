import { expect, test } from "bun:test";
import { Sim, INF, SAFE_CIV } from "../src/sim";
import type { Support } from "../src/sim";
import { BUILDING } from "../src/map";
import * as C from "../src/config";

function zoneAroundCenter(s: Sim, half = 30): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}

/** Run with the old 45 s warning: scenario tests tuned before 0.19.2 halved it (they test boats and strikes,
 *  not the warning length). */
function withWarning45(fn: () => void) {
  const keep = C.WARNING_S;
  C.TUNABLE.WARNING_S[1](45);
  try { fn(); } finally { C.TUNABLE.WARNING_S[1](keep); }
}

test("map has roads, buildings, water and bridges", () => {
  const s = new Sim(42);
  const counts = [0, 0, 0, 0, 0];
  for (const t of s.map.tile) counts[t]++;
  expect(counts.every(c => c > 0)).toBe(true);
});

test("zone costs scale with area and must fit the budget", () => {
  const s = new Sim(42);
  expect(s.setZone(zoneAroundCenter(s, 20))).toBeNull();
  const small = s.zoneCost();
  expect(s.setZone(zoneAroundCenter(s, 35))).toBeNull();
  expect(s.zoneCost()).toBeGreaterThan(small);
  expect(s.setZone([[0, 0], [s.w - 1, 0], [s.w - 1, s.h - 1], [0, s.h - 1]])).not.toBeNull(); // whole map: too expensive
  expect(s.zoneCost()).toBeGreaterThan(small); // previous zone kept
});

test("a full battle runs to an end with sane numbers", () => {
  const s = new Sim(7);
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  // every crossing starts as a gate; wall one off and check it flips back
  const g = s.inZone.indexOf(3);
  expect(g).toBeGreaterThan(-1);
  expect(s.toggleGate(g % s.w, (g / s.w) | 0)).toBeNull();
  expect(s.inZone[g]).toBe(2);
  // a sniper on a building inside the zone
  let placed = false;
  for (let i = 0; i < s.inZone.length && !placed; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) placed = s.place("sniper", i % s.w, (i / s.w) | 0) === null;
  expect(placed).toBe(true);
  expect(s.units[0].ammo).toBe(Infinity);
  s.startBattle();
  expect(s.sites.length).toBe(4);
  const t0 = performance.now();
  let ticks = 0;
  while (s.phase === "battle" && !s.roundDone && ticks < 20 * 480 + 20) { s.step(); ticks++; }
  expect(s.roundDone).toBe(true); // 0.20: the city empties (round over), the fight would go on...
  s.withdraw(); // ...until the player pulls out
  const ms = performance.now() - t0;
  const c = s.counts();
  console.log({ ticks, msPerTick: +(ms / ticks).toFixed(2), ...c, kills: s.kills, breaches: s.breaches, result: s.result });
  expect(s.phase).toBe("over");
  expect(c.civ + c.safe + c.inf).toBeLessThanOrEqual(s.n);
  for (let k = 0; k < s.n; k++) { expect(Number.isFinite(s.ax[k])).toBe(true); }
}, 120000);

test("changing the plan moves the outbreak", () => {
  const a = new Sim(7), b = new Sim(7);
  a.setZone(zoneAroundCenter(a)); b.setZone(zoneAroundCenter(b, 28));
  a.startBattle(); b.startBattle();
  expect(JSON.stringify(a.sites)).not.toBe(JSON.stringify(b.sites));
});

test("campaign cities apply their own budget, outbreak sites and horde size", () => {
  const { CITIES } = require("../src/config");
  const last = CITIES[CITIES.length - 1];
  const s = new Sim(last.seed, { budget: last.budget, waveMul: last.waveMul, sites: last.sites, speedMul: last.speedMul });
  expect(s.budget).toBe(last.budget * 2);
  expect(new Sim(last.seed, { budget: last.budget, civilians: 60000 }).budget).toBe(last.budget * 4); // sqrt(4x crowd)
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  expect(s.sites.length).toBe(last.sites);
  // every city must be winnable on paper: a zone fits the budget with money left for units
  for (const c of CITIES) { const t = new Sim(c.seed, { budget: c.budget }); expect(t.setZone(zoneAroundCenter(t))).toBeNull(); expect(t.remaining()).toBeGreaterThan(4_000_000); }
});

test("abilities: bought with budget, fired in battle, they kill", () => {
  const s = new Sim(42, { budget: 60_000_000 });
  s.setZone(zoneAroundCenter(s));
  const before = s.remaining();
  expect(s.buyAbility("airstrike")).toBeNull();
  expect(s.buyAbility("firebomb")).toBeNull();
  expect(s.buyAbility("para")).toBeNull();
  expect(before - s.remaining()).toBe(C.ABILITIES.airstrike.cost + C.ABILITIES.firebomb.cost + C.ABILITIES.para.cost);
  expect(s.sellAbility("para")).toBe(true);
  expect(s.buyAbility("para")).toBeNull();
  expect(s.useAbility("airstrike", 10, 10, 50, 10)).not.toBeNull(); // not during planning
  // mortar on a street inside the zone
  let mortarAt: number[] | null = null;
  for (let i = 0; i < s.inZone.length && !mortarAt; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 0) mortarAt = [i % s.w, (i / s.w) | 0];
  expect(s.place("mortar", mortarAt![0], mortarAt![1])).toBeNull();
  s.startBattle();
  for (let i = 0; i < 20 * 60; i++) s.step(); // let the outbreak grow
  // aim everything at a live infected crowd
  const infIdx = s.state.indexOf(1);
  const x = Math.round(s.ax[infIdx]), y = Math.round(s.ay[infIdx]);
  const k0 = s.kills, c0 = s.civKilledByUs;
  const ax0 = Math.max(5, Math.min(s.w - 45, x - 20)), ax1 = ax0 + 40;
  expect(s.useAbility("airstrike", ax0, y, ax1, y)).toBeNull();
  expect(s.useAbility("airstrike", x, y, x, y + 10)).not.toBeNull(); // only one bought
  expect(s.useAbility("firebomb", x, y)).toBeNull();
  expect(s.useAbility("para", x, y)).toBeNull();
  for (let i = 0; i < 20 * 8; i++) s.step();
  expect(s.kills).toBeGreaterThan(k0);
  expect(s.units.some(u => u.kind === "para")).toBe(true);
  expect(s.civKilledByUs).toBeGreaterThanOrEqual(c0);
  expect(s.pending.length).toBe(0);
  const mortar = s.units.find(u => u.kind === "mortar")!;
  for (let i = 0; i < 20 * 60 && s.phase === "battle"; i++) s.step();
  console.log({ mortarKills: mortar.kills, paraKills: s.units.find(u => u.kind === "para")!.kills, civKilledByUs: s.civKilledByUs });
}, 120000);

test("a charged bridge can be blown and becomes river", () => {
  const s = new Sim(1234);
  expect(s.bridges.length).toBeGreaterThan(0);
  const cell = s.bridges[0][0], x = cell % s.w, y = (cell / s.w) | 0;
  expect(s.blowBridge(x, y)).not.toBeNull(); // not in planning
  s.setZone(zoneAroundCenter(s));
  expect(s.toggleC4(x, y)).toBeNull();
  expect(s.c4.size).toBe(1);
  s.startBattle();
  s.step();
  expect(s.blowBridge(x, y)).toBeNull();
  expect(s.bridges[0].every(i => s.map.tile[i] === 3)).toBe(true);
  expect(s.mapVersion).toBe(1);
  s.step(); // fields rebuild without the bridge
  expect(s.blowBridge(x, y)).not.toBeNull(); // only once
}, 60000);

test("APC thinks: hunts, goes home to reload when low, comes back out", () => {
  const s = new Sim(42, { budget: 60_000_000 });
  s.setZone(zoneAroundCenter(s));
  let post: number[] | null = null;
  const cx = s.w / 2 + 45, cy = s.h / 4;
  for (let r = 0; r < 20 && !post; r++) for (let dy = -r; dy <= r && !post; dy++) for (let dx = -r; dx <= r && !post; dx++) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (s.map.tile[s.idx(x, y)] === 0 && !s.inZone[s.idx(x, y)] && !s.canPlace("apc", x, y)) post = [x, y];
  }
  expect(s.place("apc", post![0], post![1])).toBeNull();
  const u = s.units[0];
  s.startBattle();
  for (let i = 0; i < 20 * 5; i++) s.step();
  u.ammo = 5; u.thinkT = 0; // nearly dry
  const seen = new Set<string>();
  for (let i = 0; i < 20 * 60 && !(seen.has("reload") && u.ai === "hunt"); i++) { s.step(); seen.add(u.ai!); }
  expect([...seen]).toEqual(expect.arrayContaining(["home", "reload", "hunt"]));
  expect(u.ammo).toBe(C.UNITS.apc.ammo);
}, 60000);

test("gunboat patrols the river; battleship shells from it", () => withWarning45(() => {
  const s = new Sim(1234, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s));
  const water: number[] = [];
  for (let i = 0; i < s.map.tile.length; i++) if (s.map.tile[i] === 3) water.push(i);
  const w1 = water[Math.floor(water.length / 3)], w2 = water[Math.floor((2 * water.length) / 3)];
  expect(s.place("gunboat", 5, 5)).not.toBeNull(); // not on land
  expect(s.place("gunboat", w1 % s.w, (w1 / s.w) | 0)).toBeNull();
  expect(s.place("battleship", w2 % s.w, (w2 / s.w) | 0)).toBeNull();
  s.startBattle();
  const boat = s.units[0], ship = s.units[1];
  const start = [boat.x, boat.y];
  // 0.24: the rolled outbreaks move where the infected are; give the gunboat a crowd on the bank to chase
  let put = 0;
  for (let dy = -25; dy <= 25 && put < 60; dy++) for (let dx = -25; dx <= 25 && put < 60; dx++) {
    const x = (boat.x | 0) + dx, y = (boat.y | 0) + dy;
    if (Math.hypot(dx, dy) < 12 || x < 0 || y < 0 || x >= s.w || y >= s.h || s.map.tile[s.idx(x, y)] !== 0 || s.inZone[s.idx(x, y)]) continue;
    s.spawnInfected(x + 0.5, y + 0.5, C.INF_HP); put++;
  }
  let salvo = 0; // battleship fires 3-shell broadsides
  for (let i = 0; i < 20 * 150; i++) { s.step(); const sh = s.blasts.filter(b => b.color === C.UNITS.battleship.color && b.t === s.time).length; salvo = Math.max(salvo, sh); }
  expect(salvo).toBe(C.UNITS.battleship.salvo!);
  expect(boat.x !== start[0] || boat.y !== start[1]).toBe(true);
  expect(s.map.tile[s.idx((boat.x + 0.5) | 0, (boat.y + 0.5) | 0)] === 3 || s.map.tile[s.idx((boat.x + 0.5) | 0, (boat.y + 0.5) | 0)] === 4).toBe(true);
  expect(boat.kills + ship.kills).toBeGreaterThan(0);
  console.log({ gunboatKills: boat.kills, battleshipKills: ship.kills });
}), 120000);

test("money: income in battle, purchases, extra zones, selling takes time, gates both ways", () => {
  const s = new Sim(7);
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  const extra = s.priceOf([[20, 20], [50, 20], [50, 40], [20, 40]]);
  expect(extra).toBeGreaterThan(3000);
  s.startBattle();
  const m0 = s.remaining();
  for (let i = 0; i < 20 * 31; i++) s.step();
  expect(s.earned).toBeGreaterThan(0);
  expect(s.remaining()).toBe(m0 + s.earned);
  // buy a garrison mid-battle: it deploys before it fires, and costs money
  let at: number[] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 1 && !s.canPlace("garrison", i % s.w, (i / s.w) | 0)) at = [i % s.w, (i / s.w) | 0];
  const before = s.remaining();
  expect(s.place("garrison", at![0], at![1])).toBeNull();
  expect(s.remaining()).toBe(before - C.UNITS.garrison.cost);
  const g = s.units[s.units.length - 1];
  expect(g.deployT).toBe(5);
  // sell it: gone after 7.5 s, refunded
  const t = s.sellAt(at![0] + 0.5, at![1] + 0.5);
  expect(t).toBe(7.5);
  const mid = s.remaining();
  for (let i = 0; i < 20 * 8; i++) s.step();
  expect(s.units.includes(g)).toBe(false);
  expect(s.remaining()).toBeGreaterThanOrEqual(mid + 600);
  expect(s.unitsLost).toBe(0);
  // gates: close then reopen in battle
  const gi = s.inZone.indexOf(3);
  const gx = gi % s.w, gy = (gi / s.w) | 0;
  expect(s.toggleGate(gx, gy)).toBeNull();
  expect(s.inZone[gi]).toBe(2);
  expect(s.toggleGate(gx, gy)).toBeNull();
  expect(s.inZone[gi]).toBe(3);
}, 120000);

test("howitzer, fuel depots, target priority", () => {
  const s = new Sim(7, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s));
  expect(s.depots.length).toBeGreaterThanOrEqual(3);
  let at: number[] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 0 && !s.canPlace("howitzer", i % s.w, (i / s.w) | 0)) at = [i % s.w, (i / s.w) | 0];
  expect(s.place("howitzer", at![0], at![1])).toBeNull();
  // a garrison set to protect the walls
  let g: number[] | null = null;
  for (let i = 0; i < s.inZone.length && !g; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 1 && !s.canPlace("garrison", i % s.w, (i / s.w) | 0)) g = [i % s.w, (i / s.w) | 0];
  s.place("garrison", g![0], g![1]);
  expect(s.cycleTarget(g![0] + 0.5, g![1] + 0.5)).toBe("wall");
  expect(s.cycleTarget(g![0] + 0.5, g![1] + 0.5)).toBe("civ");
  expect(s.cycleTarget(g![0] + 0.5, g![1] + 0.5)).toBe("near");
  s.cycleTarget(g![0] + 0.5, g![1] + 0.5);
  s.dev.unitDamage = false; // 0.24: the howitzer has armor now; this test is about its shooting, not its survival
  const d = s.depots.find(d => !s.inZone[s.idx(d.x, d.y)])!;
  expect(s.blowDepot(d.x, d.y)).not.toBeNull(); // not while planning
  s.startBattle();
  const safe0 = () => s.counts().safe;
  for (let i = 0; i < 20 * 120; i++) s.step();
  const k0 = s.kills, safe = safe0();
  expect(s.blowDepot(d.x, d.y)).toBeNull();
  expect(s.blowDepot(d.x, d.y)).not.toBeNull(); // once
  s.step();
  const how = s.units.find(u => u.kind === "howitzer")!;
  expect(how.kills).toBeGreaterThan(0);
  expect(safe0()).toBeGreaterThan(safe - 50); // shells and the depot stay off our own people unless the depot is inside
  console.log({ howitzerKills: how.kills, garrisonWallKills: s.units.find(u => u.kind === "garrison")!.kills, depotKills: s.kills - k0 });
}, 120000);

test("support buildings: budget discount, radio range, command rate, supply ammo, repair yard, police and militia squads", () => {
  const s = new Sim(7, { budget: 70_000_000 });
  const bld: [number, number][] = [];
  expect(s.canPlaceSupport("budget", 200, 75)).not.toBeNull(); // needs a safe zone first
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  for (let i = 0; i < s.inZone.length && bld.length < 12; i++) {
    if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) {
      const x = i % s.w, y = (i / s.w) | 0;
      if (bld.every(([bx, by]) => Math.hypot(bx - x, by - y) >= 4)) bld.push([x, y]);
    }
  }
  expect(bld.length).toBeGreaterThanOrEqual(8);

  // 1. Budget office discounts nearby placements by 20%
  const beforeBudget = s.remaining();
  expect(s.placeSupport("budget", bld[0][0], bld[0][1])).toBeNull();
  expect(beforeBudget - s.remaining()).toBe(1_000_000);
  const beforeGar = s.remaining();
  expect(s.place("garrison", bld[1][0], bld[1][1])).toBeNull();
  expect(beforeGar - s.remaining()).toBe(960_000); // 20% off 1.2M

  // 2. Radio tower boosts unit range by 40%, Command post boosts rate by 30%
  const baseRange = s.units[0].range;
  expect(s.placeSupport("radio", bld[2][0], bld[2][1])).toBeNull();
  expect(s.placeSupport("command", bld[3][0], bld[3][1])).toBeNull();
  expect(s.units[0].range).toBeCloseTo(baseRange * 1.4, 2);
  expect(s.units[0].rateMul).toBeCloseTo(1.3, 2);

  // 3. Supply depot, Repair yard, Precinct (police) and Armory (militia)
  expect(s.placeSupport("supply", bld[4][0], bld[4][1])).toBeNull();
  expect(s.placeSupport("repair", bld[5][0], bld[5][1])).toBeNull();
  expect(s.placeSupport("police", bld[6][0], bld[6][1])).toBeNull();
  expect(s.placeSupport("militia", bld[7][0], bld[7][1])).toBeNull();

  // Place a turret on a road inside the zone (finite ammo, supplied by Supply depot)
  let roadIn: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !roadIn; i++) {
    if (s.inZone[i] === 1 && s.map.tile[i] === 0 && !s.canPlace("turret", i % s.w, (i / s.w) | 0)) {
      roadIn = [i % s.w, (i / s.w) | 0];
    }
  }
  expect(s.place("turret", roadIn![0], roadIn![1])).toBeNull();
  const turret = s.units.find(u => u.kind === "turret")!;
  expect(turret.supplied).toBe(true);

  // Damage a gate cell near the repair yard and deplete turret ammo to verify repair + supply in battle
  const gateIdx = s.inZone.findIndex((z, i) => z === 3 && Math.hypot((i % s.w) - bld[5][0], ((i / s.w) | 0) - bld[5][1]) <= 45);
  expect(gateIdx).toBeGreaterThan(-1);

  s.startBattle();
  s.wallHp[gateIdx] = 1000; // damaged gate (max 3000)
  turret.ammo = 500; // depleted from 1800

  for (let i = 0; i < 20 * 10; i++) s.step();
  expect(s.wallHp[gateIdx]).toBeGreaterThan(1000); // repaired by Repair yard
  expect(turret.ammo).toBeGreaterThan(500); // resupplied by Supply depot
  expect(s.units.some(u => u.kind === "police")).toBe(true); // Precinct spawned Police Squad
  expect(s.units.some(u => u.kind === "militia")).toBe(true); // Armory spawned Militia
}, 60000);

test("real OpenStreetMap cities decode cleanly at 560x420 with buildings, highways, mass transit rail/stations, parks, water and bridges", () => {
  const { REAL_CITIES, REAL_MAP_W, REAL_MAP_H } = require("../src/config");
  const { INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION } = require("../src/map");
  expect(REAL_CITIES.length).toBe(8);
  for (const rc of REAL_CITIES) {
    const s = new Sim(rc.seed, { realCityId: rc.id, budget: rc.budget, civilians: 2000 });
    expect(s.w).toBe(REAL_MAP_W);
    expect(s.h).toBe(REAL_MAP_H);
    const counts = [0, 0, 0, 0, 0];
    let hwy = 0, rail = 0, station = 0;
    for (let i = 0; i < s.w * s.h; i++) {
      const t = s.map.tile[i];
      counts[t]++;
      if (t === 0 || t === 4) {
        const inf = s.map.height[i];
        if (inf === INFRA_HIGHWAY) hwy++;
        else if (inf === INFRA_RAIL) rail++;
        else if (inf === INFRA_STATION) station++;
      }
    }
    expect(counts[0]).toBeGreaterThan(2000); // roads, highways & rail
    expect(counts[1]).toBeGreaterThan(2000); // real building footprints
    expect(counts[2]).toBeGreaterThan(200);  // parks & courtyards
    expect(counts[3]).toBeGreaterThan(800);  // water
    expect(counts[4]).toBeGreaterThan(15);   // bridges
    expect(hwy).toBeGreaterThan(500);        // Interstate / Highway cells
    expect(rail).toBeGreaterThan(200);       // Mass Transit Rail cells
    expect(station).toBeGreaterThan(20);     // Mass Transit Station cells
    expect(s.railLines.length).toBeGreaterThanOrEqual(1);
    expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  }
});

test("swimmer mutants swim across water when bridges are blown while normal infected cannot", () => {
  const s = new Sim(42, { budget: 60_000_000, civilians: 1000 });
  s.setZone(zoneAroundCenter(s, 25));
  for (let b = 0; b < s.bridges.length; b++) s.c4.add(b);
  s.startBattle();
  for (let b = 0; b < s.bridges.length; b++) {
    const cell = s.bridges[b][0];
    expect(s.blowBridge(cell % s.w, (cell / s.w) | 0)).toBeNull();
  }
  s.devClearInfected();
  s.dev.waves = false;
  s.step(); // rebuilds infField and swimField with all bridges gone

  // Find a water cell that has a valid swimField path toward the safe zone
  let waterCell = -1;
  for (let i = 0; i < s.w * s.h; i++) {
    if (s.map.tile[i] === 3 && s.swimField[i] < 65535 && s.infField[i] === 65535) {
      waterCell = i;
      break;
    }
  }
  expect(waterCell).toBeGreaterThan(-1);
  const wx = (waterCell % s.w) + 0.5, wy = ((waterCell / s.w) | 0) + 0.5;
  expect(s.passable(waterCell, true, false)).toBe(false); // normal infected blocked by water
  expect(s.passable(waterCell, true, true)).toBe(true);   // swimmer mutant can traverse water

  expect(s.spawnInfected(wx, wy, 350, true)).toBe(true);
  const swIdx = s.state.findIndex((st, idx) => idx >= s.civN && st === 1 && s.mutant[idx] === 1);
  expect(swIdx).toBeGreaterThanOrEqual(s.civN);
  const d0 = s.swimField[s.idx(s.ax[swIdx] | 0, s.ay[swIdx] | 0)];
  for (let i = 0; i < 60; i++) s.step();
  const d1 = s.swimField[s.idx(s.ax[swIdx] | 0, s.ay[swIdx] | 0)];
  expect(d1).toBeLessThan(d0); // swimmer moved closer to the safe zone through water
});

test("mutators and daily challenge modify rules deterministically and kill heatmaps record spatial kills", () => {
  const { dailyChallengeFor } = require("../src/config");
  const d1 = dailyChallengeFor("2026-11-08");
  const d2 = dailyChallengeFor("2026-11-08");
  const d3 = dailyChallengeFor("2026-11-09");
  expect(d1).toEqual(d2);
  expect(d1.mutators.length).toBe(2);
  expect(d1.mutators[0]).not.toBe(d1.mutators[1]);
  expect(d1.seed !== d3.seed || d1.city.id !== d3.city.id).toBe(true);

  // Supply shortage + fragile walls + titan strain
  const s = new Sim(7, { budget: 20_000_000, mutators: ["supply_shortage", "fragile_walls", "titan_strain"], civilians: 2000 });
  expect(s.budget).toBe(Math.round(Math.round(40_000_000 * 1.35) * 1.3)); // budget doubled, small crowds never cut it
  expect(s.wallMaxHp()).toBe(4000);
  expect(s.gateMaxHp()).toBe(1500);
  expect(s.supportCost("supply")).toBe(1_000_000); // 50% off under supply_shortage
  expect(s.supportCost("repair")).toBe(1_350_000); // 25% off under fragile_walls
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();

  let bld = -1;
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) { bld = i; break; }
  expect(s.place("sniper", bld % s.w, (bld / s.w) | 0)).toBeNull();
  const sniper = s.units[0];
  expect(sniper.ammo).toBe(160); // 2x magazine (not Infinity) under supply_shortage
  const lvl = s.map.height[bld];
  expect(sniper.range).toBeCloseTo((22 + 2.5 * lvl) * 1.3, 2); // +30% roof range under fragile_walls

  s.startBattle();
  // Spawn an infected right in front of the sniper so it gets killed and populates killGrid + killByKind
  const sx = sniper.x + 2, sy = sniper.y;
  s.spawnInfected(sx, sy, 50, true);
  for (let i = 0; i < 40; i++) s.step();
  expect(s.kills).toBeGreaterThan(0);
  expect(s.swimmersKilled).toBeGreaterThan(0);
  expect(s.maxKillCell).toBeGreaterThanOrEqual(1);
  let totalHeat = 0, sniperHeat = 0;
  for (const v of s.killGrid) totalHeat += v;
  for (const v of s.killByKind.sniper ?? []) sniperHeat += v;
  expect(totalHeat).toBe(s.kills);
  expect(sniperHeat).toBe(sniper.kills);
});

test("terrain & building destruction, air/helo/APC deployment vehicles, supply drops, and tactical info specs", () => {
  const C = require("../src/config");
  // Verify hover info metadata for all units and support buildings
  for (const k of Object.keys(C.UNITS)) expect(C.UNIT_INFO[k]?.role.length).toBeGreaterThan(3);
  for (const k of Object.keys(C.SUPPORTS)) expect(C.SUPPORT_INFO[k]?.role.length).toBeGreaterThan(3);

  const s = new Sim(42, { budget: 70_000_000, civilians: 1500 });
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  expect(s.buyAbility("supply_drop")).toBeNull();
  s.startBattle();

  // 1. Find an outside building and shell it repeatedly until its floors crumble and it collapses into walkable rubble
  let outBld = -1;
  for (let i = 0; i < s.w * s.h; i++) {
    const x = i % s.w, y = (i / s.w) | 0;
    if (s.map.tile[i] === BUILDING && !s.unitInZone({ x, y }) && s.map.height[i] >= 3) {
      outBld = i;
      break;
    }
  }
  expect(outBld).toBeGreaterThan(-1);
  const bx = outBld % s.w, by = (outBld / s.w) | 0;
  const h0 = s.map.height[outBld];
  s.damageTerrain(bx + 0.5, by + 0.5, 3, 65);
  expect(s.damage[outBld]).toBeGreaterThan(0);
  expect(s.map.height[outBld]).toBeLessThan(h0);
  expect(s.craters.length).toBeGreaterThan(0);

  // Finish demolishing the building
  s.damageTerrain(bx + 0.5, by + 0.5, 3, 180);
  expect(s.rubble[outBld]).toBe(1);
  expect(s.map.tile[outBld]).toBe(0); // now walkable rubble street/lot
  expect(s.buildingsCollapsed).toBeGreaterThanOrEqual(1);

  // Safe zone buildings are protected from collapsing
  let zoneBld = -1;
  for (let i = 0; i < s.w * s.h; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) { zoneBld = i; break; }
  expect(zoneBld).toBeGreaterThan(-1);
  s.damageTerrain((zoneBld % s.w) + 0.5, ((zoneBld / s.w) | 0) + 0.5, 4, 240);
  expect(s.map.tile[zoneBld]).toBe(BUILDING);
  expect(s.rubble[zoneBld]).toBe(0);

  // 2. Mid-battle unit deployments spawn UH-60, CH-47, and C-130J heavy APC parachute drops
  const zx = zoneBld % s.w, zy = (zoneBld / s.w) | 0;
  expect(s.place("sniper", zx, zy)).toBeNull();
  expect(s.transports.some(t => t.kind === "helo_uh60")).toBe(true);

  let roadCell = -1;
  for (let i = 0; i < s.w * s.h; i++) {
    const rx = i % s.w, ry = (i / s.w) | 0;
    if (s.inZone[i] === 1 && s.map.tile[i] === 0 && !s.canPlace("apc", rx, ry)) { roadCell = i; break; }
  }
  expect(roadCell).toBeGreaterThan(-1);
  const rx = roadCell % s.w, ry = (roadCell / s.w) | 0;
  expect(s.place("apc", rx, ry)).toBeNull();
  expect(s.transports.some(t => t.kind === "c130_apc")).toBe(true);
  expect(s.chutes.some(c => c.kind === "apc")).toBe(true);

  // Advance until APC finishes deploying, then spawn an infected nearby so the APC dismounts its Mechanized Rifle Team
  for (let i = 0; i < 20 * 11; i++) s.step();
  const apc = s.units.find(u => u.kind === "apc")!;
  s.spawnInfected(apc.x + 2, apc.y, 2000, false);
  s.step();
  expect(apc.dismounted).toBe(true);
  expect(s.units.some(u => u.kind === "militia" && u.parentUnit === apc)).toBe(true);

  // 3. Call a Supply Drop near the APC and a damaged gate: refills ammo, heals APC, repairs gate, and leaves supply crates
  apc.ammo = 20;
  apc.hp = 300;
  const gateCell = s.inZone.findIndex(z => z === 3);
  s.wallHp[gateCell] = 500;
  expect(s.useAbility("supply_drop", apc.x, apc.y)).toBeNull();
  expect(s.transports.some(t => t.kind === "c130_supply")).toBe(true);
  for (let i = 0; i < 20 * 5; i++) s.step();
  expect(apc.ammo).toBe(C.UNITS.apc.ammo);
  expect(apc.hp).toBe(900);
  expect(s.supplyCrates.length).toBeGreaterThan(0);
});

test("APC autocannon: a second gun with a small blast, on its own timer", () => {
  const s = new Sim(42, { budget: 60_000_000 });
  s.setZone(zoneAroundCenter(s));
  const gate = s.inZone.findIndex(z => z === 3);
  const gx = gate % s.w, gy = (gate / s.w) | 0;
  let post: number[] | null = null; // a road just outside the gate
  for (let r = 2; r < 12 && !post; r++) for (let dy = -r; dy <= r && !post; dy++) for (let dx = -r; dx <= r && !post; dx++) {
    const x = gx + dx, y = gy + dy;
    if (s.map.tile[s.idx(x, y)] === 0 && !s.inZone[s.idx(x, y)] && !s.canPlace("apc", x, y)) post = [x, y];
  }
  expect(s.place("apc", post![0], post![1])).toBeNull();
  const u = s.units[0];
  s.startBattle();
  let cannon = 0;
  for (let i = 0; i < 20 * 120 && cannon < 3; i++) { s.step(); cannon += s.blasts.filter(b => b.color === C.UNITS.apc.color && b.t === s.time).length; }
  console.log({ apcCannonShots: cannon, apcKills: u.kills, t: Math.round(s.time) });
  expect(cannon).toBeGreaterThanOrEqual(3);
}, 120000);

// ---------- 0.10 battle flow ----------
test("warning, then outbreak; hordes walk in along entry routes; no time limit", () => {
  const s = new Sim(42, { budget: 60_000_000 });
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  expect(s.entries.length).toBeGreaterThan(0);
  expect(s.upcoming.length).toBe(1);
  while (s.time < C.WARNING_S - 1) s.step();
  expect(s.counts().inf).toBe(0); // warning: nobody has turned yet
  expect(s.counts().safe).toBeGreaterThan(0); // people already heading in
  while (s.time < C.WARNING_S + 1) s.step();
  expect(s.outbreak).toBe(true);
  expect(s.counts().inf).toBeGreaterThan(0);
  s.dev.bites = false; // keep people alive so the battle can run long
  const entry = s.entries[s.upcoming[0]];
  while (s.wave < 1) s.step();
  const wave1Count = s.lastWaveCount;
  for (let i = 0; i < Math.round(C.WAVE_MARCH_S / C.DT) + 2; i++) s.step();
  let nearEntry = 0;
  for (let k = s.civN; k < s.n; k++) if (s.state[k] === INF && entry.cells.some(([x, y]) => Math.hypot(s.ax[k] - x, s.ay[k] - y) < 25)) nearEntry++;
  expect(nearEntry).toBeGreaterThan(wave1Count * 0.3); // the horde came in on its route
  let wave8Count = 0;
  while ((s.time < 330 || s.wave < 8) && s.phase === "battle") {
    s.step(C.DT * 2);
    if (s.wave === 8 && !wave8Count) wave8Count = s.lastWaveCount;
  }
  expect(s.phase).toBe("battle"); // past the old 5-minute cap and still going
  expect(wave8Count || s.lastWaveCount).toBeGreaterThan(wave1Count); // and the hordes keep growing
}, 120000);

test("Evac Points fly people out (score + money); a swarmed pad waves off; round completes; pull out ends it", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  let pad: Support | undefined;
  for (let i = 0; i < s.inZone.length && !pad; i++) {
    if (s.inZone[i] !== 1 || s.map.tile[i] !== BUILDING) continue;
    if (!s.placeSupport("evac", i % s.w, (i / s.w) | 0)) pad = s.supports[s.supports.length - 1];
  }
  expect(pad).toBeDefined();
  s.dev.bites = false;
  s.startBattle();
  const money0 = s.remaining();
  while (s.time < 40) s.step();
  expect(s.liftsFlown).toBeGreaterThan(0);
  expect(s.evacuated).toBeGreaterThan(0);
  expect(s.remaining()).toBeGreaterThan(money0); // evac pay (plus income)
  const before = s.liftsAborted;
  for (let j = 0; j < C.EVAC_ABORT_INF + 4; j++) s.spawnInfected(pad!.x + 0.5, pad!.y + 2.5, 1e9);
  const t0 = s.time; while (s.time < t0 + C.EVAC_EVERY_S + 4) s.step();
  expect(s.liftsAborted).toBeGreaterThan(before);
  s.devClearInfected();
  // 0.20: the round ends when nobody is left in the city (here: the rest are removed), then Keep fighting
  s.devRemoveCivilians();
  for (let i = 0; i < 20; i++) s.step();
  expect(s.roundDone).toBe(true);
  expect(s.roundResult!.round).toBe(true);
  expect(s.roundResult!.score).toBeGreaterThan(0);
  expect(s.phase).toBe("battle"); // keep fighting
  const medal = s.roundResult!.medal;
  s.withdraw();
  expect(s.phase).toBe("over");
  expect(s.result!.medal).toBe(medal); // frozen at round end
  expect(s.result!.mayhem).toBeUndefined(); // pulled out right at round end: nothing after the round, no Mayhem (final review #5)
  expect(s.result!.saved).toBe(s.evacuated);
  expect(s.result!.xp).toBeGreaterThan(0);
  expect(s.result!.intact).toBeGreaterThan(90);
  expect(s.result!.bonus).toBe("Light Touch");
}, 120000);

test("mobile units kite: infected close in, the squad backs away instead of standing still", () => {
  const s = new Sim(42, { budget: 60_000_000 });
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  while (!s.outbreak) s.step();
  s.devClearInfected(); s.dev.waves = false;
  // a police squad on an open road, an infected right next to it
  let spot: number[] | null = null;
  for (let i = 0; i < s.map.tile.length && !spot; i++) { const x = i % s.w, y = (i / s.w) | 0; if (!s.inZone[i] && s.map.tile[i] === 0 && s.openness(x, y) >= 40 && x > 20 && y > 20) spot = [x, y]; }
  s.units.push({ kind: "police", x: spot![0], y: spot![1], range: C.UNITS.police.range, ammo: 0, cooldown: 99, kills: 0, shotX: 0, shotY: 0, shotT: -1, post: [spot![0], spot![1]], hp: 1e9, ai: "hunt", thinkT: 99 });
  const u = s.units[s.units.length - 1];
  s.spawnInfected(spot![0] + 2.5, spot![1] + 0.5, 1e9);
  const x0 = u.x, y0 = u.y;
  for (let i = 0; i < 10; i++) s.step();
  expect(u.kiting).toBe(true);
  expect(Math.hypot(u.x - x0, u.y - y0)).toBeGreaterThan(0.5);
});

// ---------- 0.11 strike orders + escalation ----------
test("strike orders send a mobile unit to clear and hold a spot", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s));
  let post: number[] | null = null;
  for (let i = 0; i < s.inZone.length && !post; i++) { const x = i % s.w, y = (i / s.w) | 0; if (s.map.tile[i] === 0 && !s.inZone[i] && !s.canPlace("apc", x, y) && Math.hypot(x - s.w / 2, y - s.h / 3) < 60) post = [x, y]; }
  expect(s.place("apc", post![0], post![1])).toBeNull();
  s.startBattle();
  const u = s.mobileAt(post![0] + 0.5, post![1] + 0.5)!;
  expect(u).not.toBeNull();
  let dest: number[] | null = null;
  for (let i = 0; i < s.map.tile.length && !dest; i++) { const x = i % s.w, y = (i / s.w) | 0; if (s.map.tile[i] === 0 && Math.hypot(x - post![0], y - post![1]) > 25 && Math.hypot(x - post![0], y - post![1]) < 35) dest = [x, y]; }
  const bld = s.map.tile.findIndex(t => t === BUILDING);
  expect(s.orderUnit(u, bld % s.w, (bld / s.w) | 0)).not.toBeNull(); // not onto a rooftop
  expect(s.orderUnit(u, dest![0], dest![1])).toBeNull();
  const d0 = Math.hypot(u.x - dest![0], u.y - dest![1]);
  for (let i = 0; i < 20 * 15; i++) s.step(); // still in the warning: no infected to stop for
  expect(Math.hypot(u.x - dest![0], u.y - dest![1])).toBeLessThan(d0 - 10);
});

test("barrage, MOAB and nuke: escalating damage; nuke leaves fallout and costs XP", () => {
  const s = new Sim(42, { budget: 200_000_000 });
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  while (!s.outbreak) s.step();
  s.dev.waves = false;
  const cx = 60, cy = 60;
  for (let j = 0; j < 300; j++) s.spawnInfected(cx + (j % 20) - 10, cy + Math.floor(j / 20) - 7, 400);
  for (const k of ["barrage", "moab", "nuke"] as C.AbilityKind[]) expect(s.buyAbility(k)).toBeNull();
  const k0 = s.kills;
  expect(s.useAbility("barrage", cx, cy)).toBeNull();
  for (let i = 0; i < 20 * (C.ABILITIES.barrage.delay + C.BARRAGE_S + 1); i++) s.step();
  const kBarrage = s.kills - k0;
  expect(kBarrage).toBeGreaterThan(20);
  for (let j = 0; j < 300; j++) s.spawnInfected(cx + (j % 20) - 10, cy + Math.floor(j / 20) - 7, 1e5);
  const k1 = s.kills;
  expect(s.useAbility("moab", cx, cy)).toBeNull();
  for (let i = 0; i < 20 * (C.ABILITIES.moab.delay + 1); i++) s.step();
  expect(s.kills - k1).toBeGreaterThan(200); // tough ones too
  const collapsed = s.buildingsCollapsed;
  expect(s.useAbility("nuke", s.w / 2, s.h / 3)).toBeNull(); // right on the zone
  for (let i = 0; i < 20 * C.ABILITIES.nuke.delay - 2; i++) s.step();
  const safe0 = s.counts().safe, dead0 = s.civKilledByUs;
  for (let i = 0; i < 20 * 1 + 2; i++) s.step();
  expect(s.nukesUsed).toBe(1);
  expect(s.fallout.length).toBe(1);
  expect(s.civKilledByUs - dead0).toBeGreaterThan(safe0 * 0.5); // people in the zone die too
  expect(s.buildingsCollapsed).toBeGreaterThan(collapsed);
  // fallout burns infected that walk in
  const f = s.fallout[0];
  const inFallout = () => { let n = 0; for (let k = 0; k < s.n; k++) if (s.state[k] === INF && Math.hypot(s.ax[k] - f.x, s.ay[k] - f.y) < f.r * 0.5) n++; return n; };
  for (let j = 0; j < 50; j++) s.spawnInfected(f.x + (j % 10) - 5, f.y + Math.floor(j / 10), 1500);
  const before = inFallout();
  for (let i = 0; i < 20 * 6; i++) s.step();
  expect(inFallout()).toBeLessThan(before * 0.3);
  s.withdraw();
  expect(s.result!.xp).toBe(Math.max(0, Math.round(s.result!.pct * 10 + s.wave * 20 + (s.result!.bonus ? C.BONUS_XP : 0) - C.NUKE_XP_PENALTY)));
  expect(s.result!.bonus === "Light Touch").toBe(false); // the city is no longer intact
}, 120000);

// ---------- 0.12 arsenal ----------
test("arsenal: tank, HIMARS, Apache and Reaper fight; strike orders reach across the map; air units ignore streets", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  const inZone: number[][] = [], outside: number[][] = [];
  for (let i = 0; i < s.inZone.length; i += 17) { const x = i % s.w, y = (i / s.w) | 0; if (s.map.tile[i] === 0 && s.inZone[i] === 1) inZone.push([x, y]); else if (s.map.tile[i] === 0 && !s.inZone[i] && Math.hypot(x - s.w / 2, y - s.h / 3) < 70) outside.push([x, y]); }
  const put = (k: C.UnitKind, list: number[][]) => { for (const [x, y] of list) if (!s.place(k, x, y)) return s.units[s.units.length - 1]; throw new Error(k); };
  const tank = put("tank", outside), himars = put("himars", inZone.slice(2)), apache = put("apache", inZone.slice(6)), reaper = put("reaper", inZone.slice(10));
  expect(s.canPlace("apache", outside[0][0], outside[0][1])).not.toBeNull(); // air units take off from inside a zone
  s.startBattle();
  while (!s.outbreak) s.step();
  s.dev.waves = false; s.dev.bites = false;
  // a far road for the tank and a rooftop for the Apache (air units go anywhere)
  let far: number[] | null = null;
  for (let i = 0; i < s.map.tile.length && !far; i += 11) { const x = i % s.w, y = (i / s.w) | 0; if (s.map.tile[i] === 0 && x > 20 && y > 20 && x < s.w - 20 && y < s.h - 20 && Math.hypot(x - tank.x, y - tank.y) > 150) far = [x, y]; }
  const roof = s.map.tile.findIndex((t, i) => t === BUILDING && Math.hypot((i % s.w) - apache.x, ((i / s.w) | 0) - apache.y) > 60);
  expect(s.orderUnit(tank, far![0], far![1])).toBeNull();
  expect(s.orderUnit(apache, roof % s.w, (roof / s.w) | 0)).toBeNull();
  const t0 = Math.hypot(tank.x - far![0], tank.y - far![1]), a0 = Math.hypot(apache.x - roof % s.w, apache.y - ((roof / s.w) | 0));
  for (let i = 0; i < 20 * 12; i++) s.step();
  expect(Math.hypot(tank.x - far![0], tank.y - far![1])).toBeLessThan(t0 - 20);
  expect(Math.hypot(apache.x - roof % s.w, apache.y - ((roof / s.w) | 0))).toBeLessThan(a0 - 40);
  // crowds next to each unit: everyone gets kills
  for (const u of [tank, apache, reaper]) for (let j = 0; j < 60; j++) s.spawnInfected(u.x + 6 + (j % 6), u.y + Math.floor(j / 6) - 5, 300);
  for (let j = 0; j < 200; j++) s.spawnInfected(himars.x + 50 + (j % 10), himars.y + Math.floor(j / 10), 300);
  for (let i = 0; i < 20 * 20; i++) s.step();
  for (const u of [tank, himars, apache, reaper]) expect(u.kills).toBeGreaterThan(0);
}, 120000);

test("A-10, cluster, Tomahawk and AC-130 strikes", () => withWarning45(() => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAroundCenter(s));
  for (const k of ["a10", "cluster", "tomahawk", "gunship"] as C.AbilityKind[]) expect(s.buyAbility(k)).toBeNull();
  s.startBattle();
  while (!s.outbreak) s.step();
  s.dev.waves = false;
  const pack = (x: number, y: number) => { for (let j = 0; j < 200; j++) s.spawnInfected(x + (j % 20) - 10, y + Math.floor(j / 20) - 5, 500); };
  let k = s.kills; pack(60, 60);
  expect(s.useAbility("a10", 45, 60, 75, 60)).toBeNull();
  for (let i = 0; i < 20 * 4; i++) s.step(); expect(s.kills - k).toBeGreaterThan(40);
  k = s.kills; pack(60, 300);
  expect(s.useAbility("cluster", 60, 300)).toBeNull();
  for (let i = 0; i < 20 * 5; i++) s.step(); expect(s.kills - k).toBeGreaterThan(60);
  const bld = s.map.tile.findIndex((t, i) => t === BUILDING && (i % s.w) > 400 && !s.inZone[i]);
  const bx = bld % s.w, by = (bld / s.w) | 0;
  expect(s.useAbility("tomahawk", bx + 0.5, by + 0.5)).toBeNull();
  for (let i = 0; i < 20 * 11; i++) s.step();
  expect(s.damage[bld] > 0 || s.rubble[bld] > 0).toBe(true);
  k = s.kills; pack(400, 60);
  expect(s.useAbility("gunship", 400, 60)).toBeNull();
  for (let i = 0; i < 20 * 8; i++) s.step();
  expect(s.orbits.length).toBe(1);
  for (let i = 0; i < 20 * 20; i++) s.step();
  expect(s.kills - k).toBeGreaterThan(80);
}), 120000);

// ---------- 0.13 progression ----------
test("progression: unlock thresholds, city trials, ranks, grandfathered XP, achievements", () => {
  const P = require("../src/progress");
  expect(P.unlocked("garrison", 0)).toBe(true); // basics from the start
  expect(P.unlocked("nuke", 0)).toBe(false);
  expect(P.unlocked("nuke", 15000)).toBe(true);
  expect(P.unlocked("tank", 0, "tank")).toBe(true); // lent by a campaign city
  expect(P.unlocked("tank", 0, null, true)).toBe(true); // developer mode
  for (const k of Object.keys(P.UNLOCK_XP)) expect(k in C.UNITS || k in C.SUPPORTS || k in C.ABILITIES).toBe(true);
  for (const c of [...C.CITIES, ...C.REAL_CITIES]) if (c.trial) expect(c.trial in P.UNLOCK_XP).toBe(true);
  expect(P.rankFor(0).name).toBe("Private");
  expect(P.rankFor(1300).name).toBe("Sergeant");
  expect(P.newlyUnlocked(300, 1300)).toEqual(expect.arrayContaining(["howitzer", "command", "barrage"]));
  expect(P.grandfatherXp({ a: { pct: 68.9, medal: "Gold" }, b: { pct: 20, medal: null } })).toBe(689 + 200 + 200);
  const r = { saved: 12000, pct: 80, medal: "Platinum", reason: "", intact: 95, bonus: "Light Touch", xp: 0, waves: 31, round: true };
  const got = P.earned({ r, kills: 12000, held: 1300, lifts: 120, nukes: 0, unitsLost: 0, daily: false, usedAbilities: 0 }, {});
  const ids = got.map((a: { id: string }) => a.id);
  for (const id of ["first_out", "round_one", "gold", "platinum", "evac_10k", "lifts_100", "hold_20", "waves_30", "kills_10k", "light_touch", "no_losses", "ground_game"]) expect(ids).toContain(id);
  expect(ids).not.toContain("nuclear");
  expect(P.earned({ r, kills: 0, held: 0, lifts: 0, nukes: 0, unitsLost: 0, daily: false, usedAbilities: 0 }, { first_out: "x" }).map((a: { id: string }) => a.id)).not.toContain("first_out"); // only once
});

// ---------- 0.15 mods ----------
test("mods: change constants, unit stats, cities, unlocks, medals; report problems; template covers everything", () => {
  const M = require("../src/mods");
  const P = require("../src/progress");
  const keep = { growth: C.HORDE_SIZE_POW, tank: C.UNITS.tank.damage, cannon: C.UNITS.tank.cannon!.damage, boatHp: C.UNITS.gunboat.mobile!.hp,
    ash: C.CITIES[0].budget, nuke: P.UNLOCK_XP.nuke, gold: C.MEDALS.find(r => r[0] === "Gold")![1] };
  try {
    const r = M.applyMod({ file: "t.json", text: JSON.stringify({
      name: "Test mod",
      constants: { HORDE_SIZE_POW: 1.3, NOT_A_THING: 1, EVAC_PAY: "lots" },
      units: { tank: { damage: 999, cannon: { damage: 5000 }, bogus: 1 }, nosuchunit: { damage: 1 } },
      cities: { ashford: { budget: 123 } },
      unlocks: { nuke: 0 }, medals: { Gold: 40 }, weird: {},
    }) });
    expect(r.name).toBe("Test mod");
    expect(C.HORDE_SIZE_POW).toBe(1.3); // live binding: the sim reads the modded value
    expect(C.UNITS.tank.damage).toBe(999);
    expect(C.UNITS.tank.cannon!.damage).toBe(5000);
    expect(C.CITIES[0].budget).toBe(123);
    expect(P.UNLOCK_XP.nuke).toBe(0);
    expect(C.MEDALS.find(r => r[0] === "Gold")![1]).toBe(40);
    expect(r.changes).toBe(6);
    for (const bit of ["NOT_A_THING", "EVAC_PAY", "bogus", "nosuchunit", "weird"]) expect(r.problems.join(" ")).toContain(bit);
    expect(M.applyMod({ file: "bad.json", text: "{nope" }).problems[0]).toContain("not valid JSON");
    // the exported template is valid JSON with every tunable, and Infinity survives as "Infinity"
    const tpl = JSON.parse(M.toJson(M.defaults()));
    expect(Object.keys(tpl.constants).length).toBe(Object.keys(C.TUNABLE).length);
    expect(tpl.units.gunboat.mobile.hp).toBe("Infinity");
    const back = M.applyMod({ file: "tpl.json", text: M.toJson(M.defaults()) });
    expect(back.problems).toEqual([]); // the template applies cleanly
    expect(C.UNITS.gunboat.mobile!.hp).toBe(Infinity);
  } finally {
    C.TUNABLE.HORDE_SIZE_POW[1](keep.growth); C.UNITS.tank.damage = keep.tank; C.UNITS.tank.cannon!.damage = keep.cannon;
    C.CITIES[0].budget = keep.ash; P.UNLOCK_XP.nuke = keep.nuke; C.MEDALS.find(r => r[0] === "Gold")![1] = keep.gold;
  }
});

test("every plain number in config.ts is moddable (run tools/gen-tunables.ts after adding one)", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../src/config.ts"), "utf8");
  expect(src.match(/^export const [A-Z][A-Z0-9_]* = -?[\d._]+;/gm) ?? []).toEqual([]);
  for (const m of src.matchAll(/^export let ([A-Z][A-Z0-9_]*)/gm)) expect(m[1] in C.TUNABLE).toBe(true);
});

test("mods and saves from strangers: no prototype pollution, no markup, bad save values dropped", () => {
  const M = require("../src/mods");
  const Save = require("../src/save");
  const r = M.applyMod({ file: "evil.json", text: '{"units":{"__proto__":{"polluted":1},"tank":{"__proto__":{"x":1},"name":"<img src=x onerror=alert(1)>","color":"red;}"}},"constants":{"toString":1},"unlocks":{"constructor":5},' +
    '"unitInfo":{"tank":' + JSON.stringify({ role: 'x" onmouseover="alert(1)' }) + '}}' });
  expect(C.UNIT_INFO.tank.role).toBe("Main Battle Tank");
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).x).toBeUndefined();
  expect(C.UNITS.tank.name).toBe("M1 Abrams");
  expect(C.UNITS.tank.color).toBe("#a1887f");
  expect(r.changes).toBe(0);
  expect(r.problems.length).toBeGreaterThanOrEqual(5);
  const s = Save.clean({ settings: {}, xp: "9e9", best: { ashford: { pct: 50, medal: "<b>Gold</b>" }, "<x>": { pct: 1, medal: null }, b: { pct: "NaN" } },
    daily: {}, plans: { ashford: { poly: [] }, bad: 3 }, achievements: { gold: "2026-11-09", evil: "<script>" } });
  expect(s.best).toEqual({ ashford: { pct: 50, medal: null } });
  expect(s.achievements).toEqual({ gold: "2026-11-09" });
  expect(Object.keys(s.plans)).toEqual(["ashford"]);
  expect(s.xp).toBeNull();
});

test("evac pads double in price; removing one lowers the next", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  const spots: [number, number][] = [];
  for (let i = 0; i < s.inZone.length && spots.length < 40; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) spots.push([i % s.w, (i / s.w) | 0]);
  const base = C.SUPPORTS.evac.cost;
  expect(s.supportCost("evac")).toBe(base);
  const place = () => { for (const [x, y] of spots) if (!s.placeSupport("evac", x, y)) return s.supports[s.supports.length - 1]; return undefined; };
  const a = place()!; expect(a.paid).toBe(base);
  expect(s.supportCost("evac")).toBe(base * C.EVAC_COST_MUL);
  const b = place()!; expect(b.paid).toBe(base * C.EVAC_COST_MUL);
  expect(s.supportCost("evac")).toBe(base * C.EVAC_COST_MUL ** 2);
  const spent = s.spent();
  expect(s.removeAt(b.x, b.y)).toBe(true);
  expect(s.spent()).toBe(spent - base * C.EVAC_COST_MUL); // refunds what it cost
  expect(s.supportCost("evac")).toBe(base * C.EVAC_COST_MUL);
  const c = place()!; // pads a and c stand; removing a while planning moves c to the front of the line
  expect(s.removeAt(a.x, a.y)).toBe(true);
  expect(c.paid).toBe(base);
});

test("everyone dead ends the round: score screen, no medal, not a completed round", () => {
  const s = new Sim(42);
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  s.devRemoveCivilians();
  for (let i = 0; i < 20; i++) s.step();
  expect(s.roundDone).toBe(true);
  expect(s.roundResult!.medal).toBeNull();
  expect(s.roundResult!.round).toBe(false);
  expect(s.phase).toBe("battle");
});

test("stragglers end a stalled round", () => {
  const s = new Sim(42, { civilians: 300 });
  s.setZone(zoneAroundCenter(s));
  s.dev.bites = false; s.dev.waves = false;
  s.startBattle();
  s.devRemoveCivilians(2); // two people left who nothing will ever fly out (no pads)
  while (s.time < 200 && !s.roundDone) s.step();
  expect(s.roundDone).toBe(true);
  expect(s.roundAt!).toBeGreaterThanOrEqual(C.ROUND_STALL_S);
  expect(s.phase).toBe("battle");
});

test("keep fighting: final damage is live; End here straight from the round screen adds no Mayhem", () => {
  const s = new Sim(42);
  s.setZone(zoneAroundCenter(s));
  s.startBattle();
  s.devRemoveCivilians();
  for (let i = 0; i < 20; i++) s.step();
  expect(s.roundDone).toBe(true);
  const r = s.roundResult!;
  s.callIt(); // "End here" right away
  expect(s.result!.mayhem).toBeUndefined();
  expect(s.result!.reason).toBe(r.reason);

  const t = new Sim(43);
  t.setZone(zoneAroundCenter(t));
  t.startBattle();
  t.devRemoveCivilians();
  for (let i = 0; i < 20; i++) t.step();
  for (let i = 0; i < t.damage.length; i++) if (t.map.tile[i] === BUILDING) t.damage[i] = 200; // wreck the city after the round
  t.withdraw();
  expect(t.result!.damage).toBe(t.cityDamage().bill);
  expect(t.result!.damage).toBeGreaterThan(t.roundResult!.damage);
  expect(t.result!.intact).toBeLessThan(t.roundResult!.intact);
  expect(t.result!.score).toBe(t.roundResult!.score); // the round score itself stays frozen
});

// ---------- 0.21 hidden outbreak + storyteller ----------
test("outbreak sites scale with difficulty", () => {
  const run = (difficulty: C.Difficulty) => {
    const s = new Sim(1234, { sites: 4, difficulty, civilians: 1000 });
    s.setZone(zoneAroundCenter(s));
    s.startBattle();
    return s.sites.length;
  };
  const easy = run("easy");
  const medium = run("medium");
  const insane = run("insane");
  expect(easy).toBe(2);
  expect(medium).toBe(4);
  expect(insane).toBeGreaterThan(medium);
  expect(easy).toBeLessThan(insane);
});

test("sites can sit near the zone", () => {
  let nearCount = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = new Sim(seed, { sites: 6, difficulty: "insane", civilians: 500 });
    s.setZone(zoneAroundCenter(s, 60));
    s.startBattle();
    for (const [x, y] of s.sites) {
      const d = s.distToZone(x, y);
      expect(d).toBeGreaterThanOrEqual(C.OUTBREAK_MIN_ZONE_DIST);
      if (d < 40) nearCount++;
    }
  }
  expect(nearCount).toBeGreaterThan(0);
});

test("insane on a cramped map still starts", () => {
  const s = new Sim(7, { sites: 20, difficulty: "insane", civilians: 300 });
  // big zone covering most of the map
  s.setZone([[10, 10], [s.w - 10, 10], [s.w - 10, s.h - 10], [10, s.h - 10]]);
  s.startBattle();
  expect(s.phase).toBe("battle");
});

test("hordes keep coming at rolled gaps", () => {
  const s = new Sim(42, { difficulty: "medium", civilians: 600 });
  s.setZone(zoneAroundCenter(s));
  s.dev.bites = false;
  s.startBattle();
  expect(s.nextWaveT).toBe(Infinity);
  const waveTimes: number[] = [];
  let lastW = 0;
  while (s.time < C.WARNING_S + 300) {
    s.step();
    if (s.wave !== lastW) { lastW = s.wave; waveTimes.push(s.waveT); }
  }
  expect(waveTimes.length).toBeGreaterThanOrEqual(5);
  for (let i = 1; i < waveTimes.length; i++) {
    const gap = waveTimes[i] - waveTimes[i - 1];
    expect(gap).toBeGreaterThanOrEqual(C.DIFFICULTY.medium.gapFloor - 1e-6);
    expect(gap).toBeLessThanOrEqual(C.DIFFICULTY.medium.gapMax + C.DT + 1e-6);
  }
});

test("emptying the city makes hordes bigger", () => {
  const run = (empty: boolean) => {
    const s = new Sim(42, { difficulty: "medium", civilians: 600 });
    s.setZone(zoneAroundCenter(s));
    s.dev.bites = false;
    s.startBattle();
    while (!s.outbreak) s.step();
    if (empty) s.devRemoveCivilians();
    const h0 = s.heatNow();
    const counts: number[] = [];
    let lastW = s.wave;
    while (counts.length < 3) {
      s.step();
      if (s.wave !== lastW) { lastW = s.wave; counts.push(s.lastWaveCount); }
    }
    return { h0, mean: counts.reduce((a, b) => a + b, 0) / counts.length };
  };
  const full = run(false);
  const emptied = run(true);
  expect(emptied.h0).toBeGreaterThan(full.h0);
  expect(emptied.mean).toBeGreaterThan(full.mean);
});

test("same plan and difficulty replay identically", () => {
  const run = () => {
    const s = new Sim(42, { difficulty: "hard", civilians: 500 });
    s.setZone(zoneAroundCenter(s));
    s.startBattle();
    const times: number[] = [];
    let lastW = 0;
    while (s.time < 200) {
      s.step();
      if (s.wave !== lastW) { lastW = s.wave; times.push(+s.waveT.toFixed(3)); }
    }
    return times;
  };
  expect(run()).toEqual(run());
});

test("insane hordes come bigger and sooner than easy", () => {
  const run = (difficulty: C.Difficulty) => {
    const s = new Sim(42, { difficulty, civilians: 600 });
    s.setZone(zoneAroundCenter(s));
    s.dev.bites = false;
    s.startBattle();
    const counts: number[] = [], times: number[] = [];
    let lastW = 0;
    while (counts.length < 3) {
      s.step();
      if (s.wave !== lastW) { lastW = s.wave; counts.push(s.lastWaveCount); times.push(s.waveT); }
    }
    return { firstT: times[0], mean: counts.reduce((a, b) => a + b, 0) / counts.length };
  };
  const easy = run("easy");
  const insane = run("insane");
  expect(insane.firstT).toBeLessThan(easy.firstT);
  expect(insane.mean).toBeGreaterThan(easy.mean);
});

test("xp scales with difficulty", () => {
  const run = (difficulty: C.Difficulty) => {
    const s = new Sim(42, { difficulty, civilians: 500 });
    s.setZone(zoneAroundCenter(s));
    s.startBattle();
    s.evacuated = 250;
    s.devRemoveCivilians();
    for (let i = 0; i < 20; i++) s.step();
    s.withdraw();
    return s.result!.xp;
  };
  const easyXp = run("easy");
  const insaneXp = run("insane");
  expect(easyXp).toBeGreaterThan(0);
  expect(Math.abs(insaneXp / easyXp - 1.5 / 0.75)).toBeLessThan(0.05);
});




// 0.22
function zoneBuildings(s: Sim) {
  const spots: [number, number][] = [];
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) spots.push([i % s.w, (i / s.w) | 0]);
  return spots;
}

test("Armory cap: only MILITIA_MAX armories", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  let n = 0, err: string | null = null;
  for (const [x, y] of zoneBuildings(s)) { const e = s.placeSupport("militia", x, y); if (!e) n++; else if (n === C.MILITIA_MAX && !e.startsWith("Too close") && !e.startsWith("Would overlap")) { err = e; break; } }
  expect(C.MILITIA_MAX).toBe(4);
  expect(n).toBe(C.MILITIA_MAX);
  expect(err).toContain(String(C.MILITIA_MAX));
});

test("Airstrike: 12 per battle", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  for (let i = 0; i < 12; i++) expect(s.buyAbility("airstrike")).toBeNull();
  expect(s.buyAbility("airstrike")).toContain("12");
});

test("people in the zone walk to the nearest Evac Point, even far away", () => {
  const keep = C.EVAC_EVERY_S;
  C.TUNABLE.EVAC_EVERY_S[1](1e6); // no lifts: nobody leaves, so we can see where they gather
  try {
    const s = new Sim(42, { budget: 80_000_000 });
    s.setZone(zoneAroundCenter(s, 34));
    const spots = zoneBuildings(s);
    // the pad in the zone's top-left corner, far from most people
    spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    let pad: Support | undefined;
    for (const [x, y] of spots) if (!s.placeSupport("evac", x, y)) { pad = s.supports[s.supports.length - 1]; break; }
    expect(pad).toBeDefined();
    s.dev.bites = false;
    s.startBattle();
    while (s.time < 90) s.step();
    let near = 0, safe = 0;
    for (let k = 0; k < s.civN; k++) if (s.state[k] === SAFE_CIV) { safe++; if (Math.hypot(s.ax[k] - pad!.x, s.ay[k] - pad!.y) < C.SUPPORTS.evac.radius) near++; }
    expect(safe).toBeGreaterThan(100);
    expect(near / safe).toBeGreaterThan(0.5);
  } finally { C.TUNABLE.EVAC_EVERY_S[1](keep); }
}, 120000);

test("an infected inside a standing gate or wall steps out to the street outside", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  s.startBattle();
  let gate = -1;
  for (let i = 0; i < s.inZone.length && gate < 0; i++) if (s.inZone[i] === 3 && s.wallHp[i] > 0) gate = i;
  expect(gate).toBeGreaterThanOrEqual(0);
  const gx = gate % s.w, gy = (gate / s.w) | 0;
  s.closeAllGates(); // the gate becomes a wall with the infected caught in it
  s.spawnInfected(gx + 0.5, gy + 0.5, 1e9);
  let k = -1;
  for (let j = s.civN; j < s.n; j++) if (s.state[j] === INF && Math.abs(s.ax[j] - gx - 0.5) < 0.01 && Math.abs(s.ay[j] - gy - 0.5) < 0.01) k = j;
  expect(k).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 20; i++) s.step();
  const ci = (s.ay[k] | 0) * s.w + (s.ax[k] | 0);
  expect(s.passable(ci, true)).toBe(true); // no longer inside the wall
  expect(s.inZone[ci]).toBe(0); // and out on the street, not let into the zone
  expect(s.stuckInWall).toBe(0);
});

// 0.23: placement footprints, craters are rough ground
function streetSpots(s: Sim) {
  const out: [number, number][] = [];
  for (let y = 5; y < s.h - 5; y++) for (let x = 5; x < s.w - 5; x++) if (s.map.tile[s.idx(x, y)] === 0) out.push([x, y]);
  return out;
}
/** A street cell with a straight run of street to its right (x..x+len) */
function streetRun(s: Sim, len: number): [number, number] {
  for (const [x, y] of streetSpots(s)) { let ok = true; for (let d = 0; d <= len && ok; d++) ok = s.map.tile[s.idx(x + d, y)] === 0; if (ok) return [x, y]; }
  throw new Error("no street run");
}

test("footprints: overlapping refused, touching allowed, bigger units block more", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  expect(C.UNITS.turret.foot).toBe(2);
  expect(C.UNITS.tank.foot).toBeGreaterThan(C.UNITS.turret.foot);
  const [x, y] = streetRun(s, 12);
  expect(s.place("turret", x, y)).toBeNull();
  expect(s.place("turret", x + 1, y)).toContain("overlap"); // 2x2 footprints overlap
  expect(s.place("turret", x + 2, y)).toBeNull(); // touching is fine
  const t = new Sim(42, { budget: 400_000_000 });
  expect(t.place("tank", x, y)).toBeNull();
  expect(t.place("turret", x + 2, y)).toContain("overlap"); // a tank's footprint reaches further
  expect(t.place("turret", x + 4, y)).toBeNull();
});

test("an old plan with overlapping units still loads", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  const [x, y] = streetRun(s, 6);
  s.ignoreFootprint = true; // what importPlan does
  expect(s.place("turret", x, y)).toBeNull();
  expect(s.place("turret", x + 1, y)).toContain("Too close"); // the old 2-cell rule still holds
  expect(s.place("turret", x + 2, y)).toBeNull();
  s.ignoreFootprint = false;
  expect(s.units.length).toBe(2);
});

test("craters are rough ground: infected and civilians cross slower; every hit stacks a crater", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  const [x, y] = streetRun(s, 10);
  const n0 = s.craters.length;
  s.damageTerrain(x + 5.5, y + 0.5, 3, 200);
  s.damageTerrain(x + 5.5, y + 0.5, 3, 200); // same spot again: a second crater on top
  expect(s.craters.length).toBe(n0 + 2);
  const c = s.idx(x + 5, y);
  expect(s.rough[c]).toBeGreaterThan(0);
  expect(s.roughMul(c)).toBeLessThan(1);
  expect(s.roughMul(c)).toBeGreaterThanOrEqual(C.CRATER_SLOW_MUL - 1e-6);
  expect(s.roughMul(s.idx(x, y))).toBe(1); // clean street
});

// 0.24: rolling outbreak, recall, units block and take damage
test("outbreak spread: extra rolled outbreaks inside the difficulty's window", () => {
  const s = new Sim(42, { budget: 80_000_000, difficulty: "medium" });
  s.setZone(zoneAroundCenter(s, 34));
  s.dev.bites = false;
  s.startBattle();
  const d = C.DIFFICULTY.medium;
  expect(s.spreadSites.length).toBeGreaterThanOrEqual(d.spreadMin);
  expect(s.spreadSites.length).toBeLessThanOrEqual(d.spreadMax);
  for (const p of s.spreadSites) { expect(p.t).toBeGreaterThan(C.WARNING_S); expect(p.t).toBeLessThanOrEqual(C.WARNING_S + d.spreadS); }
  while (s.time < C.WARNING_S + 0.05) s.step();
  const first = s.infectedEver;
  expect(first).toBe(s.sites.length * C.INFECTED_PER_SITE);
  while (s.time < C.WARNING_S + d.spreadS + 0.5) s.step();
  expect(s.infectedEver).toBe((s.sites.length + s.spreadSites.length) * C.INFECTED_PER_SITE);
}, 60000);

test("insane rolls more spread outbreaks than easy", () => {
  expect(C.DIFFICULTY.insane.spreadMax).toBeGreaterThan(C.DIFFICULTY.easy.spreadMax);
  expect(C.DIFFICULTY.insane.spreadS).toBeGreaterThan(C.DIFFICULTY.easy.spreadS);
});

test("recall sends mobile units to the nearest zone; again sends them back", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  let apc: any;
  for (const [x, y] of streetSpots(s)) if (!s.inZone[s.idx(x, y)] && s.distToZone(x, y) > 20 && !s.place("apc", x, y)) { apc = s.units[s.units.length - 1]; break; }
  expect(apc).toBeDefined();
  const post0 = [...apc.post];
  s.startBattle();
  expect(s.recallAll()).toBeGreaterThan(0);
  expect(s.inZone[s.idx(apc.post[0], apc.post[1])]).toBe(1);
  expect(s.recalled).toBe(true);
  s.recallAll();
  expect(apc.post).toEqual(post0);
  expect(s.recalled).toBe(false);
});

test("ground units block movement and get clawed; repair yards fix them", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  // a turret on a street inside the zone, a repair yard near it
  let tur: any;
  for (const [x, y] of streetSpots(s)) if (s.inZone[s.idx(x, y)] === 1 && !s.place("turret", x, y)) { tur = s.units[s.units.length - 1]; break; }
  expect(tur).toBeDefined();
  expect(C.UNITS.turret.hp).toBeGreaterThan(0);
  s.dev.bites = false;
  s.startBattle();
  expect(tur.hp).toBe(C.UNITS.turret.hp);
  tur.ammo = 0; // it can't shoot back in this test
  for (let i = 0; i < 6; i++) s.spawnInfected(tur.x + 0.5 + (i % 3) * 0.3, tur.y + 0.5, 1e9); // dropped right on it
  for (let i = 0; i < 40; i++) s.step();
  const [x0, y0, x1, y1] = s.footRect(C.UNITS.turret.foot, tur.x, tur.y);
  let inside = 0;
  for (let k = s.civN; k < s.n; k++) if (s.state[k] === INF && s.ax[k] >= x0 && s.ax[k] < x1 + 1 && s.ay[k] >= y0 && s.ay[k] < y1 + 1) inside++;
  expect(inside).toBe(0); // pushed out of the footprint, can't stand in it
  expect(tur.hp).toBeLessThan(C.UNITS.turret.hp); // clawed
  // repair: clear the infected, add a repair yard in range
  s.devClearInfected();
  const hp1 = tur.hp;
  s.dev.instantDeploy = true;
  for (const [x, y] of zoneBuildings(s)) if (Math.hypot(x - tur.x, y - tur.y) < C.SUPPORTS.repair.radius * 0.8 && !s.placeSupport("repair", x, y)) break;
  for (let i = 0; i < 300; i++) s.step();
  expect(tur.hp).toBeGreaterThan(hp1);
}, 60000);

// 0.25: tanks and APCs crush infected they drive over, never people; claws barely scratch them
test("tanks and APCs crush infected under them, slow down for it, and spare civilians", () => {
  const s = new Sim(42, { budget: 80_000_000 });
  s.setZone(zoneAroundCenter(s, 34));
  const [x, y] = streetRun(s, 8);
  expect(s.place("tank", x, y)).toBeNull();
  const tank = s.units[0];
  s.dev.bites = false;
  s.startBattle();
  const k0 = s.kills, tk0 = tank.kills;
  for (let i = 0; i < 4; i++) s.spawnInfected(tank.x + 0.6 + i * 0.2, tank.y + 0.5, 1e9); // right under it
  s.step();
  expect(s.kills - k0).toBe(4);
  expect(tank.kills - tk0).toBe(4);
  expect(tank.crushT).toBeGreaterThan(0);
  expect(C.UNITS.tank.crushSlow!).toBeGreaterThan(C.UNITS.apc.crushSlow!); // a tank keeps more of its speed
  // a civilian under it is pushed aside, not killed
  let civ = -1;
  for (let k = 0; k < s.civN; k++) if (s.state[k] === 0) { civ = k; break; }
  s.ax[civ] = tank.x + 0.6; s.ay[civ] = tank.y + 0.5;
  s.step();
  expect(s.state[civ]).not.toBe(2); // not DEAD
});

test("claws barely scratch tanks and APCs", () => {
  expect(C.UNITS.tank.clawMul!).toBeLessThan(0.2);
  expect(C.UNITS.apc.clawMul!).toBeLessThan(0.5);
  expect(C.UNITS.tank.clawMul!).toBeLessThan(C.UNITS.apc.clawMul!);
});
