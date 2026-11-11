// All balance numbers in one place. Distances are in cells; one cell is CELL_M meters.
export let CELL_M = 2;
export let MAP_W = 480; // cells (960 m)
export let MAP_H = 360; // cells (720 m)
export let REAL_MAP_W = 560; // real-world OSM city width in cells (1,120 m)
export let REAL_MAP_H = 420; // real-world OSM city height in cells (840 m)
export let TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

// Highway & Mass Transit mechanics
export let HIGHWAY_SPEED_MUL = 1.25; // +25% movement speed along Interstate / Expressway corridors
export let RAIL_SPEED_MUL = 1.12;    // +12% movement speed along graded Mass Transit rail beds
export let TRAIN_EVERY_S = 35;       // Mass Transit evacuation train interval during battle
export let TRAIN_FIRST_S = 18;       // First transit train arrival
export let TRAIN_SPEED = 24;         // cells/s (48 m/s commuter/metro consist)
export let TRAIN_CRUSH_DMG = 2500;   // lethal impact damage to infected on the tracks
export let TRAIN_BOARD_RADIUS = 9;   // 18 m civilian boarding radius around stations/tracks
export let TRAIN_CAPACITY = 60;      // people carried out per train run (x crowd size)
export let TRAIN_BONUS_PER_CIV = 24_000; // dollars per passenger, same as an Evac Point lift

export let CIVILIANS = 15000;
export let OUTBREAK_SITES = 4;
export let INFECTED_PER_SITE = 12;
export let OUTBREAK_MIN_ZONE_DIST = 10; // minimum distance in cells from a safe zone for initial outbreak sites
// Battle flow (0.21): 20 s warning, hidden one-time outbreak outside the safe zones, then storyteller hordes walking
// in from outside along real entry routes, ramping with time and how empty the city is.
export let WARNING_S = 20; // seconds of warning before the first cases turn (was 45; the game is a horde/tower defense, not an evacuation sim)
export let WAVE_BASE = 150;
export let WAVE_WARN_S = 10; // the entry route is shown this long before a horde arrives
export let WAVE_MARCH_S = 6; // a horde walks in over this many seconds (a column, not a pop-in)
export let HORDE_SIZE_POW = 1.5; // exponent on (1 + heat) for horde size growth
export let HORDE_SIZE_JITTER = 0.25; // uniform +/- jitter on each horde size roll
export let HORDE_BIG_CHANCE = 0.1; // chance a horde is a "big one"
export let HORDE_BIG_MUL = 2; // size multiplier for a "big one" horde
export let HORDE_ROUTE_HEAT = 2; // +1 simultaneous entry route per this much heat (max 4)

export type Difficulty = "easy" | "medium" | "hard" | "insane";
export const DIFFICULTY_IDS: Difficulty[] = ["easy", "medium", "hard", "insane"];
export interface DifficultyDef {
  name: string;
  gapMin: number;
  gapMax: number;
  gapFloor: number;
  sizeMul: number;
  rampPerMin: number;
  emptyHeat: number;
  gapHeat: number;
  toughMul: number;
  sitesMul: number;
  xpMul: number;
  spreadMin: number; spreadMax: number; spreadS: number; // 0.24: extra outbreaks rolled after the first cases, inside spreadS seconds
  runnerPct: number; // 0.30: share of infected that sprint (the rest shamble)
}
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy:   { name: "Easy",   gapMin: 30, gapMax: 45, gapFloor: 14, sizeMul: 0.6, rampPerMin: 0.15, emptyHeat: 1,   gapHeat: 0.3, toughMul: 0.6, sitesMul: 0.5, xpMul: 0.75, spreadMin: 1, spreadMax: 2, spreadS: 15, runnerPct: 5 },
  medium: { name: "Medium", gapMin: 20, gapMax: 35, gapFloor: 10, sizeMul: 1,   rampPerMin: 0.25, emptyHeat: 1.5, gapHeat: 0.4, toughMul: 1,   sitesMul: 1,   xpMul: 1, spreadMin: 2, spreadMax: 4, spreadS: 20, runnerPct: 15 },
  hard:   { name: "Hard",   gapMin: 15, gapMax: 26, gapFloor: 7,  sizeMul: 1.4, rampPerMin: 0.4,  emptyHeat: 2,   gapHeat: 0.5, toughMul: 1.3, sitesMul: 1.5, xpMul: 1.25, spreadMin: 3, spreadMax: 6, spreadS: 25, runnerPct: 30 },
  insane: { name: "Insane", gapMin: 10, gapMax: 18, gapFloor: 5,  sizeMul: 2,   rampPerMin: 0.6,  emptyHeat: 3,   gapHeat: 0.6, toughMul: 1.7, sitesMul: 2,   xpMul: 1.5, spreadMin: 5, spreadMax: 8, spreadS: 30, runnerPct: 50 },
};

// 0.20 round score and Keep fighting. Tuned often: keep them here.
export let EVAC_COST_MUL = 2; // each extra evac pad costs this many times the last
export let EVAC_PAR_S = 300; // full speed points if the city empties within this long after the outbreak (0 at 3x)
export let SCORE_W_SAVED = 0.55; // round score weights (normalized by their sum)
export let SCORE_W_SPEED = 0.15;
export let SCORE_W_CITY = 0.15;
export let SCORE_W_KILLS = 0.15;
export let MEDAL_MIN_SAVED_PCT = 5; // no medal below this share saved, whatever the other parts add up to
export let ROUND_STRAGGLERS_PCT = 1; // round also ends when at most this share of people is left and nothing moves...
export let ROUND_STALL_S = 60; // ...for this long (no lift, nobody reaching a zone)
export let MAYHEM_DAMAGE_PER_POINT = 100_000; // Keep fighting: one Mayhem point per this much city damage
export let MAYHEM_XP_PER_KILL = 0.1; // Keep fighting: XP per kill after the round
export let INTACT_BONUS_PCT = 90; // city at least this intact at the end: Light Touch bonus
export let SCORCHED_BONUS_PCT = 35; // at least this much of the city wrecked: Scorched Earth bonus
export let BONUS_XP = 250;
// Evacuation: the score. Evac Points fly people out of the zone; trains carry them out on the rails.
export let EVAC_EVERY_S = 12; // seconds between lifts at one Evac Point
export let EVAC_CAP = 80; // people per lift (x crowd size)
export let EVAC_PAY = 24_000; // federal evacuation funding per person flown out (same money at any crowd size)
export let EVAC_ABORT_INF = 8; // this many infected near the pad and the lift waves off
export let SOUND_NEAR_ZOOM = 0.5; // 0.22: zombie and crowd sounds are silent until zoomed in past this (0 = all the way out, 1 = all the way in)
export let EVAC_WALK_MUL = 0.8; // 0.22: people in a zone walk to the nearest Evac Point (any distance, along the zone's streets) at this x CIV_SPEED
export let MILL_MAX_DENS = 24; // 0.30: people inside a zone don't step into a cell holding more than this (6 per m2)
export let WAIT_RHO = 3; // 0.30: people/m2 in the crowd waiting at an Evac Point (its area grows with the crowd)
export let EVAC_GATHER_D = 6; // cells from the pad where they stop and wait for the lift
export let AGENT_RESERVE = 25000; // slots for infected beyond the civilians

