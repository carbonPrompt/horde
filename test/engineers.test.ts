// 0.60: engineers (crew per zone, reload and repair jobs, wall climbing, leash, bites).
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { Sim } from "../src/sim";
import { BUILDING, WATER, walkable } from "../src/map";
import { SE_ENGINEER_LOST } from "../src/stats";
import { zone, zoneRoof } from "./troopsFixture";

function mkZ(seed = 42): Sim { const s = new Sim(seed, { budget: 400_000_000, difficulty: "medium" } as any); expect(s.setZone(zone(s))).toBeNull(); return s; }
function battle(s: Sim, bites = false) { s.dev.bites = bites; s.dev.waves = false; s.startBattle(); s.devClearInfected(); }
const alive = (s: Sim, z = 0) => s.engineersOf(z).filter(e => e.alive).length;
/** An outside street cell whose distance (Chebyshev) to the nearest wall cell is exactly d. */
function outsideAt(s: Sim, d: number): [number, number] {
  for (let i = 0; i < s.inZone.length; i++) {
    if (s.inZone[i] !== 0 || !walkable(s.map.tile[i])) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    let best = 99;
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
      if (s.inZone[s.idx(nx, ny)] === 2) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    if (best === d) return [x, y];
  }
  throw new Error("no cell");
}

test("crew size", () => {
  const s = mkZ();
  expect(alive(s)).toBe(C.ENGINEERS_FREE);
  for (let i = 0; i < C.ENGINEERS_MAX - C.ENGINEERS_FREE; i++) expect(s.buyEngineer(0)).toBeNull();
  expect(alive(s)).toBe(C.ENGINEERS_MAX);
  expect(s.buyEngineer(0)).not.toBeNull();
});

test("reload trip", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  battle(s);
  const u = s.units.find(v => v.kind === "garrison")!; u.deployT = 0;
  const start = Math.floor(C.UNITS.garrison.ammo * 0.1); u.ammo = start; u.reserve = 0; // nothing on hand: an engineer comes
  const s0 = s.supply[0].small;
  for (let t = 0; t < 150 && u.ammo < C.UNITS.garrison.ammo; t += C.DT) s.step(C.DT);
  expect(u.ammo).toBe(C.UNITS.garrison.ammo);
  const drop = s0 - s.supply[0].small - (u.reserve ?? 0); // the magazine's share (the rest went to its spares) // what the crate gave: the rounds missing at delivery (it may have fired a few on the way: the outbreak starts at 20 s)
  expect(drop).toBeGreaterThanOrEqual(C.UNITS.garrison.ammo - start); expect(drop).toBeLessThan(C.UNITS.garrison.ammo - start + 60);
}, 120000);

test("repair before ammo when set", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  s.closeAllGates();
  battle(s);
  const u = s.units.find(v => v.kind === "garrison")!; u.deployT = 0;
  for (const e of s.engineersOf(0).slice(1)) e.alive = false; // one engineer, so the order shows
  s.setPrio(0, "repair");
  const w = s.inZone.indexOf(2), max = s.wallMaxHp();
  s.wallHp[w] = max * 0.8; u.ammo = Math.floor(C.UNITS.garrison.ammo * 0.3); u.reserve = 0;
  let wallFirst = false;
  for (let t = 0; t < 240 && u.ammo < C.UNITS.garrison.ammo; t += C.DT) { s.step(C.DT); if (s.wallHp[w] >= max && u.ammo < C.UNITS.garrison.ammo) wallFirst = true; }
  expect(wallFirst).toBe(true);
}, 120000);

test("climbs a closed wall, never a gate", () => {
  const s = mkZ();
  s.closeAllGates();
  const [ox, oy] = outsideAt(s, 2);
  expect(s.place("turret", ox, oy)).toBeNull();
  battle(s);
  const u = s.units.find(v => v.kind === "turret")!; u.deployT = 0; u.ammo = 10; u.reserve = 0; // dry: the magazine fills first (two trips of two crates)
  const t0 = s.time; let onGate = false;
  for (let t = 0; t < 330 && u.ammo < C.UNITS.turret.ammo; t += C.DT) { // three crates (1,800-round magazine): three trips
    s.step(C.DT);
    for (const e of s.engineersOf(0)) if (e.alive && s.inZone[s.idx(e.x | 0, e.y | 0)] === 3) onGate = true;
  }
  expect(u.ammo).toBe(C.UNITS.turret.ammo);
  expect(onGate).toBe(false);
  expect(s.time - t0).toBeGreaterThanOrEqual(2 * C.ENGINEER_CLIMB_S);
}, 240000);

