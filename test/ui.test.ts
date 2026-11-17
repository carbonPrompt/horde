import { expect, test } from "bun:test";
import { QUICK_SLOTS, cleanQuickbar, setSlot, swapSlots, clearSlot } from "../src/quickbar";
import { clean } from "../src/save";

const known = (t: string) => ["mortar", "howitzer", "nuke"].includes(t);
const empty = () => Array(QUICK_SLOTS).fill(null) as (string | null)[];

test("cleanQuickbar handles junk", () => {
  expect(QUICK_SLOTS).toBe(7); // 0.22: Z X C V B N M
  expect(cleanQuickbar(undefined, known)).toEqual(Array(7).fill(null));
  expect(cleanQuickbar("x", known)).toEqual(Array(7).fill(null));
  const s = cleanQuickbar(["mortar", 7, "bogus", null, "nuke", ...Array(10).fill("howitzer")], known);
  expect(s.length).toBe(QUICK_SLOTS);
  expect(s.slice(0, 5)).toEqual(["mortar", null, null, null, "nuke"]);
});

test("setSlot moves instead of duplicating", () => {
  const s = setSlot(setSlot(empty(), 0, "mortar"), 4, "mortar");
  expect(s[0]).toBe(null);
  expect(s[4]).toBe("mortar");
});

test("swap and clear", () => {
  let s = setSlot(setSlot(empty(), 0, "mortar"), 1, "nuke");
  s = swapSlots(s, 0, 1);
  expect(s.slice(0, 2)).toEqual(["nuke", "mortar"]);
  expect(clearSlot(s, 0)[0]).toBe(null);
  expect(s[0]).toBe("nuke"); // copies, not mutation
});

test("save clean keeps a valid quickbar and drops a non-array", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: {}, plans: {} };
  expect(clean({ ...base, settings: { ...base.settings, quickbar: "x" as any } }).settings.quickbar).toBeUndefined();
  expect(clean({ ...base, settings: { ...base.settings, quickbar: ["mortar", null] } }).settings.quickbar).toEqual(["mortar", null]);
});

import { AlertQueue } from "../src/ticker";

test("ticker drops repeats and caps at 6", () => {
  const q = new AlertQueue();
  q.push("a", false); q.push("a", false);
  expect(q.size).toBe(1);
  for (const t of ["b", "c", "d", "e", "f"]) q.push(t, false);
  q.push("HORDE", true);
  expect(q.size).toBe(6);
  expect(q.items().map(a => a.text)).toEqual(["HORDE", "b", "c", "d", "e", "f"]); // urgent waits ahead (final review #3)
});

test("ticker keeps urgent over old non-urgent", () => {
  const q = new AlertQueue(2);
  q.push("R1", true); q.push("x", false); q.push("R2", true);
  expect(q.items().map(a => a.text)).toEqual(["R1", "R2"]);
  q.push("R3", true);
  expect(q.items().map(a => a.text)).toEqual(["R2", "R3"]);
  expect(q.shift()).toEqual({ text: "R2", urgent: true });
  expect(q.size).toBe(1);
});

test("ticker puts urgent alerts ahead of waiting non-urgent ones", () => {
  const q = new AlertQueue();
  q.push("lost 1", false); q.push("lost 2", false); q.push("HORDE", true);
  expect(q.items().map(a => a.text)).toEqual(["HORDE", "lost 1", "lost 2"]);
  q.push("BREACH", true);
  expect(q.items().map(a => a.text)).toEqual(["HORDE", "BREACH", "lost 1", "lost 2"]);
});

test("ticker skips alerts that went stale while waiting", () => {
  const q = new AlertQueue();
  q.push("Next horde in 9 s", true, 100); // stale after t = 100
  q.push("tip", false);
  expect(q.shift(150)?.text).toBe("tip");
  expect(q.size).toBe(0);
});

test("ticker drops a repeat of the alert that is scrolling right now", () => {
  const q = new AlertQueue();
  q.push("Bridge down", false);
  expect(q.shift(0)?.text).toBe("Bridge down");
  q.push("Bridge down", false);
  expect(q.size).toBe(0);
  q.done();
  q.push("Bridge down", false);
  expect(q.size).toBe(1);
});