export let CIV_SPEED = 0.67; // cells per second: 0.30: a real walk, 1.34 m/s (was 2.8, a sprint)
export let CIV_SPRINT = 2.5; // 0.30: cells per second for a panicked person running flat out (5 m/s)
export let WALK_SPREAD = 0.13; // 0.30: people's own walking pace varies by about this fraction
// 0.30 crowd model (meters and seconds unless noted). Social force (Helbing) + time-to-collision power law
// (Karamouzas 2014) + Weidmann speed-density curve.
export let CROWD_TAU = 0.5; // s: how fast a calm person reaches the speed and heading they want
export let PANIC_TAU = 0.3; // s: the same, panicked
export let BODY_R = 0.25; // m: a calm person's comfort radius (shoulders plus a little space)
export let PANIC_BODY_R = 0.17; // m: panicked people press closer
export let TTC_K = 1.5; // time-to-collision strength (Karamouzas: 1.5)
export let TTC_FOLLOW = 0.7; // how much less people brake for someone ahead walking the same way (queues keep short gaps)
export let SPEED_RHO_CELL = 1; // 1: speed from the density where they're stepping; 0: from the 3x3 cells around them
export let TTC_T0 = 3; // s: how far ahead people look for collisions (Karamouzas: 3)
export let SPACE_A = 3; // m/s2: personal-space push at contact
export let SPACE_B = 0.3; // m: how fast that push fades with distance
export let CROWD_PRESS = 3; // m/s2: a packed cell pushes people toward emptier neighbors
export let PRESS_DENS = 0.5; // people/m2 before that push starts (queues at a door pack to 3 or 4)
export let WALL_A = 6; // m/s2: push off a building at contact
export let WALL_RANGE = 0.6; // m: buildings push people within this distance
export let WALL_MIN = 0.18; // m: a person's center never gets closer than this to a wall
export let RHO_MAX = 5.4; // people/m2 where a calm crowd stops (Weidmann)
export let RHO_GAMMA = 1.913; // Weidmann curve shape
export let PANIC_RHO_MAX = 9; // people/m2 a panicked crowd will press to
export let AIM_SWAY = 0.3; // rad: people weave a little around the route direction, each at their own slow pace
export let FEAR_RISE = 4; // 1/s: how fast fear rises to what a person senses
export let FEAR_FADE_S = 15; // s: how long fear takes to fade once it's quiet
export let FEAR_SPREAD = 0.55; // share of the fear around them that people catch (panic is contagious)
export let FEAR_GRID_HALF = 2; // s: half-life of a scare in the air (gunfire, blasts) on the fear grid
export let HERD_MAX = 0.6; // panicked people follow those around them this much instead of their own route (Helbing)
export let PANIC_ODD_RATE = 0.08; // per second, for a panicked person: run the wrong way or freeze
export let PANIC_CLOG = 1.5; // how badly a panicked push jams a packed opening (faster is slower)
export let CLOG_RHO = 2; // people/m2 where that starts
export let CRUSH_RHO = 5; // people/m2 above which a pushing crowd starts crushing people
export let CRUSH_S = 2.5; // s of crush before someone is knocked down
export let DOWN_S = 6; // s a knocked-down person stays down (trampled to death if the crush goes on)
export let SHOVE = 3; // cells/s: how hard a close blast throws people away from it
export let NOISE_HALF = 6; // s: half-life of noise that draws infected (gunfire, explosions)
export let NOISE_MIN = 0.12; // infected follow noise above this level
export let NOISE_STRAGGLER = 7; // one infected in this many ignores noise and keeps after the people
export let FAMILY_PCT = 70; // share of people walking with family or friends (Moussaid 2010: about 70%)
export let INF_SPEED = 1.9;
export let SHAMBLER_MUL = 0.45; // 0.30: shamblers move at this x INF_SPEED (about 1.7 m/s)
export let RUNNER_MUL = 1.35; // 0.30: runners at this x INF_SPEED (about 5 m/s, a sprint)
export let INF_WALL_PUSH = 1.5; // 0.30: how hard infected keep off building walls
export let INF_SWAY = 0.3; // 0.30: rad: how far infected weave around their way
export let INF_SPEED_GROWTH = 0.004; // per second of battle, multiplicative-ish
export let INF_HP = 100;
export let INF_HP_GROWTH = 0.004; // +0.4% per second of battle
export let CIV_JAM_DENS = 4; // people per cell before a crowd starts to jam (gates, bridges, narrow streets)
export let GATE_CLEAR_DEPTH = 6; // 0.28: people inside the zone keep walking inward at full pace until this many cells past the gate
export let GRAIN_PUSH = 0.9; // 0.28: how hard people in one cell push apart from each other (sand-grain spreading)
export let INF_LUNGE_MUL = 1.2; // infected with a live person in sight surge this much faster
export let KITE_R = 0.45; // mobile units back off when infected get within this fraction of their range
export let INF_SENSE = 14; // cells: how far infected notice a civilian (0.10: single-minded, 9 before)
export let CIV_SENSE = 6; // cells: how far civilians notice infected
export let BITE_RANGE = 0.9;
export let BITE_CHANCE = 0.2; // per tick in range
export let SAFE_BITE_MUL = 0.1; // inside a zone people barricade indoors: bites land a tenth as often
export let WALL_DPS = 4; // wall HP removed per second per infected touching it
export let WALL_MAX_ATTACKERS = 8; // only this many infected can claw at one wall cell at a time
export let WALL_HP = 8000;

// Money is real US dollars (0.14). Ground hardware and
// helicopters cost their unit price; ships and jets cost the mission (tasking or sortie with its munitions).
export let START_BUDGET = 25_000_000;
// Every starting budget (free play and each city) is doubled, then grows with the crowd size: hordes scale with
// the population, so a 200k crowd needs more than a 15k one. Square root keeps 200k (13x the people) at about 3.7x.
export let START_BUDGET_MUL = 2;
export const startBudget = (base: number, civilians: number) => Math.round(base * START_BUDGET_MUL * Math.sqrt(Math.max(1, civilians / CIVILIANS)));
export let ZONE_BASE_COST = 2_000_000;
export let ZONE_COST_PER_CELL = 1_100; // per enclosed cell (4 m^2): barricades, wire, checkpoints
// Every safe zone after the first costs much more.
export let EXTRA_ZONE_BASE = 6_000_000;
export let EXTRA_ZONE_PER_CELL = 2_200;
// Battle income: paid every INCOME_EVERY_S, per survivor in the zones, plus a bounty per kill.
export let INCOME_EVERY_S = 10;
export let INCOME_PER_SAFE = 180; // dollars per sheltered person per 10 s (emergency aid)
export let KILL_BOUNTY = 1_000;
export let EXTRACT_MUL = 1.5; // selling mid-battle: the unit sits out 1.5x its deploy time (at least 5 s) before it is pulled out
export let CRUSH_SLOW_S = 0.8; // 0.25: seconds a tank or APC stays slowed after crushing infected
export let CRUSH_YIELD_MUL = 0.3; // speed when civilians are in its way (it never runs people over)
/** 0.27: extra steps the Evac Point route charges for squeezing past a unit that plugs a street (so people walk around one when they can). */
export let SQUEEZE_COST = 30;
export let MOBILE_HURT_DPS = 6; // per infected touching an APC or squad
export let GATE_HP = 3000; // gates let civilians in but break sooner than walls (WALL_HP)

export type UnitKind = "garrison" | "sniper" | "turret" | "mortar" | "howitzer" | "himars" | "apc" | "tank" | "gunboat" | "battleship" | "apache" | "reaper" | "para" | "police" | "militia";
/** Units the player can build directly (paratroopers arrive by ability; police and militia spawn from support buildings). */
export const BUILDABLE: UnitKind[] = ["garrison", "sniper", "turret", "mortar", "howitzer", "himars", "apc", "tank", "gunboat", "battleship", "apache", "reaper"];

export interface UnitSpec {
  name: string;
  foot: number; // 0.23: placement footprint, cells per side (matches how big it is drawn); footprints may not overlap
  cost: number;
  deploy: number; // seconds to set up when bought mid-battle (stronger units take longer)
  on: "building" | "ground" | "water" | "zone" | "any"; // zone: any cell inside a safe zone (air units take off from there)
  /** Mobile units think for themselves: speed in cells/s, hit points, how far they roam from where you put them. */
  crushSlow?: number; // 0.25: drives over infected and crushes them; speed kept while crushing (1 = no slowdown)
  clawMul?: number; // 0.25: share of claw damage that gets through its armor
  hp?: number; // 0.24: emplacements on the street have armor too (infected claw at them); mobile units use mobile.hp
  mobile?: { speed: number; hp: number; leash: number; nav: "road" | "water" | "air"; flee: number; rearmS?: number }; // air: flies straight over everything, out of reach
  splash?: number; // cells: blast radius (infected only)
  minRange?: number; // cells: can't hit closer than this
  maxHits?: number; // most infected one shell can hit (a packed crowd shields itself)
  salvo?: number; // shells per volley, scattered around the target (battleship broadsides)
  /** A second, slower gun with a small blast (APC autocannon). Fires on its own timer, uses the same ammo. */
  cannon?: { range: number; rate: number; damage: number; splash: number; maxHits: number };
  range: number; // cells, before roof bonus
  roofBonus: number; // extra cells of range per building height level
  rate: number; // shots per second
  damage: number;
  ammo: number; // rounds when outside the safe zone (or magazine for turret)
  reloadsInZone: boolean;
  color: string;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  garrison: {
    name: "Garrison", foot: 2, cost: 1_200_000, deploy: 5, on: "building", range: 16, roofBonus: 0.5,
    rate: 8, damage: 100, ammo: 800, reloadsInZone: true, color: "#4fc3f7",
  },
  sniper: {
    name: "Sniper", foot: 2, cost: 800_000, deploy: 6, on: "building", range: 22, roofBonus: 2.5,
    rate: 1.2, damage: 1000, ammo: 80, reloadsInZone: true, color: "#ffd54f",
  },
  turret: {
    name: "Turret", hp: 1200, foot: 2, cost: 1_100_000, deploy: 8, on: "ground", range: 14, roofBonus: 0,
    rate: 16, damage: 60, ammo: 1800, reloadsInZone: false, color: "#ff8a65",
  },
  mortar: {
    name: "Mortar", hp: 800, foot: 2, cost: 1_500_000, deploy: 10, on: "ground", range: 48, roofBonus: 0,
    rate: 0.25, damage: 400, ammo: 60, reloadsInZone: true, color: "#c792ea", splash: 2.2, minRange: 8, maxHits: 12,
  },
  howitzer: {
    name: "Howitzer", hp: 1600, foot: 3, cost: 3_700_000, deploy: 20, on: "ground", range: 130, roofBonus: 0,
    rate: 0.1, damage: 600, ammo: 30, reloadsInZone: true, color: "#f48fb1", splash: 4, minRange: 20, maxHits: 30,
  },
  apc: {
    name: "APC", crushSlow: 0.55, clawMul: 0.25, foot: 3, cost: 4_900_000, deploy: 8, on: "ground", range: 13, roofBonus: 0,
    rate: 9, damage: 100, ammo: 300, reloadsInZone: false, color: "#80cbc4",
    cannon: { range: 17, rate: 1.2, damage: 350, splash: 1.4, maxHits: 6 },
    mobile: { speed: 7, hp: 900, leash: 50, nav: "road", flee: 7 },
  },
  himars: {
    name: "HIMARS", hp: 2000, foot: 4, cost: 5_100_000, deploy: 18, on: "ground", range: 230, roofBonus: 0,
    rate: 1 / 14, damage: 900, ammo: 12, reloadsInZone: true, color: "#ff80ab", splash: 3.5, minRange: 30, maxHits: 20, salvo: 6,
  },
  tank: {
    name: "M1 Abrams", crushSlow: 0.8, clawMul: 0.08, foot: 4, cost: 10_000_000, deploy: 15, on: "ground", range: 15, roofBonus: 0,
    rate: 10, damage: 100, ammo: 1200, reloadsInZone: false, color: "#a1887f",
    cannon: { range: 20, rate: 0.35, damage: 1800, splash: 2.5, maxHits: 14 },
    mobile: { speed: 4.5, hp: 3000, leash: 60, nav: "road", flee: 16 },
  },
  apache: {
    name: "AH-64 Apache", foot: 3, cost: 35_000_000, deploy: 12, on: "zone", range: 16, roofBonus: 0,
    rate: 10, damage: 140, ammo: 1200, reloadsInZone: false, color: "#dce775",
    cannon: { range: 22, rate: 0.7, damage: 500, splash: 2, maxHits: 8 },
    mobile: { speed: 10, hp: Infinity, leash: 80, nav: "air", flee: 999, rearmS: 15 },
  },
  reaper: {
    name: "MQ-9 Reaper", foot: 3, cost: 16_000_000, deploy: 10, on: "zone", range: 32, roofBonus: 0,
    rate: 0.35, damage: 1200, ammo: 8, reloadsInZone: false, color: "#b0bec5", splash: 2.5, maxHits: 10,
    mobile: { speed: 6, hp: Infinity, leash: 130, nav: "air", flee: 999, rearmS: 12 },
  },
  gunboat: {
    name: "Gunboat", foot: 4, cost: 9_000_000, deploy: 12, on: "water", range: 18, roofBonus: 0,
    rate: 6, damage: 120, ammo: Infinity, reloadsInZone: false, color: "#90caf9",
    mobile: { speed: 4.5, hp: Infinity, leash: 90, nav: "water", flee: 999 },
  },
  battleship: {
    name: "Battleship", foot: 5, cost: 12_000_000, deploy: 25, on: "water", range: 200, roofBonus: 0,
    rate: 0.3, damage: 900, ammo: Infinity, reloadsInZone: false, color: "#b0bec5", splash: 4, minRange: 12, maxHits: 25, salvo: 3,
    mobile: { speed: 1.8, hp: Infinity, leash: 120, nav: "water", flee: 999 },
  },
  para: {
    name: "Paratroopers", foot: 2, cost: 0, deploy: 0, on: "any", range: 15, roofBonus: 0,
    rate: 10, damage: 100, ammo: 450, reloadsInZone: false, color: "#a5d6a7",
    mobile: { speed: 2.4, hp: 350, leash: 35, nav: "road", flee: 4 },
  },
  police: {
    name: "Police Squad", foot: 2, cost: 0, deploy: 0, on: "any", range: 14, roofBonus: 0,
    rate: 7, damage: 110, ammo: 350, reloadsInZone: false, color: "#64b5f6",
    mobile: { speed: 3.2, hp: 450, leash: 55, nav: "road", flee: 5 },
  },
  militia: {
    name: "Militia", foot: 2, cost: 0, deploy: 0, on: "any", range: 15, roofBonus: 0,
    rate: 5, damage: 90, ammo: 300, reloadsInZone: false, color: "#aed581",
    mobile: { speed: 2.6, hp: 300, leash: 40, nav: "road", flee: 4 },
  },
};

