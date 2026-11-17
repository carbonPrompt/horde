import { expect, test } from "bun:test";
import { clockMin, formatClock, START_CHOICES, randomStart, personOf, storyLine } from "../src/people";

test("clock runs 30x and formats 12h", () => {
  expect(formatClock(clockMin(450, 0))).toBe("7:30 AM");
  expect(formatClock(clockMin(450, 120))).toBe("8:30 AM"); // 2 real min x 30 = 1 h
  expect(formatClock(clockMin(1380, 240))).toBe("1:00 AM"); // wraps past midnight
  expect(formatClock(720)).toBe("12:00 PM");
  expect(formatClock(0)).toBe("12:00 AM");
});

test("start choices are the four named in the design", () => {
  expect(START_CHOICES.map(c => c.min)).toEqual([450, 600, 1050, 1380]);
  expect(randomStart(5)).toBe(randomStart(5));
  const r = randomStart(77);
  expect(Number.isInteger(r) && r >= 0 && r < 1440).toBe(true);
});

test("identity is stable and households share a last name", () => {
  const a = personOf(42, 10, 10, 4), b = personOf(42, 11, 10, 4);
  expect(personOf(42, 10, 10, 4)).toEqual(a);
  expect(a.last).toBe(b.last);
  expect(a.role).toBe("head");
  expect(a.age).toBeGreaterThanOrEqual(18);
  expect(personOf(42, 7, -1, 1).role).toBe("single");
});

test("children are younger than their head of household, ages stay 0..100", () => {
  for (let lead = 0; lead < 2000; lead += 5) {
    const head = personOf(9, lead, lead, 5);
    for (let j = 1; j < 5; j++) {
      const p = personOf(9, lead + j, lead, 5);
      expect(p.age).toBeGreaterThanOrEqual(0); expect(p.age).toBeLessThanOrEqual(100);
      if (p.role === "child") expect(p.age).toBeLessThan(head.age - 15);
      if (p.role === "elder") expect(p.age).toBeGreaterThanOrEqual(head.age + 18);
    }
  }
});

test("every story line is plain text with no em-dash", () => {
  for (let ev = 1; ev <= 9; ev++) {
    const s = storyLine(ev, 0);
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toMatch(/\u2014/);
  }
});

// ---------- sim side (0.39 task 2) ----------
import { Sim, CIV, SAFE_CIV, DEAD } from "../src/sim";
import { BUILDING, walkable } from "../src/map";
import { EV_SAFE, EV_EVAC, EV_TURNED, FATE_EVAC } from "../src/people";
import type { Support } from "../src/sim";

function zoneAt(s: Sim, half = 34): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}

test("people carry a home and a stable start", () => {
  const s = new Sim(42, { civilians: 3000 });
  for (let k = 0; k < s.civN; k++) { expect(s.homeCell[k]).toBeGreaterThanOrEqual(0); expect(s.startCell[k]).toBeGreaterThanOrEqual(0); }
  const t = new Sim(42, { civilians: 3000 });
  expect([...t.ax.slice(0, 3000)]).toEqual([...s.ax.slice(0, 3000)]);
  // household members share a home
  for (let k = 0; k < s.civN; k++) if (s.famLead[k] >= 0) expect(s.homeCell[k]).toBe(s.homeCell[s.famLead[k]]);
});

test("note links per person, sets fate once, and ignores non-people", () => {
  const s = new Sim(42, { civilians: 500 });
  s.note(3, EV_SAFE, 0); s.note(3, EV_EVAC); s.note(3, EV_TURNED); s.note(s.civN + 5, EV_SAFE); s.note(-1, EV_SAFE);
  expect(s.storyOf(3).map(e => e.code)).toEqual([EV_SAFE, EV_EVAC, EV_TURNED]);
  expect(s.fate[3]).toBe(FATE_EVAC);
  expect(s.storyOf(4)).toEqual([]);
});

test("civAt finds the nearest person and nothing on empty ground", () => {
  const s = new Sim(42, { civilians: 500 });
  s.step(); // fills the buckets
  const k = s.civAt(s.ax[17], s.ay[17], 0.01);
  expect(k).toBe(17);
  expect(s.civAt(-50, -50)).toBe(-1);
});

