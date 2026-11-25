import { expect, test } from "bun:test";
import * as C from "../src/config";
import { ACHIEVEMENTS, BY_ID, GROUPS, LEGACY_IDS, BUILDABLE, ALL_STRIKES, factsFromRecord, factsLive, careerFacts, seedLegacy, newlyEarned, progressAll,
  clockBucket, dailyStreak, type BattleFacts, type CareerFacts } from "../src/achievements";
import { emptyCareer, makeRecord, upsert, cleanHistory, type BattleRecord, type History } from "../src/battlerecord";
import { newRecorder, sample, COLS, event, SE_SIRENS, SE_GATES_LOCKED, SE_BREACH, SE_GATE_TO_WALL, SE_DEMOLISH, recCounters, REC_COUNTER_KEYS, strike, dropKill, killBy, unitIndex, killTotal } from "../src/stats";

const zeroC = () => Object.fromEntries(REC_COUNTER_KEYS.map(k => [k, 0])) as any;
function bf(p: Partial<BattleFacts> = {}): BattleFacts {
  return { kind: "campaign", cityId: "fairhaven", difficulty: "medium", sirenMin: 600, round: false, medal: null, mayhem: 0, underBudget: false, bonus: null, left: -1, refused: 0,
    saved: 0, byTrain: 0, lifts: 0, liftsAborted: 0, kills: 0, hordes: 0, held: 0, breaches: 0, damage: 0, intact: 100, nukes: 0, bridges: 0, civKilledByUs: 0, unitsLost: 0,
    counters: zeroC(), units: [], strikes: [], town: null, ...p };
}
const cnt = (p: any) => ({ ...zeroC(), ...p });
function cf(p: Partial<CareerFacts> = {}): CareerFacts {
  return { kills: 0, saved: 0, completed: 0, lifts: 0, killsByKind: {}, xp: 0, medals: {}, dailyDone: [], clockMedals: [], ...p };
}
const town = (p: any) => ({ households: 10, allOut: 0, lostSome: 0, lostAll: 0, refusedHouseholds: 0, talkedOut: 0, ran: 0, lostAtHome: 0, stillHome: 0, byPlace: [], fetched: 0, classKids: 0,
  teensAlone: 0, teensMadeIt: 0, wentBack: 0, wentBackMadeIt: 0, killedByUs: 0, schoolKids: 0, schoolKidsSafe: 0, ...p });
const done = { round: true, saved: 100 };
const campaignAll = (m: string) => Object.fromEntries(C.CITIES.map(c => [`${c.id}@hard`, m]));
const realAll = () => Object.fromEntries(C.REAL_CITIES.map(c => [`${c.areas?.[0]?.key ?? c.id}@medium`, "Bronze"]));