test("leash", () => {
  const s = mkZ();
  s.closeAllGates();
  const [ox, oy] = outsideAt(s, C.ENGINEER_LEASH + 4);
  expect(s.place("turret", ox, oy)).toBeNull();
  battle(s);
  const u = s.units.find(v => v.kind === "turret")!; u.deployT = 0; u.ammo = 10; u.reserve = 0;
  for (let t = 0; t < 40; t += C.DT) s.step(C.DT);
  expect(u.ammo).toBe(10); // never served (out of reach)
  for (const e of s.engineersOf(0)) expect(e.job).toBe(null);
}, 120000);

test("crew lost, zone still works", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  battle(s, true);
  const [sx, sy] = s.supply[0].store;
  for (let i = 0; i < 30; i++) s.spawnInfected(sx + 0.5 + (i % 6) * 0.4 - 1, sy + 0.5 + ((i / 6) | 0) * 0.4 - 1, 1e6);
  const s0 = s.supply[0].small;
  for (let t = 0; t < 20; t += C.DT) s.step(C.DT);
  expect(alive(s)).toBeLessThan(C.ENGINEERS_FREE);
  expect(s.stats.ev.k.filter(k => k === SE_ENGINEER_LOST).length).toBe(C.ENGINEERS_FREE - alive(s));
  expect(s.supply[0].small).toBeLessThanOrEqual(s0);
}, 120000);

test("deterministic", () => {
  const run = () => {
    const s = mkZ(); const [x, y] = zoneRoof(s);
    s.place("garrison", x, y); s.closeAllGates(); battle(s);
    const u = s.units.find(v => v.kind === "garrison")!; u.deployT = 0; u.ammo = 50; u.reserve = 0;
    s.wallHp[s.inZone.indexOf(2)] = 10;
    for (let t = 0; t < 120; t += C.DT) s.step(C.DT);
    return s.engineersOf(0).map(e => [Math.round(e.x * 1000), Math.round(e.y * 1000), e.alive]);
  };
  expect(run()).toEqual(run());
}, 120000);

// ---------- Task 5: units outside wait at the wall, never blocking an entrance ----------
import { SE_GATE_TO_WALL, SE_WALL_TO_GATE } from "../src/stats";

/** A zone with walls all round and one gate (the wall cell nearest the zone's south middle reopened). */
function oneGate(s: Sim): number {
  s.closeAllGates();
  let g = -1, bd = Infinity; const cx = s.w / 2, cy = s.h / 4 + 34;
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 2) { const d = Math.hypot(i % s.w - cx, ((i / s.w) | 0) - cy); if (d < bd) { bd = d; g = i; } }
  expect(s.toggleGate(g % s.w, (g / s.w) | 0)).toBeNull();
  return g;
}
const gateCells = (s: Sim) => { const out: number[] = []; s.inZone.forEach((v, i) => { if (v === 3) out.push(i); }); return out; };
const cheb = (s: Sim, a: number, x: number, y: number) => Math.max(Math.abs(a % s.w - x), Math.abs(((a / s.w) | 0) - y));

