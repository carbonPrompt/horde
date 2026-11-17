// 0.42: households that refuse to leave, bluffers who break, units that talk them out.
import { expect, test } from "bun:test";
import { Sim, CIV } from "../src/sim";
import { walkable } from "../src/map";
import * as Cfg from "../src/config";
import { PLAN_REFUSE, PLAN_STRAIGHT, EV_REFUSE, EV_BROKE, EV_TALKED_OUT } from "../src/people";

function zoneAt(s: Sim, half: number): [number, number][] {
  const cx = s.w >> 1, cy = s.h >> 1;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
function town(min: number, civilians = 6000, seedCity = 1) {
  const c = Cfg.CITIES[seedCity];
  const s = new Sim(c.seed, { recipe: c.recipe, budget: 80_000_000, civilians, difficulty: "medium" });
  s.setStartTime(min);
  s.setZone(zoneAt(s, 40));
  s.dev.bites = false; s.dev.instantDeploy = true; s.dev.unlimitedMoney = true;
  return s;
}
const homeD = (s: Sim, k: number) => Math.hypot(s.ax[k] - (s.homeCell[k] % s.w) - 0.5, s.ay[k] - ((s.homeCell[k] / s.w) | 0) - 0.5);
/** A refuser standing at home right after the alert (bluffer or die-hard). */
function refuserAtHome(s: Sim, bluffer: boolean): number {
  for (let k = 0; k < s.civN; k++) if (s.plan[k] === PLAN_REFUSE && s.state[k] === CIV && homeD(s, k) < 2 && (s.resolve[k] < 1) === bluffer) return k;
  return -1;
}
/** A free street cell within r of person k (not under them). */
function streetNear(s: Sim, k: number, r: number): [number, number] | null {
  const x0 = s.ax[k] | 0, y0 = s.ay[k] | 0;
  for (let d = 2; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const x = x0 + dx, y = y0 + dy;
    if (x < 1 || y < 1 || x >= s.w - 1 || y >= s.h - 1) continue;
    if (walkable(s.map.tile[s.idx(x, y)]) && !s.canPlace("turret", x, y)) return [x, y];
  }
  return null;
}

test("0.42: a few households refuse to leave, more of them elderly", () => {
  const s = town(1380, 20000); s.startBattle();
  let hh = 0, ref = 0, old = 0, oldRef = 0;
  for (let k = 0; k < s.civN; k++) {
    if (s.famLead[k] !== k || s.atVenue[k]) continue;
    let elder = false, r = false;
    for (let m = k; m < k + s.famSize[k]; m++) { if (s.age[m] >= 65) elder = true; if (s.refuser[m]) r = true; }
    hh++; if (r) ref++;
    if (elder) { old++; if (r) oldRef++; }
  }
  console.log({ hh, ref, old, oldRef });
  expect(ref / hh).toBeGreaterThanOrEqual(0.02);
  expect(ref / hh).toBeLessThanOrEqual(0.04);
  expect(oldRef / old).toBeGreaterThan((ref - oldRef) / (hh - old));
  for (let k = 0; k < s.civN; k++) if (s.refuser[k]) expect(s.storyOf(k).some(e => e.code === EV_REFUSE)).toBe(true);
}, 120000);

test("0.42: who refuses is the same every replay", () => {
  const a = town(600), b = town(600); a.startBattle(); b.startBattle();
  expect(Array.from(a.refuser)).toEqual(Array.from(b.refuser));
  expect(Array.from(a.resolve)).toEqual(Array.from(b.resolve));
  expect(a.refuser.some(v => v === 1)).toBe(true);
}, 120000);

test("0.42: without a start time nobody refuses", () => {
  const c = Cfg.CITIES[1];
  const s = new Sim(c.seed, { recipe: c.recipe, budget: 80_000_000, civilians: 6000 });
  s.setZone(zoneAt(s, 40)); s.startBattle();
  expect(s.refuser.every(v => v === 0)).toBe(true);
}, 120000);

test("0.42: refusers stay home while the city empties", () => {
  const s = town(1380); s.startBattle();
  while (s.time < Cfg.WARNING_S - 1) s.step();
  let n = 0, home = 0;
  for (let k = 0; k < s.civN; k++) if (s.plan[k] === PLAN_REFUSE && s.state[k] === CIV) { n++; if (homeD(s, k) < 3) home++; }
  expect(n).toBeGreaterThan(5);
  expect(home / n).toBeGreaterThanOrEqual(0.9);
}, 120000);

test("0.42: a bluffer with the infected next door breaks and runs", () => {
  const s = town(1380); s.startBattle();
  const k = refuserAtHome(s, true); expect(k).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 3; i++) s.spawnInfected(s.ax[k] + 1.2, s.ay[k] + 0.3 * i, 1e9);
  const t0 = s.time; while (s.time < t0 + 10 && s.plan[k] === PLAN_REFUSE) s.step();
  expect(s.plan[k]).toBe(PLAN_STRAIGHT);
  expect(s.refuser[k]).toBe(3);
  expect(s.storyOf(k).some(e => e.code === EV_BROKE)).toBe(true);
}, 120000);

