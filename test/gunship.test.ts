import { expect, test } from "bun:test";
import { Sim, INF, SHOT_SMALL } from "../src/sim";
import * as C from "../src/config";

// 0.46: the AC-130 rework. Flies in by itself from the nearest map edge, three guns, redeploy and send home.

function zoneAroundCenter(s: Sim, half = 30): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
/** A battle with no waves, bites, civilians or infected; `n` gunships bought. */
function gunshipBattle(n = 1, seed = 42): Sim {
  const s = new Sim(seed, { budget: 500_000_000 } as any);
  expect(s.setZone(zoneAroundCenter(s))).toBeNull();
  for (let i = 0; i < n; i++) expect(s.buyAbility("gunship")).toBeNull();
  s.dev.waves = false; s.dev.bites = false; s.dev.unitDamage = false;
  s.devRemoveCivilians(0);
  s.startBattle();
  (s as any).outbreak = true;
  s.devClearInfected();
  return s;
}
function run(s: Sim, secs: number, each?: () => void) { for (let t = 0; t < secs * C.TICK_HZ; t++) { s.step(); each?.(); } }

// ---- Task 1: arrival from the map edge ----
test("0.46: edgeEntry is the nearest point on the map border", () => {
  const s = new Sim(42, { budget: 500_000_000 } as any);
  expect(s.edgeEntry(5, s.h / 2)).toEqual([0, s.h / 2]);
  expect(s.edgeEntry(s.w - 3, s.h / 2)).toEqual([s.w - 1, s.h / 2]);
  expect(s.edgeEntry(s.w / 2, 4)).toEqual([s.w / 2, 0]);
  expect(s.edgeEntry(s.w / 2, s.h - 2)).toEqual([s.w / 2, s.h - 1]);
}, 60000);

test("0.46: the AC-130 flies in by itself from the nearest edge, no C-130 delivery", () => {
  const s = gunshipBattle();
  const x = s.w / 2 + 120, y = 70;
  expect(s.useAbility("gunship", x, y)).toBeNull();
  expect(s.transports.some(t => t.kind === "c130_para")).toBe(false);
  expect(s.pending.some(p => p.kind === "gunship")).toBe(false);
  expect(s.orbits.length).toBe(1);
  const o = s.orbits[0];
  expect(o.inbound).toBe(true);
  const [ex, ey] = s.edgeEntry(x, y);
  expect(o.fx).toBe(ex); expect(o.fy).toBe(ey);
  const gx = x + Math.cos(o.angle) * C.GUNSHIP_RADIUS * 1.15, gy = y + Math.sin(o.angle) * C.GUNSHIP_RADIUS * 1.15;
  const secs = Math.hypot(gx - ex, gy - ey) / C.GUNSHIP_SPEED + 0.5;
  const t0 = s.time;
  while (o.inbound && s.time - t0 < secs + 2) s.step();
  expect(o.inbound).toBe(false);
  expect(o.arrived).toBe(true);
  expect(s.time - t0).toBeLessThanOrEqual(secs);
  expect(Math.abs(o.until - s.time - C.GUNSHIP_S)).toBeLessThan(0.2);
}, 60000);

test("0.46: a gunship ordered at a corner arrives at once with finite numbers", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", 1, 1)).toBeNull();
  const o = s.orbits[0];
  run(s, 1);
  expect(o.inbound).toBe(false);
  for (const v of [o.fx, o.fy, o.angle, o.until]) expect(Number.isFinite(v)).toBe(true);
}, 60000);

// ---- Task 2: three guns ----
/** Infected with huge hp held at fixed spots every tick. */
function pinned(s: Sim, pts: [number, number][]) {
  const ks: number[] = [];
  for (const [x, y] of pts) {
    expect(s.spawnInfected(x + 0.5, y + 0.5, 1e9, false)).toBe(true);
    for (let k = s.civN; k < s.n; k++) if (s.state[k] === INF && s.ax[k] === x + 0.5 && s.ay[k] === y + 0.5 && !ks.includes(k)) { ks.push(k); break; }
  }
  expect(ks.length).toBe(pts.length);
  return () => { for (let j = 0; j < ks.length; j++) { s.ax[ks[j]] = pts[j][0] + 0.5; s.ay[ks[j]] = pts[j][1] + 0.5; s.state[ks[j]] = INF; s.hp[ks[j]] = 1e9; } };
}
function block(cx: number, cy: number, n: number, cols: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([cx + (i % cols), cy + Math.floor(i / cols)]);
  return pts;
}
/** A gunship on station at (x, y), infected pinned at pts; runs `secs` on station; returns the orbit. */
function onStation(pts: [number, number][], secs: number, at?: (s: Sim) => [number, number]) {
  const s = gunshipBattle();
  const [x, y] = at ? at(s) : [s.w / 2 + 120, 70];
  const hold = pinned(s, pts.map(([dx, dy]) => [x + dx, y + dy] as [number, number]));
  expect(s.useAbility("gunship", x, y)).toBeNull();
  const o = s.orbits[0];
  while (o.inbound) { s.step(); hold(); }
  run(s, secs, hold);
  return { s, o };
}