export type SupportKind = "evac" | "budget" | "repair" | "radio" | "supply" | "command" | "police" | "militia";
export const SUPPORT_KINDS: SupportKind[] = ["evac", "budget", "repair", "radio", "supply", "command", "police", "militia"];
export interface SupportSpec {
  name: string;
  foot: number; // 0.23: placement footprint, cells per side
  cost: number;
  deploy: number;
  radius: number; // cells
  color: string;
  hint: string;
}
export const SUPPORTS: Record<SupportKind, SupportSpec> = {
  evac: {
    name: "Evac Point", foot: 4, cost: 3_000_000, deploy: 10, radius: 12, color: "#fff176",
    hint: "Click a building inside your safe zone. A rooftop helipad: every 12 s a lift flies people out of the zone. Each person evacuated is saved for good and brings $24,000 in federal evacuation funding. Lifts wave off when infected crowd the pad.",
  },
  budget: {
    name: "Budget Office", foot: 4, cost: 1_000_000, deploy: 6, radius: 50, color: "#ffd54f",
    hint: "Click a building inside your safe zone. Cuts the cost of units and support buildings placed within 100 m by 20%.",
  },
  repair: {
    name: "Repair Yard", foot: 4, cost: 1_800_000, deploy: 8, radius: 45, color: "#4dd0e1",
    hint: "Click a building inside your safe zone. Continuously repairs damaged walls, gates and friendly vehicles within 90 m.",
  },
  radio: {
    name: "Radio Tower", foot: 4, cost: 2_000_000, deploy: 8, radius: 65, color: "#80deea",
    hint: "Click a building inside your safe zone. Expands the firing range of all units within 130 m by 40%.",
  },
  supply: {
    name: "Supply Depot", foot: 4, cost: 2_000_000, deploy: 8, radius: 50, color: "#ffb74d",
    hint: "Click a building inside your safe zone. Feeds ammo to turrets, mobile squads and forward units outside the walls within 100 m, and halves vehicle reload time.",
  },
  command: {
    name: "Command Post", foot: 4, cost: 2_400_000, deploy: 10, radius: 50, color: "#ba68c8",
    hint: "Click a building inside your safe zone. Boosts firing rate by 30% and extends patrol range by 25% for units within 100 m.",
  },
  police: {
    name: "Precinct", foot: 4, cost: 2_600_000, deploy: 10, radius: 55, color: "#64b5f6",
    hint: "Click a building inside your safe zone. Dispatches up to 2 autonomous Police Squads that hunt infected and return to reload.",
  },
  militia: {
    name: "Armory", foot: 4, cost: 2_200_000, deploy: 8, radius: 45, color: "#aed581",
    hint: "Click a building inside your safe zone. Arms up to 2 Militia squads that guard the walls, and reinforces indoor barricades within 90 m. Up to 4 Armories per battle.",
  },
};
export let MILITIA_MAX = 4; // 0.22: most Armories per battle
export let BUDGET_DISCOUNT = 0.2;
export let REPAIR_WALL_HPS = 30;
export let REPAIR_UNIT_HPS = 25;
export let RADIO_RANGE_MUL = 1.4;
export let SUPPLY_AMMO_RATE = 0.08; // fraction of magazine restored per second
export let COMMAND_RATE_MUL = 1.3;
export let COMMAND_LEASH_MUL = 1.25;
export let POLICE_MAX_SQUADS = 2, POLICE_SPAWN_S = 35;
export let MILITIA_MAX_SQUADS = 2, MILITIA_SPAWN_S = 30, MILITIA_BITE_MUL = 0.5;

// Medal thresholds on % of civilians evacuated (0.10: only people flown or carried out count).
export const MEDALS: [string, number, string][] = [
  ["Platinum", 75, "#b3e5fc"],
  ["Gold", 50, "#ffd54f"],
  ["Silver", 30, "#cfd8dc"],
  ["Bronze", 10, "#d7a26b"],
];


// Swimmer mutants: pink, high-HP infected that swim across rivers and canals, bypassing blown bridges.
export let SWIMMER_HP_MUL = 3.5;
export let SWIMMER_SPEED_LAND = 1.05;
export let SWIMMER_SPEED_WATER = 0.85;
export let SWIMMER_WAVE_START = 2; // wave index (0-based, so wave #3) where swimmers begin appearing naturally
export let SWIMMER_BASE_FRAC = 0.08;
export let SWIMMER_WAVE_GROWTH = 0.015;
export let SWIMMER_MAX_FRAC = 0.25;

export const VERSION = "0.30.0";

/** The campaign: fixed cities that unlock in order (a medal on one opens the next). */
export interface CityDef { id: string; name: string; seed: number; budget: number; waveMul: number; sites: number; speedMul: number; blurb: string; real?: boolean; trial?: string } // trial: hardware this city lends you before you unlock it
export const CITIES: CityDef[] = [
  { id: "ashford", name: "Ashford", seed: 7, budget: 30_000_000, waveMul: 0.6, sites: 2, speedMul: 0.9, blurb: "A quiet river town. Small hordes, a generous budget. Learn the ropes." },
  { id: "millbrook", trial: "howitzer", name: "Millbrook", seed: 42, budget: 27_000_000, waveMul: 0.8, sites: 3, speedMul: 0.95, blurb: "Mill towns sit low. Find the tall buildings for your snipers." },
  { id: "harrow-bay", trial: "barrage", name: "Harrow Bay", seed: 1234, budget: 24_000_000, waveMul: 1, sites: 4, speedMul: 1, blurb: "A normal day in a normal city. Until it isn't." },
  { id: "lowmoor", trial: "tank", name: "Lowmoor", seed: 2024, budget: 24_000_000, waveMul: 1.15, sites: 4, speedMul: 1.05, blurb: "The hordes come bigger here. Walls matter." },
  { id: "redwater", trial: "himars", name: "Redwater", seed: 31337, budget: 22_000_000, waveMul: 1.3, sites: 5, speedMul: 1.05, blurb: "Less money, more teeth. Every dollar has to fire." },
  { id: "granite-falls", trial: "apache", name: "Granite Falls", seed: 555, budget: 22_000_000, waveMul: 1.45, sites: 5, speedMul: 1.1, blurb: "The bridges are the battle. Hold them or lose them." },
  { id: "port-kessel", trial: "battleship", name: "Port Kessel", seed: 9001, budget: 20_000_000, waveMul: 1.6, sites: 6, speedMul: 1.1, blurb: "A crowded port and a thin budget. Choose who you can save." },
  { id: "cinder-hill", trial: "gunship", name: "Cinder Hill", seed: 666, budget: 18_000_000, waveMul: 1.8, sites: 7, speedMul: 1.15, blurb: "The last city. Nobody expects you to hold it." },
];