test("0.42: a die-hard holds a while with the infected next door", () => {
  const s = town(1380); s.startBattle();
  const k = refuserAtHome(s, false); expect(k).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 3; i++) s.spawnInfected(s.ax[k] + 1.2, s.ay[k] + 0.3 * i, 1e9);
  const t0 = s.time; while (s.time < t0 + 5) s.step();
  expect(s.plan[k]).toBe(PLAN_REFUSE);
}, 120000);

test("0.42: a unit parked beside a refuser talks them out after about 20 s", () => {
  const s = town(1380); s.startBattle();
  const k = refuserAtHome(s, false); expect(k).toBeGreaterThanOrEqual(0);
  const at = streetNear(s, k, Cfg.PERSUADE_R - 1); expect(at).not.toBeNull();
  expect(s.place("turret", at![0], at![1])).toBeNull();
  const t0 = s.time;
  while (s.time < t0 + Cfg.PERSUADE_S - 5) s.step();
  expect(s.plan[k]).toBe(PLAN_REFUSE);
  while (s.time < t0 + Cfg.PERSUADE_S + 3 && s.plan[k] === PLAN_REFUSE) s.step();
  expect(s.plan[k]).toBe(PLAN_STRAIGHT);
  expect(s.refuser[k]).toBe(2);
  expect(s.talkedOut).toBeGreaterThanOrEqual(1);
  expect(s.storyOf(k).some(e => e.code === EV_TALKED_OUT)).toBe(true);
}, 120000);

test("0.42: a battle saved mid-persuasion replays identically", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = town(1380, 3000); s.startBattle();
  const k = refuserAtHome(s, false); expect(k).toBeGreaterThanOrEqual(0);
  const at = streetNear(s, k, Cfg.PERSUADE_R - 1)!; s.place("turret", at[0], at[1]);
  const t0 = s.time; while (s.time < t0 + 8) s.step();
  const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
  for (let i = 0; i < 20 * 40; i++) { s.step(); b.step(); }
  let diff = 0; for (let j = 0; j < s.n; j++) if (s.ax[j] !== b.ax[j] || s.ay[j] !== b.ay[j] || s.plan[j] !== b.plan[j] || s.refuser[j] !== b.refuser[j]) diff++;
  expect(diff).toBe(0);
  expect(b.persuadeT[k]).toBe(s.persuadeT[k]);
}, 300000);

// ---------- 0.42 task 2: round end and score ----------
import { savedPct } from "../src/scoring";
import { DEAD, SAFE_CIV, INF } from "../src/sim";
test("0.42: refusers cost the score only a little", () => {
  expect(savedPct(50, 100, 0, 0)).toBe(50);
  expect(savedPct(90, 100, 10, 0)).toBeCloseTo(100 * 90 / 91, 6); // 10 at home count as one loss
  expect(savedPct(90, 100, 0, 10)).toBeCloseTo(100 * 90 / 92.5, 6); // 10 dead at home count as 2.5
  expect(savedPct(0, 0, 0, 0)).toBe(0);
});