// [id, a facts object that earns it, one that just misses]
const CASES: [string, any, any][] = [
  ["first_out", bf({ saved: 1 }), bf()],
  ["evac_5k", bf({ saved: 5000 }), bf({ saved: 4999 })],
  ["evac_10k", bf({ saved: 10000 }), bf({ saved: 9999 })],
  ["evac_14k", bf({ saved: 14000 }), bf({ saved: 13999 })],
  ["lifts_50", bf({ lifts: 50 }), bf({ lifts: 49 })],
  ["lifts_100", bf({ lifts: 100 }), bf({ lifts: 99 })],
  ["lifts_200", bf({ lifts: 200 }), bf({ lifts: 199 })],
  ["steady_hands", bf({ lifts: 100 }), bf({ lifts: 150, liftsAborted: 1 })],
  ["rail_away", bf({ byTrain: 1000 }), bf({ byTrain: 999 })],
  ["full_house", bf({ counters: cnt({ maxZone: 6000 }) }), bf({ counters: cnt({ maxZone: 5999 }) })],
  ["quick_exit", bf({ counters: cnt({ saved5: 5000 }) }), bf({ counters: cnt({ saved5: 4999 }) })],
  ["every_last_one", bf({ ...done, left: 0 }), bf({ ...done, left: 0, refused: 3 })],
  ["clean_hands", bf({ medal: "Bronze" }), bf({ medal: "Bronze", civKilledByUs: 1 })],
  ["kills_5k", bf({ kills: 5000 }), bf({ kills: 4999 })],
  ["kills_10k", bf({ kills: 10000 }), bf({ kills: 9999 })],
  ["kills_25k", bf({ kills: 25000 }), bf({ kills: 24999 })],
  ["exterminator", bf({ ...done, kills: 9000, counters: cnt({ infectedLeft: 1000 }) }), bf({ ...done, kills: 8999, counters: cnt({ infectedLeft: 1001 }) })],
  ["waves_10", bf({ hordes: 10 }), bf({ hordes: 9 })],
  ["waves_20", bf({ hordes: 20 }), bf({ hordes: 19 })],
  ["waves_30", bf({ hordes: 30 }), bf({ hordes: 29 })],
  ["hold_20", bf({ held: 1200 }), bf({ held: 1199 })],
  ["hold_40", bf({ held: 2400 }), bf({ held: 2399 })],
  ["mayhem_1", bf({ mayhem: 5000 }), bf({ mayhem: 4999 })],
  ["mayhem_2", bf({ mayhem: 20000 }), bf({ mayhem: 19999 })],
  ["mayhem_3", bf({ mayhem: 50000 }), bf({ mayhem: 49999 })],
  ["killing_floor", bf({ counters: cnt({ best60: 1000 }) }), bf({ counters: cnt({ best60: 999 }) })],
  ["shore_patrol", bf({ counters: cnt({ swimmers: 500 }) }), bf({ counters: cnt({ swimmers: 499 }) })],
  ["treads", bf({ counters: cnt({ crushedByVehicles: 200 }) }), bf({ counters: cnt({ crushedByVehicles: 199 }) })],
  ["wall_guard", bf({ counters: cnt({ guardKills: 500 }) }), bf({ counters: cnt({ guardKills: 499 }) })],
  ["round_one", bf(done), bf({ round: true, saved: 0 })],
  ["no_losses", bf(done), bf({ ...done, unitsLost: 1 })],
  ["unbroken_1", bf({ ...done, hordes: 10 }), bf({ ...done, hordes: 10, breaches: 1 })],
  ["unbroken_2", bf({ ...done, hordes: 20 }), bf({ ...done, hordes: 19 })],
  ["comeback", bf({ medal: "Bronze", breaches: 5 }), bf({ medal: null, breaches: 9 })],
  ["lockdown", bf({ counters: cnt({ lockdown: 1 }) }), bf()],
  ["wall_of_steel", bf({ counters: cnt({ gatesToWall: 20 }) }), bf({ counters: cnt({ gatesToWall: 19 }) })],
  ["patched_up", bf({ counters: cnt({ repairs: 50 }) }), bf({ counters: cnt({ repairs: 49 }) })],
  ["bridge_out", bf({ bridges: 3 }), bf({ bridges: 2 })],
  ["fortress", bf({ counters: cnt({ fortifies: 10 }) }), bf({ counters: cnt({ fortifies: 9 }) })],
  ["supply_line", bf({ counters: cnt({ topUps: 25 }) }), bf({ counters: cnt({ topUps: 24 }) })],
  ["night_watch", bf({ medal: "Gold", sirenMin: 23 * 60 }), bf({ medal: "Gold", sirenMin: 5 * 60 })],
  ["light_touch", bf({ bonus: "Light Touch", hordes: 5 }), bf({ bonus: "Light Touch", hordes: 4 })],
  ["pristine", bf({ medal: "Platinum", intact: 95 }), bf({ medal: "Silver", intact: 99 })],
  ["scorched", bf({ bonus: "Scorched Earth" }), bf({ bonus: "Light Touch" })],
  ["bill_100m", bf({ damage: 1e8 }), bf({ damage: 1e8 - 1 })],
  ["billion", bf({ damage: 1e9 }), bf({ damage: 1e9 - 1 })],
  ["bill_3b", bf({ damage: 3e9 }), bf({ damage: 3e9 - 1 })],
  ["nuclear", bf({ nukes: 1 }), bf()],
  ["full_arsenal", bf({ strikes: ALL_STRIKES.map(k => ({ kind: k, kills: 0, civ: 0, dropKills: 0 })) }), bf({ strikes: ALL_STRIKES.slice(1).map(k => ({ kind: k, kills: 0, civ: 0, dropKills: 0 })) })],
  ["surgical", bf({ ...done, civKilledByUs: 9, strikes: Array.from({ length: 10 }, () => ({ kind: "airstrike", kills: 1, civ: 0, dropKills: 0 })) }),
    bf({ ...done, civKilledByUs: 10, strikes: Array.from({ length: 10 }, () => ({ kind: "airstrike", kills: 1, civ: 0, dropKills: 0 })) })],
  ["demolition_crew", bf({ counters: cnt({ demolitions: 10 }) }), bf({ counters: cnt({ demolitions: 9 }) })],
  ["combined_arms", bf({ units: BUILDABLE.map(k => ({ kind: k, kills: 0, lost: false })) }), bf({ units: BUILDABLE.slice(1).map(k => ({ kind: k, kills: 0, lost: false })) })],
  ["top_gun", bf({ units: [{ kind: "tank", kills: 3000, lost: true }] }), bf({ units: [{ kind: "tank", kills: 2999, lost: false }] })],
  ["survivor", bf({ units: [{ kind: "tank", kills: 1000, lost: false }] }), bf({ units: [{ kind: "tank", kills: 5000, lost: true }] })],
  ["long_shot", bf({ counters: cnt({ longShot: 400 }) }), bf({ counters: cnt({ longShot: 399 }) })],
  ["grenadier", bf({ counters: cnt({ grenadierKills: 200 }) }), bf({ counters: cnt({ grenadierKills: 199 }) })],
  ["strike_airstrike", bf({ strikes: [{ kind: "airstrike", kills: 300, civ: 5, dropKills: 0 }] }), bf({ strikes: [{ kind: "airstrike", kills: 299, civ: 0, dropKills: 0 }, { kind: "firebomb", kills: 900, civ: 0, dropKills: 0 }] })],
  ["strike_para", bf({ strikes: [{ kind: "para", kills: 0, civ: 0, dropKills: 500 }] }), bf({ strikes: [{ kind: "para", kills: 0, civ: 0, dropKills: 250 }, { kind: "para", kills: 0, civ: 0, dropKills: 250 }] })],
  ["strike_nuke", bf({ strikes: [{ kind: "nuke", kills: 5000, civ: 900, dropKills: 0 }] }), bf({ strikes: [{ kind: "nuke", kills: 4999, civ: 0, dropKills: 0 }] })],
  ["strike_supply_drop", bf({ strikes: Array.from({ length: 10 }, () => ({ kind: "supply_drop", kills: 0, civ: 0, dropKills: 0 })) }), bf({ strikes: Array.from({ length: 9 }, () => ({ kind: "supply_drop", kills: 0, civ: 0, dropKills: 0 })) })],
  ["clean_strike", bf({ strikes: [{ kind: "moab", kills: 500, civ: 0, dropKills: 0 }] }), bf({ strikes: [{ kind: "moab", kills: 2000, civ: 1, dropKills: 0 }] })],
  ["gold", bf({ medal: "Gold" }), bf({ medal: "Silver" })],
  ["platinum", bf({ medal: "Platinum" }), bf({ medal: "Gold" })],
  ["campaign_bronze", cf({ medals: campaignAll("Bronze") }), cf({ medals: { ...campaignAll("Bronze"), [`${C.CITIES[0].id}@hard`]: "none" } })],
  ["campaign_gold", cf({ medals: campaignAll("Platinum") }), cf({ medals: campaignAll("Silver") })],
  ["campaign_platinum", cf({ medals: campaignAll("Platinum") }), cf({ medals: campaignAll("Gold") })],
  ["insane_medal", cf({ medals: { "fairhaven@insane": "Bronze" } }), cf({ medals: { "fairhaven@hard": "Platinum" } })],
  ["insane_gold", cf({ medals: { "x/y@insane": "Gold" } }), cf({ medals: { "fairhaven@insane": "Silver" } })],
  ["tourist", cf({ medals: { [`${C.REAL_CITIES[0].areas?.[0]?.key ?? C.REAL_CITIES[0].id}@easy`]: "Bronze" } }), cf({ medals: { "fairhaven@medium": "Gold" } })],
  ["globetrotter", cf({ medals: realAll() }), cf({ medals: Object.fromEntries(Object.entries(realAll()).slice(1)) })],
  ["daily", bf({ ...done, kind: "daily" }), bf({ ...done, kind: "quick" })],
  ["daily_week", cf({ dailyDone: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"] }), cf({ dailyDone: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"] })],
  ["daily_platinum", cf({ medals: { "daily:2026-11-01": "Platinum" } }), cf({ medals: { "fairhaven@medium": "Platinum" } })],
  ["around_the_clock", cf({ clockMedals: ["night", "morning", "day", "evening"] }), cf({ clockMedals: ["night", "morning", "day"] })],
  ["career_kills_100k", cf({ kills: 100000 }), cf({ kills: 99999 })],
  ["career_kills_1m", cf({ kills: 1e6 }), cf({ kills: 1e6 - 1 })],
  ["career_saved_100k", cf({ saved: 100000 }), cf({ saved: 99999 })],
  ["career_saved_1m", cf({ saved: 1e6 }), cf({ saved: 1e6 - 1 })],
  ["career_battles_50", cf({ completed: 50 }), cf({ completed: 49 })],
  ["career_battles_250", cf({ completed: 250 }), cf({ completed: 249 })],
  ["career_lifts_10k", cf({ lifts: 10000 }), cf({ lifts: 9999 })],
  ["general", cf({ xp: 22000 }), cf({ xp: 21999 })],
  ["unit_garrison", cf({ killsByKind: { garrison: 25000 } }), cf({ killsByKind: { garrison: 24999, tank: 1e6 } })],
  ["unit_police", cf({ killsByKind: { police: 2000 } }), cf({ killsByKind: { police: 1999 } })],
  ["ground_game", bf(done), bf({ ...done, strikes: [{ kind: "barrage", kills: 0, civ: 0, dropKills: 0 }] })],
  ["ground_pounder", bf({ ...done, strikes: [{ kind: "barrage", kills: 0, civ: 0, dropKills: 0 }, { kind: "tomahawk", kills: 0, civ: 0, dropKills: 0 }] }), bf({ ...done, units: [{ kind: "reaper", kills: 0, lost: false }] })],
  ["lean_force", bf({ medal: "Gold", units: [...Array.from({ length: 6 }, () => ({ kind: "tank", kills: 0, lost: false })), { kind: "para", kills: 0, lost: false }] }), bf({ medal: "Gold", units: Array.from({ length: 7 }, () => ({ kind: "tank", kills: 0, lost: false })) })],
  ["penny_pincher", bf({ medal: "Bronze", underBudget: true, difficulty: "insane" }), bf({ medal: "Bronze", underBudget: true, difficulty: "hard" })],
  ["untouchable", bf({ medal: "Platinum" }), bf({ medal: "Platinum", breaches: 1 })],
  ["insane_platinum", bf({ medal: "Platinum", difficulty: "insane" }), bf({ medal: "Gold", difficulty: "insane" })],
  ["families_1", bf({ town: town({ allOut: 1000 }) }), bf({ town: town({ allOut: 999 }) })],
  ["families_2", bf({ town: town({ allOut: 2500 }) }), bf({ town: town({ allOut: 2499 }) })],
  ["families_3", bf({ town: town({ allOut: 4000 }) }), bf({ town: town({ allOut: 3999 }) })],
  ["talked_down", bf({ counters: cnt({ talkedOut: 200 }) }), bf({ counters: cnt({ talkedOut: 199 }) })],
  ["nobody_refused", bf({ ...done, town: town({ refusedHouseholds: 5, talkedOut: 3, ran: 2 }) }), bf({ ...done, town: town({ refusedHouseholds: 5, talkedOut: 4, stillHome: 1 }) })],
  ["back_to_school", bf({ ...done, difficulty: "insane", town: town({ schoolKids: 40, schoolKidsSafe: 40 }) }), bf({ ...done, difficulty: "insane", town: town({ schoolKids: 40, schoolKidsSafe: 39 }) })],
];