/** Real-world OpenStreetMap cities, baked into the bundle for instant offline play. */
export const REAL_CITIES: CityDef[] = [
  { id: "castle-rock", trial: "reaper", name: "Castle Rock, CO", seed: 80104, budget: 20_000_000, waveMul: 0.85, sites: 3, speedMul: 0.95, real: true, blurb: "Downtown Castle Rock along Plum Creek and Wilcox Street. Open avenues, low roofs." },
  { id: "denver", trial: "a10", name: "Denver, CO", seed: 80202, budget: 60_000_000, waveMul: 1.3, sites: 4, speedMul: 1.0, real: true, blurb: "Confluence Park and Lower Downtown where Cherry Creek meets the South Platte River." },
  { id: "portland", trial: "cluster", name: "Portland, OR", seed: 97204, budget: 50_000_000, waveMul: 1.3, sites: 4, speedMul: 1.0, real: true, blurb: "Tight downtown blocks split down the middle by the wide Willamette River." },
  { id: "boston", trial: "tomahawk", name: "Boston, MA", seed: 2108, budget: 90_000_000, waveMul: 1.7, sites: 4, speedMul: 1.05, real: true, blurb: "Beacon Hill, Boston Common and the Charles River Esplanade." },
  { id: "chicago", trial: "command", name: "Chicago, IL", seed: 60601, budget: 150_000_000, waveMul: 2.2, sites: 5, speedMul: 1.05, real: true, blurb: "The Loop and the Chicago River Y-branch. Deep canyon streets and high-rise sniper perches." },
  { id: "pittsburgh", trial: "moab", name: "Pittsburgh, PA", seed: 15222, budget: 70_000_000, waveMul: 1.6, sites: 5, speedMul: 1.08, real: true, blurb: "The Golden Triangle at Point State Park. Three rivers and a web of steel bridges." },
  { id: "paris", trial: "police", name: "Paris, France", seed: 75004, budget: 180_000_000, waveMul: 2.6, sites: 6, speedMul: 1.1, real: true, blurb: "Ile de la Cite and the Seine. Fortify the island or hold the Left and Right Banks." },
  { id: "manhattan", trial: "nuke", name: "Manhattan, NY", seed: 10038, budget: 250_000_000, waveMul: 3.0, sites: 6, speedMul: 1.12, real: true, blurb: "Lower Manhattan by the Brooklyn Bridge. Skyscrapers, dense crowds and relentless waves." },
];
export const ALL_CITIES: CityDef[] = [...CITIES, ...REAL_CITIES];

/** Battle mutators: optional rule modifiers for custom runs and Daily Challenges. */
export type MutatorId = "titan_strain" | "swimmer_surge" | "blitz_hordes" | "supply_shortage" | "fragile_walls" | "blood_money";
export const MUTATOR_IDS: MutatorId[] = ["titan_strain", "swimmer_surge", "blitz_hordes", "supply_shortage", "fragile_walls", "blood_money"];
export interface MutatorSpec {
  id: MutatorId;
  name: string;
  short: string;
  desc: string;
  color: string;
}
export const MUTATORS: Record<MutatorId, MutatorSpec> = {
  titan_strain: {
    id: "titan_strain", name: "Titan Strain", short: "2.5x HP, +35% budget",
    desc: "Infected have 2.5x HP, but your starting budget is 35% higher.", color: "#ff8a65",
  },
  swimmer_surge: {
    id: "swimmer_surge", name: "Amphibious Surge", short: "35% Swimmers, -25% boats",
    desc: "35% of every horde wave are Swimmer mutants from wave 1. +20% starting budget and 25% cheaper boats.", color: "#ff66d1",
  },
  blitz_hordes: {
    id: "blitz_hordes", name: "Blitz Hordes", short: "Fast waves, +50% bounty",
    desc: "Horde waves arrive 35% faster and move 15% faster, but kill bounties pay 50% more.", color: "#ffd54f",
  },
  supply_shortage: {
    id: "supply_shortage", name: "Supply Shortage", short: "Finite zone ammo, +30% budget",
    desc: "Safe zones do not grant infinite ammo (units inside start with 2x magazine and need Supply Depots). +30% budget, Supply Depots cost 50% less.", color: "#ffb74d",
  },
  fragile_walls: {
    id: "fragile_walls", name: "Crumbling Barricades", short: "50% wall HP, +30% roof range",
    desc: "Walls and gates have 50% HP, but roof units (Garrisons and Snipers) gain +30% firing range and Repair Yards cost 25% less.", color: "#4dd0e1",
  },
  blood_money: {
    id: "blood_money", name: "Blood Money", short: "-25% budget, 2x battle income",
    desc: "Start with 25% less budget, but survivor tax and kill bounties during battle are doubled.", color: "#ba68c8",
  },
};

/** Deterministic daily challenge for a UTC or local date string (YYYY-MM-DD). */
export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dailyChallengeFor(dateStr = todayDateStr()): { date: string; city: CityDef; mutators: MutatorId[]; seed: number } {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const next = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const city = ALL_CITIES[Math.floor(next() * ALL_CITIES.length)];
  const m1 = Math.floor(next() * MUTATOR_IDS.length);
  let m2 = Math.floor(next() * (MUTATOR_IDS.length - 1));
  if (m2 >= m1) m2++;
  const seed = ((h ^ city.seed) >>> 0) || 1337;
  return { date: dateStr, city, mutators: [MUTATOR_IDS[m1], MUTATOR_IDS[m2]], seed };
}

/** Battle abilities: bought with budget while planning (each purchase is one use), fired during the battle. */
export type AbilityKind = "airstrike" | "firebomb" | "para" | "supply_drop" | "barrage" | "moab" | "nuke" | "a10" | "cluster" | "tomahawk" | "gunship";
export interface AbilitySpec { name: string; cost: number; max: number; delay: number; color: string; hint: string } // max: available per battle (real-world stockpiles)
export const ABILITIES: Record<AbilityKind, AbilitySpec> = {
  airstrike: { name: "Airstrike", cost: 1_200_000, max: 12, delay: 3, color: "#ff5252",
    hint: "Click where the run starts, then where it ends. An F-15E Strike Eagle drops a stick of bombs 3 s later, demolishing buildings and cratering streets. Hurts civilians too." },
  firebomb: { name: "Firebomb", cost: 600_000, max: 6, delay: 1.5, color: "#ff9100",
    hint: "Click a spot. A strike jet drops incendiary canisters that burn for 12 s and scorch terrain. Parks burn wider. Hurts civilians too." },
  para: { name: "Paratroopers", cost: 2_400_000, max: 4, delay: 4, color: "#a5d6a7",
    hint: "Click a street or roof. A C-130J Hercules flies over and drops an airborne squad on parachutes 4 s later." },
  supply_drop: { name: "Supply Drop", cost: 500_000, max: 8, delay: 3.5, color: "#4fc3f7",
    hint: "Click near your units or walls. A C-130J drops 4 GPS-guided supply crates 3.5 s later: refills 100% ammo, heals mobile units, repairs walls within 70 m, and leaves an active field depot for 45 s." },
  barrage: { name: "Artillery Barrage", cost: 900_000, max: 8, delay: 6, color: "#f48fb1",
    hint: "Click a spot. An off-map howitzer battery fires a 16-shell fire mission over 5 s into a 56 m circle, 6 s after the call. Craters streets, collapses buildings. Hurts civilians too." },
  moab: { name: "MOAB", cost: 2_500_000, max: 1, delay: 8, color: "#ffcc80",
    hint: "Click a spot. An MC-130 drops a GBU-43 MOAB 8 s later: a 56 m blast that kills everything in it, civilians included, flattens buildings and batters walls." },
  a10: { name: "A-10 Strafing Run", cost: 400_000, max: 6, delay: 3, color: "#90a4ae",
    hint: "Click where the run starts, then where it ends. An A-10 Thunderbolt II rakes the line with its 30 mm GAU-8 cannon 3 s later: a narrow, deadly path that barely scratches buildings. Hurts civilians on the line." },
  cluster: { name: "Cluster Bomb", cost: 1_100_000, max: 4, delay: 4, color: "#ffab91",
    hint: "Click a spot. A strike jet releases a CBU-97 that scatters 50 bomblets over a 64 m circle 4 s later. Shreds crowds, light on buildings. Hurts civilians too." },
  tomahawk: { name: "Tomahawk", cost: 2_000_000, max: 4, delay: 10, color: "#e0e0e0",
    hint: "Click a spot. A Tomahawk cruise missile from a destroyer offshore hits it 10 s later: a precise 14 m blast that destroys whatever is there, building included." },
  gunship: { name: "AC-130 Gunship", cost: 1_600_000, max: 3, delay: 5, color: "#ce93d8",
    hint: "Click a spot. An AC-130J Ghostrider orbits it for 40 s, firing its 30 mm cannon and 105 mm howitzer at infected within 60 m. Precise: it only shoots infected." },
  nuke: { name: "Tactical Nuke", cost: 28_000_000, max: 1, delay: 15, color: "#76ff03",
    hint: "LAST RESORT. Click a spot. 15 s later a tactical nuclear warhead erases everything within 160 m: infected, civilians (even inside a zone), walls and buildings. Fallout lingers 90 s and kills anything that stays in it. Costs 500 XP." },
};
export let BARRAGE_RADIUS = 14, BARRAGE_SHELLS = 16, BARRAGE_S = 5, BARRAGE_SPLASH = 4, BARRAGE_DMG = 700;
export let MOAB_RADIUS = 28, MOAB_WALL_DMG = 5000;
export let NUKE_RADIUS = 80, FALLOUT_RADIUS = 65, FALLOUT_S = 90, FALLOUT_DPS = 400, FALLOUT_CIV_P = 0.03; // civilian death chance per 0.2 s
export let NUKE_XP_PENALTY = 500;
export let A10_WIDTH = 1.6, A10_DMG = 3000, A10_LEN = 80;
export let CLUSTER_RADIUS = 16, CLUSTER_BOMBLETS = 50, CLUSTER_SPLASH = 1.6, CLUSTER_DMG = 900;
export let TOMAHAWK_RADIUS = 7;
export let GUNSHIP_RADIUS = 30, GUNSHIP_S = 40, GUNSHIP_GUN_DMG = 350, GUNSHIP_GUN_RATE = 6, GUNSHIP_HOW_DMG = 2200, GUNSHIP_HOW_EVERY = 3, GUNSHIP_HOW_SPLASH = 4;
export let AIRSTRIKE_LEN = 70; // cells, longest run
export let AIRSTRIKE_RADIUS = 3.5;
export let FIRE_RADIUS = 5, FIRE_RADIUS_PARK = 8, FIRE_S = 12, FIRE_DPS = 160;
export let SUPPLY_DROP_RADIUS = 35; // cells (70 m)
export let SUPPLY_DROP_WALL_HP = 2500;
export let SUPPLY_CRATE_S = 45;
export let SUPPLY_CRATE_RADIUS = 22; // cells (44 m)
/** Bridge charges: planted on a bridge while planning, blown during the battle. The bridge becomes river. */
export let C4_COST = 250_000;

