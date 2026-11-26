// 0.62: Battle Events in the Sim: the director reserves real people, shelters them, alerts, and resolves.
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { Sim, CIV, INF, DEAD, SAFE_CIV } from "../src/sim";
import { PLAN_SHELTER } from "../src/people";
import { SE_EVENT_START, SE_EVENT_WON, SE_EVENT_LOST } from "../src/stats";
import { firstAlertT } from "../src/events";
import { encode, decode } from "../src/snapshot";

const ZONE: [number, number][] = [[165, 82], [217, 82], [217, 130], [165, 130]];
function mk(opts: { events?: boolean; startMin?: number; seed?: number } = {}): Sim {
  const s = new Sim(opts.seed ?? C.CITIES[0].seed, { recipe: C.CITIES[0].recipe, difficulty: "medium", budget: 400_000_000, mutators: opts.events === false ? [] : ["battle_events"] } as any);
  s.setStartTime(opts.startMin ?? 600);
  expect(s.setZone(ZONE)).toBeNull();
  return s;
}
const go = (s: Sim, secs: number) => { for (let t = 0; t < secs; t += C.DT) s.step(C.DT); };
/** Bring the next alert forward to now. */
const alertNow = (s: Sim) => { s.bev!.nextT = s.time - C.WARNING_S; go(s, 0.5); return s.bevLive()!; };
const hashPos = (s: Sim) => { let h = 0; for (let k = 0; k < s.civN; k++) h = (Math.imul(h ^ Math.round(s.ax[k] * 100), 0x9e3779b1) ^ s.state[k]) >>> 0; return h; };

test("off: no director, and the battle runs the same", () => {
  const a = mk({ events: false }), b = mk({ events: false });
  a.startBattle(); b.startBattle();
  expect(a.bev).toBeNull();
  go(a, 40); go(b, 40);
  expect(hashPos(a)).toBe(hashPos(b));
}, 120000);

test("reserves real people at the start; they shelter", () => {
  const s = mk(); s.startBattle();
  expect(s.bev).not.toBeNull();
  const ev = s.bev!.events;
  expect(ev.length).toBeGreaterThanOrEqual(2);
  expect(ev.length).toBeLessThanOrEqual(C.EVENTS_MAX);
  expect(new Set(ev.map(e => e.kind)).size).toBe(ev.length); // each kind at most once
  for (const e of ev) {
    expect(e.state).toBe("reserved");
    expect(e.people.length).toBeGreaterThan(0);
    for (const k of e.people) { expect(s.state[k]).toBe(CIV); expect(s.plan[k]).toBe(PLAN_SHELTER); }
  }
  expect(s.bev!.nextT).toBe(firstAlertT(s.seed));
}, 120000);

test("sheltered people are not bitten", () => {
  const s = mk(); s.startBattle();
  const e = s.bev!.events.find(v => v.kind !== "power")!;
  const k = e.people[0];
  for (let i = 0; i < 20; i++) s.spawnInfected(s.ax[k] + (i % 5) * 0.3 - 0.6, s.ay[k] + ((i / 5) | 0) * 0.3 - 0.6, 1e6);
  go(s, 20);
  for (const m of e.people) expect(s.state[m]).toBe(CIV);
}, 120000);

test("the alert comes at the scheduled time, one at a time", () => {
  const s = mk(); s.startBattle();
  const t = firstAlertT(s.seed);
  go(s, C.WARNING_S + t - 1);
  expect(s.bevLive()).toBeNull();
  go(s, 2);
  const e = s.bevLive()!;
  expect(e).not.toBeNull();
  expect(e.alertT).not.toBeNull();
  if (e.kind !== "power") expect(e.endT).toBeCloseTo(e.alertT! + (e.kind === "mayor" ? C.EVENT_VIP_S : e.kind === "class" ? C.EVENT_CLASS_S : C.EVENT_SCI_S), 5);
  expect(s.bev!.events.filter(v => v.state === "live").length).toBe(1);
  expect(s.stats.ev.k.filter(k => k === SE_EVENT_START).length).toBe(1);
  expect(s.pingLog.some(p => p.kind === "event")).toBe(true);
}, 300000);

