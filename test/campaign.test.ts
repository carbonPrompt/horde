import { expect, test } from "bun:test";
import * as C from "../src/config";
import * as P from "../src/progress";
import * as Save from "../src/save";

const IDS = ["fairhaven", "pike-landing", "stonebridge", "lakemont", "highgate", "tidewater", "seven-isles", "marrow-delta", "port-royal"];

test("nine designed cities in campaign order", () => {
  expect(C.CITIES.map(c => c.id)).toEqual(IDS);
  for (const c of C.CITIES) { expect(c.recipe).toBeDefined(); expect(c.recipe!.id).toBe(c.id); }
  expect(C.LEGACY_CAMPAIGN_IDS).toEqual(["ashford", "millbrook", "harrow-bay", "lowmoor", "redwater", "granite-falls", "port-kessel", "cinder-hill"]);
});

test("old campaign medals open the same number of new cities", () => {
  const best = { ashford: { pct: 50, medal: "Gold" }, millbrook: { pct: 30, medal: "Bronze" } } as any;
  expect(P.campaignOpen(best, 0)).toBe(true);
  expect(P.campaignOpen(best, 2)).toBe(true);
  expect(P.campaignOpen(best, 3)).toBe(false);
  expect(P.campaignOpen({}, 0)).toBe(true);
  expect(P.campaignOpen({}, 1)).toBe(false);
  expect(P.campaignOpen({ fairhaven: { pct: 40, medal: "Silver" } } as any, 1)).toBe(true);
});

test("the clear bonus is paid once, for the first medal", () => {
  const c = C.CITIES[0];
  expect(P.clearBonus(c, false, "Silver")).toBe(c.clearXp ?? 0);
  expect(c.clearXp ?? 0).toBeGreaterThan(0);
  expect(P.clearBonus(c, true, "Gold")).toBe(0);
  expect(P.clearBonus(c, false, null)).toBe(0);
});

test("the daily never picks a campaign city", () => {
  const ids = new Set(C.CITIES.map(c => c.id));
  const d0 = Date.UTC(2026, 10, 12);
  for (let k = 0; k < 400; k++) {
    const d = new Date(d0 + k * 86400000).toISOString().slice(0, 10);
    const dc = C.dailyChallengeFor(d);
    expect(dc.city.recipe).toBeUndefined();
    expect(ids.has(dc.city.id)).toBe(false);
  }
});

test("a 0.34 save with old campaign data loads", () => {
  const s = Save.clean({ settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: { ashford: { pct: 73, medal: "Gold" } }, plans: { ashford: { poly: [[1, 1], [9, 1], [9, 9]], walls: [], units: [], supports: [], abilities: {} } }, xp: 12345, battle: { version: "0.34.0", savedAt: "2026-11-12T00:00:00Z", label: "Ashford", t: 120, phase: "battle", bytes: 1000 } } as any);
  expect(s.xp).toBe(12345);
  expect(s.best.ashford.medal).toBe("Gold");
});

// ---- Task 7: unlock pacing (numbers measured by the balance bot, see src/campaignPace.ts)
import { PACE_XP, PACE_MARGIN, PACE_SAVED } from "../src/campaignPace";

test("a straight playthrough unlocks everything, nuke included", () => {
  let xp = 0;
  for (const c of C.CITIES) xp += PACE_XP[c.id] + (c.clearXp ?? 0);
  expect(PACE_MARGIN).toBeGreaterThanOrEqual(C.NUKE_XP_PENALTY);
  expect(xp).toBeGreaterThanOrEqual(P.UNLOCK_XP.nuke + PACE_MARGIN); // even after using the nuke once
});

test("each city's loaned unit is still locked when a bronze-only player arrives", () => {
  let xp = 0;
  for (const c of C.CITIES) {
    if (c.trial) expect(xp, `${c.id} lends ${c.trial} at ${Math.round(xp)} XP`).toBeLessThan(P.UNLOCK_XP[c.trial]);
    xp += bronzeXp(c.id) + (c.clearXp ?? 0);
  }
});

// ---- 0.35.1: bronze on every map still unlocks everything by the time the player reaches the last one
import { PACE_WAVES, BRONZE_SCORE } from "../src/campaignPace";
const bronzeXp = (id: string) => BRONZE_SCORE * 10 + PACE_WAVES[id] * 20; // sim.ts round XP, Medium, no bonus
test("bronze on every city unlocks everything before the last city", () => {
  let xp = 0;
  for (const c of C.CITIES.slice(0, -1)) xp += bronzeXp(c.id) + (c.clearXp ?? 0);
  expect(BRONZE_SCORE).toBe(C.MEDALS.find(m => m[0] === "Bronze")![1]);
  for (const [tool, need] of Object.entries(P.UNLOCK_XP)) expect(xp, `${tool} needs ${need}, bronze player has ${xp}`).toBeGreaterThanOrEqual(need);
  expect(C.CITIES[C.CITIES.length - 1].trial).toBeUndefined(); // nothing left to lend
});

test("unlocks are spread out: every city from the second on opens something new for a bronze player", () => {
  let xp = 0;
  for (const c of C.CITIES.slice(0, -1)) {
    const before = xp; xp += bronzeXp(c.id) + (c.clearXp ?? 0);
    expect(P.newlyUnlocked(before, xp).length, `after ${c.id}`).toBeGreaterThan(0);
  }
});

test("every campaign city is winnable by the bot", () => {
  for (const c of C.CITIES) expect(PACE_SAVED[c.id]).toBeGreaterThanOrEqual(15);
});

// ---- Final review #5: a daily battle saved and loaded keeps its city (budget, hordes) for Retry
test("cityById finds campaign, real and generated daily cities", () => {
  expect(C.cityById("fairhaven")?.name).toBe("Fairhaven");
  expect(C.cityById("denver")?.real).toBe(true);
  expect(C.cityById("daily-small")?.budget).toBe(24_000_000);
  expect(C.cityById("ashford")).toBeUndefined();
});