test("a battle writes stories: people reach the zone and the flown-out count matches", () => {
  const s = new Sim(42, { budget: 80_000_000, civilians: 4000 });
  s.setZone(zoneAt(s));
  let pad: Support | undefined;
  for (let i = 0; i < s.inZone.length && !pad; i++) {
    if (s.inZone[i] !== 1 || s.map.tile[i] !== BUILDING) continue;
    if (!s.placeSupport("evac", i % s.w, (i / s.w) | 0)) pad = s.supports[s.supports.length - 1];
  }
  expect(pad).toBeDefined();
  s.dev.bites = false;
  s.startBattle();
  while (s.time < 90) s.step();
  let reached = 0, flown = 0;
  for (let k = 0; k < s.civN; k++) {
    if (s.storyOf(k).some(e => e.code === EV_SAFE)) reached++;
    if (s.fate[k] === FATE_EVAC) flown++;
  }
  expect(reached).toBeGreaterThan(0);
  expect(s.evacuated).toBeGreaterThan(0);
  expect(flown).toBe(s.evacuated);
  let live = -1; for (let k = 0; k < s.civN && live < 0; k++) if (s.state[k] === CIV || s.state[k] === SAFE_CIV) live = k;
  expect(s.civAt(s.ax[live], s.ay[live], 0.01)).toBe(live); // battle phase uses the buckets
}, 120000);

test("snapshot keeps startMin, fate and the log", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = new Sim(42, { budget: 80_000_000, civilians: 3000 });
  s.setZone(zoneAt(s));
  s.startMin = 1050;
  s.startBattle();
  while (s.time < 60) s.step();
  s.note(5, EV_EVAC);
  const b = (await unpack(await pack("t", "test", s, {}))).sim as Sim;
  expect(b.startMin).toBe(1050);
  expect(b.fate[5]).toBe(FATE_EVAC);
  for (let k = 0; k < 40; k++) expect(b.storyOf(k)).toEqual(s.storyOf(k));
}, 120000);

// ---------- 0.39 final review fixes ----------
test("review: a zone drawn while planning writes no story, a battle arrival does, once", () => {
  const s = new Sim(42, { budget: 80_000_000, civilians: 4000 });
  s.setZone(zoneAt(s));
  let safe = -1; for (let k = 0; k < s.civN && safe < 0; k++) if (s.state[k] === SAFE_CIV) safe = k;
  expect(safe).toBeGreaterThanOrEqual(0);
  expect(s.storyOf(safe)).toEqual([]);
  s.startBattle();
  s.noteSafe(7); s.noteSafe(7);
  expect(s.storyOf(7).filter(e => e.code === EV_SAFE).length).toBe(1);
});

test("review: train riders are not flown out", () => {
  expect(storyLine(EV_EVAC, 1)).toBe("left on an evacuation train");
  expect(storyLine(EV_EVAC, 0)).toBe("flown out");
});

// ---------- 0.40 task 1: where everyone is by time of day ----------
import { placeFor, rallyFor, workHours, PL_HOME, PL_WORK, PL_SCHOOL, PL_ROAD, RALLY_HOME } from "../src/people";

function sample(min: number) {
  let kids = 0, kidsSchool = 0, workers = 0, workersWork = 0, workersRoad = 0, retired = 0, retiredHome = 0, all = 0, home = 0;
  for (let lead = 0; lead < 10000; lead += 5) for (let j = 0; j < 5; j++) {
    const k = lead + j, p = personOf(3, k, lead, 5), pl = placeFor(3, k, p, min);
    all++; if (pl === PL_HOME) home++;
    if (p.age >= 5 && p.age <= 17) { kids++; if (pl === PL_SCHOOL) kidsSchool++; }
    else if (p.age >= 18 && p.age < 65) { workers++; if (pl === PL_WORK) workersWork++; if (pl === PL_ROAD) workersRoad++; }
    else if (p.age >= 65) { retired++; if (pl === PL_HOME) retiredHome++; }
  }
  return { kidsSchool: kidsSchool / kids, work: workersWork / workers, road: workersRoad / workers, retiredHome: retiredHome / retired, home: home / all };
}