import { arriveT, soundDue } from "../src/audiotiming";

test("aircraft sound waits for the aircraft, and never plays while paused", () => {
  const jet = { t: 0, dur: 6, hoverS: 0 };       // flyover: over the target at dur / 2 = 3 s
  const helo = { t: 0, dur: 10, hoverS: 4 };     // helo: arrives after (dur - hover) / 2 = 3 s
  expect(arriveT(jet)).toBe(3);
  expect(arriveT(helo)).toBe(3);
  expect(soundDue(jet, 1, 1.8)).toBe(false);               // just ordered (paused or not): silent
  expect(soundDue({ ...jet, t: 1.0 }, 1, 1.8)).toBe(false); // 2 s out
  expect(soundDue({ ...jet, t: 1.3 }, 1, 1.8)).toBe(true);  // 1.7 s out at 1x: start now
  expect(soundDue({ ...jet, t: 0.0 }, 0, 1.8)).toBe(false); // paused at t 0
  expect(soundDue({ ...jet, t: 0.2 }, 3, 1.8)).toBe(true);  // at 3x the lead covers 5.4 sim s
});

import { zoomGain } from "../src/audiotiming";

test("zoomed out you hear only the big stuff; zoomed in, everything", () => {
  const out = 1, mid = 3.5, close = 8;              // camera scale: whole city, a district, a street
  expect(zoomGain("shot", 0, out)).toBe(0);           // gunfire silent from orbit
  expect(zoomGain("shot", 0, mid)).toBeGreaterThan(0);
  expect(zoomGain("shot", 0, close)).toBe(1);
  expect(zoomGain("boom", 60, out)).toBe(1);          // nuke / MOAB always full
  expect(zoomGain("boom", 25, out)).toBe(1);          // huge blasts too
  expect(zoomGain("boom", 1.5, out)).toBe(0);         // a grenade-sized pop: no
  expect(zoomGain("boom", 8, out)).toBeGreaterThan(0.3); // large blasts carry a bit
  expect(zoomGain("air", 0, out)).toBeGreaterThanOrEqual(0.5); // aircraft carry
  expect(zoomGain("shot", 0, mid)).toBeLessThan(zoomGain("shot", 0, close));
});

import { roundParts, roundScore, medalFor, padCost, mayhem } from "../src/scoring";

test("round score: all saved, fast, intact, all killed = 100", () => {
  const p = roundParts({ pct: 100, emptiedAfterS: 200, intact: 100, kills: 50, infAlive: 0 });
  expect(roundScore(p)).toBeCloseTo(100, 5);
  expect(medalFor(roundScore(p), 100)).toBe("Platinum");
});

test("speed falls from par to 3x par, scaled by people saved", () => {
  const sp = (t: number | null, pct = 100) => roundParts({ pct, emptiedAfterS: t, intact: 100, kills: 0, infAlive: 0 }).speed;
  expect(sp(300)).toBeCloseTo(100, 5);
  expect(sp(600)).toBeCloseTo(50, 5);
  expect(sp(900)).toBeCloseTo(0, 5);
  expect(sp(null)).toBe(0);
  expect(sp(300, 40)).toBeCloseTo(40, 5);
});

test("nobody saved cannot medal", () => {
  const p = roundParts({ pct: 0, emptiedAfterS: 10, intact: 100, kills: 100, infAlive: 0 });
  expect(p.speed).toBe(0);
  expect(roundScore(p)).toBeGreaterThan(10); // city + kills alone would reach Bronze...
  expect(medalFor(roundScore(p), 0)).toBeNull(); // ...but nobody saved = no medal
});

test("pad cost doubles", () => {
  expect(padCost(3e6, 0)).toBe(3e6);
  expect(padCost(3e6, 1)).toBe(6e6);
  expect(padCost(3e6, 2)).toBe(12e6);
});

test("mayhem adds kills and damage", () => {
  expect(mayhem(500, 2_500_000)).toBe(525);
});

import { mergeBest } from "../src/scoring";