test("0.46: the 25 mm and 40 mm together keep today's single-target damage", () => {
  const dps = C.G25_DMG * C.G25_RATE + C.G40_DMG * C.G40_RATE;
  expect(Math.abs(dps - 2100) / 2100).toBeLessThan(0.1);
  expect(C.GUNSHIP_HOW_DMG).toBe(2200); expect(C.GUNSHIP_HOW_EVERY).toBe(3); expect(C.GUNSHIP_HOW_SPLASH).toBe(4);
  for (const k of ["G25_DMG", "G25_RATE", "G40_DMG", "G40_RATE", "G40_SPLASH", "G105_MIN", "GUNSHIP_SPEED"]) expect(k in C.TUNABLE).toBe(true);
  expect("GUNSHIP_GUN_DMG" in C.TUNABLE).toBe(false);
}, 60000);

test("0.46: a lone straggler gets only the 25 mm Gatling", () => {
  const { s, o } = onStation([[0, 0]], 10);
  expect(o.shots25).toBeGreaterThan(5);
  expect(o.shots40).toBe(0); expect(o.shots105).toBe(0);
  let tracer = false; // the Gatling's thin tracers come from the plane
  run(s, 3, () => { tracer ||= s.shots.some(sh => sh.kind === "ac130" && sh.cls === SHOT_SMALL); });
  expect(tracer).toBe(true);
}, 60000);

test("0.46: a small group draws the 40 mm Bofors, not the 105", () => {
  const { o } = onStation(block(0, 0, 5, 3), 30);
  expect(o.shots40).toBeGreaterThan(0);
  expect(o.shots105).toBe(0);
}, 60000);

test("0.46: a pack of 30 draws the 105 mm howitzer", () => {
  const { o } = onStation(block(-3, -2, 30, 6), 8);
  expect(o.shots105).toBeGreaterThan(0);
}, 60000);

test("0.46: the 105 mm never fires at a pack 2 cells outside the zone wall", () => {
  const { o } = onStation(block(0, -2, 30, 6), 10, s => [s.w / 2 + 30 + 2, s.h / 4]);
  expect(o.shots105).toBe(0);
}, 60000);

import { pack, unpack } from "../src/snapshot";
test("0.46: a snapshot taken while inbound and on station plays on identically", async () => {
  const s = gunshipBattle();
  const x = s.w / 2 + 120, y = 70;
  for (let i = 0; i < 60; i++) s.spawnInfected(x + (i % 10) - 5, y + Math.floor(i / 10) - 3, 400);
  for (let i = 0; i < 4; i++) s.spawnInfected(x + 15 + i * 6, y + 12, 400);
  expect(s.useAbility("gunship", x, y)).toBeNull();
  s.step();
  for (const phase of ["inbound", "station"]) {
    if (phase === "station") while (s.orbits[0].inbound) s.step();
    else expect(s.orbits[0].inbound).toBe(true);
    const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
    for (let i = 0; i < 200; i++) { s.step(); b.step(); }
    expect(JSON.stringify(b.orbits)).toBe(JSON.stringify(s.orbits));
    expect(b.kills).toBe(s.kills);
  }
  expect(s.orbits[0].shots25 + s.orbits[0].shots40 + s.orbits[0].shots105).toBeGreaterThan(0);
}, 60000);

// ---- Task 3: redeploy and send home ----
function arrive(s: Sim, o: { inbound?: boolean }) { let n = 0; while (o.inbound && n++ < 20 * 60) s.step(); expect(o.inbound).toBeFalsy(); }