test("0.40: at 10 AM kids are at school, workers at work, retirees home", () => {
  const s = sample(600);
  expect(s.kidsSchool).toBeGreaterThanOrEqual(0.75);
  expect(s.work).toBeGreaterThanOrEqual(0.65);
  expect(s.retiredHome).toBeGreaterThanOrEqual(0.7);
});

test("0.40: at 11 PM nearly everyone is home; at 7:30 AM many workers are on the road", () => {
  expect(sample(1380).home).toBeGreaterThanOrEqual(0.95);
  expect(sample(450).road).toBeGreaterThanOrEqual(0.4);
});

test("0.40: households meet at home more often during work hours", () => {
  const share = (min: number) => { let h = 0; for (let l = 0; l < 5000; l++) if (rallyFor(8, l, min) === RALLY_HOME) h++; return h / 5000; };
  const day = share(600), night = share(1380);
  expect(day).toBeGreaterThanOrEqual(0.6); expect(day).toBeLessThanOrEqual(0.7);
  expect(night).toBeGreaterThanOrEqual(0.35); expect(night).toBeLessThanOrEqual(0.45);
  expect(workHours(600)).toBe(true); expect(workHours(1020)).toBe(false); expect(workHours(479)).toBe(false);
  expect(placeFor(3, 12, personOf(3, 12, 10, 5), 600)).toBe(placeFor(3, 12, personOf(3, 12, 10, 5), 600));
});

// ---------- 0.40 task 2: setStartTime ----------
import * as Cfg from "../src/config";
const fairhaven = (difficulty: Cfg.Difficulty = "medium") => new Sim(Cfg.CITIES[0].seed, { recipe: Cfg.CITIES[0].recipe, difficulty });
const near = (s: Sim, k: number, cell: number, r: number) => Math.abs(s.ax[k] - (cell % s.w) - 0.5) <= r + 0.5 && Math.abs(s.ay[k] - ((cell / s.w) | 0) - 0.5) <= r + 0.5;

test("0.40: without setStartTime nothing moves and dayLife is off", () => {
  const a = fairhaven(), b = fairhaven();
  expect(a.dayLife).toBe(false);
  expect([...a.ax.slice(0, a.civN)]).toEqual([...b.ax.slice(0, b.civN)]);
});

test("0.40: at 11 PM nearly everyone stands at home", () => {
  const s = fairhaven(); s.setStartTime(1380);
  let home = 0; for (let k = 0; k < s.civN; k++) if (near(s, k, s.homeCell[k], 2)) home++;
  expect(home / s.civN).toBeGreaterThanOrEqual(0.95);
  expect(s.startMin).toBe(1380); expect(s.dayLife).toBe(true);
});

test("0.40: at 10 AM on Insane kids are at their schools and workers away from home", () => {
  const s = fairhaven("insane"); s.setStartTime(600);
  expect(s.schools.length).toBeGreaterThanOrEqual(1);
  let kids = 0, atSchool = 0, workers = 0, dist = 0;
  for (let k = 0; k < s.civN; k++) {
    if (s.dayPlace[k] === PL_SCHOOL) { kids++; if (s.schoolCell[k] >= 0 && near(s, k, s.schoolCell[k], 2)) atSchool++; }
    if (s.dayPlace[k] === PL_WORK) { workers++; const h = s.homeCell[k]; dist += Math.hypot(s.ax[k] - (h % s.w), s.ay[k] - ((h / s.w) | 0)); }
  }
  expect(kids).toBeGreaterThan(0); expect(atSchool).toBe(kids);
  expect(workers).toBeGreaterThan(0); expect(dist / workers).toBeGreaterThanOrEqual(40);
  for (let k = 0; k < s.civN; k++) if (s.state[k] === CIV || s.state[k] === SAFE_CIV) expect(walkable(s.map.tile[s.idx(s.ax[k] | 0, s.ay[k] | 0)])).toBe(true);
});