test("a new best never takes away a medal", () => {
  expect(mergeBest({ pct: 14, medal: "Bronze" }, 16.5, null)).toEqual({ pct: 16.5, medal: "Bronze" });
  expect(mergeBest({ pct: 60, medal: "Gold" }, 40, "Silver")).toEqual({ pct: 60, medal: "Gold" }); // worse run: unchanged
  expect(mergeBest({ pct: 20, medal: null }, 15, "Bronze")).toEqual({ pct: 20, medal: "Bronze" }); // medal up, score kept
  expect(mergeBest(undefined, 30, "Silver")).toEqual({ pct: 30, medal: "Silver" });
  expect(mergeBest({ pct: 10, medal: "Bronze", mayhem: 500 }, 80, "Platinum")).toEqual({ pct: 80, medal: "Platinum", mayhem: 500 });
});

import * as C from "../src/config";
import { heat, rollGap, rollSize, routesFor } from "../src/storyteller";

test("heat rises with time and with people gone", () => {
  const m = C.DIFFICULTY.medium;
  expect(heat(m, 0, 0)).toBe(0);
  expect(heat(m, 4, 0)).toBeCloseTo(1, 5);
  expect(heat(m, 0, 1)).toBeCloseTo(1.5, 5);
  expect(heat(m, -3, 2)).toBeCloseTo(heat(m, 0, 1), 5);
});

test("gaps roll inside the range and shrink with heat", () => {
  const m = C.DIFFICULTY.medium;
  let s = 123456789;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 1000; i++) {
    const g0 = rollGap(m, 0, r);
    expect(g0).toBeGreaterThanOrEqual(20);
    expect(g0).toBeLessThanOrEqual(35);
    const g2 = rollGap(m, 2, r);
    expect(g2).toBeLessThanOrEqual(35 / (1 + m.gapHeat * 2) + 1e-9);
    expect(g2).toBeGreaterThanOrEqual(m.gapFloor);
  }
});

test("sizes stay inside the jitter unless big", () => {
  const m = C.DIFFICULTY.medium;
  let s = 987654321;
  const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 200; i++) {
    // keep first roll >= HORDE_BIG_CHANCE so it is not big
    let call = 0;
    const r = () => (call++ === 0 ? 0.5 : rng());
    const res = rollSize(m, 0, 200, r);
    expect(res.big).toBe(false);
    expect(res.count).toBeGreaterThanOrEqual(Math.round(200 * 0.75));
    expect(res.count).toBeLessThanOrEqual(Math.round(200 * 1.25));
  }
  let call = 0;
  const rBig = () => (call++ === 0 ? 0.05 : 0.5);
  const bigRes = rollSize(m, 0, 200, rBig);
  expect(bigRes.big).toBe(true);
  expect(bigRes.count).toBe(400);
});

test("insane is harder than easy everywhere", () => {
  const easy = C.DIFFICULTY.easy, insane = C.DIFFICULTY.insane;
  for (let h = 0; h <= 5; h++) {
    expect(rollGap(insane, h, () => 1)).toBeLessThan(rollGap(easy, h, () => 1));
    expect(rollSize(insane, h, 150, () => 0.5).count).toBeGreaterThan(rollSize(easy, h, 150, () => 0.5).count);
  }
});

test("huge heat stays finite and floored", () => {
  const m = C.DIFFICULTY.medium;
  expect(rollGap(m, 1e4, () => 0.5)).toBe(m.gapFloor);
  const sz = rollSize(m, 1e4, 150, () => 0.5);
  expect(Number.isFinite(sz.count)).toBe(true);
  expect(sz.count).toBeGreaterThan(0);
});

test("routes grow with heat, max 4", () => {
  expect(routesFor(0)).toBe(1);
  expect(routesFor(2)).toBe(2);
  expect(routesFor(100)).toBe(4);
});

test("blitz never beats the floor", () => {
  expect(rollGap(C.DIFFICULTY.medium, 1e3, () => 0, true)).toBe(10);
});

import { bestKey, anyMedal, difficultyFor } from "../src/scoring";

test("old best counts as medium and unlocks", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: { ashford: { pct: 60, medal: "Gold" } }, plans: {} };
  const s = clean(base as any);
  expect(s.best[bestKey("ashford", "medium")]?.medal).toBe("Gold");
  expect(anyMedal(s.best, "ashford")).toBe(true);
  expect(anyMedal(s.best, "millbrook")).toBe(false);
});

