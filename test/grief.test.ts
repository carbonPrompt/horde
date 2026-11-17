// 0.43: loved ones turning: a family member who sees it may freeze, go back for them, or refuse to leave.
import { expect, test } from "bun:test";
import { Sim, CIV, INF, DEAD } from "../src/sim";
import { walkable, BUILDING } from "../src/map";
import * as Cfg from "../src/config";
import { PLAN_GO_BACK, PLAN_STRAIGHT, PLAN_REFUSE, PLAN_GATHER, EV_SAW_TURN, EV_FROZE, EV_GO_BACK, EV_GRIEF_STAY, storyLine } from "../src/people";

function town(min: number | null, civilians = 6000) {
  const c = Cfg.CITIES[1];
  const s = new Sim(c.seed, { recipe: c.recipe, budget: 80_000_000, civilians, difficulty: "medium" });
  if (min !== null) s.setStartTime(min);
  const cx = s.w >> 1, cy = s.h >> 1; s.setZone([[cx - 40, cy - 40], [cx + 40, cy - 40], [cx + 40, cy + 40], [cx - 40, cy + 40]]);
  s.dev.bites = false; s.dev.instantDeploy = true; s.dev.unlimitedMoney = true;
  return s;
}
const turn = (s: Sim, v: number) => { s.state[v] = INF; (s as any).grieve(v); };
const has = (s: Sim, k: number, code: number) => s.storyOf(k).some(e => e.code === code);
/** Turn the lead of every household still together and see how the others react. */
function sweep(s: Sim) {
  let witnesses = 0, froze = 0, back = 0, stay = 0;
  for (let k = 0; k < s.civN; k++) {
    if (s.famLead[k] !== k || s.state[k] !== CIV || s.refuser[k]) continue;
    const others: number[] = [];
    for (let m = k + 1; m < k + s.famSize[k]; m++) if (s.state[m] === CIV && !s.refuser[m] && s.age[m] >= 13 && Math.hypot(s.ax[m] - s.ax[k], s.ay[m] - s.ay[k]) < 3) others.push(m);
    if (!others.length) continue;
    turn(s, k);
    for (const m of others) {
      witnesses++;
      expect(has(s, m, EV_SAW_TURN)).toBe(true);
      if (has(s, m, EV_FROZE)) froze++; else if (has(s, m, EV_GO_BACK)) back++; else if (has(s, m, EV_GRIEF_STAY)) stay++;
    }
  }
  return { witnesses, froze, back, stay };
}

test("0.43: some who see a loved one turn react, mostly freezing", () => {
  const s = town(1380, 20000); s.startBattle();
  const r = sweep(s), react = r.froze + r.back + r.stay;
  console.log(r);
  expect(r.witnesses).toBeGreaterThan(300);
  expect(react / r.witnesses).toBeGreaterThan(0.2); expect(react / r.witnesses).toBeLessThan(0.4);
  expect(r.froze / react).toBeGreaterThan(0.45); expect(r.froze / react).toBeLessThan(0.75);
  expect(r.back / react).toBeGreaterThan(0.12); expect(r.back / react).toBeLessThan(0.38);
  expect(r.stay / react).toBeGreaterThan(0.05); expect(r.stay / react).toBeLessThan(0.25);
}, 120000);

test("0.43: the same turnings get the same reactions every replay", () => {
  const a = town(1380), b = town(1380); a.startBattle(); b.startBattle();
  expect(sweep(a)).toEqual(sweep(b));
  expect(Array.from(a.plan)).toEqual(Array.from(b.plan));
  expect(Array.from(a.actT)).toEqual(Array.from(b.actT));
}, 120000);

test("0.43: without a start time nobody grieves", () => {
  const s = town(null); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.famLead[i] === i && s.famSize[i] > 2) k = i;
  turn(s, k);
  for (let m = k + 1; m < k + s.famSize[k]; m++) expect(s.storyOf(m).length).toBe(0);
}, 120000);