test("0.40: placement is deterministic and changing the time re-places cleanly", () => {
  const a = fairhaven(); a.setStartTime(600);
  const b = fairhaven(); b.setStartTime(600);
  expect([...a.ax.slice(0, a.civN)]).toEqual([...b.ax.slice(0, b.civN)]);
  const c = fairhaven(); c.setStartTime(600); c.setStartTime(1380);
  const d = fairhaven(); d.setStartTime(1380);
  expect([...c.ax.slice(0, c.civN)]).toEqual([...d.ax.slice(0, d.civN)]);
  expect([...c.ay.slice(0, c.civN)]).toEqual([...d.ay.slice(0, d.civN)]);
});

test("0.40: a preschooler is never home alone", () => {
  const s = fairhaven(); s.setStartTime(600);
  for (let k = 0; k < s.civN; k++) {
    const lead = s.famLead[k]; if (lead < 0 || s.age[k] >= 5 || s.dayPlace[k] !== PL_HOME) continue;
    let adultHome = false;
    for (let m = lead; m < lead + s.famSize[k]; m++) if (s.age[m] >= 18 && s.dayPlace[m] === PL_HOME) adultHome = true;
    expect(adultHome).toBe(true);
  }
});

// ---------- 0.40 task 4: alert plans ----------
import { PLAN_STRAIGHT, PLAN_GATHER, EV_GAVE_UP } from "../src/people";
import { navOf } from "../src/nav";
function pike(min: number | null, civilians = 6000, difficulty: Cfg.Difficulty = "insane") {
  const c = Cfg.CITIES[1];
  const s = new Sim(c.seed, { recipe: c.recipe, budget: 80_000_000, civilians, difficulty });
  if (min !== null) s.setStartTime(min);
  s.setZone(zoneAt(s, 40));
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING && !s.placeSupport("evac", i % s.w, (i / s.w) | 0)) break;
  s.dev.bites = false;
  return s;
}
const anyEvent = (s: Sim, code: number) => { for (let k = 0; k < s.civN; k++) if (s.storyOf(k).some(e => e.code === code)) return true; return false; };

test("0.40: without a start time nobody gets a plan", () => {
  const s = pike(null); s.startBattle(); while (s.time < 30) s.step();
  expect(s.plan.every(p => p === 0)).toBe(true);
}, 120000);

test("0.40: at night most households are already together and leave at once", () => {
  const s = pike(1380); s.startBattle();
  let leads = 0, straight = 0;
  for (let k = 0; k < s.civN; k++) if (s.famLead[k] === k && s.state[k] === CIV) { leads++; if (s.plan[k] === PLAN_STRAIGHT) straight++; }
  expect(straight / leads).toBeGreaterThanOrEqual(0.8);
}, 120000);

test("0.40: someone whose home is cut off gives up and runs", () => {
  const s = pike(600); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.plan[i] === PLAN_GATHER && Math.hypot(s.ax[i] - (s.homeCell[i] % s.w), s.ay[i] - ((s.homeCell[i] / s.w) | 0)) > 30) k = i;
  expect(k).toBeGreaterThanOrEqual(0);
  const hx = s.homeCell[k] % s.w, hy = (s.homeCell[k] / s.w) | 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) { const i = s.idx(hx + dx, hy + dy); s.map.tile[i] = BUILDING; s.walkMask![i] = 0; }
  s.navVersion++; // as a blown bridge does
  const t0 = s.time; while (s.time < t0 + Cfg.DEPART_SPREAD_S + 8) s.step();
  expect(s.plan[k]).toBe(PLAN_STRAIGHT);
  expect(s.storyOf(k).some(e => e.code === EV_GAVE_UP)).toBe(true);
}, 120000);

test("0.40: a battle saved mid-errand plays on identically", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = pike(600, 3000); s.startBattle();
  while (s.time < 30) s.step();
  const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
  for (let i = 0; i < 20 * 40; i++) { s.step(); b.step(); }
  let diff = 0; for (let k = 0; k < s.n; k++) if (s.ax[k] !== b.ax[k] || s.ay[k] !== b.ay[k] || s.state[k] !== b.state[k] || s.plan[k] !== b.plan[k]) diff++;
  expect(diff).toBe(0);
}, 300000);