test("waiting spot keeps clear of gates", () => {
  const s = mkZ(); oneGate(s);
  const [ox, oy] = outsideAt(s, C.ENGINEER_LEASH);
  expect(s.place("apc", ox, oy)).toBeNull();
  let placed = false; for (let d = 3; d < 30 && !placed; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (!placed && s.place("apc", ox + dx, oy + dy) === null) placed = true;
  expect(placed).toBe(true);
  const [a, b] = s.units.filter(u => u.kind === "apc");
  const sa = s.supplyWaitSpot(a)!; a.waitAt = sa;
  const sb = s.supplyWaitSpot(b)!;
  for (const sp of [sa, sb]) {
    expect(s.inZone[s.idx(sp[0], sp[1])]).toBe(0);
    for (const g of gateCells(s)) expect(cheb(s, g, sp[0], sp[1])).toBeGreaterThanOrEqual(C.SUPPLY_WAIT_GATE_D);
    expect(s.onGateApproach(sp[0], sp[1])).toBe(false);
  }
  expect(sb).not.toEqual(sa);
});

test("vehicle waits at the wall, no gate opened", () => {
  const s = mkZ(); oneGate(s);
  const gates0 = gateCells(s);
  const [ox, oy] = outsideAt(s, C.ENGINEER_LEASH);
  expect(s.place("apc", ox, oy)).toBeNull();
  battle(s);
  const u = s.units.find(v => v.kind === "apc")!; u.deployT = 0; u.ammo = Math.floor(C.UNITS.apc.ammo * 0.1); u.reserve = 0;
  let waited = false, entered = false;
  for (let t = 0; t < 300 && !(waited && !u.waitingSupply); t += C.DT) {
    s.step(C.DT);
    if (u.waitingSupply) waited = true;
    if (s.inZone[s.idx(Math.floor(u.x), Math.floor(u.y))] === 1) entered = true;
  }
  expect(waited).toBe(true);
  expect(u.waitingSupply).toBeFalsy();
  expect(u.ammo + (u.reserve ?? 0)).toBe(C.UNITS.apc.ammo * (1 + C.BASIC_LOAD_VEHICLE));
  expect(entered).toBe(false);
  expect(gateCells(s)).toEqual(gates0);
  expect(s.stats.ev.k.filter(k => k === SE_GATE_TO_WALL || k === SE_WALL_TO_GATE).length).toBe(0);
}, 240000);

test("engineer reach for the placement label", () => {
  const { inEngineerReach } = require("../src/engineers");
  const s = mkZ(); s.closeAllGates();
  const [fx, fy] = outsideAt(s, C.ENGINEER_LEASH + 4), [nx, ny] = outsideAt(s, 2), [rx, ry] = zoneRoof(s);
  expect(inEngineerReach(s, fx, fy)).toBe(false);
  expect(inEngineerReach(s, nx, ny)).toBe(true);
  expect(inEngineerReach(s, rx, ry)).toBe(true);
});

// ---------- Task 9 (lab findings): no bites through a wall; a basic load on hand; two crates a trip ----------
test("an engineer inside is not bitten through the wall", () => {
  const s = mkZ(); s.closeAllGates(); battle(s, true);
  const w = s.inZone.indexOf(2), wx = w % s.w, wy = (w / s.w) | 0;
  let inside: [number, number] | null = null, outside: [number, number] | null = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const i = s.idx(wx + dx, wy + dy);
    if (s.inZone[i] === 1) inside = [wx + dx, wy + dy]; else if (s.inZone[i] === 0) outside = [wx + dx, wy + dy];
  }
  expect(inside && outside).toBeTruthy();
  const e = s.engineersOf(0)[0]; for (const o of s.engineersOf(0).slice(1)) o.alive = false;
  e.x = inside![0] + 0.5; e.y = inside![1] + 0.5; s.wallHp[w] = s.wallMaxHp() * 0.5; // it repairs right there
  for (let i = 0; i < 10; i++) s.spawnInfected(outside![0] + 0.5, outside![1] + 0.5, 1e6);
  for (let t = 0; t < 10; t += C.DT) s.step(C.DT);
  expect(e.alive).toBe(true);
}, 60000);

test("units carry a basic load and reload from it", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  s.place("garrison", x, y); const u = s.units[0];
  expect(u.reserve).toBe(C.BASIC_LOAD_SMALL * C.UNITS.garrison.ammo);
  battle(s); u.deployT = 0; u.ammo = 0;
  for (let t = 0; t < C.APC_RELOAD_S + 0.5; t += C.DT) s.step(C.DT);
  expect(u.ammo).toBeGreaterThan(C.UNITS.garrison.ammo * 0.9);
});

test("an engineer carries up to ENGINEER_CRATES crates and tops up magazine and spares", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  s.place("garrison", x, y); const u = s.units[0]; battle(s); u.deployT = 0;
  u.ammo = 0; u.reserve = 0; // dry, nothing on hand
  const s0 = s.supply[0].small;
  for (let t = 0; t < 150 && u.ammo + (u.reserve ?? 0) < C.UNITS.garrison.ammo * 2; t += C.DT) s.step(C.DT);
  expect(u.ammo + (u.reserve ?? 0)).toBeGreaterThanOrEqual(C.UNITS.garrison.ammo * 2 - 60); // one trip: two crates
  expect(s0 - s.supply[0].small).toBeGreaterThanOrEqual(C.ENGINEER_CRATES * C.CRATE_SMALL - 60);
}, 120000);

test("multi-drop: one trip serves two snipers", () => {
  const s = mkZ();
  const roofs: [number, number][] = [];
  for (let i = 0; i < s.inZone.length && roofs.length < 2; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING && s.place("sniper", i % s.w, (i / s.w) | 0) === null) roofs.push([i % s.w, (i / s.w) | 0]);
  expect(roofs.length).toBe(2);
  battle(s);
  for (const e of s.engineersOf(0).slice(1)) e.alive = false;
  for (const u of s.units) { u.deployT = 0; u.ammo = 0; u.reserve = 0; }
  const full = C.UNITS.sniper.ammo * (1 + (C.BASIC_LOAD_KIND.sniper ?? 0));
  let fetches = 0, carried = false;
  for (let t = 0; t < 200 && s.units.some(u => u.ammo + (u.reserve ?? 0) < full); t += C.DT) {
    s.step(C.DT); const e = s.engineersOf(0)[0];
    if (e.carry && !carried) fetches++; carried = !!e.carry;
  }
  for (const u of s.units) expect(u.ammo + (u.reserve ?? 0)).toBe(full);
  expect(fetches).toBe(1);
}, 120000);