/** APCs hold a post outside the zone; out of ammo they drive into the zone, reload, and drive back. */
export let APC_RELOAD_S = 6;

/** Fuel depots: a few per map, set off during the battle for one huge blast (civilians too). */
export let DEPOTS = 5, DEPOT_RADIUS = 11;

/** Terrain & structural damage from heavy ordnance and explosions. */
export let STRUCT_DMG_MORTAR = 45;
export let STRUCT_DMG_BATTLESHIP = 85;
export let STRUCT_DMG_HOWITZER = 110;
export let STRUCT_DMG_AIRSTRIKE = 160;
export let STRUCT_DMG_DEPOT = 240;
export let STRUCT_DMG_FIREBOMB = 40;
export let SCAR_PX = 4; // 0.23: pixels per cell in the ground-damage layer
export let SMOKE_MAX = 400; // most smoke puffs at once
export let SMOKE_S = 10; // seconds a plume lasts
export let SMOKE_WIND = 0.6; // cells per second the smoke drifts
export let CRATER_SLOW_MUL = 0.6; // 0.23: speed at the bottom of a crater (rough ground, eases toward the rim)
export let RUBBLE_SLOW_MUL = 0.7; // 30% movement slow through deep shell craters and collapsed building rubble

export type DeployVehicle = "helo_uh60" | "helo_ch47" | "c130_apc" | "c130_para" | "naval" | "ground";
export interface UnitInfoSpec {
  role: string;
  transport: string;
  vehicle: DeployVehicle;
  structDmg: string;
  desc: string;
  specials: string[];
}
export const UNIT_INFO: Record<UnitKind, UnitInfoSpec> = {
  garrison: {
    role: "Rooftop Infantry Squad",
    transport: "UH-60 Black Hawk fast-rope",
    vehicle: "helo_uh60",
    structDmg: "None (5.56mm carbines)",
    desc: "Rapid-fire rifle squad positioned on building rooftops. Ideal for holding safe-zone perimeters and mowing down packed runners.",
    specials: ["+1 m range per building floor", "Infinite ammo when inside Safe Zone", "Inserted by UH-60 Black Hawk mid-battle"],
  },
  sniper: {
    role: "Precision Anti-Materiel Team",
    transport: "UH-60 Black Hawk rooftop insertion",
    vehicle: "helo_uh60",
    structDmg: "None (.50 BMG precision)",
    desc: "High-caliber marksman team placed on tall buildings. Gains massive range bonuses from skyscraper elevation and one-shots standard infected.",
    specials: ["+5 m range per building floor (press J for heights)", "1,000 dmg/shot counters high-HP Swimmer mutants", "Infinite ammo when inside Safe Zone"],
  },
  turret: {
    role: "Automated Rotary Sentry",
    transport: "CH-47 Chinook heavy sling-load",
    vehicle: "helo_ch47",
    structDmg: "None (7.62mm minigun)",
    desc: "Autonomous radar-guided rotary cannon placed on streets or parks. Blistering 16 rds/s rate of fire shreds waves at choke points.",
    specials: ["1,800-round drum (does not auto-reload from Safe Zone)", "Pair with a Supply Depot (Cargo Drones) or Supply Drop to keep fed", "Air-lifted by CH-47 Chinook mid-battle"],
  },
  mortar: {
    role: "Indirect-Fire Mortar Pit",
    transport: "CH-47 Chinook artillery sling-load",
    vehicle: "helo_ch47",
    structDmg: "Medium (craters roads, chips building floors)",
    desc: "81mm high-angle mortar crew that lobs HE shells into dense crowds beyond 16 m. Repeated shelling craters streets and collapses weakened buildings.",
    specials: ["4.4 m blast radius (up to 12 infected per shell)", "Cratered streets and rubble slow infected by 30%", "Never fires into your own Safe Zone"],
  },
  howitzer: {
    role: "155mm Heavy Field Artillery",
    transport: "CH-47 Chinook heavy artillery lift",
    vehicle: "helo_ch47",
    structDmg: "Heavy (demolishes buildings into rubble, deep craters)",
    desc: "Long-range 155mm artillery battery spanning 260 m. Obliterates distant horde columns, shears floors off buildings, and turns city blocks into rubble.",
    specials: ["8.0 m blast radius (up to 30 infected per shell)", "Demolishes outside buildings into walkable rubble", "Minimum range 40 m; safe-zone fire-control lock"],
  },
  apc: {
    role: "Mechanized Infantry Carrier",
    transport: "C-130J Heavy LAPES Parachute Drop",
    vehicle: "c130_apc",
    structDmg: "None (7.62 mm coax machine gun + 25 mm Bushmaster autocannon)",
    desc: "Armored vehicle with a coax machine gun and a 25 mm autocannon that fires small high-explosive bursts into packs. Patrols roads, hunts infected chasing civilians, retreats when swarmed, and drives back into the Safe Zone to reload and repair.",
    specials: ["Air-dropped via C-130J heavy cargo chutes mid-battle", "Dismounts a Mechanized Rifle Team upon first contact", "900 HP armor; reloads in 6 s (3 s with Supply Depot)"],
  },
  gunboat: {
    role: "Riverine Patrol Craft",
    transport: "Naval river transit",
    vehicle: "naval",
    structDmg: "None (twin .50 cal mounts)",
    desc: "Fast armored patrol boat that cruises rivers and canals, gunning down hordes along the banks and intercepting river-crossing Swimmer mutants.",
    specials: ["Unlimited ammunition and immune to land infected", "Patrols within 180 m of its assigned river post", "25% cheaper during Amphibious Surge mutator"],
  },
  battleship: {
    role: "Offshore Naval Fire Support",
    transport: "Naval heavy deployment",
    vehicle: "naval",
    structDmg: "Heavy (naval gunfire demolishes structures & craters land)",
    desc: "Heavily armed warship whose main batteries fire 3-shell broadsides up to 400 m inland, smashing hordes and leveling buildings across half the city.",
    specials: ["3-shell salvos, 8.0 m blast radius each, heavy structural demolition", "Unlimited ammunition and invulnerable on water", "Click in Move Map mode to set target priority"],
  },
  himars: {
    role: "Rocket Artillery (M142 HIMARS)",
    transport: "C-130J roll-off delivery",
    vehicle: "helo_ch47",
    structDmg: "Heavy (GMLRS rockets crater and collapse)",
    desc: "Truck-mounted rocket launcher that ripples 6 guided rockets at the thickest crowd up to 460 m away, then reloads. Can't hit anything closer than 60 m.",
    specials: ["6-rocket salvos, 7 m blasts", "Longest reach of any ground unit", "Reloads free inside the zone"],
  },
  tank: {
    role: "Main Battle Tank",
    transport: "Ground convoy",
    vehicle: "ground",
    structDmg: "Light (120 mm HE)",
    desc: "Heavily armored tank with a coax machine gun and a 120 mm main gun that blows apart packed crowds. Patrols roads, kites infected, and drives home to rearm.",
    specials: ["3,000 HP armor: shrugs off small crowds", "120 mm HE: 1,800 dmg in a 5 m blast", "Takes strike orders"],
  },
  apache: {
    role: "Attack Helicopter",
    transport: "Flies in",
    vehicle: "ground",
    structDmg: "None",
    desc: "Flies over everything, out of reach. A 30 mm chain gun and Hydra rockets hunt infected within 160 m of its post; flies home to rearm when dry.",
    specials: ["Takes off from inside a safe zone", "Rockets: 500 dmg, small blasts", "Takes strike orders anywhere on the map"],
  },
  reaper: {
    role: "Armed Drone",
    transport: "Flies in",
    vehicle: "ground",
    structDmg: "Light",
    desc: "Loiters high over a wide patrol area and fires Hellfire missiles at the densest pack of infected, then flies home to rearm.",
    specials: ["8 Hellfires, 1,200 dmg in 5 m", "Widest patrol area of any unit (260 m)", "Takes strike orders anywhere on the map"],
  },
  para: {
    role: "Airborne Quick-Reaction Squad",
    transport: "C-130J Hercules parachute drop",
    vehicle: "c130_para",
    structDmg: "None",
    desc: "Elite airborne infantry dropped by parachute anywhere on the map. Fights autonomously until out of ammo, then evacuates to the Safe Zone.",
    specials: ["Deployed via the Paratroopers ability", "Can be resupplied in the field by Supply Drops or Supply Depots"],
  },
  police: {
    role: "Precinct Tactical Response Unit",
    transport: "Dispatched from Precinct",
    vehicle: "ground",
    structDmg: "None",
    desc: "Autonomous mobile squad dispatched from a Precinct support building. Prioritizes infected chasing civilians and returns to the zone to reload.",
    specials: ["Up to 2 squads active per Precinct", "Respawns automatically every 35 s if lost"],
  },
  militia: {
    role: "Armory Defense Detail",
    transport: "Dispatched from Armory / APC",
    vehicle: "ground",
    structDmg: "None",
    desc: "Local defense squad dispatched by an Armory or dismounted from an APC. Defaults to targeting infected clawing at your walls and gates.",
    specials: ["Up to 2 squads per Armory + 1 dismount per APC", "Reinforces nearby indoor barricades"],
  },
};

