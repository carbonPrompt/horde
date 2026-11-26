// 0.62 fix pass (final review C1, I1-I7, M1, M3, M5, M7): each test was RED before its fix.
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { Sim, CIV, INF, DEAD, SAFE_CIV } from "../src/sim";
import { PLAN_SHELTER, PLAN_FOLLOW, EV_SHELTER, EV_RESCUED, shelterWords } from "../src/people";
import { bevPick } from "../src/eventui";
import type { BevEvent } from "../src/events";

const ZONE: [number, number][] = [[165, 82], [217, 82], [217, 130], [165, 130]];
function mk(startMin = 600): Sim {
  const s = new Sim(C.CITIES[0].seed, { recipe: C.CITIES[0].recipe, difficulty: "medium", budget: 400_000_000, mutators: ["battle_events"] } as any);
  s.setStartTime(startMin);
  expect(s.setZone(ZONE)).toBeNull();
  return s;
}
const go = (s: Sim, secs: number) => { for (let t = 0; t < secs; t += C.DT) s.step(C.DT); };
const first = (s: Sim, kind: string) => { const b = s.bev!; const e = b.events.find(v => v.kind === kind)!; b.events = [e, ...b.events.filter(v => v !== e)]; return e; };
const alertNow = (s: Sim) => { s.bev!.nextT = s.time - C.WARNING_S; go(s, 0.5); };

test("C1: an event live when the round ends is settled before the round score freezes", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = first(s, "mayor"); alertNow(s);
  expect(e.state).toBe("live");
  (s as any).endRound("test", true);
  expect(e.state).toBe("lost"); // settled inside endRound, not a tick later
  expect(s.bevScore).toBeLessThan(0);
  expect(s.roundResult!.score).toBe(s.scoreNow("x").score);
  const xp0 = s.roundResult!.xp; go(s, 1);
  expect(s.roundResult!.xp).toBe(xp0);
}, 120000);

test("C1: pulling out with no round settles the live events into the result", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = first(s, "mayor"); alertNow(s);
  s.withdraw();
  expect(e.state).toBe("lost");
  expect(s.result!.score).toBe(s.scoreNow("x").score);
}, 120000);

test("I3: events still reserved at the round's end are released (dropped, no score)", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const res = s.bev!.events.filter(v => v.state === "reserved");
  expect(res.length).toBeGreaterThan(0);
  (s as any).endRound("test", true);
  for (const e of res) {
    expect(e.state).toBe("lost"); expect(e.frac).toBe(-1);
    for (const k of e.people) { expect(s.bevMark![k]).toBe(0); if (s.state[k] === CIV) expect(s.plan[k]).not.toBe(PLAN_SHELTER); }
  }
  expect(s.bevScore).toBe(0);
}, 120000);

test("I1: sheltered people are not prey (infected neither chase nor stop at them)", () => {
  const s = mk(); s.startBattle();
  const e = s.bev!.events.find(v => v.kind !== "power")!, k = e.people[0];
  const t = (s as any).nearest(s.ax[k], s.ay[k], 0.4, CIV, SAFE_CIV, 40, true);
  expect(e.people.includes(t)).toBe(false);
}, 120000);

test("I1: the power crew is prey only after its alert", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = first(s, "power"), k = p.people[0];
  const near = () => (s as any).nearest(s.ax[k], s.ay[k], 0.6, CIV, SAFE_CIV, 400, true);
  expect(p.people.includes(near())).toBe(false);
  alertNow(s);
  expect(p.people.includes(near())).toBe(true);
}, 120000);

test("I2: alerted people nobody reached hold the round open", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = first(s, "mayor"); alertNow(s);
  for (let k = 0; k < s.civN; k++) if (!e.people.includes(k) && s.state[k] === CIV) s.state[k] = DEAD;
  expect(s.counts().bevStay).toBe(0);
  (s as any).checkEnd(true);
  expect(s.roundDone).toBe(false);
}, 120000);

test("I4: the power station is lost when fewer than 3 of its crew are alive", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = first(s, "power"); alertNow(s);
  for (const k of p.people.slice(0, p.people.length - 2)) s.state[k] = DEAD;
  go(s, 0.5);
  expect(p.state).toBe("lost");
}, 120000);

