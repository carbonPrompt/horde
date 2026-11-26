// 0.59: the achievements. Recognition only: they unlock nothing and give no XP. Every one says how to earn it.
// Battle achievements read one battle's facts (live while it runs, then from its record); career achievements read
// the career totals, the medals and the rank. Battles played in Dev mode or with mods earn nothing (the page checks
// the flags before calling in here). Pure: no DOM, so the tests cover every definition.
import * as C from "./config";
import type { Score } from "./sim";
import type { BattleKind, BattleRecord, Career, History } from "./battlerecord";
import { countsInCareer } from "./battlerecord";
import { recCounters, REC_COUNTER_KEYS, type RecCounters, type Recorder, type BevOutcome } from "./stats";
import type { TownSummary } from "./townreport";
import { RANKS } from "./progress";

export type AchGroup = "Evacuation" | "Combat" | "Defense" | "Destruction" | "Units" | "Strikes" | "Cities" | "Career" | "Challenge" | "People";
export const GROUPS: AchGroup[] = ["Evacuation", "Combat", "Defense", "Destruction", "Units", "Strikes", "Cities", "Career", "Challenge", "People"];
/** 1 Bronze, 2 Silver, 3 Gold, 4 Platinum (the hardest single ones). */
export type Tier = 1 | 2 | 3 | 4;
export const TIER_NAMES: Record<Tier, string> = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum" };

/** One battle, as the achievements see it. */
export interface BattleFacts {
  kind: BattleKind; cityId: string; difficulty: string; sirenMin: number;
  round: boolean; medal: string | null; mayhem: number; underBudget: boolean; bonus: string | null; left: number; refused: number;
  saved: number; byTrain: number; lifts: number; liftsAborted: number; kills: number; hordes: number; held: number; breaches: number;
  damage: number; intact: number; nukes: number; bridges: number; civKilledByUs: number; unitsLost: number;
  counters: RecCounters;
  units: { kind: string; kills: number; lost: boolean }[];
  strikes: { kind: string; kills: number; civ: number; dropKills: number }[];
  town: TownSummary | null;
  bevents: BevOutcome[]; // 0.62: Battle Events this battle (empty without the mutator)
}
/** The career, as the achievements see it. medals: best medal per "<cityId>@<difficulty>" (legacy medals included). */
export interface CareerFacts {
  kills: number; saved: number; completed: number; lifts: number; killsByKind: Record<string, number>; xp: number;
  medals: Record<string, string>; dailyDone: string[]; clockMedals: string[]; // dailyDone: dates with a Daily round complete; clockMedals: siren-time buckets with a medal
}

export interface AchDef {
  id: string; group: AchGroup; name: string; how: string; tier: Tier; scope: "battle" | "career";
  test: (x: any) => boolean;
  /** [current, goal] for the progress bar; absent = no bar (a yes/no condition). */
  progress?: (x: any) => [number, number];
  unit?: "%" | "min" | "m" | "$"; // how the progress numbers read
}

const MEDAL_RANK: Record<string, number> = { Bronze: 1, Silver: 2, Gold: 3, Platinum: 4 };
export const medalRank = (m: string | null | undefined) => (m ? MEDAL_RANK[m] ?? 0 : 0);
const atLeast = (m: string | null, want: string) => medalRank(m) >= MEDAL_RANK[want];

/** Units the player builds (paratroopers come by strike). */
export const BUILDABLE: string[] = ["garrison", "sniper", "turret", "mortar", "howitzer", "himars", "apc", "tank", "gunboat", "battleship", "apache", "reaper", "police", "militia"];
/** Strikes delivered from the air (Ground Pounder): everything except artillery and the ship-launched Tomahawk. */
export const AIR_STRIKES: string[] = ["airstrike", "firebomb", "para", "supply_drop", "moab", "nuke", "a10", "cluster", "gunship"];
export const ALL_STRIKES: string[] = Object.keys(C.ABILITIES);

const n = (v: number) => v.toLocaleString("en-US");
const unitName = (k: string) => (C.UNITS as Record<string, { name: string }>)[k]?.name ?? k;
const strikeName = (k: string) => (C.ABILITIES as Record<string, { name: string }>)[k]?.name ?? k;