test("0.43: a family member out of sight doesn't see it", () => {
  const s = town(1380); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.famLead[i] === i && s.famSize[i] >= 2 && s.state[i] === CIV && s.state[i + 1] === CIV) k = i;
  const m = k + 1;
  s.ax[m] = s.ax[k] + 20; s.ay[m] = s.ay[k]; // too far
  turn(s, k);
  expect(has(s, m, EV_SAW_TURN)).toBe(false);
  // behind a building: find one with street on both sides
  const s2 = town(1380); s2.startBattle();
  let x = -1, y = -1, gap = 0;
  for (let yy = 5; yy < s2.h - 5 && x < 0; yy++) for (let xx = 5; xx < s2.w - 12 && x < 0; xx++) {
    if (!walkable(s2.map.tile[s2.idx(xx, yy)])) continue;
    let L = 0; while (L < 10 && s2.map.tile[s2.idx(xx + 1 + L, yy)] === BUILDING) L++;
    if (L >= 2 && L < 10 && walkable(s2.map.tile[s2.idx(xx + 1 + L, yy)])) { x = xx; y = yy; gap = L + 1; }
  }
  expect(x).toBeGreaterThan(0);
  s2.ax[k] = x + 0.5; s2.ay[k] = y + 0.5; s2.ax[m] = x + gap + 0.5; s2.ay[m] = y + 0.5;
  turn(s2, k);
  expect(has(s2, m, EV_SAW_TURN)).toBe(false);
}, 120000);

/** A witness with a given reaction, found by trying household leads in turn (each sim fresh). */
function witnessWith(code: number) {
  const s = town(1380); s.startBattle();
  for (let k = 0; k < s.civN; k++) {
    if (s.famLead[k] !== k || s.state[k] !== CIV || s.refuser[k]) continue;
    for (let m = k + 1; m < k + s.famSize[k]; m++) {
      if (s.state[m] !== CIV || s.refuser[m] || s.age[m] < 13 || Math.hypot(s.ax[m] - s.ax[k], s.ay[m] - s.ay[k]) >= 3) continue;
      turn(s, k);
      if (has(s, m, code)) return { s, k, m };
      break;
    }
  }
  return null;
}

test("0.43: a freezer stands still for a few seconds, then goes on", () => {
  const w = witnessWith(EV_FROZE)!; expect(w).not.toBeNull();
  const { s, k, m } = w;
  s.state[k] = DEAD; // the turned one is shot right away, nothing chases them
  expect(s.act[m]).toBe(2);
  expect(s.actT[m]).toBeGreaterThanOrEqual(Cfg.GRIEF_FREEZE_S_MIN - 1e-6); expect(s.actT[m]).toBeLessThanOrEqual(Cfg.GRIEF_FREEZE_S_MAX + 1e-6);
  const x0 = s.ax[m], y0 = s.ay[m], t0 = s.time;
  while (s.time < t0 + Cfg.GRIEF_FREEZE_S_MIN - 0.5) s.step();
  expect(Math.hypot(s.ax[m] - x0, s.ay[m] - y0)).toBeLessThan(0.6);
  while (s.time < t0 + Cfg.GRIEF_FREEZE_S_MAX + 1) s.step();
  expect(s.act[m]).toBe(0);
}, 120000);

test("0.43: someone who goes back walks toward them, and the errand ends", () => {
  const w = witnessWith(EV_GO_BACK)!; expect(w).not.toBeNull();
  const { s, k, m } = w;
  expect(s.plan[m]).toBe(PLAN_GO_BACK);
  expect(s.goal[m]).toBe(k);
  s.ax[k] += 6; s.hp[k] = 1e9; s.dev.bites = false;
  const d0 = Math.hypot(s.ax[m] - s.ax[k], s.ay[m] - s.ay[k]);
  let minD = d0; const t0 = s.time;
  while (s.time < t0 + Cfg.GO_BACK_S + 2 && s.plan[m] === PLAN_GO_BACK) { s.step(); minD = Math.min(minD, Math.hypot(s.ax[m] - s.ax[k], s.ay[m] - s.ay[k])); }
  expect(minD).toBeLessThan(d0 - 1);
  expect(s.plan[m]).toBe(PLAN_STRAIGHT);
}, 120000);

test("0.43: going back ends at once if the one they went for is gone", () => {
  const w = witnessWith(EV_GO_BACK)!; const { s, k, m } = w;
  s.state[k] = DEAD; s.step(); s.step(); s.step(); s.step(); s.step(); s.step(); s.step(); s.step();
  expect(s.plan[m]).toBe(PLAN_STRAIGHT);
}, 120000);

test("0.43: someone who won't leave now counts as a refuser and can be talked out", () => {
  const w = witnessWith(EV_GRIEF_STAY)!; expect(w).not.toBeNull();
  const { s, m } = w;
  expect(s.refuser[m]).toBe(1);
  expect([PLAN_REFUSE, PLAN_GATHER]).toContain(s.plan[m]);
  expect(s.counts().refusing).toBeGreaterThanOrEqual(1);
  expect(s.refuserList).toContain(m);
}, 120000);