test("I4: one fallen cell does not take the power station; most of the building does", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = first(s, "power"); alertNow(s);
  expect(p.cells!.length).toBeGreaterThan(2);
  s.map.tile[p.building] = 0; go(s, 0.5);
  expect(p.state).toBe("live");
  for (const i of p.cells!.slice(0, Math.ceil(p.cells!.length / 2) + 1)) s.map.tile[i] = 0;
  go(s, 0.5);
  expect(p.state).toBe("lost");
}, 120000);

test("M1: people turned by an overrun count as infected", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  s.bev!.events = s.bev!.events.filter(v => v.kind !== "power");
  const e = s.bev!.events[0]; alertNow(s);
  const n0 = s.infectedEver;
  go(s, e.endT! - s.time + 1);
  expect(e.state).toBe("lost");
  expect(s.infectedEver - n0).toBeGreaterThanOrEqual(e.people.filter(k => s.state[k] === INF).length);
  expect(e.people.some(k => s.state[k] === INF)).toBe(true);
}, 300000);

test("M3: nobody keeps following a sheltered person", () => {
  const s = mk(); s.startBattle(); go(s, C.WARNING_S + 1);
  const e = s.bev!.events.find(v => v.kind !== "power" && v.state === "reserved")!, k = e.people[0];
  let m = -1; for (let j = 0; j < s.civN; j++) if (s.state[j] === CIV && !s.bevMark![j]) { m = j; break; }
  s.plan[m] = PLAN_FOLLOW; s.goal[m] = k;
  go(s, 2);
  expect(s.plan[m] === PLAN_FOLLOW && s.goal[m] === k).toBe(false);
}, 120000);

test("M5: a class whose children are all gone is dropped at its alert, no score", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = first(s, "research"); e.kind = "class"; // adults only: no children alive
  alertNow(s);
  expect(e.state).toBe("lost"); expect(e.frac).toBe(-1);
  expect(s.bevScore).toBe(0);
}, 120000);

test("I5: F goes to a countdown event, or to the power station only while besieged", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const p = first(s, "power"); alertNow(s);
  expect(s.bevUrgent()).toBeNull();
  p.siege = 3;
  expect(s.bevUrgent()).toBe(p);
}, 120000);

test("I6: the card shows a just-ended event before the power station", () => {
  const ev = (kind: string, state: string, alertT: number) => ({ kind, state, alertT } as unknown as BevEvent);
  const power = ev("power", "live", 10), mayor = ev("mayor", "won", 50), live = ev("class", "live", 60);
  expect(bevPick([power, mayor], 100, 95)).toBe(mayor); // ended 5 s ago
  expect(bevPick([power, mayor], 100, 80)).toBe(power); // ended 20 s ago
  expect(bevPick([power, mayor, live], 100, 95)).toBe(live);
  expect(bevPick([], 100, 95)).toBeNull();
});

test("I7: the shelter story says who and where", () => {
  const arg = (kind: number, home: boolean, lead: boolean) => kind | (home ? 4 : 0) | (lead ? 8 : 0);
  expect(shelterWords(arg(0, false, true))).toContain("was the Mayor");
  expect(shelterWords(arg(0, false, false))).toContain("with the Mayor");
  expect(shelterWords(arg(0, true, true))).toContain("at home");
  expect(shelterWords(arg(0, true, false))).not.toContain("meeting");
  expect(shelterWords(arg(1, false, false))).toContain("school");
  expect(EV_SHELTER).toBe(31); expect(EV_RESCUED).toBe(32);
});

test("I7: the shelter note carries home and lead; a zone rescue is not soldiers", () => {
  const s = mk(); s.startBattle(); go(s, 1);
  const e = first(s, "mayor");
  const shel = s.storyOf(e.lead).find(v => v.code === EV_SHELTER)!;
  expect(shel.arg & 8).toBe(8);
  expect(!!(shel.arg & 4)).toBe(!!e.home);
  alertNow(s);
  for (const k of e.people) s.inZone[s.idx(Math.floor(s.ax[k]), Math.floor(s.ay[k]))] = 1; // a zone drawn over them
  go(s, 0.5);
  const r = s.storyOf(e.lead).find(v => v.code === EV_RESCUED)!;
  expect(r.arg).toBe(1);
}, 120000);
