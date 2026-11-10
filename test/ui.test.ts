import { expect, test } from "bun:test";
import { QUICK_SLOTS, cleanQuickbar, setSlot, swapSlots, clearSlot } from "../src/quickbar";
import { clean } from "../src/save";

const known = (t: string) => ["mortar", "howitzer", "nuke"].includes(t);
const empty = () => Array(QUICK_SLOTS).fill(null) as (string | null)[];

test("cleanQuickbar handles junk", () => {
  expect(cleanQuickbar(undefined, known)).toEqual(Array(9).fill(null));
  expect(cleanQuickbar("x", known)).toEqual(Array(9).fill(null));
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