test("medals are kept per difficulty", () => {
  const best: Record<string, { pct: number; medal: string | null }> = {};
  best[bestKey("ashford", "easy")] = mergeBest(best[bestKey("ashford", "easy")], 60, "Gold");
  best[bestKey("ashford", "hard")] = mergeBest(best[bestKey("ashford", "hard")], 15, "Bronze");
  const s = clean({ settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best, plans: {} } as any);
  expect(s.best[bestKey("ashford", "easy")]?.medal).toBe("Gold");
  expect(s.best[bestKey("ashford", "hard")]?.medal).toBe("Bronze");
  expect(s.best[bestKey("ashford", "medium")]).toBeUndefined();
  expect(anyMedal(s.best, "ashford")).toBe(true);
});

test("daily is always medium", () => {
  expect(difficultyFor(true, "insane")).toBe("medium");
  expect(difficultyFor(false, "bogus" as any)).toBe("medium");
  expect(difficultyFor(false, undefined)).toBe("medium");
  expect(difficultyFor(false, "hard")).toBe("hard");
});

test("save keeps a valid difficulty, drops junk", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: {}, plans: {} };
  expect(clean({ ...base, settings: { ...base.settings, difficulty: "hard" } } as any).settings.difficulty).toBe("hard");
  expect(clean({ ...base, settings: { ...base.settings, difficulty: "x" as any } } as any).settings.difficulty).toBeUndefined();
});



test("an old 9-slot quick bar keeps its first 7 slots", () => {
  expect(cleanQuickbar(["mortar", null, null, null, null, null, "nuke", "howitzer", null], known)).toEqual(["mortar", null, null, null, null, null, "nuke"]);
});

test("save clean keeps updater settings and the game version only when well formed", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: {}, plans: {} } as any;
  const ok = clean({ ...base, gameVersion: "0.26.0", settings: { ...base.settings, autoUpdate: true, checkUpdates: false, updatePin: "0.24.0" } });
  expect(ok.gameVersion).toBe("0.26.0");
  expect(ok.settings).toMatchObject({ autoUpdate: true, checkUpdates: false, updatePin: "0.24.0" });
  const bad = clean({ ...base, gameVersion: "<b>", settings: { ...base.settings, autoUpdate: "yes", updatePin: "../x" } });
  expect(bad.gameVersion).toBeUndefined();
  expect(bad.settings.autoUpdate).toBeUndefined();
  expect(bad.settings.updatePin).toBeUndefined();
});

// ---- 0.36 City Map screen
import { areaAt, cityMapModel, areaCardInfo } from "../src/citymapui";

test("areaAt hits the centre of a turned quad and misses outside it", () => {
  const q: [number, number][] = [[10, 0], [30, 20], [20, 30], [0, 10]]; // a diamond-ish turned box
  expect(areaAt([q], 15, 15)).toBe(0);
  expect(areaAt([q], 2, 2)).toBe(-1);
  expect(areaAt([[[100, 100], [110, 100], [110, 110], [100, 110]], q], 105, 105)).toBe(0);
});

test("the Castle Rock City Map lists 6 areas with boxes on the overview", () => {
  const m = cityMapModel("castle-rock")!;
  expect(m.areas.length).toBe(6);
  for (const a of m.areas) { expect(a.quad.length).toBe(4); for (const [x, y] of a.quad) { expect(x).toBeGreaterThan(0); expect(y).toBeGreaterThan(0); expect(x).toBeLessThan(m.overview.w); expect(y).toBeLessThan(m.overview.h); } }
  expect(cityMapModel("nowhere")).toBeNull();
});

test("picking an area gives its card", () => {
  const m = cityMapModel("castle-rock")!, k = m.areas[2].key;
  const card = areaCardInfo(k, { [k]: { pct: 44, medal: "Silver" } }, "medium");
  expect(card.title).toBe(m.areas[2].name);
  expect(card.best).toContain("Silver");
  expect(areaCardInfo(k, {}, "medium").best).toBe("Not played");
});

import { clockSpan } from "../src/people";