test("117 achievements in the ten groups, ids unique", () => {
  expect(ACHIEVEMENTS.length).toBe(117);
  expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(117);
  const per = Object.fromEntries(GROUPS.map(g => [g, ACHIEVEMENTS.filter(a => a.group === g).length]));
  expect(per).toEqual({ Evacuation: 13, Combat: 16, Defense: 12, Destruction: 10, Units: 20, Strikes: 12, Cities: 14, Career: 8, Challenge: 6, People: 6 });
});

test("the 16 achievements from before 0.59 keep their ids", () => {
  for (const id of LEGACY_IDS) expect(BY_ID[id]).toBeDefined();
  expect(LEGACY_IDS.length).toBe(16);
});

test("every achievement says how to earn it, in plain text", () => {
  for (const a of ACHIEVEMENTS) {
    expect(a.how.length).toBeGreaterThan(10);
    expect(a.how.endsWith(".")).toBe(true);
    expect(a.how + a.name).not.toContain("—");
    expect(a.name).not.toMatch(/[!?]/);
  }
});

test("each listed achievement passes its earning case and fails the near miss", () => {
  for (const [id, yes, no] of CASES) {
    const d = BY_ID[id]; expect(d, id).toBeDefined();
    expect(d.test(yes), `${id} yes`).toBe(true);
    expect(d.test(no), `${id} no`).toBe(false);
  }
});