export interface SupportInfoSpec {
  role: string;
  transport: string;
  effect: string;
  specials: string[];
}
export const SUPPORT_INFO: Record<SupportKind, SupportInfoSpec> = {
  evac: {
    role: "Rooftop Helipad · Civilian Airlift",
    transport: "CH-47 Chinook modular lift",
    effect: "Lifts up to 80 people out every 12 s · $24,000 per person",
    specials: ["Evacuated people are saved for good: this is your score", "People inside the zone queue toward the nearest pad", "A lift waves off if 8+ infected are near the pad"],
  },
  budget: {
    role: "Logistics & Procurement Hub",
    transport: "CH-47 Chinook modular lift",
    effect: "-20% cost on all units and support buildings within 100 m",
    specials: ["Payback in just 4-5 nearby unit placements", "Must be placed on a building inside a Safe Zone"],
  },
  repair: {
    role: "Field Engineering Depot",
    transport: "CH-47 Chinook modular lift",
    effect: "+30 HP/s to walls & gates · +25 HP/s to mobile units within 90 m",
    specials: ["Keeps front-line barricades and APCs alive under heavy siege", "25% cheaper during Crumbling Barricades mutator"],
  },
  radio: {
    role: "C4ISR Communications Array",
    transport: "CH-47 Chinook modular lift",
    effect: "+40% firing range for all combat units within 130 m",
    specials: ["Stacks multiplicatively with skyscraper rooftop elevation", "Turns Snipers and Howitzers into map-wide overwatch"],
  },
  supply: {
    role: "Automated Drone Resupply Hub",
    transport: "CH-47 Chinook modular lift",
    effect: "+8% mag/s via Cargo Drones · -50% vehicle reload time within 100 m",
    specials: ["Dispatches quad-rotor cargo drones to feed Turrets and outside units", "Essential during Supply Shortage mutator"],
  },
  command: {
    role: "Tactical Fire-Direction Center",
    transport: "CH-47 Chinook modular lift",
    effect: "+30% firing rate · +25% mobile patrol leash within 100 m",
    specials: ["Directly boosts DPS of all garrisons, snipers, turrets and artillery in range"],
  },
  police: {
    role: "Tactical Precinct",
    transport: "CH-47 Chinook modular lift",
    effect: "Spawns up to 2 autonomous Police Squads (35 s replacement)",
    specials: ["Squads roam roads to rescue fleeing civilians and return to reload"],
  },
  militia: {
    role: "Civil Defense Armory",
    transport: "CH-47 Chinook modular lift",
    effect: "Spawns up to 2 Militia Squads · -50% indoor bite chance within 90 m",
    specials: ["Militia prioritize wall-biting infected; protects Safe Zone interior"],
  },
};

/** What a unit shoots first. Click a unit (Move map tool) to switch. */
export type TargetMode = "near" | "wall" | "civ";
export const TARGET_MODES: TargetMode[] = ["near", "wall", "civ"];
export const TARGET_LABEL: Record<TargetMode, string> = { near: "nearest", wall: "closest to the walls", civ: "chasing civilians" };