test("0.42: with only refusers left at home the round ends as emptied, and they're counted", () => {
  const s = town(1380, 3000); s.startBattle();
  while (!s.outbreak) s.step();
  let ref = 0;
  for (let k = 0; k < s.civN; k++) {
    if (s.state[k] !== CIV && s.state[k] !== SAFE_CIV) continue;
    if (s.plan[k] === 9 && s.refuser[k] === 1) { ref++; continue; }
    s.state[k] = DEAD; // everyone else is gone
  }
  expect(ref).toBeGreaterThan(0);
  const t0 = s.time; while (!s.roundResult && s.time < t0 + 3) s.step();
  expect(s.roundResult).not.toBeNull();
  expect(s.roundResult!.refused).toBe(s.counts().refusing);
  expect(s.roundResult!.refused).toBeGreaterThan(0);
  expect(s.roundResult!.parts.speed).toBeGreaterThanOrEqual(0); // emptied: speed is scored
  expect(s.roundResult!.reason).toMatch(/refused to leave/);
}, 120000);

// ---------- 0.42 task 3: age ----------
import { agePace, EV_SOLO } from "../src/people";
test("0.42: pace by age", () => {
  expect(agePace(3)).toBe(0.8); expect(agePace(9)).toBe(0.95); expect(agePace(15)).toBe(1.1);
  expect(agePace(40)).toBe(1); expect(agePace(70)).toBe(0.85); expect(agePace(82)).toBe(0.7);
});

test("0.42: the elderly cover less ground than working-age adults", () => {
  const s = town(1380, 6000); s.startBattle();
  const pick = (lo: number, hi: number) => { const a: number[] = []; for (let k = 0; k < s.civN; k++) if (s.famLead[k] < 0 && !s.refuser[k] && s.state[k] === CIV && s.age[k] >= lo && s.age[k] <= hi) a.push(k); return a; };
  const old = pick(75, 120), adults = pick(18, 64);
  const x0 = new Float32Array(s.civN), y0 = new Float32Array(s.civN);
  for (let k = 0; k < s.civN; k++) { x0[k] = s.ax[k]; y0[k] = s.ay[k]; }
  while (s.time < 12) s.step();
  const mean = (a: number[]) => a.reduce((t, k) => t + Math.hypot(s.ax[k] - x0[k], s.ay[k] - y0[k]), 0) / a.length;
  console.log({ old: old.length, adults: adults.length, mo: mean(old), ma: mean(adults) });
  expect(old.length).toBeGreaterThan(10);
  expect(mean(old) / mean(adults)).toBeLessThan(0.85);
}, 120000);

test("0.42: some teens head for the zone alone, and their family doesn't keep them close", () => {
  const s = town(1380, 12000); s.startBattle();
  let teens = 0, solo = 0;
  for (let k = 0; k < s.civN; k++) if (s.famLead[k] >= 0 && s.age[k] >= 13 && s.age[k] <= 17 && s.state[k] === CIV && !s.refuser[k] && !s.atVenue[k]) {
    teens++;
    if (s.solo[k]) { solo++; expect(s.plan[k]).toBe(1); expect(s.storyOf(k).some(e => e.code === EV_SOLO)).toBe(true); }
  }
  console.log({ teens, solo });
  expect(solo / teens).toBeGreaterThan(0.08); expect(solo / teens).toBeLessThan(0.25);
}, 120000);