test("every battle achievement runs on empty facts without throwing; career ones on an empty career", () => {
  for (const a of ACHIEVEMENTS) {
    const x = a.scope === "battle" ? bf() : cf();
    expect(a.test(x), a.id).toBe(false);
    if (a.progress) { const [c, g] = a.progress(x); expect(Number.isFinite(c) && Number.isFinite(g) && g > 0, a.id).toBe(true); }
  }
});

test("strikes group covers every strike kind", () => {
  for (const k of ALL_STRIKES) expect(BY_ID[`strike_${k}`], k).toBeDefined();
});

test("clock buckets and daily streaks", () => {
  expect(clockBucket(22 * 60)).toBe("night"); expect(clockBucket(3 * 60 + 59)).toBe("night"); expect(clockBucket(4 * 60)).toBe(null);
  expect(clockBucket(6 * 60)).toBe("morning"); expect(clockBucket(9 * 60)).toBe("day"); expect(clockBucket(17 * 60)).toBe("evening");
  expect(dailyStreak([])).toBe(0);
  expect(dailyStreak(["2026-11-30", "2026-12-01", "2026-12-02", "2026-11-30"])).toBe(3);
});

test("legacy medals: best keys get a difficulty, daily keys keep the date", () => {
  const l = seedLegacy({ fairhaven: { medal: "Gold" }, "stonebridge@insane": { medal: "Bronze" }, "pike-landing": { medal: null } }, { "2026-11-01": { medal: null } });
  expect(l).toEqual({ "fairhaven@medium": "Gold", "stonebridge@insane": "Bronze", "daily:2026-11-01": "none" });
  const c = careerFacts(emptyCareer(), null, l, 0);
  expect(c.medals["fairhaven@medium"]).toBe("Gold");
  expect(c.dailyDone).toEqual(["2026-11-01"]);
  expect(BY_ID.insane_medal.test(c)).toBe(true);
});