/** Money for the screen: $1.2B, $24.5M, $850k, $900. */
export function money(v: number) {
  const a = Math.abs(v), sg = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sg}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sg}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sg}$${Math.round(a / 1e3)}k`;
  return `${sg}$${Math.round(a)}`;
}
/** Property value per building cell per floor (4 m^2 x ~$2,500/m^2): what the damage bill counts. */
export let BUILDING_CELL_FLOOR_VALUE = 10_000;
export let BILLION = 1_000_000_000;

// ---- TUNABLE (generated by tools/gen-tunables.ts; do not edit by hand) ----
/** Every plain number above, by name, for mods: [read, write]. */
export const TUNABLE: Record<string, [() => number, (v: number) => void]> = {
  CELL_M: [() => CELL_M, v => { CELL_M = v; }],
  MAP_W: [() => MAP_W, v => { MAP_W = v; }],
  MAP_H: [() => MAP_H, v => { MAP_H = v; }],
  REAL_MAP_W: [() => REAL_MAP_W, v => { REAL_MAP_W = v; }],
  REAL_MAP_H: [() => REAL_MAP_H, v => { REAL_MAP_H = v; }],
  TICK_HZ: [() => TICK_HZ, v => { TICK_HZ = v; }],
  HIGHWAY_SPEED_MUL: [() => HIGHWAY_SPEED_MUL, v => { HIGHWAY_SPEED_MUL = v; }],
  RAIL_SPEED_MUL: [() => RAIL_SPEED_MUL, v => { RAIL_SPEED_MUL = v; }],
  TRAIN_EVERY_S: [() => TRAIN_EVERY_S, v => { TRAIN_EVERY_S = v; }],
  TRAIN_FIRST_S: [() => TRAIN_FIRST_S, v => { TRAIN_FIRST_S = v; }],
  TRAIN_SPEED: [() => TRAIN_SPEED, v => { TRAIN_SPEED = v; }],
  TRAIN_CRUSH_DMG: [() => TRAIN_CRUSH_DMG, v => { TRAIN_CRUSH_DMG = v; }],
  TRAIN_BOARD_RADIUS: [() => TRAIN_BOARD_RADIUS, v => { TRAIN_BOARD_RADIUS = v; }],
  TRAIN_CAPACITY: [() => TRAIN_CAPACITY, v => { TRAIN_CAPACITY = v; }],
  TRAIN_BONUS_PER_CIV: [() => TRAIN_BONUS_PER_CIV, v => { TRAIN_BONUS_PER_CIV = v; }],
  CIVILIANS: [() => CIVILIANS, v => { CIVILIANS = v; }],
  OUTBREAK_SITES: [() => OUTBREAK_SITES, v => { OUTBREAK_SITES = v; }],
  INFECTED_PER_SITE: [() => INFECTED_PER_SITE, v => { INFECTED_PER_SITE = v; }],
  OUTBREAK_MIN_ZONE_DIST: [() => OUTBREAK_MIN_ZONE_DIST, v => { OUTBREAK_MIN_ZONE_DIST = v; }],
  WARNING_S: [() => WARNING_S, v => { WARNING_S = v; }],
  WAVE_BASE: [() => WAVE_BASE, v => { WAVE_BASE = v; }],
  WAVE_WARN_S: [() => WAVE_WARN_S, v => { WAVE_WARN_S = v; }],
  WAVE_MARCH_S: [() => WAVE_MARCH_S, v => { WAVE_MARCH_S = v; }],
  HORDE_SIZE_POW: [() => HORDE_SIZE_POW, v => { HORDE_SIZE_POW = v; }],
  HORDE_SIZE_JITTER: [() => HORDE_SIZE_JITTER, v => { HORDE_SIZE_JITTER = v; }],
  HORDE_BIG_CHANCE: [() => HORDE_BIG_CHANCE, v => { HORDE_BIG_CHANCE = v; }],
  HORDE_BIG_MUL: [() => HORDE_BIG_MUL, v => { HORDE_BIG_MUL = v; }],
  HORDE_ROUTE_HEAT: [() => HORDE_ROUTE_HEAT, v => { HORDE_ROUTE_HEAT = v; }],
  EVAC_COST_MUL: [() => EVAC_COST_MUL, v => { EVAC_COST_MUL = v; }],
  EVAC_PAR_S: [() => EVAC_PAR_S, v => { EVAC_PAR_S = v; }],
  SCORE_W_SAVED: [() => SCORE_W_SAVED, v => { SCORE_W_SAVED = v; }],
  SCORE_W_SPEED: [() => SCORE_W_SPEED, v => { SCORE_W_SPEED = v; }],
  SCORE_W_CITY: [() => SCORE_W_CITY, v => { SCORE_W_CITY = v; }],
  SCORE_W_KILLS: [() => SCORE_W_KILLS, v => { SCORE_W_KILLS = v; }],
  MEDAL_MIN_SAVED_PCT: [() => MEDAL_MIN_SAVED_PCT, v => { MEDAL_MIN_SAVED_PCT = v; }],
  ROUND_STRAGGLERS_PCT: [() => ROUND_STRAGGLERS_PCT, v => { ROUND_STRAGGLERS_PCT = v; }],
  ROUND_STALL_S: [() => ROUND_STALL_S, v => { ROUND_STALL_S = v; }],
  MAYHEM_DAMAGE_PER_POINT: [() => MAYHEM_DAMAGE_PER_POINT, v => { MAYHEM_DAMAGE_PER_POINT = v; }],
  MAYHEM_XP_PER_KILL: [() => MAYHEM_XP_PER_KILL, v => { MAYHEM_XP_PER_KILL = v; }],
  INTACT_BONUS_PCT: [() => INTACT_BONUS_PCT, v => { INTACT_BONUS_PCT = v; }],
  SCORCHED_BONUS_PCT: [() => SCORCHED_BONUS_PCT, v => { SCORCHED_BONUS_PCT = v; }],
  BONUS_XP: [() => BONUS_XP, v => { BONUS_XP = v; }],
  EVAC_EVERY_S: [() => EVAC_EVERY_S, v => { EVAC_EVERY_S = v; }],
  EVAC_CAP: [() => EVAC_CAP, v => { EVAC_CAP = v; }],
  EVAC_PAY: [() => EVAC_PAY, v => { EVAC_PAY = v; }],
  EVAC_ABORT_INF: [() => EVAC_ABORT_INF, v => { EVAC_ABORT_INF = v; }],
  SOUND_NEAR_ZOOM: [() => SOUND_NEAR_ZOOM, v => { SOUND_NEAR_ZOOM = v; }],
  EVAC_WALK_MUL: [() => EVAC_WALK_MUL, v => { EVAC_WALK_MUL = v; }],
  MILL_MAX_DENS: [() => MILL_MAX_DENS, v => { MILL_MAX_DENS = v; }],
  WAIT_RHO: [() => WAIT_RHO, v => { WAIT_RHO = v; }],
  EVAC_GATHER_D: [() => EVAC_GATHER_D, v => { EVAC_GATHER_D = v; }],
  AGENT_RESERVE: [() => AGENT_RESERVE, v => { AGENT_RESERVE = v; }],
  CIV_SPEED: [() => CIV_SPEED, v => { CIV_SPEED = v; }],
  CIV_SPRINT: [() => CIV_SPRINT, v => { CIV_SPRINT = v; }],
  WALK_SPREAD: [() => WALK_SPREAD, v => { WALK_SPREAD = v; }],
  CROWD_TAU: [() => CROWD_TAU, v => { CROWD_TAU = v; }],
  PANIC_TAU: [() => PANIC_TAU, v => { PANIC_TAU = v; }],
  BODY_R: [() => BODY_R, v => { BODY_R = v; }],
  PANIC_BODY_R: [() => PANIC_BODY_R, v => { PANIC_BODY_R = v; }],
  TTC_K: [() => TTC_K, v => { TTC_K = v; }],
  TTC_FOLLOW: [() => TTC_FOLLOW, v => { TTC_FOLLOW = v; }],
  SPEED_RHO_CELL: [() => SPEED_RHO_CELL, v => { SPEED_RHO_CELL = v; }],
  TTC_T0: [() => TTC_T0, v => { TTC_T0 = v; }],
  SPACE_A: [() => SPACE_A, v => { SPACE_A = v; }],
  SPACE_B: [() => SPACE_B, v => { SPACE_B = v; }],
  CROWD_PRESS: [() => CROWD_PRESS, v => { CROWD_PRESS = v; }],
  PRESS_DENS: [() => PRESS_DENS, v => { PRESS_DENS = v; }],
  WALL_A: [() => WALL_A, v => { WALL_A = v; }],
  WALL_RANGE: [() => WALL_RANGE, v => { WALL_RANGE = v; }],
  WALL_MIN: [() => WALL_MIN, v => { WALL_MIN = v; }],
  RHO_MAX: [() => RHO_MAX, v => { RHO_MAX = v; }],
  RHO_GAMMA: [() => RHO_GAMMA, v => { RHO_GAMMA = v; }],
  PANIC_RHO_MAX: [() => PANIC_RHO_MAX, v => { PANIC_RHO_MAX = v; }],
  AIM_SWAY: [() => AIM_SWAY, v => { AIM_SWAY = v; }],
  FEAR_RISE: [() => FEAR_RISE, v => { FEAR_RISE = v; }],
  FEAR_FADE_S: [() => FEAR_FADE_S, v => { FEAR_FADE_S = v; }],
  FEAR_SPREAD: [() => FEAR_SPREAD, v => { FEAR_SPREAD = v; }],
  FEAR_GRID_HALF: [() => FEAR_GRID_HALF, v => { FEAR_GRID_HALF = v; }],
  HERD_MAX: [() => HERD_MAX, v => { HERD_MAX = v; }],
  PANIC_ODD_RATE: [() => PANIC_ODD_RATE, v => { PANIC_ODD_RATE = v; }],
  PANIC_CLOG: [() => PANIC_CLOG, v => { PANIC_CLOG = v; }],
  CLOG_RHO: [() => CLOG_RHO, v => { CLOG_RHO = v; }],
  CRUSH_RHO: [() => CRUSH_RHO, v => { CRUSH_RHO = v; }],
  CRUSH_S: [() => CRUSH_S, v => { CRUSH_S = v; }],
  DOWN_S: [() => DOWN_S, v => { DOWN_S = v; }],
  SHOVE: [() => SHOVE, v => { SHOVE = v; }],
  NOISE_HALF: [() => NOISE_HALF, v => { NOISE_HALF = v; }],
  NOISE_MIN: [() => NOISE_MIN, v => { NOISE_MIN = v; }],
  NOISE_STRAGGLER: [() => NOISE_STRAGGLER, v => { NOISE_STRAGGLER = v; }],
  FAMILY_PCT: [() => FAMILY_PCT, v => { FAMILY_PCT = v; }],
  INF_SPEED: [() => INF_SPEED, v => { INF_SPEED = v; }],
  SHAMBLER_MUL: [() => SHAMBLER_MUL, v => { SHAMBLER_MUL = v; }],
  RUNNER_MUL: [() => RUNNER_MUL, v => { RUNNER_MUL = v; }],
  INF_WALL_PUSH: [() => INF_WALL_PUSH, v => { INF_WALL_PUSH = v; }],
  INF_SWAY: [() => INF_SWAY, v => { INF_SWAY = v; }],
  INF_SPEED_GROWTH: [() => INF_SPEED_GROWTH, v => { INF_SPEED_GROWTH = v; }],
  INF_HP: [() => INF_HP, v => { INF_HP = v; }],
  INF_HP_GROWTH: [() => INF_HP_GROWTH, v => { INF_HP_GROWTH = v; }],
  CIV_JAM_DENS: [() => CIV_JAM_DENS, v => { CIV_JAM_DENS = v; }],
  GATE_CLEAR_DEPTH: [() => GATE_CLEAR_DEPTH, v => { GATE_CLEAR_DEPTH = v; }],
  GRAIN_PUSH: [() => GRAIN_PUSH, v => { GRAIN_PUSH = v; }],
  INF_LUNGE_MUL: [() => INF_LUNGE_MUL, v => { INF_LUNGE_MUL = v; }],
  KITE_R: [() => KITE_R, v => { KITE_R = v; }],
  INF_SENSE: [() => INF_SENSE, v => { INF_SENSE = v; }],
  CIV_SENSE: [() => CIV_SENSE, v => { CIV_SENSE = v; }],
  BITE_RANGE: [() => BITE_RANGE, v => { BITE_RANGE = v; }],
  BITE_CHANCE: [() => BITE_CHANCE, v => { BITE_CHANCE = v; }],
  SAFE_BITE_MUL: [() => SAFE_BITE_MUL, v => { SAFE_BITE_MUL = v; }],
  WALL_DPS: [() => WALL_DPS, v => { WALL_DPS = v; }],
  WALL_MAX_ATTACKERS: [() => WALL_MAX_ATTACKERS, v => { WALL_MAX_ATTACKERS = v; }],
  WALL_HP: [() => WALL_HP, v => { WALL_HP = v; }],
  START_BUDGET: [() => START_BUDGET, v => { START_BUDGET = v; }],
  START_BUDGET_MUL: [() => START_BUDGET_MUL, v => { START_BUDGET_MUL = v; }],
  ZONE_BASE_COST: [() => ZONE_BASE_COST, v => { ZONE_BASE_COST = v; }],
  ZONE_COST_PER_CELL: [() => ZONE_COST_PER_CELL, v => { ZONE_COST_PER_CELL = v; }],
  EXTRA_ZONE_BASE: [() => EXTRA_ZONE_BASE, v => { EXTRA_ZONE_BASE = v; }],
  EXTRA_ZONE_PER_CELL: [() => EXTRA_ZONE_PER_CELL, v => { EXTRA_ZONE_PER_CELL = v; }],
  INCOME_EVERY_S: [() => INCOME_EVERY_S, v => { INCOME_EVERY_S = v; }],
  INCOME_PER_SAFE: [() => INCOME_PER_SAFE, v => { INCOME_PER_SAFE = v; }],
  KILL_BOUNTY: [() => KILL_BOUNTY, v => { KILL_BOUNTY = v; }],
  EXTRACT_MUL: [() => EXTRACT_MUL, v => { EXTRACT_MUL = v; }],
  CRUSH_SLOW_S: [() => CRUSH_SLOW_S, v => { CRUSH_SLOW_S = v; }],
  CRUSH_YIELD_MUL: [() => CRUSH_YIELD_MUL, v => { CRUSH_YIELD_MUL = v; }],
  SQUEEZE_COST: [() => SQUEEZE_COST, v => { SQUEEZE_COST = v; }],
  MOBILE_HURT_DPS: [() => MOBILE_HURT_DPS, v => { MOBILE_HURT_DPS = v; }],
  GATE_HP: [() => GATE_HP, v => { GATE_HP = v; }],
  MILITIA_MAX: [() => MILITIA_MAX, v => { MILITIA_MAX = v; }],
  BUDGET_DISCOUNT: [() => BUDGET_DISCOUNT, v => { BUDGET_DISCOUNT = v; }],
  REPAIR_WALL_HPS: [() => REPAIR_WALL_HPS, v => { REPAIR_WALL_HPS = v; }],
  REPAIR_UNIT_HPS: [() => REPAIR_UNIT_HPS, v => { REPAIR_UNIT_HPS = v; }],
  RADIO_RANGE_MUL: [() => RADIO_RANGE_MUL, v => { RADIO_RANGE_MUL = v; }],
  SUPPLY_AMMO_RATE: [() => SUPPLY_AMMO_RATE, v => { SUPPLY_AMMO_RATE = v; }],
  COMMAND_RATE_MUL: [() => COMMAND_RATE_MUL, v => { COMMAND_RATE_MUL = v; }],
  COMMAND_LEASH_MUL: [() => COMMAND_LEASH_MUL, v => { COMMAND_LEASH_MUL = v; }],
  POLICE_MAX_SQUADS: [() => POLICE_MAX_SQUADS, v => { POLICE_MAX_SQUADS = v; }],
  POLICE_SPAWN_S: [() => POLICE_SPAWN_S, v => { POLICE_SPAWN_S = v; }],
  MILITIA_MAX_SQUADS: [() => MILITIA_MAX_SQUADS, v => { MILITIA_MAX_SQUADS = v; }],
  MILITIA_SPAWN_S: [() => MILITIA_SPAWN_S, v => { MILITIA_SPAWN_S = v; }],
  MILITIA_BITE_MUL: [() => MILITIA_BITE_MUL, v => { MILITIA_BITE_MUL = v; }],
  SWIMMER_HP_MUL: [() => SWIMMER_HP_MUL, v => { SWIMMER_HP_MUL = v; }],
  SWIMMER_SPEED_LAND: [() => SWIMMER_SPEED_LAND, v => { SWIMMER_SPEED_LAND = v; }],
  SWIMMER_SPEED_WATER: [() => SWIMMER_SPEED_WATER, v => { SWIMMER_SPEED_WATER = v; }],
  SWIMMER_WAVE_START: [() => SWIMMER_WAVE_START, v => { SWIMMER_WAVE_START = v; }],
  SWIMMER_BASE_FRAC: [() => SWIMMER_BASE_FRAC, v => { SWIMMER_BASE_FRAC = v; }],
  SWIMMER_WAVE_GROWTH: [() => SWIMMER_WAVE_GROWTH, v => { SWIMMER_WAVE_GROWTH = v; }],
  SWIMMER_MAX_FRAC: [() => SWIMMER_MAX_FRAC, v => { SWIMMER_MAX_FRAC = v; }],
  BARRAGE_RADIUS: [() => BARRAGE_RADIUS, v => { BARRAGE_RADIUS = v; }],
  BARRAGE_SHELLS: [() => BARRAGE_SHELLS, v => { BARRAGE_SHELLS = v; }],
  BARRAGE_S: [() => BARRAGE_S, v => { BARRAGE_S = v; }],
  BARRAGE_SPLASH: [() => BARRAGE_SPLASH, v => { BARRAGE_SPLASH = v; }],
  BARRAGE_DMG: [() => BARRAGE_DMG, v => { BARRAGE_DMG = v; }],
  MOAB_RADIUS: [() => MOAB_RADIUS, v => { MOAB_RADIUS = v; }],
  MOAB_WALL_DMG: [() => MOAB_WALL_DMG, v => { MOAB_WALL_DMG = v; }],
  NUKE_RADIUS: [() => NUKE_RADIUS, v => { NUKE_RADIUS = v; }],
  FALLOUT_RADIUS: [() => FALLOUT_RADIUS, v => { FALLOUT_RADIUS = v; }],
  FALLOUT_S: [() => FALLOUT_S, v => { FALLOUT_S = v; }],
  FALLOUT_DPS: [() => FALLOUT_DPS, v => { FALLOUT_DPS = v; }],
  FALLOUT_CIV_P: [() => FALLOUT_CIV_P, v => { FALLOUT_CIV_P = v; }],
  NUKE_XP_PENALTY: [() => NUKE_XP_PENALTY, v => { NUKE_XP_PENALTY = v; }],
  A10_WIDTH: [() => A10_WIDTH, v => { A10_WIDTH = v; }],
  A10_DMG: [() => A10_DMG, v => { A10_DMG = v; }],
  A10_LEN: [() => A10_LEN, v => { A10_LEN = v; }],
  CLUSTER_RADIUS: [() => CLUSTER_RADIUS, v => { CLUSTER_RADIUS = v; }],
  CLUSTER_BOMBLETS: [() => CLUSTER_BOMBLETS, v => { CLUSTER_BOMBLETS = v; }],
  CLUSTER_SPLASH: [() => CLUSTER_SPLASH, v => { CLUSTER_SPLASH = v; }],
  CLUSTER_DMG: [() => CLUSTER_DMG, v => { CLUSTER_DMG = v; }],
  TOMAHAWK_RADIUS: [() => TOMAHAWK_RADIUS, v => { TOMAHAWK_RADIUS = v; }],
  GUNSHIP_RADIUS: [() => GUNSHIP_RADIUS, v => { GUNSHIP_RADIUS = v; }],
  GUNSHIP_S: [() => GUNSHIP_S, v => { GUNSHIP_S = v; }],
  GUNSHIP_GUN_DMG: [() => GUNSHIP_GUN_DMG, v => { GUNSHIP_GUN_DMG = v; }],
  GUNSHIP_GUN_RATE: [() => GUNSHIP_GUN_RATE, v => { GUNSHIP_GUN_RATE = v; }],
  GUNSHIP_HOW_DMG: [() => GUNSHIP_HOW_DMG, v => { GUNSHIP_HOW_DMG = v; }],
  GUNSHIP_HOW_EVERY: [() => GUNSHIP_HOW_EVERY, v => { GUNSHIP_HOW_EVERY = v; }],
  GUNSHIP_HOW_SPLASH: [() => GUNSHIP_HOW_SPLASH, v => { GUNSHIP_HOW_SPLASH = v; }],
  AIRSTRIKE_LEN: [() => AIRSTRIKE_LEN, v => { AIRSTRIKE_LEN = v; }],
  AIRSTRIKE_RADIUS: [() => AIRSTRIKE_RADIUS, v => { AIRSTRIKE_RADIUS = v; }],
  FIRE_RADIUS: [() => FIRE_RADIUS, v => { FIRE_RADIUS = v; }],
  FIRE_RADIUS_PARK: [() => FIRE_RADIUS_PARK, v => { FIRE_RADIUS_PARK = v; }],
  FIRE_S: [() => FIRE_S, v => { FIRE_S = v; }],
  FIRE_DPS: [() => FIRE_DPS, v => { FIRE_DPS = v; }],
  SUPPLY_DROP_RADIUS: [() => SUPPLY_DROP_RADIUS, v => { SUPPLY_DROP_RADIUS = v; }],
  SUPPLY_DROP_WALL_HP: [() => SUPPLY_DROP_WALL_HP, v => { SUPPLY_DROP_WALL_HP = v; }],
  SUPPLY_CRATE_S: [() => SUPPLY_CRATE_S, v => { SUPPLY_CRATE_S = v; }],
  SUPPLY_CRATE_RADIUS: [() => SUPPLY_CRATE_RADIUS, v => { SUPPLY_CRATE_RADIUS = v; }],
  C4_COST: [() => C4_COST, v => { C4_COST = v; }],
  APC_RELOAD_S: [() => APC_RELOAD_S, v => { APC_RELOAD_S = v; }],
  DEPOTS: [() => DEPOTS, v => { DEPOTS = v; }],
  DEPOT_RADIUS: [() => DEPOT_RADIUS, v => { DEPOT_RADIUS = v; }],
  STRUCT_DMG_MORTAR: [() => STRUCT_DMG_MORTAR, v => { STRUCT_DMG_MORTAR = v; }],
  STRUCT_DMG_BATTLESHIP: [() => STRUCT_DMG_BATTLESHIP, v => { STRUCT_DMG_BATTLESHIP = v; }],
  STRUCT_DMG_HOWITZER: [() => STRUCT_DMG_HOWITZER, v => { STRUCT_DMG_HOWITZER = v; }],
  STRUCT_DMG_AIRSTRIKE: [() => STRUCT_DMG_AIRSTRIKE, v => { STRUCT_DMG_AIRSTRIKE = v; }],
  STRUCT_DMG_DEPOT: [() => STRUCT_DMG_DEPOT, v => { STRUCT_DMG_DEPOT = v; }],
  STRUCT_DMG_FIREBOMB: [() => STRUCT_DMG_FIREBOMB, v => { STRUCT_DMG_FIREBOMB = v; }],
  SCAR_PX: [() => SCAR_PX, v => { SCAR_PX = v; }],
  SMOKE_MAX: [() => SMOKE_MAX, v => { SMOKE_MAX = v; }],
  SMOKE_S: [() => SMOKE_S, v => { SMOKE_S = v; }],
  SMOKE_WIND: [() => SMOKE_WIND, v => { SMOKE_WIND = v; }],
  CRATER_SLOW_MUL: [() => CRATER_SLOW_MUL, v => { CRATER_SLOW_MUL = v; }],
  RUBBLE_SLOW_MUL: [() => RUBBLE_SLOW_MUL, v => { RUBBLE_SLOW_MUL = v; }],
  BUILDING_CELL_FLOOR_VALUE: [() => BUILDING_CELL_FLOOR_VALUE, v => { BUILDING_CELL_FLOOR_VALUE = v; }],
  BILLION: [() => BILLION, v => { BILLION = v; }],
};
// ---- end TUNABLE ----

/** 0.24: full armor of a unit (mobile units: mobile.hp; street emplacements: hp), or undefined when it can't be hurt. */
export const maxHp = (spec: UnitSpec) => spec.mobile ? (spec.mobile.hp === Infinity ? undefined : spec.mobile.hp) : spec.hp;