test("0.46: redeploy on station flies to the new spot and keeps the station time it had left", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  arrive(s, o);
  run(s, 10);
  const left = o.until - s.time;
  const [px, py] = s.orbitPos(o);
  expect(s.redeployOrbit(o, s.w / 2 - 120, 90)).toBeNull();
  expect(o.inbound).toBe(true);
  expect(o.fx).toBeCloseTo(px, 5); expect(o.fy).toBeCloseTo(py, 5);
  expect(s.orbits.length).toBe(1);
  arrive(s, o);
  expect(o.x).toBe(s.w / 2 - 120); expect(o.y).toBe(90);
  expect(Math.abs(o.until - s.time - left)).toBeLessThan(0.1);
}, 60000);

test("0.46: redeploy while inbound changes the target, still one plane", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  s.step();
  expect(s.redeployOrbit(o, s.w / 2 - 100, 120)).toBeNull();
  expect(s.orbits.length).toBe(1);
  arrive(s, o);
  expect(o.x).toBe(s.w / 2 - 100);
  expect(Math.abs(o.until - s.time - C.GUNSHIP_S)).toBeLessThan(0.1);
}, 60000);

test("0.46: redeploy while refueling moves the spot; it still refuels, then comes back there for a full stint", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  arrive(s, o);
  while (!o.away) s.step();
  const back = o.until;
  expect(s.redeployOrbit(o, s.w / 2 - 100, 120)).toBeNull();
  expect(o.away).toBe(true); expect(o.until).toBe(back); expect(s.orbits.length).toBe(1);
  while (s.time < back + 0.2) s.step();
  expect(o.away).toBe(false);
  expect(o.x).toBe(s.w / 2 - 100);
  expect(Math.abs(o.until - s.time - C.GUNSHIP_S)).toBeLessThan(0.3);
}, 60000);

test("0.46: send home before it arrives returns the charge; after, it doesn't", () => {
  const s = gunshipBattle(2);
  expect(s.useAbility("gunship", s.w / 2 + 120, 200)).toBeNull();
  expect(s.charges.gunship).toBe(1);
  const o = s.orbits[0];
  s.step();
  expect(s.sendHome(o)).toBe(true);
  expect(s.charges.gunship).toBe(2);
  expect(s.orbitAlive(o)).toBe(false);
  expect(s.sendHome(o)).toBe(false);
  expect(s.redeployOrbit(o, 100, 100)).not.toBeNull();
  run(s, 15);
  expect(s.orbits.includes(o)).toBe(false);
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const p = s.orbits[0];
  arrive(s, p);
  expect(s.sendHome(p)).toBe(true);
  expect(s.charges.gunship).toBe(1);
  run(s, 15);
  expect(s.orbits.length).toBe(0);
}, 60000);

test("0.46: send home while refueling just ends it", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  arrive(s, o);
  while (!o.away) s.step();
  expect(s.sendHome(o)).toBe(true);
  s.step();
  expect(s.orbits.length).toBe(0);
  expect(s.charges.gunship).toBe(0);
}, 60000);

test("0.46: entityAt finds the plane and the orbit center", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  s.step();
  const [fx, fy] = s.orbitPos(o);
  expect(s.entityAt(fx + 1, fy - 1)).toEqual({ orbit: o });
  arrive(s, o);
  const [px, py] = s.orbitPos(o);
  expect(s.entityAt(px, py)).toEqual({ orbit: o });
  expect(s.entityAt(o.x + 2, o.y)).toEqual({ orbit: o });
  expect(s.sendHome(o)).toBe(true);
  expect(s.entityAt(o.x, o.y)).toBeNull();
}, 60000);

// ---- Task 4: the cursor label over an AC-130 (found in the browser check: it threw every frame) ----
import { describeCell } from "../src/cursorinfo";
test("0.46: the cursor label names an AC-130 under the pointer", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  const lines = describeCell(s, Math.floor(o.x), Math.floor(o.y));
  expect(lines!.join(" ")).toContain("AC-130");
}, 60000);

// ---- Final review fix: redeploy while refueling says when it will be back ----
test("0.46: the redeploy message tells the truth about a refueling plane", () => {
  const s = gunshipBattle();
  expect(s.useAbility("gunship", s.w / 2 + 120, 70)).toBeNull();
  const o = s.orbits[0];
  expect(s.redeployNote(o)).toBe("AC-130 moving to the new spot.");
  arrive(s, o);
  while (!o.away) s.step();
  run(s, 5);
  expect(s.redeployOrbit(o, s.w / 2 - 100, 120)).toBeNull();
  expect(s.redeployNote(o)).toBe(`AC-130 refueling: back over the new spot in ${Math.ceil(o.until - s.time)} s.`);
}, 60000);