// ---------- definitions ----------
type BF = BattleFacts; type CF = CareerFacts;
const defs: AchDef[] = [];
function battle(group: AchGroup, id: string, name: string, tier: Tier, how: string, test: (f: BF) => boolean, progress?: (f: BF) => [number, number]) {
  defs.push({ id, group, name, how, tier, scope: "battle", test, progress });
}
function career(group: AchGroup, id: string, name: string, tier: Tier, how: string, test: (c: CF) => boolean, progress?: (c: CF) => [number, number]) {
  defs.push({ id, group, name, how, tier, scope: "career", test, progress });
}
/** A battle achievement that is a number reaching a goal. */
function count(group: AchGroup, id: string, name: string, tier: Tier, how: string, val: (f: BF) => number, goal: number) {
  battle(group, id, name, tier, how, f => val(f) >= goal, f => [val(f), goal]);
}
function ccount(group: AchGroup, id: string, name: string, tier: Tier, how: string, val: (c: CF) => number, goal: number) {
  career(group, id, name, tier, how, c => val(c) >= goal, c => [val(c), goal]);
}

// Evacuation (14)
count("Evacuation", "first_out", "First Lift", 1, "Evacuate your first people.", f => f.saved, 1);
count("Evacuation", "evac_5k", "Airlift I", 1, "Evacuate 5,000 people in one battle.", f => f.saved, 5000);
count("Evacuation", "evac_10k", "Airlift II", 2, "Evacuate 10,000 people in one battle.", f => f.saved, 10000);
count("Evacuation", "evac_14k", "Airlift III", 3, "Evacuate 14,000 people in one battle.", f => f.saved, 14000);
count("Evacuation", "lifts_50", "Shuttle Run I", 1, "Fly 50 evac lifts in one battle.", f => f.lifts, 50);
count("Evacuation", "lifts_100", "Shuttle Run II", 2, "Fly 100 evac lifts in one battle.", f => f.lifts, 100);
count("Evacuation", "lifts_200", "Shuttle Run III", 3, "Fly 200 evac lifts in one battle.", f => f.lifts, 200);
battle("Evacuation", "steady_hands", "Steady Hands", 3, "Fly 100 lifts in one battle without one waved off.", f => f.lifts >= 100 && f.liftsAborted === 0, f => [f.liftsAborted ? 0 : f.lifts, 100]);
count("Evacuation", "rail_away", "Rail Away", 2, "Evacuate 1,000 people by train in one battle.", f => f.byTrain, 1000);
count("Evacuation", "full_house", "Full House", 2, "Have 6,000 people in your zone at once.", f => f.counters.maxZone, 6000);
count("Evacuation", "quick_exit", "Quick Exit", 3, "Evacuate 5,000 people within 5 minutes of the sirens.", f => f.counters.saved5, 5000);
battle("Evacuation", "every_last_one", "Every Last One", 3, "Complete a round with nobody left behind outside the zone, refusers included.", f => f.round && f.saved > 0 && f.left === 0 && f.refused === 0);
battle("Evacuation", "clean_hands", "Clean Hands", 2, "Earn a medal without killing a single civilian.", f => !!f.medal && f.civKilledByUs === 0);

// Combat (16)
count("Combat", "kills_5k", "Grinder I", 1, "Kill 5,000 infected in one battle.", f => f.kills, 5000);
count("Combat", "kills_10k", "Grinder II", 2, "Kill 10,000 infected in one battle.", f => f.kills, 10000);
count("Combat", "kills_25k", "Grinder III", 3, "Kill 25,000 infected in one battle.", f => f.kills, 25000);
battle("Combat", "exterminator", "Exterminator", 3, "Complete a round having killed 90% of all infected (at least 1,000 kills).",
  f => f.round && f.kills >= 1000 && f.kills / Math.max(1, f.kills + f.counters.infectedLeft) >= 0.9,
  f => [Math.floor(100 * f.kills / Math.max(1, f.kills + f.counters.infectedLeft)), 90]);