test("reached by a ground unit: they walk out, escorted", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  s.bev!.order = ["mayor", "research", "class", "power"]; s.bev!.events.sort((a, b) => s.bev!.order.indexOf(a.kind) - s.bev!.order.indexOf(b.kind));
  const e = alertNow(s);
  expect(e.kind).not.toBe("power");
  const c = s.bevCenter(e)!;
  expect(s.place("apc", Math.floor(c[0]) + 2, Math.floor(c[1]))).toBeNull(); // in battle: an APC drops in near them
  const apc = s.units[s.units.length - 1]; apc.deployT = 0; apc.x = c[0] + 2; apc.y = c[1];
  go(s, 1);
  expect(e.reached).toBe(true);
  for (const k of e.people) if (s.state[k] === CIV) expect(s.plan[k]).not.toBe(PLAN_SHELTER);
  expect(apc.orders?.[0]?.k).toBe("escort");
  expect(apc.orders?.[0]?.who).toBe(e.lead);
}, 120000);

test("win on reaching a safe zone: money now, score later", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = alertNow(s);
  if (e.kind === "power") return; // covered below
  const earned0 = s.earned;
  e.reached = true;
  for (const k of e.people) if (s.state[k] === CIV) { s.state[k] = SAFE_CIV; }
  go(s, 0.5);
  expect(e.state).toBe("won");
  expect(s.stats.ev.k.filter(k => k === SE_EVENT_WON).length).toBe(1);
  expect(s.earned - earned0).toBeGreaterThanOrEqual(Math.round(C.EVENT_CASH * s.diff.incomeMul * (e.kind === "class" ? e.frac : 1)) - 1);
  expect(s.bevScore).toBeGreaterThan(0);
  expect(s.bevXp).toBeGreaterThan(0);
}, 120000);

test("overrun at the countdown: they turn, the score drops", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  s.bev!.events = s.bev!.events.filter(v => v.kind !== "power");
  const e = alertNow(s);
  go(s, e.endT! - s.time + 1);
  expect(e.state).toBe("lost");
  for (const k of e.people) expect([INF, DEAD]).toContain(s.state[k]);
  expect(s.stats.ev.k.filter(k => k === SE_EVENT_LOST).length).toBe(1);
  expect(s.bevScore).toBeLessThan(0);
  expect(s.bevXp).toBe(0);
}, 300000);

test("the power station resolves when the round ends", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = s.bev!.events.find(v => v.kind === "power");
  if (!p) return; // no building fit in this city: skipped (the reserve test covers 2+ events)
  s.bev!.events = [p, ...s.bev!.events.filter(v => v !== p)];
  const e = alertNow(s);
  expect(e.kind).toBe("power");
  expect(e.endT).toBeNull();
  (s as any).endRound("test", true);
  go(s, 0.5);
  expect(e.state).toBe(e.people.filter(k => s.state[k] === CIV || s.state[k] === SAFE_CIV).length >= 3 ? "won" : "lost");
}, 120000);

test("at most EVENTS_MAX, never two at once, none after the round", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  expect(s.bev!.events.length).toBeLessThanOrEqual(C.EVENTS_MAX);
  const e = alertNow(s);
  s.bev!.nextT = -1e6; go(s, 1); // due again while one is live: still one
  expect(s.bev!.events.filter(v => v.state === "live").length).toBe(1);
  expect(e.state).toBe("live");
  (s as any).endRound("test", true);
  s.bev!.nextT = -1e6; go(s, 1);
  expect(s.bev!.events.filter(v => v.state === "reserved").every(v => v.alertT === null)).toBe(true);
}, 120000);

test("snapshot round trip mid-event", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  alertNow(s);
  const t = decode(encode({ sim: s as any }, new Set([s]))).sim as any; Object.setPrototypeOf(t, Sim.prototype);
  go(s, 20); for (let i = 0; i < 20 / C.DT; i++) t.step(C.DT);
  expect(t.bev.events.map((e: any) => [e.kind, e.state, e.endT, e.people.length])).toEqual(s.bev!.events.map(e => [e.kind, e.state, e.endT, e.people.length]));
}, 120000);