// ---------- 0.40 final review fixes ----------
import { PLAN_MEET, PLAN_HOME_WAIT, RALLY_ZONE } from "../src/people";
import { personHtml as phtml } from "../src/personui";

test("review: a saved battle replays identically even after buildings collapse into rubble", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = pike(600, 3000); s.startBattle();
  while (s.time < 30) s.step(); // fields built
  for (let i = 0; i < s.map.tile.length; i++) if (s.map.tile[i] === BUILDING && s.inZone[i] === 0 && (i % 3 === 0)) s.map.tile[i] = 0; // rubble all over town
  const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
  for (let i = 0; i < 20 * 40; i++) { s.step(); b.step(); }
  let diff = 0; for (let k = 0; k < s.n; k++) if (s.ax[k] !== b.ax[k] || s.ay[k] !== b.ay[k]) diff++;
  expect(diff).toBe(0);
}, 300000);

test("review: a round doesn't stall out while families are still on their errands", () => {
  const c = Cfg.CITIES[1];
  const s = new Sim(c.seed, { recipe: c.recipe, budget: 80_000_000, civilians: 3000 });
  s.setStartTime(600); s.setZone(zoneAt(s, 40)); s.dev.bites = false; // no Evac Point: its lifts would count as progress
  s.startBattle();
  while (!s.outbreak) s.step();
  // one household: someone waiting at home, someone walking back slowly; everybody else gone
  let lead = -1, walker = -1;
  for (let k = 0; k < s.civN && lead < 0; k++) if (s.famLead[k] === k) {
    let home = -1, gat = -1;
    for (let m = k; m < k + s.famSize[k]; m++) { if (s.plan[m] === PLAN_HOME_WAIT && s.state[m] === CIV) home = m; if (s.plan[m] === PLAN_GATHER && s.state[m] === CIV) gat = m; }
    if (home >= 0 && gat >= 0) { lead = k; walker = gat; }
  }
  expect(lead).toBeGreaterThanOrEqual(0);
  for (let k = 0; k < s.civN; k++) if ((k < lead || k >= lead + s.famSize[lead]) && (s.state[k] === CIV || s.state[k] === SAFE_CIV)) s.state[k] = DEAD;
  for (let m = lead; m < lead + s.famSize[lead]; m++) if (s.plan[m] !== PLAN_HOME_WAIT && m !== walker) s.state[m] = DEAD;
  s.pspd[walker] = 0.1; // a long way back, slowly
  s.dev.waves = false;
  const t0 = s.time; while (s.time < t0 + Cfg.ROUND_STALL_S + 15 && !s.roundDone) s.step();
  expect(s.roundDone).toBe(false);
}, 300000);

test("review: reaching a zone ends a home errand, and the window says so", () => {
  const s = pike(600); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.plan[i] === PLAN_GATHER && s.rally[i] !== RALLY_ZONE) k = i;
  expect(k).toBeGreaterThanOrEqual(0);
  s.state[k] = SAFE_CIV; s.noteSafe(k);
  expect(s.plan[k]).toBe(PLAN_STRAIGHT);
  expect(phtml(s, k).match(/<div class="pw-sub"[^>]*>([^<]*)</)![1]).not.toContain("Going home"); // their own status line
});

test("review: a household with someone already safe, or a home inside the zone, meets at the zone", () => {
  const s = pike(600);
  let lead = -1;
  for (let k = 0; k < s.civN && lead < 0; k++) if (s.famLead[k] === k && s.famSize[k] >= 3 && !s.atVenue[k] && s.inZone[s.homeCell[k]] === 1) lead = k;
  expect(lead).toBeGreaterThanOrEqual(0);
  s.startBattle();
  expect(s.rally[lead]).toBe(RALLY_ZONE);
});