count("Combat", "waves_10", "Tide Breaker I", 1, "Survive 10 hordes.", f => f.hordes, 10);
count("Combat", "waves_20", "Tide Breaker II", 2, "Survive 20 hordes.", f => f.hordes, 20);
count("Combat", "waves_30", "Tide Breaker III", 3, "Survive 30 hordes.", f => f.hordes, 30);
battle("Combat", "hold_20", "Last Stand I", 1, "Hold 20 minutes after the outbreak.", f => f.held >= 1200, f => [Math.floor(f.held / 60), 20]);
battle("Combat", "hold_40", "Last Stand II", 2, "Hold 40 minutes after the outbreak.", f => f.held >= 2400, f => [Math.floor(f.held / 60), 40]);
count("Combat", "mayhem_1", "Mayhem I", 1, "Score 5,000 Mayhem in Keep fighting.", f => f.mayhem, 5000);
count("Combat", "mayhem_2", "Mayhem II", 2, "Score 20,000 Mayhem in Keep fighting.", f => f.mayhem, 20000);
count("Combat", "mayhem_3", "Mayhem III", 3, "Score 50,000 Mayhem in Keep fighting.", f => f.mayhem, 50000);
count("Combat", "killing_floor", "Killing Floor", 3, "Kill 1,000 infected within one minute.", f => f.counters.best60, 1000);
count("Combat", "shore_patrol", "Shore Patrol", 2, "Kill 500 swimmers in one battle.", f => f.counters.swimmers, 500);
count("Combat", "treads", "Treads", 2, "Crush 200 infected under APCs and tanks in one battle.", f => f.counters.crushedByVehicles, 200);
count("Combat", "wall_guard", "Wall Guard", 2, "Wall guards kill 500 infected in one battle.", f => f.counters.guardKills, 500);

// Defense (12)
battle("Defense", "round_one", "Held the Line", 1, "Complete a round: get everyone you can out of the city.", f => f.round && f.saved > 0);
battle("Defense", "no_losses", "Everyone Comes Home", 2, "Complete a round without losing a unit.", f => f.round && f.saved > 0 && f.unitsLost === 0);
battle("Defense", "unbroken_1", "Unbroken I", 2, "Complete a round with no breaches after 10 or more hordes.", f => f.round && f.saved > 0 && f.breaches === 0 && f.hordes >= 10);
battle("Defense", "unbroken_2", "Unbroken II", 3, "Complete a round with no breaches after 20 or more hordes.", f => f.round && f.saved > 0 && f.breaches === 0 && f.hordes >= 20);
battle("Defense", "comeback", "Comeback", 2, "Earn a medal after 5 or more breaches.", f => !!f.medal && f.breaches >= 5);
battle("Defense", "lockdown", "Lockdown", 2, "Lock the gates in battle and take no breach for the rest of the round (at least 5 minutes).", f => f.counters.lockdown > 0);
count("Defense", "wall_of_steel", "Wall of Steel", 2, "Turn 20 gates into walls in one battle.", f => f.counters.gatesToWall, 20);
count("Defense", "patched_up", "Patched Up", 2, "Repair 50 wall sections in one battle (a Repair Yard brings each from under half to full).", f => f.counters.repairs, 50);
count("Defense", "bridge_out", "Bridge Out", 2, "Blow 3 bridges in one battle.", f => f.bridges, 3);
count("Defense", "fortress", "Fortress", 2, "Fortify 10 Troops squads on roofs in one battle.", f => f.counters.fortifies, 10);
count("Defense", "supply_line", "Supply Line", 2, "Top up 25 squads in one battle.", f => f.counters.topUps, 25);
battle("Defense", "night_watch", "Night Watch", 3, "Earn Gold with the sirens between 22:00 and 04:00.", f => atLeast(f.medal, "Gold") && clockBucket(f.sirenMin) === "night");

// Destruction (10)
battle("Destruction", "light_touch", "Light Touch", 2, "Finish with the city at least 90% intact (after 5 or more hordes).", f => f.bonus === "Light Touch" && f.hordes >= 5);
battle("Destruction", "pristine", "Pristine", 3, "Earn Gold with the city at least 95% intact.", f => atLeast(f.medal, "Gold") && f.intact >= 95);
battle("Destruction", "scorched", "Scorched Earth", 1, "Finish with at least 35% of the city wrecked.", f => f.bonus === "Scorched Earth");
count("Destruction", "bill_100m", "Damage Bill I", 1, "Cause $100 million in property damage in one battle.", f => f.damage, 1e8);
count("Destruction", "billion", "Damage Bill II", 2, "Cause $1 billion in property damage in one battle.", f => f.damage, 1e9);
count("Destruction", "bill_3b", "Damage Bill III", 3, "Cause $3 billion in property damage in one battle.", f => f.damage, 3e9);
battle("Destruction", "nuclear", "Nuclear Option", 2, "Use a tactical nuke. It costs you.", f => f.nukes > 0);
battle("Destruction", "full_arsenal", "Full Arsenal", 3, "Call in every kind of strike in one battle.", f => ALL_STRIKES.every(k => f.strikes.some(s => s.kind === k)),
  f => [ALL_STRIKES.filter(k => f.strikes.some(s => s.kind === k)).length, ALL_STRIKES.length]);