test("a class event only on a school day", () => {
  const s = mk({ startMin: 1380 }); s.startBattle();
  expect(s.bev!.events.some(e => e.kind === "class")).toBe(false);
}, 120000);

test("a class event is picked on an Insane school day (the only time classes are at school; real class, kids + teachers, sheltering)", () => {
  const c = C.CITIES[1]; // Pike: the 0.41 school-day city
  let found = null as null | { s: Sim; e: any };
  for (let seed = 0; seed < 12 && !found; seed++) {
    const s = new Sim(c.seed + seed, { recipe: c.recipe, budget: 80_000_000, civilians: 6000, difficulty: "insane", mutators: ["battle_events"] } as any);
    s.setStartTime(600);
    const cx = s.w / 2, cy = s.h / 4;
    expect(s.setZone([[cx - 40, cy - 40], [cx + 40, cy - 40], [cx + 40, cy + 40], [cx - 40, cy + 40]])).toBeNull();
    s.startBattle();
    const e = s.bev?.events.find(v => v.kind === "class");
    if (e) found = { s, e };
  }
  expect(found).not.toBeNull();
  const { s, e } = found!;
  const kids = e.people.filter((k: number) => s.age[k] < 18);
  expect(kids.length).toBeGreaterThanOrEqual(6);
  for (const k of e.people) expect(s.plan[k]).toBe(PLAN_SHELTER);
}, 600000);

// ---------- Task 3: score, XP, ping, record ----------
import { PING_KINDS } from "../src/sim";
import { makeRecord, cleanHistory } from "../src/battlerecord";
import { factsFromRecord } from "../src/achievements";
import { medalFor } from "../src/scoring";

test("a won event raises the score by 4 and adds its XP", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = alertNow(s);
  const before = s.scoreNow("x");
  s.bevResolve(e, true, 1);
  const after = s.scoreNow("x");
  const expectScore = Math.min(100, before.score + 4);
  expect(after.score).toBeCloseTo(expectScore, 6);
  expect(after.xp - before.xp).toBeGreaterThanOrEqual(Math.round(C.EVENT_XP * s.diff.xpMul));
  expect(after.medal).toBe(medalFor(after.score, after.pct));
}, 120000);

test("a lost event lowers the score by 5, never below 0, and takes no XP", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = alertNow(s);
  const before = s.scoreNow("x");
  s.bevResolve(e, false, 0);
  const after = s.scoreNow("x");
  expect(after.score).toBeCloseTo(Math.max(0, before.score - 5), 6);
  expect(after.xp).toBeLessThanOrEqual(before.xp);
  s.bevScore = -1000;
  expect(s.scoreNow("x").score).toBe(0);
}, 120000);

test("ping kinds fit the key: two kinds at one spot both ping", () => {
  expect(PING_KINDS.length).toBeLessThanOrEqual(16);
  const s = mk(); s.startBattle(); go(s, 1);
  const n0 = s.pingLog.length;
  s.ping("event", 50, 50); s.ping("bite", 50, 50);
  expect(s.pingLog.length - n0).toBe(2);
}, 120000);

test("the record keeps the events; an old record without them still loads", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = alertNow(s); s.bevResolve(e, true, 1);
  const sc = s.scoreNow("x");
  const meta = { id: "b1", date: "2026-11-26", version: C.VERSION, cityId: "fairhaven", cityName: "Fairhaven", kind: "campaign", difficulty: "medium", sirenMin: 600, flags: { dev: false, modded: false } } as any;
  const out = { medal: sc.medal, score: sc.score, parts: sc.parts, roundComplete: false, abandoned: true, keepFighting: false } as any;
  const r = makeRecord(meta, out, sc, s.stats, { roundAt: null, nukes: 0, bridges: 0, crushed: 0, budget: 1 });
  const h = cleanHistory(JSON.parse(JSON.stringify({ v: 1, battles: [r, { ...r, meta: { ...r.meta, id: "old" }, bevents: undefined }] })));
  expect(h.battles.length).toBe(2);
  expect(h.battles[0].bevents?.length).toBe(1);
  expect(h.battles[0].bevents![0]).toMatchObject({ kind: e.kind, won: true, score: 4 });
  expect(factsFromRecord(h.battles[0]).bevents.length).toBe(1);
  expect(factsFromRecord(h.battles[1]).bevents).toEqual([]);
}, 120000);