test("0.39: the top bar clock shows time of day, battle time on hover", () => {
  expect(clockSpan(450, 120)).toBe(`<span class="clock" title="Battle time 2:00">8:30 AM</span>`);
  expect(clockSpan(1380, 0)).toBe(`<span class="clock" title="Battle time 0:00">11:00 PM</span>`);
});

import { needsTimePick } from "../src/people";

test("0.39: the time picker shows for a normal city, never in the tutorial or attract mode", () => {
  expect(needsTimePick(false, false)).toBe(true);
  expect(needsTimePick(true, false)).toBe(false);
  expect(needsTimePick(false, true)).toBe(false);
});

test("0.39: save clean keeps a valid plan start time and drops junk", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: {} };
  const plan = (start: unknown) => ({ poly: [], walls: [], units: [], start });
  const c = clean({ ...base, plans: { "fairhaven": plan(450) as any, "pike-landing": plan("noon") as any, "a": plan(99999) as any } });
  expect(c.plans["fairhaven"].start).toBe(450);
  expect(c.plans["pike-landing"]?.start).toBeUndefined();
  expect(c.plans["a"]?.start).toBeUndefined();
});

// ---------- 0.39: the person window ----------
import { Sim as PSim, DEAD as PDEAD } from "../src/sim";
import { personHtml } from "../src/personui";
import { personOf as pOf, EV_SAFE as PEV_SAFE, FATE_EVAC as PFATE_EVAC } from "../src/people";

function headOfFamily(s: PSim): number { for (let k = 0; k < s.civN; k++) if (s.famLead[k] === k && s.famSize[k] >= 3) return k; return -1; }

test("0.39: person window shows name, age, family and a Follow button", () => {
  const s = new PSim(42, { civilians: 500 });
  const k = headOfFamily(s); expect(k).toBeGreaterThanOrEqual(0);
  const p = pOf(s.seed, k, s.famLead[k], s.famSize[k]);
  const html = personHtml(s, k);
  expect(html).toContain(`${p.first} ${p.last}`);
  expect(html).toContain("Age");
  expect(html).toContain(pOf(s.seed, k + 1, k, s.famSize[k]).first);
  expect(html).toContain('data-act="follow"');
  expect(html).toContain(`data-k="${k + 1}"`);
  expect(html).not.toMatch(/—/);
});

test("0.39: person window story shows events with clock times", () => {
  const s = new PSim(42, { civilians: 500 });
  s.startMin = 450;
  s.note(10, PEV_SAFE, 1);
  const html = personHtml(s, 10);
  expect(html).toContain("reached Zone 2");
  expect(html).toContain("7:30 AM");
});

test("0.39: person window states: flown out, dead", () => {
  const s = new PSim(42, { civilians: 500 });
  s.note(20, 3); s.state[20] = PDEAD; // EV_EVAC
  expect(personHtml(s, 20)).toContain("Flown out");
  s.state[21] = PDEAD;
  expect(personHtml(s, 21)).toContain("Dead");
  expect(s.fate[20]).toBe(PFATE_EVAC);
});

test("0.39: a household cut short at the end of the population renders", () => {
  const s = new PSim(42, { civilians: 500 });
  const lead = s.civN - 2; s.famLead[lead] = lead; s.famLead[lead + 1] = lead; s.famSize[lead] = 5; s.famSize[lead + 1] = 5;
  expect(() => personHtml(s, lead)).not.toThrow();
  expect(() => personHtml(s, -1)).not.toThrow();
});

import { followEndLine } from "../src/personui";

test("0.39: follow-end ticker lines name the person and what happened", () => {
  const s = new PSim(42, { civilians: 500 });
  const p = pOf(s.seed, 30, s.famLead[30], s.famSize[30]);
  s.note(30, 3); s.state[30] = PDEAD;
  expect(followEndLine(s, 30)).toBe(`${p.first} ${p.last}, ${p.age}, was flown out.`);
  s.note(31, 4);
  expect(followEndLine(s, 31)).toContain("was bitten and turned.");
  s.state[32] = PDEAD;
  expect(followEndLine(s, 32)).toContain("died.");
});