battle("Destruction", "surgical", "Surgical", 3, "Complete a round with 10 or more strikes called in and fewer than 10 civilians killed by your fire.",
  f => f.round && f.saved > 0 && f.strikes.length >= 10 && f.civKilledByUs < 10, f => [f.civKilledByUs < 10 ? Math.min(10, f.strikes.length) : 0, 10]);
count("Destruction", "demolition_crew", "Demolition Crew", 1, "Demolish 10 buildings in one battle.", f => f.counters.demolitions, 10);

// Units (20): career kills by unit kind, then five battle ones
const UNIT_GOALS: [string, number, Tier][] = [["garrison", 25000, 3], ["sniper", 10000, 2], ["turret", 10000, 2], ["mortar", 10000, 2], ["howitzer", 10000, 2],
  ["himars", 10000, 2], ["apc", 10000, 2], ["tank", 25000, 3], ["gunboat", 10000, 2], ["battleship", 10000, 2], ["apache", 25000, 3], ["reaper", 10000, 2],
  ["para", 5000, 2], ["police", 2000, 1], ["militia", 2000, 1]];
for (const [k, goal, tier] of UNIT_GOALS)
  ccount("Units", `unit_${k}`, `${unitName(k)} Veteran`, tier, `Kill ${n(goal)} infected with ${unitName(k)} across your career.`, c => c.killsByKind[k] ?? 0, goal);
battle("Units", "combined_arms", "Combined Arms", 3, "Field every buildable unit type in one battle.", f => BUILDABLE.every(k => f.units.some(u => u.kind === k)),
  f => [BUILDABLE.filter(k => f.units.some(u => u.kind === k)).length, BUILDABLE.length]);
count("Units", "top_gun", "Top Gun", 3, "One unit kills 3,000 infected in one battle.", f => Math.max(0, ...f.units.map(u => u.kills)), 3000);
battle("Units", "survivor", "Survivor", 3, "One unit kills 1,000 infected in a battle and is never destroyed.", f => f.units.some(u => u.kills >= 1000 && !u.lost),
  f => [Math.max(0, ...f.units.filter(u => !u.lost).map(u => u.kills)), 1000]);
count("Units", "long_shot", "Long Shot", 2, "Make a Sniper kill at 400 m or more.", f => f.counters.longShot, 400);
count("Units", "grenadier", "Grenadier", 2, "Paratrooper grenades kill 200 infected in one battle.", f => f.counters.grenadierKills, 200);

// Strikes (12): one single use reaches the number
const bestStrike = (f: BF, k: string) => Math.max(0, ...f.strikes.filter(s => s.kind === k).map(s => s.kills + (k === "para" ? s.dropKills : 0)));
const STRIKE_GOALS: [string, string, number, Tier][] = [["airstrike", "Danger Close", 300, 2], ["firebomb", "Firestorm", 300, 2], ["para", "Airborne", 500, 2],
  ["barrage", "Fire for Effect", 400, 2], ["moab", "Massive Ordnance", 1500, 3], ["nuke", "Ground Zero", 5000, 4], ["a10", "Gun Run", 250, 2],
  ["cluster", "Saturation", 400, 2], ["tomahawk", "Deep Strike", 300, 2], ["gunship", "Spectre", 600, 3]];
for (const [k, name, goal, tier] of STRIKE_GOALS)
  count("Strikes", `strike_${k}`, name, tier, k === "para"
    ? `One Paratroopers drop kills ${n(goal)} infected (the squads' kills over the battle).`
    : `One ${strikeName(k)} kills ${n(goal)} infected.`, f => bestStrike(f, k), goal);
count("Strikes", "strike_supply_drop", "Resupplied", 1, "Call in 10 Supply Drops in one battle.", f => f.strikes.filter(s => s.kind === "supply_drop").length, 10);
battle("Strikes", "clean_strike", "Clean Strike", 3, "One strike kills 500 or more infected with no civilian losses.", f => f.strikes.some(s => s.kills >= 500 && s.civ === 0),
  f => [Math.max(0, ...f.strikes.filter(s => s.civ === 0).map(s => s.kills)), 500]);