test("the power station runs in the background: the next event still comes", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = s.bev!.events.find(v => v.kind === "power");
  expect(p).toBeTruthy();
  s.bev!.events = [p!, ...s.bev!.events.filter(v => v !== p)];
  alertNow(s);
  expect(p!.state).toBe("live");
  expect(s.bev!.nextT).toBeGreaterThan(s.time - C.WARNING_S); // the next one is scheduled from the power alert
  s.bev!.nextT = s.time - C.WARNING_S; go(s, 0.5);
  const live = s.bev!.events.filter(v => v.state === "live");
  expect(live.length).toBe(2);
  expect(live.filter(v => v.kind !== "power").length).toBe(1);
  expect(s.bevLive()!.kind).not.toBe("power"); // the card shows the event with a clock first
}, 120000);

test("sheltered people are indoors: not moved, not crushed, not firing out", async () => {
  const { EV_SHOT } = await import("../src/people");
  const s = mk(); s.startBattle();
  const e = s.bev!.events.find(v => v.kind !== "power")!;
  const k = e.people[0], x0 = s.ax[k], y0 = s.ay[k];
  s.crushT[k] = C.CRUSH_S; s.civWep[k] = 1; s.civAmmo[k] = 50; // nearly crushed, and armed
  for (let i = 0; i < 12; i++) s.spawnInfected(s.ax[k] + 2 + (i % 4) * 0.4, s.ay[k] + ((i / 4) | 0) * 0.4, 1e6);
  go(s, 30);
  expect(s.state[k]).toBe(CIV);
  expect(s.ax[k]).toBe(x0); expect(s.ay[k]).toBe(y0);
  expect(s.crushT[k]).toBe(C.CRUSH_S);
  expect(s.storyOf(k).some(v => v.code === EV_SHOT)).toBe(false);
}, 300000);

test("the power station falls to a siege: enough infected around it for long enough", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = s.bev!.events.find(v => v.kind === "power")!;
  s.bev!.events = [p, ...s.bev!.events.filter(v => v !== p)];
  alertNow(s);
  for (const k of p.people) expect(s.state[k]).toBe(CIV); // indoors: the crew waits inside
  const dx = p.people.reduce((a, k) => a + s.ax[k], 0) / p.people.length, dy = p.people.reduce((a, k) => a + s.ay[k], 0) / p.people.length;
  for (let i = 0; i < C.EVENT_SIEGE_N + 10; i++) s.spawnInfected(dx + (i % 6) - 3, dy + ((i / 6) | 0) - 3, 1e6);
  go(s, C.EVENT_SIEGE_S + 5);
  expect(p.state).toBe("lost");
  for (const k of p.people) expect([INF, DEAD]).toContain(s.state[k]);
}, 120000);

test("a power station nobody besieges holds to the round's end: won", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = s.bev!.events.find(v => v.kind === "power")!;
  s.bev!.events = [p, ...s.bev!.events.filter(v => v !== p)];
  alertNow(s);
  s.devClearInfected(); s.dev.waves = false; go(s, 2);
  (s as any).endRound("test", true); go(s, 0.5);
  expect(p.state).toBe("won");
}, 120000);

test("sheltering event people never count as errands that keep the round open", () => {
  const s = mk(); s.startBattle();
  for (let k = 0; k < s.civN; k++) if (!s.bevMark![k]) s.plan[k] = 1; // everyone else: walking straight to a zone (PLAN_STRAIGHT)
  expect((s as any).errandsActive()).toBe(false);
}, 120000);