// ---------- with real records ----------
let seq = 0;
function rec(p: { dev?: boolean; medal?: string | null; saved?: number; kind?: any; city?: string; diff?: string; sirenMin?: number; round?: boolean } = {}): BattleRecord {
  const r = newRecorder("a" + seq++);
  event(r, SE_SIRENS, 0, 0, 0);
  for (let i = 0; i < 40; i++) sample(r, Object.fromEntries(COLS.map(c => [c, c === "t" ? i * 10 : c === "saved" ? i * 200 : c === "infected" ? 50 : i])) as any);
  const score = { saved: p.saved ?? 100, pct: 50, medal: p.medal ?? null, reason: "", intact: 90, bonus: null, xp: 100, waves: 2, round: true, damage: 1e6, spent: 2e6, score: 40,
    parts: { saved: 30, speed: 5, city: 3, kills: 2 }, kills: 0, perM: 5, left: 0, refused: 0 } as any;
  return makeRecord({ id: r.battleId, date: "2026-11-25", version: "0.59.0", cityId: p.city ?? "fairhaven", cityName: "F", kind: p.kind ?? "campaign", difficulty: p.diff ?? "medium",
    sirenMin: p.sirenMin ?? 600, flags: { dev: !!p.dev, modded: false } },
    { medal: p.medal ?? null, score: 40, parts: { saved: 30, speed: 5, city: 3, kills: 2 }, roundComplete: p.round ?? true, abandoned: false, keepFighting: false, left: 0 },
    score, r, { roundAt: 390, nukes: 0, bridges: 0, crushed: 0, budget: 5e7 });
}

test("a record keeps the counters; factsFromRecord reads them (and survives a history round trip)", () => {
  const r = rec();
  expect(r.counters!.saved5).toBe(30 * 200); // the last sample at or before 300 s after the sirens (t = 300)
  expect(r.counters!.infectedLeft).toBe(50);
  const back = cleanHistory(JSON.parse(JSON.stringify({ v: 1, battles: [r] }))).battles[0];
  expect(factsFromRecord(back)).toEqual(factsFromRecord(r));
  expect(BY_ID.quick_exit.test(factsFromRecord(back))).toBe(true);
});