test("0.42: an armed adult shoots first at the infected next to their family", () => {
  const s = town(1380, 3000); s.startBattle();
  // an armed adult with a family member, both alive on the street
  let k = -1, m = -1;
  for (let i = 0; i < s.civN && k < 0; i++) if (s.civWep[i] > 0 && s.age[i] >= 18 && s.famLead[i] >= 0 && s.state[i] === CIV)
    for (let j = s.famLead[i]; j < s.famLead[i] + s.famSize[i]; j++) if (j !== i && s.state[j] === CIV) { k = i; m = j; break; }
  expect(k).toBeGreaterThanOrEqual(0);
  // put both on an open street, the relative 4 cells away
  let cx = -1, cy = -1;
  for (let y = 10; y < s.h - 10 && cx < 0; y++) for (let x = 10; x < s.w - 10 && cx < 0; x++) {
    let ok = true; for (let dy = -6; dy <= 6 && ok; dy++) for (let dx = -6; dx <= 6 && ok; dx++) ok = walkable(s.map.tile[s.idx(x + dx, y + dy)]) && s.inZone[s.idx(x + dx, y + dy)] === 0;
    if (ok) { cx = x; cy = y; }
  }
  expect(cx).toBeGreaterThan(0);
  s.ax[k] = cx + 0.5; s.ay[k] = cy + 0.5; s.ax[m] = cx + 4.5; s.ay[m] = cy + 0.5;
  const infAt = (x: number, y: number) => { s.spawnInfected(x, y, 1e9); for (let i = s.civN; i < s.n; i++) if (s.state[i] === INF && s.ax[i] === x && s.ay[i] === y) return i; return -1; };
  for (let i = s.civN; i < s.n; i++) if (s.state[i] !== DEAD && Math.hypot(s.ax[i] - cx, s.ay[i] - cy) < 15) s.state[i] = DEAD; // nobody else around
  const near = infAt(cx - 1.5, cy + 0.5); // nearer to the shooter
  const fam = infAt(cx + 5.5, cy + 1.5); // beside the relative
  expect(near).toBeGreaterThanOrEqual(0); expect(fam).toBeGreaterThanOrEqual(0);
  (s as any).rebuildBuckets();
  const wep = Cfg.CIV_WEAPONS[s.civWep[k] as Cfg.CivWeaponId];
  expect((s as any).civTarget(k, s.ax[k], s.ay[k], wep.range)).toBe(fam);
  s.state[m] = DEAD; // with nobody of theirs near: the nearest, as before
  expect((s as any).civTarget(k, s.ax[k], s.ay[k], wep.range)).toBe(near);
}, 120000);

// ---------- 0.42 review fixes ----------
import { FATE_EVAC, PLAN_GATHER } from "../src/people";
test("0.42 review: a train doesn't carry off a refuser at home; one still walking home gets on and stops refusing", () => {
  const s = town(1380); s.startBattle();
  const k = refuserAtHome(s, false); expect(k).toBeGreaterThanOrEqual(0);
  expect((s as any).trainBoard(k)).toBe(false);
  expect(s.state[k]).toBe(CIV);
  const s2 = town(600); s2.startBattle();
  let w = -1; for (let i = 0; i < s2.civN && w < 0; i++) if (s2.refuser[i] === 1 && s2.plan[i] === PLAN_GATHER) w = i;
  expect(w).toBeGreaterThanOrEqual(0);
  expect((s2 as any).trainBoard(w)).toBe(true);
  expect(s2.refuser[w]).toBe(0);
  expect(s2.fate[w]).toBe(FATE_EVAC);
}, 120000);

test("0.42 review: a refuser who got out isn't counted as lost at home", () => {
  const s = town(1380, 3000); s.startBattle();
  const k = refuserAtHome(s, false);
  const before = s.counts().refusedLost;
  s.state[k] = DEAD; s.fate[k] = FATE_EVAC;
  expect(s.counts().refusedLost).toBe(before);
}, 120000);

test("0.42 review: accidental kills after the round show on the final screen", () => {
  const s = town(1380, 3000); s.startBattle();
  while (!s.outbreak) s.step();
  expect(s.endRoundNow()).toBeNull();
  s.civKilledByUs += 200; s.kills += 1;
  s.withdraw();
  expect(s.result!.civKilledByUs).toBe(s.civKilledByUs);
}, 120000);

test("0.42 review: a refuser whose home ends up inside a zone stops refusing", () => {
  const s = town(1380, 3000); s.startBattle();
  const k = refuserAtHome(s, false); expect(k).toBeGreaterThanOrEqual(0);
  s.inZone[s.homeCell[k]] = 1; // the doorstep is inside now, they're just outside it
  const hx = s.homeCell[k] % s.w, hy = (s.homeCell[k] / s.w) | 0; let moved = false;
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [1, 2], [-2, 1], [-1, -2]]) {
    const i = s.idx(hx + dx, hy + dy);
    if (!moved && walkable(s.map.tile[i]) && s.inZone[i] === 0) { s.ax[k] = hx + dx + 0.5; s.ay[k] = hy + dy + 0.5; moved = true; }
  }
  expect(moved).toBe(true);
  const t0 = s.time; while (s.time < t0 + 2) s.step();
  expect(s.refuser[k]).not.toBe(1);
  expect(s.plan[k]).not.toBe(PLAN_REFUSE);
}, 120000);
