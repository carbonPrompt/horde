import { expect, test } from "bun:test";
import { COLS, SE_HORDE, newRecorder, sample, event, unitIndex, killBy, strike, killTotal } from "../src/stats";
import { encode, decode } from "../src/snapshot";

const row = (v: number) => Object.fromEntries(COLS.map(c => [c, v])) as any;

test("sample pushes one value per column and advances nextT", () => {
  const r = newRecorder("b1");
  sample(r, row(1)); sample(r, { ...row(1), t: 10 });
  expect(COLS.every(c => r.cols[c].length === 2)).toBe(true);
  expect(r.nextT).toBe(20);
});

test("every kill lands in exactly one bucket", () => {
  const r = newRecorder("b1"); const u = { kind: "tank" } as any;
  const ui = unitIndex(r, u, 0); const si = strike(r, "airstrike", 5, 1, 2);
  killBy(r, 6, { unit: ui }); killBy(r, 6, { strike: si }); killBy(r, 7, { other: "guard" }); killBy(r, 7, {});
  expect(killTotal(r)).toBe(4);
  expect(r.units[ui].kills).toBe(1); expect(r.strikes[si].kills).toBe(1);
  expect(r.other.guard).toBe(1); expect(r.other.env).toBe(1);
});

test("unitIndex is stable and labels by kind order", () => {
  const r = newRecorder("b1"); const a = { kind: "tank" } as any, b = { kind: "tank" } as any;
  expect(unitIndex(r, a, 0)).toBe(unitIndex(r, a, 9));
  unitIndex(r, b, 1);
  expect(r.units.map(x => x.label)).toEqual(["M1 Abrams 1", "M1 Abrams 2"]);
});

test("best60 counts kills inside a rolling 60 s window", () => {
  const r = newRecorder("b1");
  for (let i = 0; i < 30; i++) killBy(r, i, {});
  for (let i = 0; i < 10; i++) killBy(r, 100 + i, {});
  expect(r.c.best60).toBe(30);
});

test("strike logs an event and counts its kind", () => {
  const r = newRecorder("b1"); strike(r, "moab", 3, 4, 5); strike(r, "moab", 9, 4, 5);
  expect(r.c.strikeKinds.moab).toBe(2); expect(r.ev.t.length).toBe(2);
});

test("recorder survives snapshot encode/decode", () => {
  const r = newRecorder("b1"); sample(r, row(2)); event(r, SE_HORDE, 3, 4, 5, 120, 2);
  expect(decode(encode({ r })).r).toEqual(r);
});

// ---------- sim wiring ----------
import { Sim } from "../src/sim";
import * as C from "../src/config";
import { SE_LIFT, SE_SIRENS, SE_STRIKE } from "../src/stats";

function zoneAroundCenter(s: Sim, half = 30): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
/** A small battle: zone, a mortar, an APC and a sniper, one airstrike and one firebomb on the crowd, run to 240 s. */
function battleFixture(until = 240, opts: object = {}) {
  const s = new Sim(42, { budget: 80_000_000, civilians: 5000, battleId: "fx", ...opts } as any);
  s.setZone(zoneAroundCenter(s));
  let placed = 0;
  for (let y = 10; y < s.h - 10 && placed < 3; y += 3) for (let x = 10; x < s.w - 10 && placed < 3; x += 3)
    if (s.inZone[s.idx(x, y)] === 1 && !s.place((["mortar", "apc", "sniper"] as const)[placed], x, y)) placed++;
  s.buyAbility("airstrike"); s.buyAbility("firebomb");
  s.startBattle();
  const steps = (sec: number) => { for (let i = 0; i < sec / C.DT; i++) s.step(); };
  steps(60);
  const k = s.state.indexOf(1);
  if (k >= 0) {
    const x = Math.round(s.ax[k]), y = Math.round(s.ay[k]);
    const ax0 = Math.max(5, Math.min(s.w - 45, x - 20));
    s.useAbility("airstrike", ax0, y, ax0 + 40, y); s.useAbility("firebomb", x, y);
  }
  steps(until - 60);
  return s;
}

test("sim: recorder kill buckets sum to sim.kills over a real battle", () => {
  const s = battleFixture();
  expect(s.kills).toBeGreaterThan(0);
  expect(killTotal(s.stats)).toBe(s.kills);
  expect(s.stats.strikes.length).toBe(2);
  expect(s.stats.battleId).toBe("fx");
  expect(s.stats.strikes.reduce((n, x) => n + x.kills, 0)).toBeGreaterThan(0);
}, 120000);

test("sim: samples every 10 s of battle time, sirens and strikes logged", () => {
  const s = battleFixture(120);
  expect(s.stats.cols.t.length).toBe(Math.floor(s.time / 10) + 1); // float time: 2400 x DT can land just under 120
  expect(s.stats.cols.t[1]).toBeCloseTo(10, 0);
  expect(s.stats.ev.k).toContain(SE_SIRENS);
  expect(s.stats.ev.k.filter(k => k === SE_STRIKE).length).toBe(2);
  expect(s.stats.units.length).toBeGreaterThanOrEqual(3);
}, 120000);

test("sim: snapshot mid-battle then finish equals an uninterrupted run's recorder", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = battleFixture(90);
  const b = (await unpack(await pack(C.VERSION, "t", s, {}))).sim;
  for (let i = 0; i < 30 / C.DT; i++) { s.step(); b.step(); }
  expect(b.stats).toEqual(s.stats);
}, 120000);