test("review: opening a gate mid-battle makes the walking-home fields stale by itself", () => {
  const s = pike(600, 3000); s.startBattle();
  while (s.time < 10) s.step();
  const v0 = s.navVersion;
  let g = -1; for (let i = 0; i < s.inZone.length && g < 0; i++) if (s.inZone[i] === 3) g = i;
  expect(g).toBeGreaterThanOrEqual(0);
  expect(s.toggleGate(g % s.w, (g / s.w) | 0)).toBeNull();
  s.step();
  expect(s.navVersion).toBeGreaterThan(v0);
});

test("review: an errand that makes no headway is dropped", () => {
  const s = pike(600, 3000); s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.plan[i] === PLAN_GATHER) k = i;
  s.pspd[k] = 0; // can't move at all
  const t0 = s.time; while (s.time < t0 + Cfg.DEPART_SPREAD_S + 35) s.step();
  expect(s.plan[k]).toBe(PLAN_STRAIGHT);
}, 120000);

// ---------- 0.40: kids at school only on Insane ----------
test("0.40: below Insane, kids are home with the family and only working adults are out", () => {
  for (const d of ["easy", "medium", "hard"] as Cfg.Difficulty[]) {
    const s = fairhaven(d); s.setStartTime(600);
    let atSchool = 0, workers = 0;
    for (let k = 0; k < s.civN; k++) { if (s.dayPlace[k] === PL_SCHOOL) atSchool++; if (s.dayPlace[k] === PL_WORK) workers++; }
    expect(atSchool).toBe(0);
    expect(workers).toBeGreaterThan(0);
    expect(s.schools.length).toBe(0);
    for (let k = 0; k < s.civN; k++) {
      const lead = s.famLead[k]; if (lead !== k || s.atVenue[k]) continue;
      let minorHome = false, adultHome = false;
      for (let m = lead; m < lead + s.famSize[k]; m++) { if (s.age[m] < 18 && s.dayPlace[m] === PL_HOME) minorHome = true; if (s.age[m] >= 18 && s.dayPlace[m] === PL_HOME) adultHome = true; }
      if (minorHome) expect(adultHome).toBe(true);
    }
  }
});

test("0.40: on Insane the kids are at school", () => {
  const s = fairhaven("insane"); s.setStartTime(600);
  let atSchool = 0; for (let k = 0; k < s.civN; k++) if (s.dayPlace[k] === PL_SCHOOL) atSchool++;
  expect(atSchool).toBeGreaterThan(0);
});

// ---------- 0.40: drop-off time and commuters ----------
import { INFRA_HIGHWAY, INFRA_STATION } from "../src/map";
test("0.40: at 3:30 PM many kids are on their way home", () => {
  let kids = 0, road = 0;
  for (let lead = 0; lead < 10000; lead += 5) for (let j = 0; j < 5; j++) { const k = lead + j, p = personOf(3, k, lead, 5); if (p.age >= 5 && p.age <= 17) { kids++; if (placeFor(3, k, p, 930) === PL_ROAD) road++; } }
  expect(road / kids).toBeGreaterThanOrEqual(0.4);
});

test("0.40: on Insane at 3:30 PM, kids on the road are between school and home", () => {
  const s = fairhaven("insane"); s.setStartTime(930);
  let n = 0, near = 0;
  for (let k = 0; k < s.civN; k++) if (s.age[k] >= 5 && s.age[k] <= 17 && s.dayPlace[k] === PL_ROAD) {
    n++;
    const h = s.homeCell[k], sc = s.schoolCell[k];
    if (sc < 0) continue;
    const hx = h % s.w, hy = (h / s.w) | 0, sx = sc % s.w, sy = (sc / s.w) | 0, len = Math.hypot(sx - hx, sy - hy) || 1;
    const dSeg = Math.abs((sx - hx) * (hy - s.ay[k]) - (hx - s.ax[k]) * (sy - hy)) / len; // distance from the home-school line
    if (dSeg <= 8) near++;
  }
  expect(n).toBeGreaterThan(0);
  expect(near / n).toBeGreaterThanOrEqual(0.8);
});