test("a record from before 0.59 (no counters) gives facts without NaN", () => {
  const r = rec(); delete r.counters; delete (r.outcome as any).left;
  const f = factsFromRecord(r);
  for (const k of REC_COUNTER_KEYS) expect(Number.isFinite(f.counters[k])).toBe(true);
  expect(f.left).toBe(-1);
  expect(BY_ID.every_last_one.test(f)).toBe(false);
});

test("career facts: medals and clock buckets come from counting battles only; daily days from completed dailies", () => {
  let h: History = { v: 1, battles: [] }, c = emptyCareer();
  for (const r of [rec({ medal: "Gold", sirenMin: 23 * 60 }), rec({ medal: "Platinum", dev: true, diff: "insane" }), rec({ kind: "daily", city: "daily:2026-11-20", medal: "Platinum" }), rec({ kind: "daily", city: "daily:2026-11-21", round: false })]) {
    const u = upsert(h, c, r); h = u.history; c = u.career;
  }
  const f = careerFacts(c, h, undefined, 0);
  expect(f.medals["fairhaven@medium"]).toBe("Gold"); // the daily's Platinum sits under its daily key, not the city's
  expect(f.medals["fairhaven@insane"]).toBeUndefined(); // dev battle
  expect(f.medals["daily:2026-11-20"]).toBe("Platinum");
  expect(f.dailyDone).toEqual(["2026-11-20"]);
  expect(f.clockMedals.sort()).toEqual(["day", "night"]);
  expect(BY_ID.daily_platinum.test(f)).toBe(true);
});

test("newlyEarned skips what is held; progress takes the best counting battle", () => {
  const f = bf({ saved: 6000, kills: 100 });
  const got = newlyEarned("battle", f, { first_out: "2026-01-01" }).map(a => a.id);
  expect(got).toContain("evac_5k"); expect(got).not.toContain("first_out"); expect(got).not.toContain("evac_10k");
  const h: History = { v: 1, battles: [rec({ saved: 3000 }), rec({ saved: 8000 }), rec({ saved: 12000, dev: true })] };
  const p = progressAll(h, null);
  expect(p.evac_10k).toEqual([8000, 10000]);
});

test("live facts from a running recorder", () => {
  const r = newRecorder("live");
  event(r, SE_SIRENS, 20, 0, 0); event(r, SE_GATE_TO_WALL, 30, 0, 0); event(r, SE_DEMOLISH, 31, 0, 0);
  const u = { kind: "tank" } as any; const ui = unitIndex(r, u, 0); killBy(r, 40, { unit: ui });
  const sim: any = { stats: r, roundAt: null, roundDone: false, roundResult: null, result: null, time: 600, difficulty: "hard", startMin: 600, evacuated: 50, trainsEvacuated: 5,
    liftsFlown: 3, liftsAborted: 0, kills: 1, wave: 4, breaches: 0, nukesUsed: 0, blown: new Set([1]), civKilledByUs: 0 };
  const f = factsLive(sim, "quick", "quick");
  expect(f.saved).toBe(50); expect(f.counters.gatesToWall).toBe(1); expect(f.counters.demolitions).toBe(1); expect(f.units[0].kills).toBe(1);
  expect(f.medal).toBe(null); expect(f.left).toBe(-1); expect(f.bridges).toBe(1);
  expect(newlyEarned("battle", f, {}).map(a => a.id)).toEqual(["first_out"]);
});

test("lockdown: gates locked, no breach after, five minutes to the round", () => {
  const r = newRecorder("ld");
  event(r, SE_BREACH, 10, 0, 0); event(r, SE_GATES_LOCKED, 100, 0, 0, 12);
  expect(recCounters(r, 400).lockdown).toBe(1);
  expect(recCounters(r, 399).lockdown).toBe(0);
  expect(recCounters(r, null).lockdown).toBe(0);
  event(r, SE_BREACH, 200, 0, 0);
  expect(recCounters(r, 400).lockdown).toBe(0);
});

test("paratrooper drop kills add to the drop, not to the kill buckets", () => {
  const r = newRecorder("p");
  const si = strike(r, "para", 0, 0, 0);
  const u = { kind: "para" } as any; const ui = unitIndex(r, u, 0);
  for (let i = 0; i < 5; i++) { killBy(r, i, { unit: ui }); dropKill(r, si); }
  expect(r.strikes[si].dropKills).toBe(5); expect(r.strikes[si].kills).toBe(0); expect(killTotal(r)).toBe(5);
});