// Cities (14)
battle("Cities", "gold", "Gold Standard", 2, "Earn Gold or better.", f => atLeast(f.medal, "Gold"));
battle("Cities", "platinum", "Nobody Left Behind", 3, "Earn Platinum (75 points).", f => f.medal === "Platinum");
const campaignIds = () => C.CITIES.map(c => c.id);
const campaignWith = (c: CF, want: string) => campaignIds().filter(id => C.DIFFICULTY_IDS.some(d => atLeast(c.medals[`${id}@${d}`] ?? null, want))).length;
career("Cities", "campaign_bronze", "Campaign Bronze", 2, "Earn a medal on every campaign city.", c => campaignWith(c, "Bronze") >= campaignIds().length, c => [campaignWith(c, "Bronze"), campaignIds().length]);
career("Cities", "campaign_gold", "Campaign Gold", 3, "Earn Gold on every campaign city.", c => campaignWith(c, "Gold") >= campaignIds().length, c => [campaignWith(c, "Gold"), campaignIds().length]);
career("Cities", "campaign_platinum", "Campaign Platinum", 4, "Earn Platinum on every campaign city.", c => campaignWith(c, "Platinum") >= campaignIds().length, c => [campaignWith(c, "Platinum"), campaignIds().length]);
const anyAt = (c: CF, diff: string, want: string) => Object.entries(c.medals).some(([k, m]) => k.endsWith(`@${diff}`) && !k.startsWith("daily:") && atLeast(m, want));
career("Cities", "insane_medal", "Insane Medal", 3, "Earn a medal on Insane.", c => anyAt(c, "insane", "Bronze"));
career("Cities", "insane_gold", "Insane Gold", 4, "Earn Gold on Insane.", c => anyAt(c, "insane", "Gold"));
const realIds = () => C.REAL_CITIES.map(c => c.id);
const realWithMedal = (c: CF) => new Set(Object.entries(c.medals).filter(([, m]) => !!medalRank(m)).map(([k]) => k.split("@")[0].split("/")[0]).filter(id => realIds().includes(id))).size;
career("Cities", "tourist", "Tourist", 1, "Earn a medal on a real city (any area).", c => realWithMedal(c) >= 1);
career("Cities", "traveler", "Traveler", 2, "Earn medals on 5 different real cities.", c => realWithMedal(c) >= 5, c => [realWithMedal(c), 5]);
career("Cities", "globetrotter", "Globetrotter", 4, "Earn a medal on every real city in the game. The count grows as cities are added.",
  c => realIds().length > 0 && realWithMedal(c) >= realIds().length, c => [realWithMedal(c), realIds().length]);
battle("Cities", "daily", "Daily Duty", 1, "Complete a round in a Daily Challenge.", f => f.kind === "daily" && f.round && f.saved > 0);
career("Cities", "daily_week", "Daily Week", 3, "Complete the Daily Challenge 7 days in a row.", c => dailyStreak(c.dailyDone) >= 7, c => [dailyStreak(c.dailyDone), 7]);
career("Cities", "daily_platinum", "Daily Platinum", 3, "Earn Platinum in a Daily Challenge.", c => Object.entries(c.medals).some(([k, m]) => k.startsWith("daily:") && m === "Platinum"));
career("Cities", "around_the_clock", "Around the Clock", 3, "Earn medals with the sirens at night (22:00-04:00), in the morning rush (06:00-09:00), by day (09:00-17:00) and in the evening (17:00-22:00).",
  c => CLOCK.every(b => c.clockMedals.includes(b)), c => [CLOCK.filter(b => c.clockMedals.includes(b)).length, CLOCK.length]);

// Career (8)
ccount("Career", "career_kills_100k", "Hundred Thousand", 2, "Kill 100,000 infected across your career.", c => c.kills, 100000);
ccount("Career", "career_kills_1m", "One Million", 4, "Kill 1,000,000 infected across your career.", c => c.kills, 1000000);
ccount("Career", "career_saved_100k", "A City Saved", 2, "Save 100,000 people across your career.", c => c.saved, 100000);
ccount("Career", "career_saved_1m", "A Million Lives", 4, "Save 1,000,000 people across your career.", c => c.saved, 1000000);
ccount("Career", "career_battles_50", "Seasoned", 2, "Complete 50 battles.", c => c.completed, 50);
ccount("Career", "career_battles_250", "Veteran Commander", 3, "Complete 250 battles.", c => c.completed, 250);
ccount("Career", "career_lifts_10k", "Ten Thousand Lifts", 3, "Fly 10,000 evac lifts across your career.", c => c.lifts, 10000);
ccount("Career", "general", "General", 4, "Reach the top rank (General), outside Dev mode.", c => c.xp, RANKS[RANKS.length - 1][1]);