test("0.40: in the morning rush some commuters wait at stations and some sit on the highway", () => {
  const c = Cfg.CITIES[8]; // Port Royal: rail stations and an Interstate
  const s = new Sim(c.seed, { recipe: c.recipe }); s.setStartTime(450);
  let road = 0, station = 0, highway = 0;
  for (let k = 0; k < s.civN; k++) if (s.dayPlace[k] === PL_ROAD) {
    road++;
    const i = s.idx(s.ax[k] | 0, s.ay[k] | 0), inf = s.map.height[i];
    if (inf === INFRA_STATION) station++; else if (inf === INFRA_HIGHWAY) highway++;
  }
  expect(road).toBeGreaterThan(100);
  expect(station).toBeGreaterThan(0);
  expect(highway / road).toBeGreaterThanOrEqual(0.03); // the Interstate crosses only part of town
});

// ---------- 0.40: school buses on Insane ----------
// ---------- 0.40 bus review fixes ----------

test("bus review: picking the morning rush is quick on a map with no stations or highways", () => {
  const c = Cfg.CITIES[2];
  const s = new Sim(c.seed, { recipe: c.recipe, civilians: 50000 });
  const t0 = performance.now(); s.setStartTime(450);
  expect(performance.now() - t0).toBeLessThan(1500);
}, 60000);

// ---------- 0.41: no buses; teachers walk the classes to the zone, parents meet them there ----------
import { EV_CLASS, PLAN_FETCH as P_FETCH, PLAN_SCHOOL_WAIT as P_SWAIT } from "../src/people";
test("0.41: on a school day the classes walk to the zone and their families meet them there", () => {
  const s = pike(600); s.startBattle();
  const kids: number[] = []; for (let k = 0; k < s.civN; k++) if (s.dayPlace[k] === PL_SCHOOL) kids.push(k);
  expect(kids.length).toBeGreaterThan(0);
  expect((s as any).buses).toBeUndefined();
  for (let k = 0; k < s.civN; k++) { expect(s.plan[k]).not.toBe(P_FETCH); expect(s.plan[k]).not.toBe(P_SWAIT); }
  for (const k of kids) {
    expect(s.storyOf(k).some(e => e.code === EV_CLASS)).toBe(true);
    if (s.famLead[k] >= 0) expect(s.rally[k]).toBe(RALLY_ZONE);
  }
  while (s.time < 400) s.step();
  const ok = kids.filter(k => s.state[k] === SAFE_CIV || s.fate[k] === FATE_EVAC).length;
  console.log({ kids: kids.length, ok });
  expect(ok / kids.length).toBeGreaterThanOrEqual(0.85);
}, 300000);

test("0.41: a class waits a moment for the teachers, then leaves together", () => {
  const s = pike(600); s.startBattle();
  const kids: number[] = []; for (let k = 0; k < s.civN; k++) if (s.dayPlace[k] === PL_SCHOOL) kids.push(k);
  const x0 = kids.map(k => s.ax[k]), y0 = kids.map(k => s.ay[k]);
  const moved = () => kids.reduce((a, k, i) => a + Math.hypot(s.ax[k] - x0[i], s.ay[k] - y0[i]), 0) / kids.length; // the class on average (a crowd jostles)
  while (s.time < 3) s.step();
  expect(moved()).toBeLessThan(2); // still lining up
  while (s.time < Cfg.CLASS_READY_S + 15) s.step();
  expect(moved()).toBeGreaterThan(5); // on the way
}, 120000);

// ---------- 0.41 review fixes ----------
test("0.41 review: open gates for the tutorial count only intact gates that aren't already swinging shut", () => {
  const s = pike(600, 3000); s.startBattle();
  expect(s.openGateCells()).toBeGreaterThan(0);
  let g = -1; for (let i = 0; i < s.inZone.length && g < 0; i++) if (s.inZone[i] === 3) g = i;
  s.wallHp[g] = 0; // broken: can't be closed any more
  s.closeAllGates();
  expect(s.openGateCells()).toBe(0); // the rest are swinging shut, the broken one doesn't count
});

test("0.41 review: the school alert only when classes are actually walking", () => {
  for (const [min, want] of [[600, true], [1380, false], [930, false]] as const) {
    const s = pike(min, 4000); s.startBattle();
    expect(s.classKids > 0).toBe(want);
  }
}, 120000);