test("review: a household member a cell off the doorstep started at home", () => {
  const s = new PSim(42, { civilians: 500 });
  const k = 40, home = s.homeCell[k];
  s.startCell[k] = home + 1; // the cell next door
  expect(personHtml(s, k)).toContain("at home when the sirens went off");
  s.startCell[k] = home + 5 * s.w;
  expect(personHtml(s, k)).not.toContain("at home when");
});

import { followEndLine as fel2 } from "../src/personui";
test("review: a train rider's follow ends with the train line", () => {
  const s = new PSim(42, { civilians: 500 });
  s.note(50, 3, 1); s.state[50] = PDEAD;
  expect(fel2(s, 50)).toContain("left on an evacuation train");
  expect(personHtml(s, 50)).toContain("Left on a train");
});

// ---------- 0.40: the window shows where people were and what they are doing ----------
import * as UC from "../src/config";
import { PL_SCHOOL as UPL_SCHOOL } from "../src/people";

test("0.41: How to Play is current (J for heights, people and Follow, the no-fire band, the time pick)", async () => {
  const html = await Bun.file("index.html").text();
  const a = html.indexOf('id="s-howto"'), b = html.indexOf("data-back", a);
  const page = html.slice(a, b);
  expect(page).not.toContain("press V");
  expect(page).toContain("press J");
  expect(page).toContain("Follow");
  expect(page).toContain("NO-FIRE");
  expect(page).toContain("Pick a time");
  expect(page).not.toMatch(/—/);
});

test("0.41: a kid at school reads right, and their walk with the class shows in the story", () => {
  const c = UC.CITIES[1];
  const s = new PSim(c.seed, { recipe: c.recipe, civilians: 4000, difficulty: "insane" });
  s.setStartTime(600);
  let kid = -1; for (let k = 0; k < s.civN && kid < 0; k++) if (s.dayPlace[k] === UPL_SCHOOL) kid = k;
  expect(personHtml(s, kid)).toContain("at school when the sirens went off");
  s.startBattle();
  expect(personHtml(s, kid)).toContain("walking to the zone with the class");
}, 120000);

// ---------- 0.42: refusers in the UI ----------
import { planWords as uPlanWords, personState as uPersonState } from "../src/personui";
import { endStatsLines } from "../src/personui";
test("0.42: How to Play explains refusers and age", async () => {
  const html = await Bun.file("index.html").text();
  const a = html.indexOf('id="s-howto"'), b = html.indexOf("data-back", a);
  const page = html.slice(a, b);
  expect(page).toContain("refuse to leave");
  expect(page).toContain("talk them out");
  expect(page).toContain("elderly");
});
test("0.42: a refuser's window says so", () => {
  const c = UC.CITIES[1];
  const s = new PSim(c.seed, { recipe: c.recipe, civilians: 6000, budget: 80_000_000 });
  s.setStartTime(1380);
  const cx = s.w >> 1, cy = s.h >> 1; s.setZone([[cx - 40, cy - 40], [cx + 40, cy - 40], [cx + 40, cy + 40], [cx - 40, cy + 40]]);
  s.startBattle();
  let k = -1; for (let i = 0; i < s.civN && k < 0; i++) if (s.plan[i] === 9) k = i;
  expect(k).toBeGreaterThanOrEqual(0);
  expect(uPlanWords(s, k)).toBe("Refusing to leave: feels safer at home");
  expect(uPersonState(s, k).text).toBe("Refusing to leave: feels safer at home");
});
test("0.42: end-of-round lines for refusers and accidents (only what happened)", () => {
  expect(endStatsLines({ refused: 0, refusedLost: 0, talkedOut: 0, broke: 0, civKilledByUs: 0, civFriendlyFire: 0 })).toEqual([]);
  expect(endStatsLines({ refused: 12, refusedLost: 3, talkedOut: 5, broke: 4, civKilledByUs: 7, civFriendlyFire: 2 })).toEqual([
    "Refused to leave: 12 stayed home (3 died there) · 5 talked out · 4 ran when the infected came",
    "Killed by accident: 7 by our fire · 2 by other civilians",
  ]);
  expect(endStatsLines({ refused: 2, refusedLost: 0, talkedOut: 0, broke: 0, civKilledByUs: 0, civFriendlyFire: 0 })).toEqual(["Refused to leave: 2 stayed home"]);
});