// ---------- final review fixes ----------
test("review C1: the last partial stock is delivered", () => {
  const s = mkZ(); const [x, y] = zoneRoof(s);
  s.place("garrison", x, y); battle(s);
  const u = s.units[0]; u.deployT = 0; u.ammo = 10; u.reserve = 0;
  s.setAuto(0, false); s.supply[0].small = 500;
  for (let t = 0; t < 200 && u.ammo + (u.reserve ?? 0) < 400; t += C.DT) s.step(C.DT);
  expect(s.supply[0].small).toBe(0);
  expect(u.ammo + (u.reserve ?? 0)).toBeGreaterThanOrEqual(500); // it fired a few on the way perhaps, but the 500 rounds reached it
}, 120000);

test("review I4a: a unit waiting out of engineer reach does not stay latched", () => {
  const { inEngineerReach } = require("../src/engineers");
  const s = mkZ(); s.closeAllGates();
  const [fx, fy] = outsideAt(s, C.ENGINEER_LEASH + 8);
  expect(s.place("apc", fx, fy)).toBeNull(); battle(s);
  const u = s.units[0]; u.deployT = 0; u.ammo = 5; u.reserve = 0;
  u.ai = "supply"; u.waitAt = [fx, fy]; u.waitingSupply = true; u.thinkT = 0; // latched far out (an old bug)
  for (let t = 0; t < 8; t += C.DT) s.step(C.DT);
  expect(u.waitingSupply && !inEngineerReach(s, Math.floor(u.x), Math.floor(u.y))).toBe(false);
}, 60000);

test("review I4b: a waiting unit is released when the stock is empty and nothing is on the way", () => {
  const s = mkZ(); oneGate(s);
  const [ox, oy] = outsideAt(s, 1);
  expect(s.place("apc", ox, oy)).toBeNull(); battle(s);
  const u = s.units[0]; u.deployT = 0; u.ammo = C.UNITS.apc.ammo; u.reserve = 0; // a full magazine, no spares: not "low"
  s.setAuto(0, false); s.supply[0].vehicle = 0;
  u.ai = "supply"; u.waitAt = [ox, oy]; u.waitingSupply = true; u.thinkT = 0;
  for (let t = 0; t < 6; t += C.DT) s.step(C.DT);
  expect(u.waitingSupply).toBeFalsy();
  expect(u.ai).not.toBe("supply");
}, 60000);

test("review I4c: a repair-only job goes straight to the unit (the store is empty)", () => {
  const s = mkZ(); oneGate(s);
  const [ox, oy] = outsideAt(s, 1);
  expect(s.place("apc", ox, oy)).toBeNull(); battle(s);
  const u = s.units[0], mhp = C.UNITS.apc.mobile!.hp; u.deployT = 0;
  u.ammo = C.UNITS.apc.ammo; u.reserve = C.UNITS.apc.ammo * C.BASIC_LOAD_VEHICLE; u.hp = mhp * 0.3; // full ammo, badly hurt
  s.setAuto(0, false); s.supply[0].vehicle = 0;
  u.ai = "supply"; u.waitAt = [ox, oy]; u.waitingSupply = true; u.thinkT = 0;
  for (let t = 0; t < 150 && (u.hp ?? 0) < mhp; t += C.DT) s.step(C.DT);
  expect(u.hp).toBe(mhp);
}, 180000);

test("review 7: gate approach is quick and gives the same answers", () => {
  const s = mkZ(); oneGate(s);
  const gates: number[] = []; s.inZone.forEach((v, i) => { if (v === 3) gates.push(i); });
  const brute = (x: number, y: number) => gates.some(i => { const gx = i % s.w, gy = (i / s.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ox = gx + dx, oy = gy + dy; if (ox < 0 || oy < 0 || ox >= s.w || oy >= s.h || s.inZone[s.idx(ox, oy)] !== 0) continue;
      for (let k = 1; k <= 12; k++) for (let l = -1; l <= 1; l++) if (gx + dx * k + (dy ? l : 0) === x && gy + dy * k + (dx ? l : 0) === y) return true; }
    return false; });
  for (let i = 0; i < s.inZone.length; i += 37) { const x = i % s.w, y = (i / s.w) | 0; expect(s.onGateApproach(x, y)).toBe(brute(x, y)); }
  // the slow case: a zone of open gates (every crossing a gate, the default) with walls on part of it
  const t = mkZ(); let n = 0; t.inZone.forEach((v, i) => { if (v === 3 && n++ % 3 === 0) t.toggleGate(i % t.w, (i / t.w) | 0); });
  const [ox, oy] = outsideAt(t, 3); expect(t.place("apc", ox, oy)).toBeNull();
  const t0 = performance.now(); for (let k = 0; k < 10; k++) t.supplyWaitSpot(t.units[0]); const ms = (performance.now() - t0) / 10;
  expect(ms).toBeLessThan(3);
});