// Challenge (6)
// 0.62: Battle Events (the mutator)
const bevWon = (f: BF, kind: string) => f.bevents.some(e => e.kind === kind && e.won);
battle("Challenge", "bev_mayor", "Chain of Command", 2, "Battle Events: get the Mayor into a safe zone alive.", f => bevWon(f, "mayor"));
battle("Challenge", "bev_class", "Recess", 2, "Battle Events: save every child of a trapped class.", f => f.bevents.some(e => e.kind === "class" && e.won && e.frac >= 1));
battle("Challenge", "bev_research", "Research Continues", 2, "Battle Events: get the research team out (at least 3 of 4).", f => bevWon(f, "research"));
battle("Challenge", "bev_power", "Lights On", 2, "Battle Events: keep the power station running until the round ends.", f => bevWon(f, "power"));
battle("Challenge", "bev_all", "All Hands", 3, "Battle Events: win 3 events in one battle.", f => f.bevents.filter(e => e.won).length >= 3, f => [f.bevents.filter(e => e.won).length, 3]);
battle("Challenge", "ground_game", "Boots Only", 2, "Complete a round without calling in any strike.", f => f.round && f.saved > 0 && f.strikes.length === 0);
battle("Challenge", "ground_pounder", "Ground Pounder", 3, "Complete a round with no aircraft: no Apache, no Reaper, no strikes from the air (Artillery Barrage and Tomahawk are allowed).",
  f => f.round && f.saved > 0 && !f.units.some(u => u.kind === "apache" || u.kind === "reaper") && !f.strikes.some(s => AIR_STRIKES.includes(s.kind)));
battle("Challenge", "lean_force", "Lean Force", 3, "Earn Gold with 6 units or fewer (paratroopers not counted).", f => atLeast(f.medal, "Gold") && f.units.filter(u => u.kind !== "para").length <= 6);
battle("Challenge", "penny_pincher", "Penny Pincher", 3, "Earn a medal Under Budget on Insane.", f => !!f.medal && f.underBudget && f.difficulty === "insane");
battle("Challenge", "untouchable", "Untouchable", 4, "Earn Platinum with no breaches and no unit lost.", f => f.medal === "Platinum" && f.breaches === 0 && f.unitsLost === 0);
battle("Challenge", "insane_platinum", "Insane Platinum", 4, "Earn Platinum on Insane.", f => f.medal === "Platinum" && f.difficulty === "insane");

// People (5)
count("People", "families_1", "Whole Families I", 1, "Get 1,000 households out together in one battle.", f => f.town?.allOut ?? 0, 1000);
count("People", "families_2", "Whole Families II", 2, "Get 2,500 households out together in one battle.", f => f.town?.allOut ?? 0, 2500);
count("People", "families_3", "Whole Families III", 3, "Get 4,000 households out together in one battle.", f => f.town?.allOut ?? 0, 4000);
count("People", "talked_down", "Talked Down", 2, "Talk 200 refusers into leaving in one battle.", f => f.counters.talkedOut, 200);
battle("People", "nobody_refused", "Nobody Refused for Long", 3, "Complete a round with every refusing household talked out or gone by the end.",
  f => f.round && f.saved > 0 && !!f.town && f.town.refusedHouseholds > 0 && f.town.stillHome === 0 && f.town.lostAtHome === 0);
battle("People", "back_to_school", "Back to School", 4, "On Insane, every child who was at school when the sirens went reaches a zone.",
  f => f.round && f.difficulty === "insane" && !!f.town && (f.town.schoolKids ?? 0) > 0 && f.town.schoolKidsSafe === f.town.schoolKids);