test("0.43: a witness reacts once per person turned", () => {
  const w = witnessWith(EV_SAW_TURN)!; const { s, k, m } = w;
  (s as any).grieve(k);
  expect(s.storyOf(m).filter(e => e.code === EV_SAW_TURN).length).toBe(1);
}, 120000);

test("0.43: the story lines name the one they lost", () => {
  expect(storyLine(EV_SAW_TURN, 5, () => "Ana")).toBe("saw Ana turn");
  expect(storyLine(EV_GO_BACK, 5, () => "Ana")).toBe("went back for Ana");
  expect(storyLine(EV_GRIEF_STAY, 5, () => "Ana")).toBe("won't leave now, not after losing Ana");
  expect(storyLine(EV_FROZE, 0)).toBe("froze in shock");
});

test("0.43: a battle saved while someone goes back replays identically", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const w = witnessWith(EV_GO_BACK)!; const { s } = w;
  s.step(); s.step();
  const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
  for (let i = 0; i < 20 * 15; i++) { s.step(); b.step(); }
  let diff = 0; for (let j = 0; j < s.n; j++) if (s.ax[j] !== b.ax[j] || s.ay[j] !== b.ay[j] || s.plan[j] !== b.plan[j] || s.state[j] !== b.state[j]) diff++;
  expect(diff).toBe(0);
}, 300000);

// ---------- 0.43 review fixes ----------
import { EV_BROKE, EV_GAVE_UP } from "../src/people";
test("0.43 review: someone who won't leave doesn't give up on it out of fear a moment later", () => {
  // find a grief refuser who is away from home (heading home), with the turned one still right beside them
  const s = town(1380); s.startBattle();
  let m = -1, v = -1;
  for (let k = 0; k < s.civN && m < 0; k++) {
    if (s.famLead[k] !== k || s.state[k] !== CIV || s.refuser[k]) continue;
    for (let j = k + 1; j < k + s.famSize[k]; j++) {
      if (s.state[j] !== CIV || s.refuser[j] || s.age[j] < 13) continue;
      s.ax[j] = s.ax[k] + 1.5; s.ay[j] = s.ay[k]; s.ax[k] += 0; // close by
      const hc = s.homeCell[j]; s.homeCell[j] = hc + 40; // home is elsewhere now: they'll head there
      turn(s, k);
      if (s.storyOf(j).some(e => e.code === EV_GRIEF_STAY)) { m = j; v = k; }
      else s.homeCell[j] = hc;
      break;
    }
  }
  expect(m).toBeGreaterThanOrEqual(0);
  s.hp[v] = 1e9;
  const t0 = s.time; while (s.time < t0 + 2) s.step();
  const gaveUp = s.storyOf(m).some(e => e.code === EV_GAVE_UP), broke = s.storyOf(m).some(e => e.code === EV_BROKE);
  expect(gaveUp).toBe(false);
  expect(s.refuser[m] === 1 || broke).toBe(true);
}, 120000);

test("0.43 review: someone done refusing (talked out or ran) doesn't become a refuser again", () => {
  const s = town(1380, 20000); s.startBattle();
  for (let k = 0; k < s.civN; k++) if (s.refuser[k] === 0) s.refuser[k] = 3; // everyone has been through it already
  const before = s.refusers;
  for (let k = 0; k < s.civN; k++) if (s.famLead[k] === k && s.state[k] === CIV) turn(s, k);
  expect(s.refusers).toBe(before);
  for (let k = 0; k < s.civN; k++) expect(s.storyOf(k).some(e => e.code === EV_GRIEF_STAY)).toBe(false);
}, 120000);

test("0.43 review: family waiting in the zone don't wait for someone who refuses at home", () => {
  const s = town(1380); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.famLead[i] === i && s.famSize[i] >= 2 && s.state[i] === CIV && s.state[i + 1] === CIV) k = i;
  for (let m = k; m < k + s.famSize[k]; m++) s.state[m] = 3; // all safe in the zone
  s.state[k + 1] = CIV; s.refuser[k + 1] = 1; s.plan[k + 1] = PLAN_REFUSE; // except one, who stays home
  expect((s as any).meetDone(k)).toBe(true);
}, 120000);