export const ACHIEVEMENTS: AchDef[] = defs;
export const BY_ID: Record<string, AchDef> = Object.fromEntries(defs.map(d => [d.id, d]));
for (const [id, unit] of [["exterminator", "%"], ["hold_20", "min"], ["hold_40", "min"], ["long_shot", "m"], ["bill_100m", "$"], ["billion", "$"], ["bill_3b", "$"]] as const) BY_ID[id].unit = unit;
/** Ids from before 0.59 (their earned dates carry over). */
export const LEGACY_IDS = ["first_out", "round_one", "gold", "platinum", "evac_10k", "lifts_100", "hold_20", "waves_30", "kills_10k", "light_touch", "scorched",
  "no_losses", "ground_game", "billion", "nuclear", "daily"];

// ---------- facts ----------
export type ClockBucket = "night" | "morning" | "day" | "evening";
export const CLOCK: ClockBucket[] = ["night", "morning", "day", "evening"];
/** Siren time (minutes after midnight) to its bucket; 04:00-06:00 is none of them. */
export function clockBucket(min: number): ClockBucket | null {
  const h = ((min % 1440) + 1440) % 1440 / 60;
  if (h >= 22 || h < 4) return "night";
  if (h >= 6 && h < 9) return "morning";
  if (h >= 9 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return null;
}
/** The longest run of consecutive calendar days in a list of "YYYY-MM-DD". */
export function dailyStreak(dates: string[]): number {
  const days = [...new Set(dates)].map(d => Date.parse(d + "T00:00:00Z") / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0, run = 0;
  for (let i = 0; i < days.length; i++) { run = i && days[i] - days[i - 1] === 1 ? run + 1 : 1; if (run > best) best = run; }
  return best;
}

const ZERO_COUNTERS = (): RecCounters => Object.fromEntries(REC_COUNTER_KEYS.map(k => [k, 0])) as unknown as RecCounters;

export function factsFromRecord(r: BattleRecord): BattleFacts {
  const t = r.totals, o = r.outcome;
  const counters = r.counters ? { ...r.counters } : { ...ZERO_COUNTERS(), talkedOut: t.talkedOut, longShot: t.longShot, best60: t.best60, maxZone: t.maxZone }; // before 0.59: what the record kept
  return {
    kind: r.meta.kind, cityId: r.meta.cityId, difficulty: r.meta.difficulty, sirenMin: r.meta.sirenMin,
    round: o.roundComplete, medal: o.medal, mayhem: o.mayhem ?? 0, underBudget: !!o.underBudget, bonus: o.bonus ?? null, left: o.left ?? -1, refused: t.refused,
    saved: t.saved, byTrain: t.byTrain, lifts: t.lifts, liftsAborted: t.liftsAborted, kills: t.kills, hordes: t.hordes, held: t.held, breaches: t.breaches,
    damage: t.damage, intact: t.intact, nukes: t.nukes, bridges: t.bridges, civKilledByUs: t.civKilledByUs, unitsLost: t.unitsLost, counters,
    units: r.units.map(u => ({ kind: u.kind, kills: u.kills, lost: u.lostT >= 0 })),
    strikes: r.strikes.map(s => ({ kind: s.kind, kills: s.kills, civ: s.civ, dropKills: s.dropKills ?? 0 })),
    town: r.town?.summary ?? null, bevents: r.bevents ?? [],
  };
}

/** What the live check reads off the running battle (a structural slice of Sim, so tests can hand one in). */
export interface LiveSim {
  stats: Recorder; roundAt: number | null; roundDone: boolean; roundResult: Score | null; result: Score | null; time: number; difficulty: string; startMin: number;
  evacuated: number; trainsEvacuated: number; liftsFlown: number; liftsAborted: number; kills: number; wave: number; breaches: number; nukesUsed: number;
  blown: { size: number }; civKilledByUs: number;
}
/** The running battle's facts. Round-dependent numbers (medal, bonus, left) come only once the round has a result. */
export function factsLive(s: LiveSim, kind: BattleKind, cityId: string): BattleFacts {
  const r = s.stats, last = (c: keyof Recorder["cols"]) => { const a = r.cols[c]; return a.length ? a[a.length - 1] : 0; };
  const sc = s.result ?? (s.roundDone ? s.roundResult : null);
  return {
    kind, cityId, difficulty: s.difficulty, sirenMin: s.startMin,
    round: s.roundDone, medal: sc?.medal ?? null, mayhem: s.result?.mayhem ?? 0, underBudget: !!sc?.underBudget, bonus: sc?.bonus ?? null,
    left: sc ? sc.left ?? -1 : -1, refused: sc?.refused ?? 0,
    saved: Math.max(s.evacuated, sc?.saved ?? 0), byTrain: s.trainsEvacuated, lifts: s.liftsFlown, liftsAborted: s.liftsAborted, kills: s.kills, hordes: s.wave,
    held: Math.max(0, s.time - C.WARNING_S), breaches: s.breaches,
    damage: sc?.damage ?? last("damage"), intact: sc?.intact ?? (r.cols.intact.length ? last("intact") : 100), nukes: s.nukesUsed, bridges: s.blown.size,
    civKilledByUs: s.civKilledByUs, unitsLost: r.units.filter(u => u.lostT >= 0).length, counters: recCounters(r, s.roundAt),
    units: r.units.map(u => ({ kind: u.kind, kills: u.kills, lost: u.lostT >= 0 })),
    strikes: r.strikes.map(x => ({ kind: x.kind, kills: x.kills, civ: x.civ, dropKills: x.dropKills ?? 0 })),
    town: null, bevents: s.stats.bevents ?? [],
  };
}

/** Legacy medals (from save.best / save.daily before 0.59) as "<cityId>@<difficulty>" / "daily:<date>" keys. */
export function seedLegacy(best: Record<string, { medal?: string | null }>, daily: Record<string, { medal?: string | null }> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(best)) if (v?.medal) out[k.includes("@") ? k : `${k}@medium`] = v.medal;
  for (const [d, v] of Object.entries(daily ?? {})) out[`daily:${d}`] = v?.medal ?? "none";
  return out;
}

/** The career facts: the career totals plus medals from counting battles and the legacy medals. */
export function careerFacts(c: Career, history: History | null, legacy: Record<string, string> | undefined, xp: number): CareerFacts {
  const medals: Record<string, string> = {}, daily = new Set<string>(), clock = new Set<string>();
  const put = (k: string, m: string | null) => { if (m && m !== "none" && medalRank(m) > medalRank(medals[k])) medals[k] = m; };
  for (const [k, m] of Object.entries(legacy ?? {})) {
    if (k.startsWith("daily:")) { daily.add(k.slice(6)); put(k, m); }
    else put(k.includes("@") ? k : `${k}@medium`, m);
  }
  for (const b of history?.battles ?? []) {
    if (!countsInCareer(b)) continue;
    if (b.meta.kind === "daily") {
      const d = b.meta.cityId.replace(/^daily:/, "");
      if (b.outcome.roundComplete && b.totals.saved > 0) daily.add(d);
      put(`daily:${d}`, b.outcome.medal);
    } else put(`${b.meta.cityId}@${b.meta.difficulty}`, b.outcome.medal);
    if (b.outcome.medal) { const cb = clockBucket(b.meta.sirenMin); if (cb) clock.add(cb); }
  }
  return { kills: c.kills, saved: c.saved, completed: c.completed, lifts: c.lifts, killsByKind: { ...c.killsByKind }, xp, medals, dailyDone: [...daily], clockMedals: [...clock] };
}

/** Achievements of one scope met now and not already held. */
export function newlyEarned(scope: "battle", f: BattleFacts, have: Record<string, string>): AchDef[];
export function newlyEarned(scope: "career", f: CareerFacts, have: Record<string, string>): AchDef[];
export function newlyEarned(scope: "battle" | "career", f: BattleFacts | CareerFacts, have: Record<string, string>): AchDef[] {
  return defs.filter(d => d.scope === scope && !have[d.id] && safeTest(d, f));
}
function safeTest(d: AchDef, f: unknown): boolean { try { return !!d.test(f); } catch { return false; } }

/** Progress toward each achievement: battle ones from the best counting battle, career ones from the career. */
export function progressAll(history: History | null, cf: CareerFacts | null): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const facts = (history?.battles ?? []).filter(countsInCareer).map(factsFromRecord);
  for (const d of defs) {
    if (!d.progress) continue;
    if (d.scope === "career") { if (cf) out[d.id] = clampP(d.progress(cf)); continue; }
    let best: [number, number] | null = null;
    for (const f of facts) { const p = clampP(d.progress(f)); if (!best || p[0] > best[0]) best = p; }
    if (best) out[d.id] = best;
  }
  return out;
}
const clampP = (p: [number, number]): [number, number] => [Number.isFinite(p[0]) ? Math.max(0, p[0]) : 0, p[1]];
