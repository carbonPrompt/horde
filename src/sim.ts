import { buildCity } from "./cities/build";
import type { CityRecipe } from "./cities/recipe";
import * as C from "./config";
import type { Order } from "./orders";
import { nextOrder, arrived, ESCORT_R } from "./orders";
import { EV_SAFE, EV_EVAC, EV_TURNED, EV_CRUSHED, EV_KILLED_BY_US, EV_FRIENDLY_FIRE, EV_SHOT, hash32, isEnding, personOf, placeFor, PL_HOME, PL_WORK, PL_SCHOOL, PL_STORE, PL_ROAD, PL_VENUE,
  rallyFor, RALLY_HOME, RALLY_ZONE, PLAN_STRAIGHT, PLAN_GATHER, PLAN_MEET, PLAN_HOME_WAIT, PLAN_FOLLOW, PLAN_NONE,
  EV_HEAD_HOME, EV_HOME_WAIT, EV_FAMILY_TOGETHER, EV_ZONE_WAIT, EV_GAVE_UP, EV_TO_ZONE, EV_CLASS, PLAN_CLASS,
  PLAN_REFUSE, EV_REFUSE, EV_BROKE, EV_TALKED_OUT, EV_SOLO, AGE_PACE, FATE_EVAC,
  PLAN_GO_BACK, EV_SAW_TURN, EV_FROZE, EV_GO_BACK, EV_GRIEF_STAY } from "./people";
import { padCost, roundParts, roundScore, medalFor, mayhem, savedPct, type RoundParts } from "./scoring";
import { heat, rollGap, rollSize, routesFor } from "./storyteller";
import * as St from "./stats";
import * as Sup from "./supply";
import { newEngineer, stepEngineers, inEngineerReach } from "./engineers";
import type { OtherKill } from "./stats";
import { BRIDGE, BUILDING, CityMap, ROAD, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, WATER, extractRailLines, generateCity, rng, walkable } from "./map";
import { decodeCityMap } from "./osm";
import { navOf } from "./nav";
import { REAL_CITY_MAPS } from "./realcities";
import { realAreaMap } from "./realcity/load";
import { GROUPS, pruneGroups, type GroupSlot } from "./groups";
import { labelBuildings, makeSquad, squadSize, soldierStats, type Soldier, fireTeamForm, fortBlock } from "./squads";
/** 0.36: levels that count for the roof range bonus (real towers stay tall but don't outrange the map). */
export const roofLv = (lv: number) => Math.min(lv, C.ROOF_BONUS_MAX_LV);

export const CIV = 0, INF = 1, DEAD = 2, SAFE_CIV = 3; // SAFE_CIV: civilian inside the safe zone

export interface Support {
  kind: C.SupportKind;
  x: number; y: number; // cell
  paid: number;
  deployT?: number;
  extractT?: number;
  spawnT?: number;
  liftT?: number; // Evac Point: seconds to the next lift
  pickupAt?: number; // Evac Point: battle time the inbound lift touches down
}

/** A way into the city along the map edge: a road, highway, rail line, bridge or the river. */
/** 0.48: minimap alerts. zone = someone bitten inside a safe zone, bite = out in the city, unit = a unit clawed at,
 *  wall = infected gnawing a wall or gate, breach = a wall cell down, abort = an evac lift waved off. */
export type PingKind = "zone" | "bite" | "unit" | "wall" | "breach" | "abort" | "ammo";
export const PING_KINDS: PingKind[] = ["zone", "bite", "unit", "wall", "breach", "abort", "ammo"];
export interface Ping { kind: PingKind; x: number; y: number; t: number }
export interface Score {
  saved: number; pct: number; medal: string | null; reason: string; intact: number; bonus: string | null; xp: number; waves: number; round: boolean; damage: number; spent: number;
  score: number; parts: RoundParts; kills: number; // 0.20: round score 0..100 and its four parts
  killsAfter?: number; damageAfter?: number; mayhem?: number; // Keep fighting (after the round)
  left?: number; zoneHeld?: number; // 0.30.1: people still outside (left behind) and in the zone when the round was scored
  // 0.42: refused to leave (still at home), refusers lost at home, talked out, bluffers who ran; killed by accident
  refused?: number; refusedLost?: number; talkedOut?: number; broke?: number; civKilledByUs?: number; civFriendlyFire?: number;
  perM?: number; underBudget?: boolean; // 0.48: people saved per $1M spent; a medal won spending <= UNDER_BUDGET_PCT of budget + income
}

export interface Entry { kind: "highway" | "rail" | "bridge" | "road" | "river"; cells: [number, number][]; x: number; y: number; edge: number; weight: number }

export interface Unit {
  kind: C.UnitKind;
  x: number; y: number; // cell
  soldiers?: Soldier[]; // 0.49: Garrison, Sniper team, Paratroopers
  fortBox?: [number, number, number]; // 0.52.1: a rooftop squad's sandbag fortification: top-left cell and size
  squadPaid?: number; // 0.49: what the squad first cost (top-ups are priced from it)
  // 0.50: Troops/Sniper roof state: climb (going up, FORTIFY_S), up (fortified), descend (coming down, DISMOUNT_S);
  // undefined = on the ground. fortT: seconds left climbing/descending; fortAt: the roof (climb) or street (descend) cell.
  fort?: "climb" | "up" | "descend"; fortT?: number; fortAt?: [number, number];
  planPos?: [number, number]; // 0.50: where it stood when the battle started (Retry rebuilds the plan from this)
  range: number;
  ammo: number; // Infinity when it reloads inside the zone
  cooldown: number;
  cooldown2?: number; // second gun (APC autocannon)
  kiting?: boolean; // backing away from infected while firing
  kills: number;
  sid?: number; // 0.57: the recorder's index for this unit
  drop?: number; // 0.59: the paratrooper drop (recorder strike index) this squad came from
  reserve?: number; resT?: number; dry?: boolean; resPaid?: number; resMags?: number; // 0.60: batteries' rounds beyond the magazine, reload countdown; out of ammo (pinged once)
  waitingSupply?: boolean; waitAt?: [number, number]; supplyAgainT?: number; // supplyAgainT: no new trip to the wall before this (review I4) // 0.60: parked at the wall for an engineer; the spot it is going to
  shotX: number; shotY: number; shotT: number; // last shot, for tracers
  mode?: C.TargetMode;
  paid?: number;
  rateMul?: number;
  supplied?: boolean;
  rangeBoosted?: boolean;
  parentSupport?: Support;
  parentUnit?: Unit;
  dismounted?: boolean;
  deployT?: number; // bought mid-battle: seconds until it is set up
  extractT?: number; // being sold mid-battle: seconds until it is pulled out (and refunded)
  // Mobile units (APC, gunboat, paratroopers, police, militia): their own little brain.
  post?: [number, number]; // where you put it; it roams within its leash of this
  hp?: number;
  ai?: "hunt" | "hold" | "flee" | "home" | "reload" | "leave" | "supply"; // 0.60 supply: driving to a spot at the wall to wait for an engineer
  recallFrom?: [number, number]; // 0.24: its post before a Recall
  crushT?: number; // 0.25: seconds left slowed from crushing infected
  yieldCiv?: boolean; // 0.25: civilians in its way this tick: it creeps
  yieldMul?: number; // 0.33: how much the crowd around it slows it
  movedT?: number; // 0.33: when it last moved
  lastX?: number; lastY?: number; headX?: number; headY?: number; // 0.32: where a vehicle is heading (people clear its path)
  goal?: number; nav?: Uint16Array; thinkT?: number; reloadT?: number;
  // 0.45: orders. cmd: the player has commanded it (it no longer hunts on its own); holdAt: where it holds once its
  // queue is empty; standby: holds fire; recallOrders: its queue while Recall has it.
  orders?: Order[]; cmd?: boolean; standby?: boolean; holdAt?: [number, number];
  recallOrders?: { orders: Order[]; holdAt?: [number, number]; standby?: boolean };
  planOrders?: { orders: Order[]; standby: boolean }; // 0.45: its orders as planned, kept at the battle's start (Retry replays these)
}

export type Phase = "plan" | "battle" | "over";
/** 0.44: something the player can click and select. */
export type Entity = { unit: Unit } | { support: Support } | { orbit: Orbit };

/** Something scheduled to happen at battle time `at` (airstrike bombs, fire landing, a para drop). */
interface Pending { kind: C.AbilityKind | "bomb" | "shell"; at: number; x: number; y: number; x2: number; y2: number; chuteSpawned?: boolean; strike?: number } // 0.57 strike: recorder index
export interface Fire { x: number; y: number; r: number; until: number; strike?: number }
export interface Fallout { x: number; y: number; r: number; until: number; strike?: number }
export interface Blast { x: number; y: number; r: number; t: number; color: string }
/** 0.28: what a round looks like in flight: small arms, sniper, cannon, shell, rocket. */
export const SHOT_SMALL = 0, SHOT_SNIPER = 1, SHOT_CANNON = 2, SHOT_SHELL = 3, SHOT_ROCKET = 4;
/** 0.28: one round in the air, for the renderer: fired at t from (x0,y0), arrives at `land` at (x1,y1). */
/** 0.46: one AC-130. `fx/fy`: the plane while it flies in, to a new spot or home (not while circling).
 *  `stationLeft`: station time it brings when it next arrives. `g*`: gun cooldowns (s). `shots*`: rounds fired. */
export interface Orbit {
  x: number; y: number; until: number; angle: number; away?: boolean; inbound?: boolean; leaving?: boolean;
  fx: number; fy: number; stationLeft: number; arrived?: boolean;
  g25: number; g40: number; g105: number; shots25: number; shots40: number; shots105: number;
  strike?: number; // 0.57: recorder strike index
}
export interface Shot { x0: number; y0: number; x1: number; y1: number; t: number; land: number; cls: number; kind: C.UnitKind | "ac130" }
/** 0.28: a shell or rocket on its way; it explodes (damage, craters, blast) when it lands. */
interface Impact { x: number; y: number; r: number; dmg: number; maxHits?: number; sDmg: number; u: Unit; t: number; color: string; gren?: boolean } // 0.59 gren: a grenadier's M320 round (achievement counter)
/** Muzzle velocity in meters per second, for flight time (gameplay-compressed for the slow ones). */
const SHOT_MPS = [900, 950, 1500, 0, 0];
export interface Crater { x: number; y: number; r: number; t: number; seq: number } // seq: 1, 2, 3... (the renderer paints each once)
export interface SupplyCrate { x: number; y: number; until: number }
export type TransportKind = "helo_uh60" | "helo_ch47" | "helo_extract" | "c130_para" | "c130_supply" | "c130_apc" | "jet_strike" | "drone_supply";
export interface Transport {
  kind: TransportKind;
  x: number; y: number;
  sx: number; sy: number;
  tx: number; ty: number;
  ex: number; ey: number;
  angle: number;
  t: number;
  dur: number;
  hoverS: number;
  color: string;
  label?: string;
  air?: string; // which airframe to draw when the kind alone doesn't say (A-10, AC-130, MC-130, Tomahawk)
}
export interface Parachute {
  kind: "trooper" | "supply" | "apc";
  x: number; y: number;
  z: number; // 1.0 (release altitude) down to 0.0 (ground touchdown)
  vz: number;
  driftX: number; driftY: number;
  color: string;
}
export interface TrainRun {
  pts: [number, number][];
  pos: number;
  x: number; y: number;
  angle: number;
  boarded: number;
}

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
/** 0.52: rooftop shuffle: quiet for this long, one soldier moves every ~4 s at a slow walk (cells/s). */
const ROOF_IDLE_S = 3, ROOF_SHUFFLE_TICKS = 80, ROOF_WALK = 0.7, CLIMB_WALK = 1.6; // CLIMB_WALK: to the foot of the building (cells/s)
const BUCKET = 4; // cells per spatial bucket
const ERRAND_HOLD = "hold" as const; // 0.40: an errand says stand here
/** 0.28: distance-field units. A straight step costs FIELD_STEP, a diagonal FIELD_DIAG (~sqrt 2), and a cell
 *  under a standing ground unit adds FIELD_OCC (walk around it unless it plugs the only way). */
export const FIELD_STEP = 10, FIELD_DIAG = 14, FIELD_OCC = 300;
const BITE_P3 = 1 - Math.pow(1 - C.BITE_CHANCE, 3); // bite checked every 3rd tick
/** exp(x) for the crowd's pushes, cheap: (1 + x/32)^32, good to a fraction of a percent for x in [-6, 2]. */
function fexp(x: number) { let y = 1 + x / 32; if (y <= 0) return 0; y *= y; y *= y; y *= y; y *= y; y *= y; return y; }

export interface SimOpts {
  budget?: number;
  waveMul?: number;
  sites?: number;
  speedMul?: number;
  civilians?: number;
  realCityId?: string;
  realArea?: string; // 0.36: "<city>/<area>"; loadRealArea(key) must have run first
  customMap?: CityMap;
  /** 0.35: a designed campaign city (built by buildCity). */
  recipe?: CityRecipe;
  mutators?: C.MutatorId[];
  difficulty?: C.Difficulty;
  battleId?: string; // 0.57: the recorder's stable id for this battle (the page makes one per battle)
}

/** 0.45: cell offsets for spreading a group order, nearest first (ties in a fixed order: deterministic). */
const SPREAD: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) out.push([dx, dy]);
  return out.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
})();

export class Sim {
  /** Developer switches (see the dev panel). safeBiteMul: people inside a zone barricade indoors and are harder to bite. */
  dev = { income: true, waves: true, bites: true, wallDamage: true, unitDamage: true, friendlyFire: true, instantDeploy: false, unlimitedMoney: false, noStockpileLimits: false, safeBiteMul: C.SAFE_BITE_MUL };
  /** Dev: kill every infected now. */
  /** Dev/test: everyone still in the city (outside or in a zone) dies, except the first `keep` people outside. */
  devRemoveCivilians(keep = 0) { let n = 0; for (let k = 0; k < this.civN; k++) if (this.state[k] === CIV || this.state[k] === SAFE_CIV) { if (keep > 0 && this.state[k] === CIV) { keep--; continue; } this.state[k] = DEAD; n++; } return n; }
  devClearInfected() { let n = 0; for (let k = 0; k < this.n; k++) if (this.state[k] === INF) { this.state[k] = DEAD; n++; } return n; }
  /** Dev: the next horde arrives now. */
  devWaveNow() { this.nextWaveT = this.time; }
  /** Dev: end the battle now (scored as if time ran out). */
  devEndNow() { this.endNow = true; this.tick = Math.ceil(this.tick / 10) * 10 - 1; }
  endNow = false;
  /** Pull out: the battle ends now and only the people already evacuated count. */
  withdraw() { if (this.phase === "battle") { this.endNow = true; this.checkEnd(true); } }
  /** Round complete and the player calls it there. */
  callIt() { if (this.phase === "battle") { this.calledIt = true; this.endNow = true; this.checkEnd(true); } }
  calledIt = false;
  map: CityMap;
  w: number; h: number;
  phase: Phase = "plan";
  budget = C.START_BUDGET;
  time = 0; // battle seconds
  tick = 0;
  mutators = new Set<C.MutatorId>();

  // Agents (structure of arrays).
  n: number;
  ax: Float32Array; ay: Float32Array;
  hx: Float32Array; hy: Float32Array; // current heading
  state: Uint8Array;
  mutant: Uint8Array; // 0 = normal, 1 = Swimmer mutant
  hp: Float32Array;

  // Safe zone.
  zones: [number, number][][] = [];
  supply: Sup.ZoneSupply[] = []; // 0.60: one per zone (same order as zones)
  /** 0.50: battle groups on keys 1-0 (units or one zone per slot). */
  groups: GroupSlot[] = Array(GROUPS).fill(null);
  /** 0.50: a unit that still belongs in a group: standing, not lost, not being pulled out. */
  pruneGroupsNow() { for (const g of this.groups) if (g && "units" in g) { this.groups = pruneGroups(this.groups, u => this.groupAlive(u)); return; } }
  groupAlive(u: Unit) { return this.units.includes(u) && (u.hp === undefined || u.hp > 0) && u.extractT === undefined; }
  zoneCellsEach: number[] = [];
  get zonePoly() { return this.zones.flat(); }
  get zoneClosed() { return this.zones.length > 0; }
  inZone: Uint8Array; // 1 inside (interior), 2 wall, 3 gate
  wallHp: Float32Array;
  zoneCells = 0;
  units: Unit[] = [];
  supports: Support[] = [];

  // Flow fields (distance in steps; 65535 = unreachable).
  civField: Uint16Array; infField: Uint16Array; swimField: Uint16Array;
  // Per-cell walking direction down each field (dx, dy; 0,0 = none), worked out once per field rebuild
  // instead of once per agent per tick.
  civDir: Float32Array; infDir: Float32Array; swimDir: Float32Array;
  dens: Uint16Array; // people per cell this tick (crowd separation)
  sumX: Float32Array; sumY: Float32Array; // 0.28: summed positions per cell, for the sand-grain push inside a cell
  biasC: Float32Array; biasS: Float32Array; // each agent's fixed lean left/right of the field direction (infected only since 0.30)
  fieldDirty = true;
  // 0.30 crowd model (see stepCiv): velocity, fear, odd panic acts, knocked down, families.
  velX: Float32Array; velY: Float32Array; // cells/s
  zWand: Float32Array; // 0.30.1: each infected's wandering heading offset (rad)
  /** 0.33: infected don't know the map. The route field as it stood before the first bridge went: they keep walking it
   *  (null until a bridge is blown). zMem per infected: 0 walks the old routes, 1 hit the gap and mills, 2 re-oriented. */
  memDir: Float32Array | null = null;
  zMem: Uint8Array;
  fear: Float32Array; zStim: Float32Array; // fear 0..1; how scary the nearest infected is (sensed every 4th tick)
  act: Uint8Array; actT: Float32Array; // panic acts: 1 run the wrong way, 2 freeze; seconds left
  downT: Float32Array; crushT: Float32Array; // knocked down (s left); time spent in a crush
  pspd: Float32Array; famLead: Int32Array; famSize: Uint8Array;
  // 0.37: armed population and household group origins
  cityId = "generated";
  civWep: Uint8Array; civAmmo: Uint8Array; civMilitia: Uint8Array; civCd: Float32Array; civShotT: Float32Array;
  // 0.39: people. Where they live and stood at spawn, how their round ended (0 = still in it, else a FATE_* code), the
  // clock's start (minutes since midnight) and the story log: one event stream, linked per person newest first.
  startMin = 600;
  seed: number; // 0.39: who each person is comes from this (people.personOf)
  homeCell: Int32Array; startCell: Int32Array; fate: Uint8Array; lastEv: Int32Array; private lastShotNote: Float32Array;
  // 0.40: daily life. Off until setStartTime (old tests and attract mode stay as 0.39). spawnX/Y: where the household
  // stood at spawn (home), so a new start time always re-places from the same base.
  dayLife = false;
  dayPlace: Uint8Array; workCell: Int32Array; schoolCell: Int32Array; age: Uint8Array; atVenue: Uint8Array;
  spawnX: Float32Array; spawnY: Float32Array; schools: number[] = []; private doorSpots: Int32Array = new Int32Array(0);
  // 0.40: alert plans (people.PLAN_*), each errand's goal cell (or, for PLAN_FOLLOW, the person followed), seconds in
  // the current stage (negative: still getting ready to leave), seconds with no route, and each household's rally
  plan: Uint8Array; goal: Int32Array; planT: Float32Array; stuckT: Float32Array; rally: Uint8Array;
  progT: Float32Array; ancX: Float32Array; ancY: Float32Array; // seconds without moving 2 cells from the anchor point (routes detour, so not 'closer')
  // walking-home fields depend only on this: walkable cells frozen at the battle's start (rubble from collapses is not
  // added, so a replay after a snapshot load builds the same fields) and a version bumped by every wall/gate/bridge change
  walkMask: Uint8Array | null = null; navVersion = 0;
  classKids = 0; // 0.41: kids walking to the zone with their class this round
  // 0.42: refusers. refuser: 0 not one, 1 refusing, 2 talked out, 3 broke and ran; resolve: drops while infected are
  // close (at 0 they run); persuadeT: seconds a unit has stood beside them. unitNear: cells a unit stands within
  // PERSUADE_R of, stamped this tick (unitNearGen === tick + 1).
  refuser: Uint8Array; resolve: Float32Array; persuadeT: Float32Array;
  solo: Uint8Array; // 0.42: a teen heading for the zone alone (out of the family group)
  refusers = 0; talkedOut = 0; broke = 0; refuserList: number[] = []; // (the list: for the map's rings)
  private unitNear: Int32Array | null = null;
  evT: Float32Array; evK: Int32Array; evCode: Uint8Array; evArg: Int32Array; evPrev: Int32Array; evN = 0;
  civKills = 0; civFriendlyFire = 0; lastCivShotT = -1; lastCivShotX = 0; lastCivShotY = 0;
  // 0.30: the crowd waiting at the Evac Points takes room: the waiting area grows with how many are waiting
  // (at about WAIT_RHO people/m2) instead of everyone piling into the cells around the pad
  gatherD = C.EVAC_GATHER_D; private waitN = 0; private waitCount = 0; private padRing = new Uint16Array(0);
  private lod = 1; // big crowds think every lod-th tick (staggered) and coast on their velocity in between
  cellHead: Int32Array; cellNext: Int32Array; // everyone alive, listed per cell (near neighbors)
  cellGen: Uint32Array; private gen = 0; // a cell's list is current only when its stamp matches gen (no full clear per tick)
  fearB: Float32Array; noiseB: Float32Array; // per bucket: scares in the air (gunfire, blasts, bites); noise that draws infected
  panSum: Float32Array; panCnt: Uint16Array; panPrev: Float32Array; // per bucket: summed fear this tick; average fear last tick
  crushed = 0; // people killed in crushes
  private scanT = -1; // shots and blasts up to this time already turned into fear and noise

  // Spatial hash.
  bw: number; bh: number;
  // Two lists per bucket: infected (head) and civilians (headC), so a packed horde never hides a civilian
  // behind its own members when a search is capped.
  head: Int32Array; headC: Int32Array; next: Int32Array;

  kills = 0;
  swimmersKilled = 0;
  infectedEver = 0;
  breaches = 0;
  lastWaveCount = 0;
  lastWaveBig = false;
  killGrid: Uint16Array;
  killByKind: Partial<Record<C.UnitKind, Uint16Array>> = {};
  maxKillCell = 1;

  // Terrain and structural damage.
  damage: Uint8Array;
  rubble: Uint8Array;
  craters: Crater[] = [];
  craterSeq = 0;
  /** 0.23: how deep in a crater each cell is (0 clean .. 255 bottom): rough ground that slows movers. */
  rough: Uint8Array;
  /** 0.24: cells covered by a ground unit's footprint (turret, mortar, howitzer, HIMARS, APC, tank).
   *  Nobody walks through them; infected claw at the unit like a wall. Rebuilt every tick in battle. */
  occ: Uint8Array;
  /** 0.28: the same footprints for units that stay put (emplacements, not vehicles on the move). The distance
   *  fields route around these; a change in them rebuilds the fields. */
  occStatic: Uint8Array;
  private occSig = 0;
  /** 0.32: tanks and APCs this tick: center, half size (cells) and heading, so people step out of their way. */
  private movers: { x: number; y: number; h: number; dx: number; dy: number; moving: boolean }[] = [];
  private nearMover(x: number, y: number) {
    for (const v of this.movers) { const r = v.h + C.VEH_CLEAR + C.VEH_AHEAD; if (Math.abs(x - v.x) < r && Math.abs(y - v.y) < r) return true; }
    return false;
  }
  private rebuildOcc(dt = 0) {
    this.occ.fill(0);
    this.movers.length = 0;
    let sig = 0;
    for (const u of this.units) {
      const spec = C.UNITS[u.kind];
      if (spec.on !== "ground" || this.onRoof(u) || u.extractT !== undefined || (u.hp !== undefined && u.hp <= 0)) continue;
      const [x0, y0, x1, y1] = this.footRect(spec.foot, Math.floor(u.x), Math.floor(u.y));
      if (spec.crushSlow !== undefined) {
        const mx = u.x - (u.lastX ?? u.x), my = u.y - (u.lastY ?? u.y), ml = hyp(mx, my);
        if (ml > 1e-4) { u.headX = mx / ml; u.headY = my / ml; u.movedT = this.time; }
        u.lastX = u.x; u.lastY = u.y;
        // 0.33: one waiting for people to step aside still counts as moving (they keep clearing its path)
        this.movers.push({ x: (x0 + x1 + 1) / 2, y: (y0 + y1 + 1) / 2, h: (x1 - x0 + 1) / 2, dx: u.headX ?? 0, dy: u.headY ?? 0, moving: u.movedT !== undefined && this.time - u.movedT < 2 && u.ai !== "reload" });
      }
      if (spec.crushSlow !== undefined && !(u.deployT && u.deployT > 0)) this.crushUnder(u, x0, y0, x1, y1, dt);
      for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) { const i = y * this.w + x; if (this.occ[i] !== 1) this.occ[i] = spec.crushSlow !== undefined ? 2 : 1; } // 0.33: 2 = a tank/APC (people edge out from under it)
      if (!spec.mobile) sig = (sig + Math.imul((x0 + 1) * 73856093 ^ (y0 + 1) * 19349663, spec.foot + 1)) | 0;
    }
    if (sig !== this.occSig) {
      this.occSig = sig;
      this.occStatic.fill(0);
      for (const u of this.units) {
        const spec = C.UNITS[u.kind];
        if (spec.on !== "ground" || this.onRoof(u) || spec.mobile || u.extractT !== undefined || (u.hp !== undefined && u.hp <= 0)) continue;
        const [x0, y0, x1, y1] = this.footRect(spec.foot, Math.floor(u.x), Math.floor(u.y));
        for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.occStatic[y * this.w + x] = 1;
      }
      this.fieldDirty = true;
    }
  }
  /** 0.28: steps inward from the perimeter for interior cells (0 at walls/gates, 255 = deep or unreachable).
   *  People who just came through a gate keep walking inward at full pace instead of stopping in the doorway. */
  depth: Uint8Array;
  private buildDepth() {
    const cells = this.w * this.h, w = this.w, q = new Int32Array(cells);
    this.depth.fill(255);
    let qh = 0, qt = 0;
    for (let i = 0; i < cells; i++) if (this.inZone[i] === 2 || this.inZone[i] === 3) { this.depth[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const c = q[qh++], cx = c % w, d = this.depth[c] + 1;
      if (d >= C.GATE_CLEAR_DEPTH + 1) continue;
      for (const n of [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, c - w, c + w]) {
        if (n < 0 || n >= cells || this.depth[n] !== 255 || this.inZone[n] !== 1 || !walkable(this.map.tile[n])) continue;
        this.depth[n] = d; q[qt++] = n;
      }
    }
  }
  /** 0.25: a tank or APC kills every infected under its footprint (its kills) and slows for a moment;
   *  civilians under or right around it make it creep instead (they step aside; it never runs people over). */
  private crushUnder(u: Unit, x0: number, y0: number, x1: number, y1: number, dt: number) {
    if (u.crushT && u.crushT > 0) u.crushT -= dt;
    let crushed = 0, civ = 0;
    const b0x = Math.max(0, ((x0 - 1) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x1 + 2) / BUCKET) | 0);
    const b0y = Math.max(0, ((y0 - 1) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y1 + 2) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== INF) continue;
        const x = this.ax[k], y = this.ay[k];
        if (x >= x0 && x < x1 + 1 && y >= y0 && y < y1 + 1) { this.state[k] = DEAD; this.hp[k] = 0; this.recordKill(k, u); crushed++; }
      }
      if (civ < 40) for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
        const x = this.ax[k], y = this.ay[k];
        if (x >= x0 - 1 && x < x1 + 2 && y >= y0 - 1 && y < y1 + 2 && ++civ >= 40) break;
      }
    }
    if (crushed) { u.crushT = C.CRUSH_SLOW_S; this.stats.c.crushedByVehicles += crushed; } // 0.59
    // 0.33: the thicker the crowd around it, the slower it goes (people and tank edge around each other)
    u.yieldCiv = civ > 0;
    u.yieldMul = civ ? Math.max(C.CRUSH_YIELD_MUL, 1 / (1 + civ / C.CRUSH_CROWD_N)) : 1;
  }
  /** 0.33: how many people moving a footprint from (ox,oy) to (nx,ny) would put it on (only the cells it newly covers count). */
  private civOnNewCells(foot: number, ox: number, oy: number, nx: number, ny: number) {
    const [a0, b0, a1, b1] = this.footRect(foot, Math.floor(ox), Math.floor(oy));
    const [x0, y0, x1, y1] = this.footRect(foot, Math.floor(nx), Math.floor(ny));
    if (x0 === a0 && y0 === b0) return 0;
    let n = 0;
    const c0x = Math.max(0, (x0 / BUCKET) | 0), c1x = Math.min(this.bw - 1, (x1 / BUCKET) | 0);
    const c0y = Math.max(0, (y0 / BUCKET) | 0), c1y = Math.min(this.bh - 1, (y1 / BUCKET) | 0);
    for (let by = c0y; by <= c1y; by++) for (let bx = c0x; bx <= c1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
        const x = this.ax[k], y = this.ay[k];
        if (x >= x0 && x < x1 + 1 && y >= y0 && y < y1 + 1 && !(x >= a0 && x < a1 + 1 && y >= b0 && y < b1 + 1) && ++n > C.VEH_NUDGE) return n;
      }
    return n;
  }
  /** Speed multiplier on cell i from craters and rubble (the stronger of the two; they don't stack). */
  roughMul(i: number) {
    let m = this.rough[i] ? 1 - (1 - C.CRATER_SLOW_MUL) * (this.rough[i] / 255) : 1;
    if ((this.rubble[i] || this.damage[i] >= 140) && C.RUBBLE_SLOW_MUL < m) m = C.RUBBLE_SLOW_MUL;
    return m;
  }
  buildingsCollapsed = 0;

  // Abilities, air/ground deployment transports, parachutes, supply crates, and bridges.
  charges: Record<C.AbilityKind, number> = { airstrike: 0, firebomb: 0, para: 0, supply_drop: 0, barrage: 0, moab: 0, nuke: 0, a10: 0, cluster: 0, tomahawk: 0, gunship: 0 };
  bought: Record<C.AbilityKind, number> = { airstrike: 0, firebomb: 0, para: 0, supply_drop: 0, barrage: 0, moab: 0, nuke: 0, a10: 0, cluster: 0, tomahawk: 0, gunship: 0 };
  fallout: Fallout[] = [];
  orbits: Orbit[] = []; // AC-130s: inbound, on station until `until`, away refueling until `until`, or leaving for good
  nukesUsed = 0;
  bridges: number[][] = []; // cells of each bridge
  c4 = new Set<number>(); // bridge ids with a charge planted
  demo = new Set<number>(); // 0.38: building demolition charges, by the cell they were planted on
  demoBlown = new Set<number>();
  guardPosts: { i: number; cd: number; dead: number }[] = []; // 0.38: armed guards on the wall walk
  private guardKey = -1;
  guardKills = 0; guardsLost = 0;
  carriers: { k: number; t: number }[] = []; // 0.38: hidden carriers and when they turn
  private carrierNext = 0;
  carriersTurned = 0;
  blown = new Set<number>();
  repairLow = new Set<number>(); // 0.59: wall cells a Repair Yard is bringing back from under half (Patched Up)
  mapVersion = 0; // bumps when the map itself changes (a bridge falls or buildings/terrain take damage)
  pending: Pending[] = [];
  fires: Fire[] = [];
  blasts: Blast[] = [];
  shots: Shot[] = [];
  private impacts: Impact[] = [];
  /** 0.28: record a round for the renderer; returns its flight time in seconds. */
  private shoot(u: Unit, x1: number, y1: number, cls: number, mps: number, delay = 0, ox?: number, oy?: number) {
    const x0 = ox ?? u.x + 0.5, y0 = oy ?? u.y + 0.5; // 0.49: a soldier fires from where they stand
    const fl = Math.min(3, Math.max(cls >= SHOT_SHELL ? 0.4 : 0, hyp(x1 - x0, y1 - y0) * C.CELL_M / mps));
    const t = this.time + delay;
    if (this.shots.length < 4000) this.shots.push({ x0, y0, x1, y1, t, land: t + fl, cls, kind: u.kind });
    return fl + delay;
  }
  transports: Transport[] = [];
  chutes: Parachute[] = [];
  supplyCrates: SupplyCrate[] = [];
  railLines: [number, number][][] = [];
  trains: TrainRun[] = [];
  nextTrainT = C.TRAIN_FIRST_S;
  trainsEvacuated = 0;
  evacuated = 0; // people flown or carried out of the city: the score
  liftsFlown = 0; liftsAborted = 0;
  /** 0.57: the battle recorder (plain data, carried by snapshots); curStrike: the strike whose effect is resolving. */
  stats!: St.Recorder; curStrike = -1;
  liftLog: { kind: "ok" | "abort"; n: number; x: number; y: number }[] = []; // for the UI
  /** 0.49: which building each roof cell belongs to (squads.labelBuildings), worked out once per map. A collapsed
   *  cell keeps its old id: nothing can be placed on it any more, so it never matters. */
  private bid: Int32Array | null = null;
  get buildingId(): Int32Array { return this.bid ??= labelBuildings(this.map.tile, this.map.height, this.w, this.h, C.BUILDING_MAX_CELLS); }
  /** 0.48: minimap alerts (StarCraft style), drained by the UI. One per kind per PING_CELL square per PING_GAP_S. */
  pingLog: Ping[] = [];
  private pingAt = new Map<number, number>();
  ping(kind: PingKind, x: number, y: number) {
    if (this.phase !== "battle") return;
    const key = (((y / C.PING_CELL) | 0) * 1024 + ((x / C.PING_CELL) | 0)) * 8 + PING_KINDS.indexOf(kind);
    const last = this.pingAt.get(key);
    if (last !== undefined && this.time - last < C.PING_GAP_S) return;
    this.pingAt.set(key, this.time);
    this.pingLog.push({ kind, x, y, t: this.time });
    if (this.pingLog.length > 64) this.pingLog.splice(0, this.pingLog.length - 64); // nobody draining (headless)
  }
  civKilledByUs = 0; // civilians killed by our own bombs and fire
  depots: { x: number; y: number; used: boolean }[] = [];
  apcField: Uint16Array;

  /** Difficulty knobs for a city: budget and how hard the hordes hit. */
  difficulty: C.Difficulty = "medium";
  get diff(): C.DifficultyDef { return C.DIFFICULTY[this.difficulty]; }
  waveMul = 1;
  civN: number; popMul: number;
  sitesN = C.OUTBREAK_SITES;
  speedMul = 1;
  infHpMul = 1;
  incomeMul = 1;
  killBountyMul = 1;
  wallMaxHp() { return this.mutators.has("fragile_walls") ? C.WALL_HP * 0.5 : C.WALL_HP; }
  gateMaxHp() { return this.mutators.has("fragile_walls") ? C.GATE_HP * 0.5 : C.GATE_HP; }
  constructor(seed: number, opts: SimOpts = {}) {
    this.seed = seed;
    this.stats = St.newRecorder(opts.battleId ?? "b" + seed);
    if (opts.difficulty && C.DIFFICULTY[opts.difficulty]) this.difficulty = opts.difficulty;
    this.budget = C.startBudget(opts.budget || C.START_BUDGET, opts.civilians ?? C.CIVILIANS);
    if (opts.waveMul) this.waveMul = opts.waveMul;
    if (opts.sites) this.sitesN = opts.sites;
    if (opts.speedMul) this.speedMul = opts.speedMul;
    for (const m of opts.mutators ?? []) this.mutators.add(m);
    if (this.mutators.has("titan_strain")) { this.infHpMul *= 2.5; this.budget = Math.round(this.budget * 1.35); }
    if (this.mutators.has("swimmer_surge")) { this.budget = Math.round(this.budget * 1.2); }
    if (this.mutators.has("blitz_hordes")) { this.speedMul *= 1.15; this.killBountyMul *= 1.5; }
    if (this.mutators.has("supply_shortage")) { this.budget = Math.round(this.budget * 1.3); }
    if (this.mutators.has("blood_money")) { this.budget = Math.round(this.budget * 0.75); this.incomeMul *= 2; this.killBountyMul *= 2; }
    // 0.48: difficulty reaches the wallet (on top of any mutator)
    this.budget = Math.round(this.budget * this.diff.budgetMul); this.incomeMul *= this.diff.incomeMul; this.killBountyMul *= this.diff.incomeMul;
    const rle = opts.realCityId && REAL_CITY_MAPS[opts.realCityId];
    const area = opts.realArea ? realAreaMap(opts.realArea) : undefined;
    if (opts.realArea && !area) throw new Error(`real area ${opts.realArea} not loaded (await loadRealArea first)`);
    this.cityId = opts.realArea ? opts.realArea.split("/")[0] : opts.realCityId ?? opts.recipe?.id ?? "generated";
    this.map = area ? { ...area, seed, tile: area.tile.slice(), height: area.height.slice() }
      : opts.customMap ? opts.customMap : rle ? decodeCityMap(rle, seed) : opts.recipe ? buildCity(opts.recipe) : generateCity(seed);
    this.w = this.map.w; this.h = this.map.h;
    const cells = this.w * this.h;
    this.killGrid = new Uint16Array(cells);
    this.damage = new Uint8Array(cells);
    this.rubble = new Uint8Array(cells);
    this.rough = new Uint8Array(cells);
    this.occ = new Uint8Array(cells);
    this.occStatic = new Uint8Array(cells);
    this.depth = new Uint8Array(cells).fill(255);
    this.inZone = new Uint8Array(cells);
    this.wallHp = new Float32Array(cells);
    this.gnawTick = new Uint32Array(cells);
    this.gnawCnt = new Uint8Array(cells);
    this.civField = new Uint16Array(cells);
    this.infField = new Uint16Array(cells);
    this.swimField = new Uint16Array(cells);
    this.civDir = new Float32Array(cells * 2); this.infDir = new Float32Array(cells * 2); this.swimDir = new Float32Array(cells * 2);
    this.dens = new Uint16Array(cells);
    this.sumX = new Float32Array(cells); this.sumY = new Float32Array(cells);
    this.bw = Math.ceil(this.w / BUCKET); this.bh = Math.ceil(this.h / BUCKET);
    this.head = new Int32Array(this.bw * this.bh).fill(-1);
    this.headC = new Int32Array(this.bw * this.bh).fill(-1);
    this.civN = opts.civilians ?? C.CIVILIANS;
    this.popMul = this.civN / C.CIVILIANS; // hordes and income scale with the population
    this.freeSlot = this.civN;
    this.n = this.civN + Math.max(C.AGENT_RESERVE, Math.round(this.civN * 0.5)); // slots for hordes (dead ones are reused)
    this.next = new Int32Array(this.n).fill(-1);
    this.ax = new Float32Array(this.n); this.ay = new Float32Array(this.n);
    this.hx = new Float32Array(this.n); this.hy = new Float32Array(this.n);
    this.state = new Uint8Array(this.n);
    this.mutant = new Uint8Array(this.n);
    this.hp = new Float32Array(this.n);
    this.biasC = new Float32Array(this.n); this.biasS = new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) { const a = (((k * 0.6180339887) % 1) - 0.5) * 1.0; this.biasC[k] = Math.cos(a); this.biasS[k] = Math.sin(a); }
    this.chase = new Uint8Array(this.n);
    this.velX = new Float32Array(this.n); this.velY = new Float32Array(this.n); this.zWand = new Float32Array(this.n); this.zMem = new Uint8Array(this.n);
    this.fear = new Float32Array(this.n); this.zStim = new Float32Array(this.n);
    this.act = new Uint8Array(this.n); this.actT = new Float32Array(this.n);
    this.downT = new Float32Array(this.n); this.crushT = new Float32Array(this.n);
    this.pspd = new Float32Array(this.n); this.famLead = new Int32Array(this.n).fill(-1); this.famSize = new Uint8Array(this.n);
    this.civWep = new Uint8Array(this.n); this.civAmmo = new Uint8Array(this.n); this.civMilitia = new Uint8Array(this.n);
    this.homeCell = new Int32Array(this.civN).fill(-1); this.startCell = new Int32Array(this.civN).fill(-1);
    this.dayPlace = new Uint8Array(this.civN); this.workCell = new Int32Array(this.civN).fill(-1); this.schoolCell = new Int32Array(this.civN).fill(-1);
    this.age = new Uint8Array(this.civN); this.atVenue = new Uint8Array(this.civN);
    this.spawnX = new Float32Array(this.civN); this.spawnY = new Float32Array(this.civN);
    this.plan = new Uint8Array(this.civN); this.goal = new Int32Array(this.civN).fill(-1); this.planT = new Float32Array(this.civN);
    this.stuckT = new Float32Array(this.civN); this.rally = new Uint8Array(this.civN);
    this.solo = new Uint8Array(this.civN); this.refuser = new Uint8Array(this.civN); this.resolve = new Float32Array(this.civN); this.persuadeT = new Float32Array(this.civN);
    this.progT = new Float32Array(this.civN); this.ancX = new Float32Array(this.civN).fill(-1e4); this.ancY = new Float32Array(this.civN).fill(-1e4);
    this.fate = new Uint8Array(this.civN); this.lastEv = new Int32Array(this.civN).fill(-1); this.lastShotNote = new Float32Array(this.civN).fill(-1e9);
    const ev0 = Math.max(1024, Math.min(C.PEOPLE_EV_CAP, this.civN * 2));
    this.evT = new Float32Array(ev0); this.evK = new Int32Array(ev0); this.evCode = new Uint8Array(ev0); this.evArg = new Int32Array(ev0); this.evPrev = new Int32Array(ev0);
    this.civCd = new Float32Array(this.n); this.civShotT = new Float32Array(this.n).fill(-10);
    this.cellHead = new Int32Array(cells).fill(-1); this.cellNext = new Int32Array(this.n).fill(-1); this.cellGen = new Uint32Array(cells);
    const nb = this.bw * this.bh;
    this.fearB = new Float32Array(nb); this.noiseB = new Float32Array(nb);
    this.panSum = new Float32Array(nb); this.panCnt = new Uint16Array(nb); this.panPrev = new Float32Array(nb);
    this.placeCivilians(seed);
    this.findBridges();
    this.railLines = extractRailLines(this.map);
    this.apcField = new Uint16Array(this.w * this.h);
    this.findDepots(seed);
  }

  /** Fuel depots: building cells on a street corner of a block, spread across the map (own rng: maps stay the same). */
  private findDepots(seed: number) {
    const r = rng((seed ^ 0x2f6b9a1d) >>> 0);
    for (let tries = 0; tries < 4000 && this.depots.length < C.DEPOTS; tries++) {
      const x = 4 + Math.floor(r() * (this.w - 8)), y = 4 + Math.floor(r() * (this.h - 8));
      const i = this.idx(x, y);
      if (this.map.tile[i] !== BUILDING) continue;
      const nearRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.map.tile[this.idx(x + dx, y + dy)] === 0);
      if (!nearRoad || this.depots.some(d => hyp(d.x - x, d.y - y) < 55)) continue;
      this.depots.push({ x, y, used: false });
    }
  }
  depotAt(x: number, y: number) { return this.depots.findIndex(d => !d.used && Math.abs(d.x - x) <= 2 && Math.abs(d.y - y) <= 2); }
  blowDepot(x: number, y: number): string | null {
    if (this.phase !== "battle") return "Fuel depots can only be set off during the battle.";
    const k = this.depotAt(x, y);
    if (k < 0) return "Click a fuel depot (orange).";
    const d = this.depots[k]; d.used = true;
    this.areaDamage(d.x + 0.5, d.y + 0.5, C.DEPOT_RADIUS, 5000, true);
    this.damageTerrain(d.x + 0.5, d.y + 0.5, C.DEPOT_RADIUS, C.STRUCT_DMG_DEPOT);
    this.blasts.push({ x: d.x + 0.5, y: d.y + 0.5, r: C.DEPOT_RADIUS + 2, t: this.time, color: "#ff6d00" });
    this.fires.push({ x: d.x + 0.5, y: d.y + 0.5, r: 5, until: this.time + 8 });
    return null;
  }

  /** Cycle what a unit at x,y shoots first. Returns the new mode, or null when there is no unit there. */
  cycleTarget(x: number, y: number): C.TargetMode | null {
    const u = this.units.find(u => Math.abs(u.x + 0.5 - x) <= 1.5 && Math.abs(u.y + 0.5 - y) <= 1.5);
    return u ? this.cycleTargetOf(u) : null;
  }

  /** 0.44: the next target priority for one unit (nearest, closest to the walls, chasing civilians). */
  cycleTargetOf(u: Unit): C.TargetMode {
    const m = C.TARGET_MODES;
    u.mode = m[(m.indexOf(u.mode ?? "near") + 1) % m.length];
    return u.mode;
  }

  private findBridges() {
    const seen = new Uint8Array(this.w * this.h);
    for (let i = 0; i < seen.length; i++) {
      if (this.map.tile[i] !== BRIDGE || seen[i]) continue;
      const cells: number[] = [], st = [i]; seen[i] = 1;
      while (st.length) {
        const c = st.pop()!; cells.push(c);
        const x = c % this.w, y = (c / this.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const n = this.idx(nx, ny);
          if (this.map.tile[n] === BRIDGE && !seen[n]) { seen[n] = 1; st.push(n); }
        }
      }
      this.bridges.push(cells);
    }
  }
  bridgeAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const i = this.idx(x, y);
    return this.bridges.findIndex(b => b.includes(i));
  }

  idx(x: number, y: number) { return y * this.w + x; }
  tileAt(x: number, y: number) { return this.map.tile[this.idx(x, y)]; }

  /** Walkable for a mover of this kind: interior/gate cells; walls block until breached. */
  passable(i: number, infected: boolean, swimmer = false) {
    if (this.occ[i]) return false; // 0.24: a ground unit stands here
    const t = this.map.tile[i];
    if (!walkable(t) && !(swimmer && t === WATER)) return false;
    const z = this.inZone[i];
    if (z === 2) return this.wallHp[i] <= 0;
    if (z === 3) return !infected || this.wallHp[i] <= 0; // gates let civilians in only
    return true;
  }

  /** 0.27: a street cell a ground unit can drive on: standing walls stop it (gates open for it, breaches let it through). */
  unitPass(i: number) {
    return walkable(this.map.tile[i]) && !(this.inZone[i] === 2 && this.wallHp[i] > 0);
  }
  /** 0.27: direct-fire units on the ground (and the gunboat) can't shoot through a standing wall;
   *  artillery, rooftop units and aircraft fire over it. */
  blockedByWalls(kind: string) {
    const spec = (C.UNITS as Record<string, C.UnitSpec | undefined>)[kind];
    if (!spec || spec.minRange || spec.on === "building" || spec.mobile?.nav === "air") return false;
    return true;
  }
  /** 0.27: the line between two points doesn't cross the zone's perimeter except through a gate or a breach:
   *  no standing wall cell on it, and no step straight from inside the zone to outside (that's through a perimeter building). */
  lineClear(x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
    let prev = this.inZone[this.idx(Math.min(this.w - 1, Math.max(0, x0 | 0)), Math.min(this.h - 1, Math.max(0, y0 | 0)))];
    for (let s = 1; s <= n; s++) {
      const x = (x0 + dx * s / n) | 0, y = (y0 + dy * s / n) | 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const i = y * this.w + x, z = this.inZone[i];
      if (z === 2 && this.wallHp[i] > 0) return false;
      if ((prev === 1 && z === 0) || (prev === 0 && z === 1)) return false;
      prev = z;
    }
    return true;
  }
  /** 0.33: does this unit aim down a sight line (direct fire from the street, a roof or the water)? Artillery and aircraft don't. */
  sightLine(kind: string) {
    const spec = (C.UNITS as Record<string, C.UnitSpec | undefined>)[kind];
    return !!spec && !spec.minRange && spec.mobile?.nav !== "air";
  }
  /** 0.33: a unit's gun height in meters; rooftop units stand on their building. */
  eyeOf(u: Unit) {
    const spec = C.UNITS[u.kind], i = this.idx(Math.min(this.w - 1, Math.max(0, u.x | 0)), Math.min(this.h - 1, Math.max(0, u.y | 0)));
    const roof = this.map.tile[i] === BUILDING ? this.map.height[i] * C.LEVEL_M : 0;
    return roof + (spec.eye ?? (roof ? 1.7 : C.EYE_M));
  }
  /** 0.33: the sight line from (x0,y0) at e0 meters down to an infected at (x1,y1) clears every building on the way:
   *  a building blocks it where its roof stands above the line. A rooftop shooter's own building doesn't count. */
  sightClear(x0: number, y0: number, e0: number, x1: number, y1: number) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
    const tile = this.map.tile, ht = this.map.height, w = this.w, LV = C.LEVEL_M, T = C.TARGET_M;
    const ix = Math.min(w - 1, Math.max(0, x0 | 0)), iy = Math.min(this.h - 1, Math.max(0, y0 | 0)), own = tile[iy * w + ix] === BUILDING;
    for (let s = 1; s < n; s++) {
      const fx = x0 + dx * s / n, fy = y0 + dy * s / n, x = fx | 0, y = fy | 0;
      if (x < 0 || y < 0 || x >= w || y >= this.h) continue;
      const i = y * w + x;
      if (tile[i] !== BUILDING) continue;
      if (own && Math.abs(fx - x0) < 2.5 && Math.abs(fy - y0) < 2.5) continue;
      if (ht[i] * LV > e0 + (T - e0) * s / n) return false;
    }
    return true;
  }
  /** Can a shooter at (x,y) hit the infected at (tx,ty)? walls: stopped by the perimeter; eye >= 0: sight line over buildings. */
  private seen(x: number, y: number, tx: number, ty: number, walls: boolean, eye: number) {
    return (!walls || this.lineClear(x, y, tx, ty)) && (eye < 0 || this.sightClear(x, y, eye, tx, ty));
  }
  /** 0.27: nearest infected in r that the unit can see (past the walls; 0.33: and the buildings). */
  private nearestSeen(x: number, y: number, r: number, walls = true, eye = -1) {
    const t = this.nearest(x, y, r, INF, 255, 400);
    if (t < 0 || this.seen(x, y, this.ax[t], this.ay[t], walls, eye)) return t;
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bs = r * r, checks = 600;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (--checks <= 0) return best;
        if (this.state[k] !== INF) continue;
        const ddx = this.ax[k] - x, ddy = this.ay[k] - y, d2 = ddx * ddx + ddy * ddy;
        if (d2 <= bs && this.seen(x, y, this.ax[k], this.ay[k], walls, eye)) { bs = d2; best = k; }
      }
    return best;
  }

  /** 0.42: who an armed civilian shoots: first an infected right beside a living member of their family (in range and
   *  in sight), else the nearest they can see. */
  private civTarget(k: number, x: number, y: number, range: number): number {
    const near = this.nearestSeen(x, y, range, true, C.EYE_M);
    const lead = this.famLead[k];
    if (near >= 0 && lead >= 0 && this.dayLife) { // (nothing in sight at all: no family scan)
      let best = -1, bd = range * range;
      for (let m = lead, e = lead + this.famSize[k]; m < e; m++) {
        if (m === k || this.state[m] !== CIV) continue;
        const t = this.nearest(this.ax[m], this.ay[m], C.GUARD_FAMILY_R, INF);
        if (t < 0) continue;
        const d2 = (this.ax[t] - x) ** 2 + (this.ay[t] - y) ** 2;
        if (d2 <= bd && this.seen(x, y, this.ax[t], this.ay[t], true, C.EYE_M)) { bd = d2; best = t; }
      }
      if (best >= 0) return best;
    }
    return near;
  }
  /** Nearest live armed civilian within r cells of (x, y), or -1. */
  armedCivAt(x: number, y: number, r = 2.2): number {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bd = r * r;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if ((this.state[k] !== CIV && this.state[k] !== SAFE_CIV) || !this.civWep[k]) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = k; }
      }
    return best;
  }

  /** 0.39: nearest live person (index < civN, outside or in a zone) within r cells of (x, y), or -1. */
  civAt(x: number, y: number, r = 1.5): number {
    if (this.phase === "plan") { // the buckets fill only once the battle runs; one scan per click is cheap at 200k
      let best = -1, bd = r * r;
      for (let k = 0; k < this.civN; k++) {
        if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d2 = dx * dx + dy * dy;
        if (d2 <= bd) { bd = d2; best = k; }
      }
      return best;
    }
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bd = r * r;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (k >= this.civN || (this.state[k] !== CIV && this.state[k] !== SAFE_CIV)) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d2 = dx * dx + dy * dy;
        if (d2 <= bd) { bd = d2; best = k; }
      }
    return best;
  }
  /** 0.39: which zone (0-based) holds cell (x, y); 0 when none or unknown. Only called on a person's state change. */
  zoneIndexAt(x: number, y: number): number {
    for (let z = 0; z < this.zones.length; z++) {
      const p = this.zones[z]; let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return z;
    }
    return 0;
  }
  /** 0.39: add a story event for person k (ignored for anyone who isn't one of the starting people). The first ending
   *  event sets their fate. Past PEOPLE_EV_CAP events, recording stops (fates still update). */
  note(k: number, code: number, arg = 0) {
    if (k < 0 || k >= this.civN) return;
    if (code === EV_KILLED_BY_US && this.curStrike >= 0 && this.stats.strikes[this.curStrike]) this.stats.strikes[this.curStrike].civ++; // 0.57
    if (isEnding(code) && this.fate[k] === 0) this.fate[k] = code;
    if (this.evN >= this.evT.length) {
      const cap = Math.min(C.PEOPLE_EV_CAP, this.evT.length * 2);
      if (cap <= this.evT.length) return;
      const grow = <T extends Float32Array | Int32Array | Uint8Array>(a: T): T => { const b = new (a.constructor as any)(cap) as T; b.set(a); return b; };
      this.evT = grow(this.evT); this.evK = grow(this.evK); this.evCode = grow(this.evCode); this.evArg = grow(this.evArg); this.evPrev = grow(this.evPrev);
    }
    const e = this.evN++;
    this.evT[e] = this.time; this.evK[e] = k; this.evCode[e] = code; this.evArg[e] = arg;
    this.evPrev[e] = this.lastEv[k]; this.lastEv[k] = e;
  }
  /** 0.39: person k's story, oldest first. */
  storyOf(k: number): { t: number; code: number; arg: number }[] {
    const out: { t: number; code: number; arg: number }[] = [];
    if (k < 0 || k >= this.civN) return out;
    for (let e = this.lastEv[k]; e >= 0; e = this.evPrev[e]) out.push({ t: this.evT[e], code: this.evCode[e], arg: this.evArg[e] });
    return out.reverse();
  }
  /** 0.40: put everyone where they would be at clock time `min` (minutes since midnight): home, work, school, a store,
   *  on the road or out with friends, by age and job (people.placeFor). Planning only. Always re-places from the
   *  households' spawn positions, so picking another time gives the same result as picking it first. */
  setStartTime(min: number) {
    if (this.phase !== "plan") return;
    min = ((Math.floor(min) % 1440) + 1440) % 1440;
    this.startMin = min; this.dayLife = true;
    const w = this.w, h = this.h, seed = this.seed, tile = this.map.tile, ht = this.map.height, N = this.civN;
    const uu = (k: number, salt: number) => hash32(seed, k, salt) / 4294967296;
    const doors = this.doorSpots.length ? this.doorSpots : Int32Array.from(this.homeCell);
    const dist = (a: number, b: number) => Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0));
    const adjH = (c: number) => { // tallest building next to a doorstep
      const x = c % w, y = (c / w) | 0; let m = 0;
      for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1]) if (n >= 0 && tile[n] === BUILDING && ht[n] > m) m = ht[n];
      return m;
    };
    const night = min >= 1320 || min < 360;
    this.workCell.fill(-1); this.schoolCell.fill(-1);
    for (let k = 0; k < N; k++) {
      const p = personOf(seed, k, this.famLead[k], this.famSize[k]);
      this.age[k] = Math.min(255, p.age);
      this.dayPlace[k] = this.atVenue[k] ? (night ? PL_HOME : PL_VENUE) : placeFor(seed, k, p, min);
      // kids are at school (and need fetching) only on Insane; otherwise they're home with the family
      if (this.difficulty !== "insane" && (this.dayPlace[k] === PL_SCHOOL || (this.dayPlace[k] === PL_ROAD && p.age >= 5 && p.age <= 17))) this.dayPlace[k] = PL_HOME;
    }
    // a preschooler (below Insane: any child) is never home alone: if no adult of the household is home, the first adult stays home
    for (let k = 0; k < N; k++) {
      if (this.famLead[k] !== k) continue;
      const end = Math.min(N, k + this.famSize[k]);
      let tot = false, adultHome = false, firstAdult = -1;
      for (let m = k; m < end; m++) {
        if ((this.age[m] < 5 || (this.age[m] < 18 && this.difficulty !== "insane")) && this.dayPlace[m] === PL_HOME) tot = true;
        if (this.age[m] >= 18) { if (firstAdult < 0) firstAdult = m; if (this.dayPlace[m] === PL_HOME) adultHome = true; }
      }
      if (tot && !adultHome && firstAdult >= 0) this.dayPlace[firstAdult] = PL_HOME;
    }
    // schools: one per ~450 pupils, at doorsteps of low buildings, spread out (farthest-point sampling)
    const pupil = (k: number) => this.age[k] >= 5 && this.age[k] <= 17 && (this.dayPlace[k] === PL_SCHOOL || this.dayPlace[k] === PL_ROAD);
    let kids = 0; for (let k = 0; k < N; k++) if (pupil(k)) kids++;
    this.schools = [];
    if (kids > 0) {
      let cand = Array.from(doors).filter(c => { const a = adjH(c); return a > 0 && a <= 3; });
      if (!cand.length) cand = Array.from(doors);
      if (cand.length > 4000) { const step = cand.length / 4000; cand = Array.from({ length: 4000 }, (_, i) => cand[Math.floor(i * step)]); }
      const want = Math.min(cand.length, Math.ceil(kids / 450));
      const best = new Float32Array(cand.length).fill(Infinity);
      let pick = cand[hash32(seed, 0, 31) % cand.length];
      while (this.schools.length < want) {
        this.schools.push(pick);
        let far = -1, fd = -1;
        for (let i = 0; i < cand.length; i++) { const d = dist(cand[i], pick); if (d < best[i]) best[i] = d; if (best[i] > fd) { fd = best[i]; far = i; } }
        if (far < 0 || fd <= 0) break;
        pick = cand[far];
      }
    }
    const offices = Array.from(doors).filter(c => adjH(c) >= 4);
    const workPool = offices.length ? offices : Array.from(doors);
    const snap = (c: number) => { // nearest walkable cell (spiral, up to 6 out)
      if (walkable(tile[c])) return c;
      const x = c % w, y = (c / w) | 0;
      for (let r = 1; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && walkable(tile[ny * w + nx])) return ny * w + nx;
      }
      return -1;
    };
    // nearest road/bridge cell of a kind (station, highway) for every cell, out to R steps: one breadth-first pass per kind
    const nearMaps = new Map<number, Int32Array | null>();
    const nearestInfra = (c: number, kind: number, R: number) => {
      if (!nearMaps.has(kind)) {
        const near = new Int32Array(w * h).fill(-1), d = new Uint16Array(w * h).fill(65535), q: number[] = [];
        for (let i = 0; i < w * h; i++) if (walkable(tile[i]) && tile[i] !== PARK && ht[i] === kind) { near[i] = i; d[i] = 0; q.push(i); }
        for (let qi = 0; qi < q.length; qi++) {
          const i = q[qi], x = i % w; if (d[i] >= R) continue;
          for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (n >= 0 && n < w * h && d[n] === 65535) { d[n] = d[i] + 1; near[n] = near[i]; q.push(n); }
        }
        nearMaps.set(kind, q.length ? near : null);
      }
      const m = nearMaps.get(kind);
      return m ? m[c] : -1;
    };
    const schoolOf = (home: number) => { let bs = this.schools[0], bd = Infinity; for (const sc of this.schools) { const d = dist(sc, home); if (d < bd) { bd = d; bs = sc; } } return bs; };
    for (let k = 0; k < N; k++) {
      const pl = this.dayPlace[k], home = this.homeCell[k];
      let cell = -1;
      if (pl === PL_ROAD && pupil(k) && this.schools.length) { // school's out: somewhere between school and home
        const sc = schoolOf(home); this.schoolCell[k] = sc;
        const f = 0.2 + 0.6 * uu(k, 48);
        const x = Math.round((home % w) + ((sc % w) - (home % w)) * f), y = Math.round(((home / w) | 0) + (((sc / w) | 0) - ((home / w) | 0)) * f);
        cell = snap(y * w + x);
      } else if (pl === PL_WORK || pl === PL_ROAD) {
        // a workplace 40 to 160 cells (80 to 320 m) from home: most picks land in that ring; the closest try wins otherwise
        let c = workPool[hash32(seed, k, 40) % workPool.length];
        for (let t = 1; t < 24 && (dist(c, home) < 40 || dist(c, home) > 160); t++) {
          const c2 = workPool[hash32(seed, k, 40 + t) % workPool.length], d2 = dist(c2, home);
          if ((d2 >= 40 && d2 <= 160) || Math.abs(d2 - 100) < Math.abs(dist(c, home) - 100)) c = c2;
        }
        this.workCell[k] = c;
        if (pl === PL_WORK) cell = c;
        else {
          const f = 0.2 + 0.6 * uu(k, 48);
          const x = Math.round((home % w) + ((c % w) - (home % w)) * f), y = Math.round(((home / w) | 0) + (((c / w) | 0) - ((home / w) | 0)) * f);
          cell = snap(y * w + x);
          // commuters: some wait for a train at a station, some sit in traffic on the highway
          const roll = uu(k, 49);
          if (cell >= 0 && roll < 0.2) { const st = nearestInfra(cell, INFRA_STATION, 40); if (st >= 0) cell = st; }
          else if (cell >= 0 && roll < 0.55) { const hw = nearestInfra(cell, INFRA_HIGHWAY, 60); if (hw >= 0) cell = hw; }
        }
      } else if (pl === PL_SCHOOL && this.schools.length) {
        const bs = schoolOf(home); this.schoolCell[k] = bs; cell = bs;
      } else if (pl === PL_STORE) {
        for (let t = 0; t < 8 && cell < 0; t++) { const c = doors[hash32(seed, k, 44 + t) % doors.length], d = dist(c, home); if (d >= 10 && d <= 60) cell = c; }
      }
      if (cell < 0 && pl !== PL_HOME && pl !== PL_VENUE) this.dayPlace[k] = PL_HOME; // nowhere fitting on this map: home
      if (cell >= 0) {
        this.ax[k] = Math.fround((cell % w) + 0.15 + 0.7 * uu(k, 50)); this.ay[k] = Math.fround(((cell / w) | 0) + 0.15 + 0.7 * uu(k, 51));
      } else if (this.dayPlace[k] === PL_HOME && this.atVenue[k]) {
        this.ax[k] = Math.fround((home % w) + 0.15 + 0.7 * uu(k, 50)); this.ay[k] = Math.fround(((home / w) | 0) + 0.15 + 0.7 * uu(k, 51));
      } else { this.ax[k] = this.spawnX[k]; this.ay[k] = this.spawnY[k]; }
      this.velX[k] = 0; this.velY[k] = 0;
      const ci = this.idx(Math.max(0, Math.min(w - 1, this.ax[k] | 0)), Math.max(0, Math.min(h - 1, this.ay[k] | 0)));
      this.startCell[k] = ci;
      if (this.state[k] === CIV || this.state[k] === SAFE_CIV) this.state[k] = this.inZone[ci] === 1 ? SAFE_CIV : CIV;
    }
  }
  /** 0.39: k reached a zone. Not written while planning (drawing a zone isn't an arrival), nor twice in a row (a gate
   *  rebuilt as wall moves people who were already safe). */
  noteSafe(k: number) {
    if (this.phase === "plan" || k < 0 || k >= this.civN) return;
    const e = this.lastEv[k];
    if (e >= 0 && this.evCode[e] === EV_SAFE) return;
    this.note(k, EV_SAFE, this.zoneIndexAt(this.ax[k], this.ay[k]));
    if (this.refuser[k] === 1) this.refuser[k] = 0; // a zone came to them: safe, not refusing
    if (this.dayLife && this.rally[k] === RALLY_ZONE && this.famLead[k] >= 0 && this.plan[k] !== PLAN_MEET && !this.meetDone(k)) {
      this.plan[k] = PLAN_MEET; this.goal[k] = -1; this.planT[k] = 0; this.note(k, EV_ZONE_WAIT); // 0.40: wait in the zone for the family
    } else if (this.dayLife && this.plan[k] !== PLAN_MEET) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; } // safe beats any errand
  }

  private placeCivilians(seed: number) {
    const r = rng(seed ^ 0x5bd1e995);
    const w = this.w, h = this.h, tile = this.map.tile, ht = this.map.height;
    const spots: number[] = [], homeSpots: number[] = [], venueSpots: number[] = [];
    for (let i = 0; i < w * h; i++) {
      const t = tile[i];
      if (!walkable(t)) continue;
      spots.push(i);
      const x = i % w, y = (i / w) | 0;
      if (t === PARK || ((t === ROAD || t === BRIDGE) && ht[i] === INFRA_STATION)) venueSpots.push(i);
      let adjBld = false;
      if ((x > 0 && tile[i - 1] === BUILDING) || (x < w - 1 && tile[i + 1] === BUILDING) || (y > 0 && tile[i - w] === BUILDING) || (y < h - 1 && tile[i + w] === BUILDING)) adjBld = true;
      if (adjBld) homeSpots.push(i);
    }
    const homes = homeSpots.length ? homeSpots : spots;
    const venues = venueSpots.length ? venueSpots : homes;
    for (let k = 0; k < this.civN; k++) {
      const c = spots[Math.floor(r() * spots.length)];
      this.ax[k] = (c % w) + r(); this.ay[k] = ((c / w) | 0) + r();
      this.state[k] = CIV;
      const a = r() * Math.PI * 2;
      this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a);
    }
    // 0.30/0.37: walking pace, accurate start grouping (households at building doorsteps + venue crowds at parks/stations),
    // census household sizes, and country/city armed population with household gun clustering and rare militia families.
    const fr = rng((seed ^ 0x9e3779b9) >>> 0);
    const gr = rng((seed ^ 0x7f4a7c15) >>> 0);
    const prof = C.cityGunProfile(this.cityId);
    const famScale = Math.max(0.6, Math.min(1.4, (prof.avgHousehold - 1.2) / 1.3));
    const pickWep = (mix: [number, number, number, number]): C.CivWeaponId => {
      const tot = mix[0] + mix[1] + mix[2] + mix[3], u = gr() * tot;
      return u < mix[0] ? 1 : u < mix[0] + mix[1] ? 2 : u < mix[0] + mix[1] + mix[2] ? 3 : 4;
    };
    const arm = (m: number, wid: C.CivWeaponId, fullMags = false) => {
      const spec = C.CIV_WEAPONS[wid];
      const mags = fullMags ? spec.mags[1] : spec.mags[0] + Math.floor(gr() * (spec.mags[1] - spec.mags[0] + 1));
      this.civWep[m] = wid;
      this.civAmmo[m] = Math.min(255, spec.mag * mags);
    };
    let venueLeft = 0, venueAnchor = -1;
    for (let k = 0; k < this.civN;) {
      const pace = Math.max(0.7, Math.min(1.35, 1 + C.WALK_SPREAD * ((fr() + fr() + fr()) - 1.5) * 2));
      let size = 1;
      if (fr() * 100 < C.FAMILY_PCT) {
        const q = fr() / famScale;
        size = q < 0.48 ? 2 : q < 0.78 ? 3 : q < 0.94 ? 4 : 5;
      }
      size = Math.min(size, this.civN - k);
      // Choose origin cell: either continuing a venue crowd at a park/station or starting a household at a building front
      let anchorCell: number, atVenue = true;
      if (venueLeft > 0 && venueAnchor >= 0) {
        venueLeft -= size;
        const vx = venueAnchor % w, vy = (venueAnchor / w) | 0;
        let picked = venueAnchor;
        for (let tr = 0; tr < 4; tr++) {
          const nx = vx + Math.round((fr() - 0.5) * 6), ny = vy + Math.round((fr() - 0.5) * 6);
          if (nx > 0 && ny > 0 && nx < w && ny < h && walkable(tile[ny * w + nx])) { picked = ny * w + nx; break; }
        }
        anchorCell = picked;
      } else if (fr() > C.HOUSEHOLD_SHARE) {
        venueAnchor = venues[Math.floor(fr() * venues.length)];
        venueLeft = C.VENUE_CROWD_MIN + Math.floor(fr() * (C.VENUE_CROWD_MAX - C.VENUE_CROWD_MIN + 1)) - size;
        anchorCell = venueAnchor;
      } else {
        anchorCell = homes[Math.floor(fr() * homes.length)];
        atVenue = false;
      }
      // 0.39: home address. A household starts at its own doorstep; a group out at a park or station lives at a
      // doorstep picked by hash (no fr() call, so spawn layouts don't move).
      const home = atVenue ? homes[hash32(seed, k, 13) % homes.length] : anchorCell;
      const ax0 = (anchorCell % w) + 0.15 + fr() * 0.7, ay0 = ((anchorCell / w) | 0) + 0.15 + fr() * 0.7;
      this.ax[k] = Math.fround(ax0); this.ay[k] = Math.fround(ay0);
      for (let j = 0; j < size; j++) {
        const m = k + j;
        this.pspd[m] = pace;
        this.homeCell[m] = home; this.atVenue[m] = atVenue ? 1 : 0;
        if (size > 1) {
          this.famLead[m] = k; this.famSize[m] = size;
          if (j > 0) {
            let placed = false;
            for (let tr = 0; tr < 4; tr++) {
              const x = ax0 + (fr() - 0.5) * 1.3, y = ay0 + (fr() - 0.5) * 1.3;
              if (x > 0 && y > 0 && x < w && y < h && walkable(tile[this.idx(x | 0, y | 0)])) {
                this.ax[m] = Math.fround(x); this.ay[m] = Math.fround(y); placed = true; break;
              }
            }
            if (!placed) {
              this.ax[m] = Math.fround((anchorCell % w) + 0.1 + fr() * 0.8);
              this.ay[m] = Math.fround(((anchorCell / w) | 0) + 0.1 + fr() * 0.8);
            }
          }
        }
      }
      // 0.37: Roll household firearm ownership (country rate x city factor, clustered in households + rare militia family)
      const pInd = Math.min(0.65, prof.armedRate * prof.cityFactor);
      const pHouse = 1 - Math.pow(1 - pInd, Math.max(1, size * 0.8));
      if (pInd > 0 && gr() < pHouse) {
        if (size >= 2 && gr() * 100 < C.MILITIA_FAMILY_PCT * prof.militiaFactor) {
          const adults = Math.max(2, size - (size >= 4 ? 1 : 0));
          for (let j = 0; j < size; j++) {
            this.civMilitia[k + j] = 1;
            if (j < adults) arm(k + j, pickWep([0.10, 0.28, 0.50, 0.12]), true);
          }
        } else {
          arm(k, pickWep(prof.mix), false);
          for (let j = 1; j < size; j++) {
            const pExtra = C.CIV_HOUSEHOLD_GUN_BONUS * Math.min(1.3, prof.cityFactor) * (j === 1 ? 1 : 0.45);
            if (gr() < pExtra) arm(k + j, pickWep(prof.mix), false);
          }
        }
      }
      k += size;
    }
    this.doorSpots = Int32Array.from(homes); // 0.40: doorsteps, for work/school/store places
    for (let k = 0; k < this.civN; k++) { // 0.39: where each person stood when the round began
      this.spawnX[k] = this.ax[k]; this.spawnY[k] = this.ay[k];
      this.startCell[k] = this.idx(Math.max(0, Math.min(w - 1, this.ax[k] | 0)), Math.max(0, Math.min(h - 1, this.ay[k] | 0)));
      if (this.homeCell[k] < 0) this.homeCell[k] = this.startCell[k];
    }
    for (let k = this.civN; k < this.n; k++) this.state[k] = DEAD; // outbreak slots, filled at battle start
  }

  // ---------- Planning ----------

  /** Cost of a zone of `cells` cells when it is the `index`-th zone (0 = the first, cheap one). */
  static zonePrice(cells: number, index: number) {
    const p = index === 0 ? C.ZONE_BASE_COST + Math.round(cells * C.ZONE_COST_PER_CELL) : C.EXTRA_ZONE_BASE + Math.round(cells * C.EXTRA_ZONE_PER_CELL);
    return Math.round(p * C.ZONE_GUARD_COST_MUL); // 0.38: the walls come manned
  }
  zoneCost() {
    let c = 0;
    this.zoneCellsEach.forEach((n, i) => (c += Sim.zonePrice(n, i)));
    return c;
  }
  // While planning, spending is worked out from the plan (so removing refunds). From the battle on it is a
  // ledger: what was locked in at the start plus every purchase since. Losses and used abilities never refund.
  lockedSpend = 0; battleSpend = 0; earned = 0; lastIncome = 0; private incomeT = 0; private killsPaid = 0;
  upkeepPaid = 0; lastUpkeep = 0; // 0.48: cost of operations (Insane), charged with each income tick; part of battleSpend
  unitsLost = 0;
  abilitiesUsed = 0;
  lostLog: string[] = []; // kinds lost, drained by the UI for messages
  soldLog: string[] = [];
  spent() {
    if (this.phase !== "plan") return this.lockedSpend + this.battleSpend;
    let s = this.zoneCost();
    for (const u of this.units) s += u.paid ?? C.UNITS[u.kind].cost;
    for (const b of this.supports) s += b.paid;
    for (const z of this.supply) s += z.bought; // 0.60: supply bought in planning
    for (const u of this.units) s += u.resPaid ?? 0;
    for (const k in this.bought) s += this.abilitySpent(k as C.AbilityKind, this.bought[k as C.AbilityKind]);
    return s + this.c4.size * C.C4_COST + this.demo.size * C.DEMO_COST;
  }
  remaining() { return this.dev.unlimitedMoney ? 1e12 : Math.floor(this.budget + this.earned - this.spent()); }
  private pay(cost: number) { if (this.phase !== "plan") this.battleSpend += cost; }

  /** Replace the safe zone with this closed polygon (cell coordinates). Returns an error or null. */
  /** Cells inside a polygon (even-odd rule at cell centers). */
  private polyCells(poly: [number, number][]) {
    const out: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const cy = y + 0.5;
      const xsCross: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xsCross.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
      }
      xsCross.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xsCross.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xsCross[k] - 0.5)); x <= Math.min(this.w - 1, Math.floor(xsCross[k + 1] - 0.5)); x++) out.push(this.idx(x, y));
    }
    return out;
  }

  /** Price of adding this polygon as the next zone (for the live estimate while drawing). */
  priceOf(poly: [number, number][]) { return poly.length < 3 ? 0 : Sim.zonePrice(this.polyCells(poly).length, this.zones.length); }

  /** Kept for the plan format and tests: in planning, replaces all zones with one. */
  setZone(poly: [number, number][]): string | null {
    this.navVersion++; // 0.40
    if (this.phase === "plan" && this.zones.length) {
      // check the replacement fits before throwing the old zone away
      if (poly.length >= 3 && Sim.zonePrice(this.polyCells(poly).length, 0) > this.remaining() + this.zoneCost()) return "Not enough budget for a zone that big.";
      this.clearZone();
    }
    return this.addZone(poly);
  }

  /** Add a safe zone. Zones that overlap merge; existing walls and gates keep their state and damage. */
  addZone(poly: [number, number][]): string | null {
    if (poly.length < 3) return "A safe zone needs at least 3 corners.";
    if (this.phase === "over") return "The battle is over.";
    const cells = this.polyCells(poly);
    if (cells.length < 20) return "That zone is too small.";
    const price = Sim.zonePrice(cells.length, this.zones.length);
    if (this.remaining() < price) return this.zones.length ? `An extra safe zone that size costs $${price.toLocaleString()}. Not enough money.` : "Not enough budget for a zone that big.";
    if (this.phase === "battle") {
      const inPoly = new Uint8Array(this.w * this.h);
      for (const c of cells) inPoly[c] = 1;
      for (let k = 0; k < this.n; k++) if (this.state[k] === INF && inPoly[this.idx(this.ax[k] | 0, this.ay[k] | 0)]) return "Infected are already inside that area. Pick clear ground.";
    }
    // interior = every cell inside any zone polygon
    const interior = new Uint8Array(this.w * this.h);
    for (let i = 0; i < interior.length; i++) if (this.inZone[i]) interior[i] = 1;
    for (const c of cells) interior[c] = 1;
    const old = this.inZone.slice();
    for (let i = 0; i < interior.length; i++) {
      if (!interior[i]) continue;
      let edge = false;
      if (walkable(this.map.tile[i])) {
        const x = i % this.w, y = (i / this.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) { edge = true; break; }
          const n = this.idx(nx, ny);
          if (!interior[n] && walkable(this.map.tile[n])) { edge = true; break; }
        }
      }
      if (!edge) this.inZone[i] = 1;
      else if (old[i] === 2 || old[i] === 3) this.inZone[i] = old[i]; // keeps state and damage
      else { this.inZone[i] = 3; this.wallHp[i] = this.gateMaxHp(); } // every new crossing starts as a gate
    }
    this.zones.push(poly);
    this.newZoneSupply(this.zones.length - 1); // 0.60 (sets supply[z])
    this.zoneCellsEach.push(cells.length);
    this.zoneCells += cells.length;
    this.pay(price);
    for (let k = 0; k < this.civN; k++) { // civilians already inside are safe
      if (this.state[k] !== CIV) continue;
      if (this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)] === 1) { this.state[k] = SAFE_CIV; this.noteSafe(k); }
    }
    this.refreshUnitAmmo();
    this.fieldDirty = true;
    return null;
  }

  clearZone() {
    this.navVersion++; // 0.40
    if (this.phase !== "plan") return;
    this.zones = []; this.supply = []; this.zoneCellsEach = []; this.inZone.fill(0); this.zoneCells = 0;
    this.supports = []; // support buildings require a safe zone; removing the zone refunds them
    for (let k = 0; k < this.civN; k++) if (this.state[k] === SAFE_CIV) this.state[k] = CIV;
    this.refreshUnitAmmo();
    this.refreshAuras();
    this.fieldDirty = true;
  }

  /** Toggle a gate on a wall cell (and its wall neighbors across the road width). */
  /** 0.30.1: gates and walls take time to open or close during a battle (people get out of the way first). */
  switching: { cells: number[]; to: 2 | 3; start: number; at: number }[] = [];
  private applySwitch(cells: number[], to: 2 | 3) {
    this.navVersion++; // 0.40
    const gMax = this.gateMaxHp(), wMax = this.wallMaxHp();
    for (const c of cells) {
      if (this.wallHp[c] <= 0 || this.inZone[c] === to || (this.inZone[c] !== 2 && this.inZone[c] !== 3)) continue; // broken meanwhile
      this.wallHp[c] = to === 2 ? (this.wallHp[c] / gMax) * wMax : (this.wallHp[c] / wMax) * gMax; // keeps its damage
      this.inZone[c] = to;
    }
    if (to === 2) this.clearCells(cells);
    this.fieldDirty = true;
  }
  /** Anyone (not infected) standing in these cells steps into the zone. */
  private clearCells(cells: number[]) {
    const set = new Set(cells);
    for (let k = 0; k < this.civN; k++) {
      const st = this.state[k];
      if (st !== CIV && st !== SAFE_CIV) continue;
      if (set.has(this.idx(this.ax[k] | 0, this.ay[k] | 0))) this.stepInside(k);
    }
  }
  /** Put a person caught in a wall on the nearest open cell inside the zone (they are safe). */
  private stepInside(k: number) {
    const cx = this.ax[k] | 0, cy = this.ay[k] | 0;
    for (let r = 1; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const i = this.idx(x, y);
      if (this.inZone[i] === 1 && walkable(this.map.tile[i]) && !this.occ[i]) {
        this.ax[k] = Math.fround(x + 0.5); this.ay[k] = Math.fround(y + 0.5); this.state[k] = SAFE_CIV; this.velX[k] = 0; this.velY[k] = 0; this.noteSafe(k); return;
      }
    }
  }
  private stepSwitching() {
    for (let i = this.switching.length - 1; i >= 0; i--) {
      const sw = this.switching[i];
      if (this.time >= sw.at) { this.applySwitch(sw.cells, sw.to); this.switching.splice(i, 1); }
    }
  }

  toggleGate(x: number, y: number): string | null {
    this.navVersion++; // 0.40
    const i = this.idx(x, y);
    const z = this.inZone[i];
    if (z !== 2 && z !== 3) return "Click where a road crosses the safe zone edge.";
    // A gate spans the connected run of wall cells within 3 cells, so a whole road gets one gate.
    const run: number[] = [];
    const seen = new Set<number>([i]);
    const q = [i];
    while (q.length) {
      const c = q.pop()!; run.push(c);
      const cx = c % this.w, cy = (c / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        if (Math.abs(nx - x) > 3 || Math.abs(ny - y) > 3) continue;
        const n = this.idx(nx, ny);
        if (!seen.has(n) && this.inZone[n] === z) { seen.add(n); q.push(n); }
      }
    }
    const to = z === 2 ? 3 : 2;
    if (this.phase !== "plan" && run.some(c => this.wallHp[c] <= 0)) return "That crossing is already broken.";
    const gMax = this.gateMaxHp(), wMax = this.wallMaxHp();
    if (this.phase === "plan") {
      for (const c of run) { this.wallHp[c] = to === 3 ? gMax : wMax; this.inZone[c] = to; }
      this.fieldDirty = true;
      return null;
    }
    if (this.switching.some(sw => sw.cells.some(c => run.includes(c)))) return "That crossing is already moving.";
    const dur = to === 2 ? C.GATE_CLOSE_S : C.GATE_OPEN_S;
    this.switching.push({ cells: run, to, start: this.time, at: this.time + dur });
    St.event(this.stats, to === 2 ? St.SE_GATE_TO_WALL : St.SE_WALL_TO_GATE, this.time, x, y); // 0.57
    return null;
  }

  /** Turn every intact gate into a wall (planning or battle). Returns how many crossings changed. */
  /** 0.41: gate cells still standing open (intact and not already swinging shut): what Lock Gates would close. */
  openGateCells(): number {
    const moving = new Set(this.switching.flatMap(sw => sw.cells));
    let n = 0; for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i] === 3 && this.wallHp[i] > 0 && !moving.has(i)) n++;
    return n;
  }
  closeAllGates() {
    this.navVersion++; // 0.40
    let n = 0;
    const wMax = this.wallMaxHp(), cells: number[] = [];
    const moving = new Set(this.switching.flatMap(sw => sw.cells));
    for (let i = 0; i < this.inZone.length; i++) {
      if (this.inZone[i] !== 3 || this.wallHp[i] <= 0 || moving.has(i)) continue;
      if (this.phase === "plan") { this.wallHp[i] = wMax; this.inZone[i] = 2; } else cells.push(i);
      n++;
    }
    if (cells.length) { this.switching.push({ cells, to: 2, start: this.time, at: this.time + C.GATE_CLOSE_S }); St.event(this.stats, St.SE_GATES_LOCKED, this.time, 0, 0, n); }
    else if (n) this.fieldDirty = true;
    return n;
  }

  /** True when an active (deployed, not extracting) support building of `kind` covers `(x, y)`. */
  hasActiveSupport(kind: C.SupportKind, x: number, y: number) {
    const r = C.SUPPORTS[kind].radius, r2 = r * r;
    for (const b of this.supports) {
      if (b.kind !== kind || b.extractT !== undefined || (b.deployT && b.deployT > 0)) continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  /** 0.48: units of this kind standing (or deploying) now. A sold unit pulling out (hp -1) no longer counts. */
  standingOf(kind: C.UnitKind) { return this.units.filter(u => u.kind === kind && (u.hp === undefined || u.hp > 0)); }
  /** 0.48: the price line. Each standing unit of a kind adds the difficulty's priceStep to the next one; a standing
   *  unit keeps its own place in line (so a plan's refunds stay exact). */
  stepMul(placeInLine: number) { return 1 + this.diff.priceStep * placeInLine; }
  unitCost(kind: C.UnitKind, x?: number, y?: number) {
    const line = this.standingOf(kind), at = x !== undefined && this.phase === "plan" ? line.findIndex(u => u.x === x && u.y === y) : -1;
    let base = Math.round(C.UNITS[kind].cost * this.stepMul(at >= 0 ? at : line.length));
    if (this.mutators.has("swimmer_surge") && (kind === "gunboat" || kind === "battleship")) base = Math.round(base * 0.75);
    return x !== undefined && y !== undefined && this.hasActiveSupport("budget", x, y)
      ? Math.round(base * (1 - C.BUDGET_DISCOUNT)) : base;
  }

  supportCost(kind: C.SupportKind, x?: number, y?: number) {
    let base = C.SUPPORTS[kind].cost;
    // a standing building keeps its own place in line. 0.20: each extra pad costs EVAC_COST_MUL times the last.
    // 0.49 (design ruling): every other support has a line too: each standing one of the kind multiplies the next one's
    // price by the difficulty's supportMul (spamming Repair Yards made the walls unbreakable)
    const line = this.supports.filter(b => b.kind === kind);
    const at = x !== undefined ? line.findIndex(b => b.x === x && b.y === y) : -1, place = at >= 0 ? at : line.length;
    base = kind === "evac" ? padCost(base, place) : Math.round(base * Math.pow(this.diff.supportMul, place));
    if (this.mutators.has("supply_shortage") && kind === "supply") base = Math.round(base * 0.5);
    if (this.mutators.has("fragile_walls") && kind === "repair") base = Math.round(base * 0.75);
    return x !== undefined && y !== undefined && kind !== "budget" && this.hasActiveSupport("budget", x, y)
      ? Math.round(base * (1 - C.BUDGET_DISCOUNT)) : base;
  }

  canPlace(kind: C.UnitKind, x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    const spec = C.UNITS[kind];
    const t = this.tileAt(x, y);
    const troop = kind === "garrison" || kind === "sniper"; // 0.50: a roof (fortified) or a street inside a zone (on the ground)
    if (kind === "garrison" && t !== BUILDING && !walkable(t)) return "Troops go on a roof, a street or a park."; // 0.53: anywhere, flown in by helicopter
    if (kind === "sniper" && t !== BUILDING && !(walkable(t) && this.inZone[this.idx(x, y)] === 1)) return "Snipers go on a roof, or a street inside a safe zone.";
    if (!troop && spec.on === "building" && t !== BUILDING) return `${spec.name}s go on buildings.`;
    if (spec.on === "ground" && !walkable(t) && !(spec.roof && t === BUILDING)) return `${spec.name}s go on streets or parks${spec.roof ? " or rooftops" : ""}.`;
    if (spec.on === "water" && t !== WATER) return `${spec.name}s go on the river.`;
    if (spec.on === "zone" && this.inZone[this.idx(x, y)] !== 1) return `${spec.name}s take off from inside a safe zone.`;
    if (spec.on === "any") return "That unit can't be built.";
    const near = this.overlapAt(spec.foot, x, y);
    if (near) return near;
    if (troop && t === BUILDING && this.buildingTaken(kind, x, y)) return kind === "garrison" ? "One Troops squad per building." : "One Sniper team per building.";
    if (this.remaining() < this.unitCost(kind, x, y)) return "Not enough budget.";
    return null;
  }

  /** 0.49: a squad of this kind already stands on the building at x,y (one Garrison / Sniper team per building). */
  buildingTaken(kind: C.UnitKind, x: number, y: number, except?: Unit) {
    const id = this.buildingId[this.idx(x, y)];
    return id >= 0 && this.units.some(u => u !== except && u.kind === kind && (u.hp === undefined || u.hp > 0) && u.fort !== "descend"
      && this.buildingId[u.fort === "climb" ? this.idx(u.fortAt![0], u.fortAt![1]) : this.idx(Math.floor(u.x), Math.floor(u.y))] === id); // 0.50: a squad climbing up counts
  }
  /** 0.50: the open street/park cell next to the building at (bx,by) nearest (nx,ny): where a squad climbs up or comes down. */
  buildingBase(bx: number, by: number, nx: number, ny: number, insideOnly = false): [number, number] | null {
    const id = this.buildingId[this.idx(bx, by)];
    let best: [number, number] | null = null, bd = Infinity;
    const R = C.SQUAD_SPREAD + 14;
    for (let y = Math.max(1, by - R); y <= Math.min(this.h - 2, by + R); y++) for (let x = Math.max(1, bx - R); x <= Math.min(this.w - 2, bx + R); x++) {
      const i = this.idx(x, y);
      if (!walkable(this.map.tile[i]) || (this.inZone[i] === 2 && this.wallHp[i] > 0) || (insideOnly && this.inZone[i] !== 1)) continue;
      let next = false;
      for (let dy = -1; dy <= 1 && !next; dy++) for (let dx = -1; dx <= 1 && !next; dx++) if (this.buildingId[this.idx(x + dx, y + dy)] === id) next = true;
      if (!next) continue;
      const d = (x - nx) ** 2 + (y - ny) ** 2;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }
  /** 0.50: bring a fortified Troops/Sniper squad down to the street (toward x,y if given): DISMOUNT_S on the roof
   *  (no firing, still out of reach), then a ground squad that holds there. */
  dismount(u: Unit, x?: number, y?: number): string | null {
    if (u.kind !== "garrison" && u.kind !== "sniper") return "Only Troops and Snipers dismount.";
    if (u.fort !== "up") return "Already on the ground.";
    const bx = Math.floor(u.x), by = Math.floor(u.y);
    const inside = x === undefined || y === undefined || this.inZone[this.idx(Math.floor(x), Math.floor(y))] === 1; // come down on the side it's going to
    const base = (inside && this.buildingBase(bx, by, x ?? bx, y ?? by, true)) || this.buildingBase(bx, by, x ?? bx, y ?? by);
    if (!base) return "No way down from here.";
    u.fort = "descend"; u.fortT = C.DISMOUNT_S; u.fortAt = base; u.orders = []; u.cmd = false; u.standby = false;
    if (this.phase === "plan") { u.fortT = 0; this.stepFort(u, 0); } // planning: at once
    return null;
  }
  /** 0.50: climbing up or coming down: count down, then land on the roof (fortified) or the street (ground squad). */
  private stepFort(u: Unit, dt: number) {
    u.fortT = (u.fortT ?? 0) - dt;
    if (u.fort === "climb" && u.fortAt) { // 0.52: the dots walk to the foot of the building while they climb (dots don't animate a climb)
      const tx = u.fortAt[0] + 0.5, ty = u.fortAt[1] + 0.5, st = CLIMB_WALK * dt;
      for (const so of u.soldiers ?? []) {
        if (!so.alive) continue;
        const dx = tx - so.x, dy = ty - so.y, d = hyp(dx, dy); if (d < 0.6) continue;
        const nx = so.x + dx / d * st, ny = so.y + dy / d * st;
        if (this.openAt(nx, ny)) { so.x = nx; so.y = ny; } else if (this.openAt(nx, so.y)) so.x = nx; else if (this.openAt(so.x, ny)) so.y = ny;
      }
    }
    if (u.fortT > 0) return;
    const spec = C.UNITS[u.kind], [x, y] = u.fortAt!, living = (u.soldiers ?? []).filter(so => so.alive);
    if (u.fort === "climb") {
      if (this.buildingTaken(u.kind, x, y, u)) { // someone else got up there first
        this.orderLog.push(u.kind === "garrison" ? "One Troops squad per building." : "One Sniper team per building.");
        u.fort = undefined; u.fortAt = undefined; u.ai = "hold"; u.orders = []; u.cmd = false; u.holdAt = [Math.floor(u.x), Math.floor(u.y)];
        return;
      }
      const fb = fortBlock(this.buildingId, this.w, this.buildingId[this.idx(x, y)], x, y, living.length); // 0.52.1: one fortification
      living.forEach((so, i) => { so.x = fb.slots[i][0] + 0.5; so.y = fb.slots[i][1] + 0.5; });
      u.x = x; u.y = y; u.fort = "up"; u.fortBox = [fb.x, fb.y, fb.size];
    } else {
      const slots = this.groundSlots(x, y, living.length);
      living.forEach((so, i) => { so.x = slots[i][0] + 0.5; so.y = slots[i][1] + 0.5; });
      u.x = x; u.y = y; u.fort = undefined; u.ai = "hold"; u.holdAt = [x, y]; u.post = [x, y]; u.fortBox = undefined;
    }
    const carryOn = u.fort === undefined && !!u.orders?.length; // down on the street with somewhere to go (0.50 review C1)
    u.fortT = undefined; u.fortAt = undefined; u.goal = undefined; u.nav = undefined;
    if (carryOn) { u.cmd = true; u.ai = "hunt"; u.thinkT = 0; } else { u.orders = []; u.cmd = false; }
    this.refreshAuras(); // 0.60: no endless zone ammo (engineers refill)
  }
  /** 0.49: soldiers for a squad unit: rooftop squads spread over their building, ground squads around the point. */
  private squadFor(kind: C.UnitKind, x: number, y: number): Soldier[] | undefined {
    const n = squadSize(kind);
    if (!n) return undefined;
    const seed = hash32(this.seed, x * 7919 + y * 104729 + this.units.length);
    if (C.UNITS[kind].on === "building" && this.map.tile[this.idx(x, y)] === BUILDING) return makeSquad(kind, fortBlock(this.buildingId, this.w, this.buildingId[this.idx(x, y)], x, y, n).slots, seed); // 0.52.1
    return makeSquad(kind, this.groundSlots(x, y, n), seed);
  }
  /** 0.49: n open cells (not buildings or water) around x,y, nearest first, spread in a loose ring. */
  groundSlots(x: number, y: number, n: number): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r <= 4 && out.length < n; r++) for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || (r > 0 && (dx + dy) % 2 !== 0 && r < 2)) continue;
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
      const t = this.map.tile[this.idx(cx, cy)];
      if (t === BUILDING || t === WATER) continue;
      out.push([cx, cy]);
    }
    while (out.length < n) out.push([x, y]);
    return out;
  }

  /** 0.38: a ground unit set up on a rooftop (the Mortar can be): it blocks no street and nothing claws at it. */
  onRoof(u: { x: number; y: number }) { return this.map.tile[this.idx(Math.floor(u.x), Math.floor(u.y))] === BUILDING; }

  /** 0.23: true while a saved plan loads; old plans may overlap under the new footprints and keep the old 2-cell rule. */
  ignoreFootprint = false;
  /** Cells a footprint of side n covers when centered on cell (x, y): [x0, y0, x1, y1] inclusive. */
  footRect(n: number, x: number, y: number): [number, number, number, number] {
    const lo = (n - 1) >> 1, hi = n - 1 - lo;
    return [x - lo, y - lo, x + hi, y + hi];
  }
  /** Why a footprint of side n at (x, y) can't go there (overlaps a unit or support building), or null. */
  overlapAt(n: number, x: number, y: number): string | null {
    if (this.ignoreFootprint) {
      return this.units.some(u => Math.abs(u.x - x) < 2 && Math.abs(u.y - y) < 2) || this.supports.some(b => Math.abs(b.x - x) < 2 && Math.abs(b.y - y) < 2) ? "Too close to another unit or building." : null;
    }
    const [ax0, ay0, ax1, ay1] = this.footRect(n, x, y);
    const hit = (m: number, bx: number, by: number) => { const [x0, y0, x1, y1] = this.footRect(m, bx, by); return ax0 <= x1 && x0 <= ax1 && ay0 <= y1 && y0 <= ay1; };
    for (const u of this.units) if (hit(C.UNITS[u.kind].foot, u.x, u.y)) return `Would overlap the ${C.UNITS[u.kind].name}.`;
    for (const b of this.supports) if (hit(C.SUPPORTS[b.kind].foot, b.x, b.y)) return `Would overlap the ${C.SUPPORTS[b.kind].name}.`;
    return null;
  }

  /** Nearest off-map entry/exit point for helicopter or drone sorties. */
  private nearestEdgePoint(tx: number, ty: number): [number, number] {
    const dTop = ty, dBot = this.h - ty, dLeft = tx, dRight = this.w - tx;
    const m = Math.min(dTop, dBot, dLeft, dRight);
    if (m === dTop) return [tx, -24];
    if (m === dBot) return [tx, this.h + 24];
    if (m === dLeft) return [-24, ty];
    return [this.w + 24, ty];
  }

  /** Spawn a helicopter or drone transport that flies from `(sx,sy)` to `(tx,ty)`, hovers for `hoverS`, and exits to `(ex,ey)`. */
  spawnHelo(kind: TransportKind, tx: number, ty: number, dur: number, hoverS: number, color: string, label?: string, sx?: number, sy?: number) {
    const [esx, esy] = sx !== undefined && sy !== undefined ? [sx, sy] : this.nearestEdgePoint(tx, ty);
    const angle = Math.atan2(ty - esy, tx - esx);
    this.transports.push({
      kind, x: esx, y: esy, sx: esx, sy: esy, tx, ty, ex: esx, ey: esy,
      angle, t: 0, dur: Math.max(1.5, dur), hoverS: Math.min(dur * 0.6, hoverS), color, label,
    });
  }

  /** Spawn a fixed-wing aircraft (C-130J or Strike Jet) flying across the map over `(tx, ty)`. */
  spawnFlyover(kind: TransportKind, tx: number, ty: number, dur: number, color: string, angle?: number, label?: string, air?: string) {
    const ang = angle ?? ((this.tick * 0.7 + tx * 0.03) % 1 > 0.5 ? 0.18 : Math.PI - 0.18);
    const dist = Math.max(this.w, this.h) * 0.75;
    const sx = tx - Math.cos(ang) * dist, sy = ty - Math.sin(ang) * dist;
    const ex = tx + Math.cos(ang) * dist, ey = ty + Math.sin(ang) * dist;
    this.transports.push({
      kind, x: sx, y: sy, sx, sy, tx, ty, ex, ey,
      angle: ang, t: 0, dur: Math.max(1.6, dur), hoverS: 0, color, label, air,
    });
  }

  /** A cruise missile: flies in from off the map and ends at `(tx, ty)` when it hits, `dur` seconds from now. */
  spawnMissile(tx: number, ty: number, dur: number, color: string, label?: string) {
    const ang = (this.tick * 0.37 + tx * 0.05) % 6.2832, dist = Math.max(this.w, this.h) * 0.9;
    const sx = tx - Math.cos(ang) * dist, sy = ty - Math.sin(ang) * dist;
    this.transports.push({ kind: "jet_strike", x: sx, y: sy, sx, sy, tx, ty, ex: tx, ey: ty, angle: ang, t: 0, dur, hoverS: 0, color, label, air: "tomahawk" });
  }

  /** Spawn descending parachutes (`trooper`, `supply`, or `apc`) around `(x, y)`. */
  spawnChutes(kind: Parachute["kind"], x: number, y: number, count: number, descentS: number, color: string) {
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + 0.4;
      const spread = count === 1 ? 0 : (kind === "supply" ? 2.2 : 3.2) * (0.5 + (i % 2) * 0.5);
      this.chutes.push({
        kind,
        x: x + Math.cos(a) * spread,
        y: y + Math.sin(a) * spread,
        z: 1,
        vz: 1 / Math.max(0.8, descentS * (0.9 + (i % 3) * 0.08)),
        driftX: Math.cos(a + 0.7) * 0.4,
        driftY: Math.sin(a + 0.7) * 0.3,
        color,
      });
    }
  }

  /** Apply terrain scorching, craters, and structural building damage / collapse from heavy weapons and blasts. */
  damageTerrain(x: number, y: number, r: number, strDmg: number, bumpVersion = true) {
    if (strDmg <= 0) return;
    const cx0 = Math.max(0, Math.floor(x - r - 0.5)), cx1 = Math.min(this.w - 1, Math.ceil(x + r + 0.5));
    const cy0 = Math.max(0, Math.floor(y - r - 0.5)), cy1 = Math.min(this.h - 1, Math.ceil(y + r + 0.5));
    const centerTile = (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.tileAt(x | 0, y | 0) : WATER;
    if (strDmg >= 35 && centerTile !== WATER && centerTile !== BRIDGE) {
      // 0.23: every hit leaves its own crater (they stack), dug into the ground as rough terrain
      const cr = Math.min(6, Math.max(1.2, r * 0.6));
      if (this.craters.length >= 600) this.craters.shift();
      this.craters.push({ x, y, r: cr, t: this.time, seq: ++this.craterSeq });
      const R = cr + 0.5;
      for (let yy = Math.max(0, Math.floor(y - R)); yy <= Math.min(this.h - 1, Math.ceil(y + R)); yy++)
        for (let xx = Math.max(0, Math.floor(x - R)); xx <= Math.min(this.w - 1, Math.ceil(x + R)); xx++) {
          const d = hyp(xx + 0.5 - x, yy + 0.5 - y);
          if (d > R) continue;
          const i = yy * this.w + xx, v = Math.round(255 * Math.min(1, 1.15 - d / R));
          if (this.map.tile[i] !== WATER && this.map.tile[i] !== BRIDGE && v > this.rough[i]) this.rough[i] = v;
        }
    }
    let changed = false;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dist = hyp(cx + 0.5 - x, cy + 0.5 - y);
        if (dist > r + 0.5) continue;
        const i = cy * this.w + cx;
        const t = this.map.tile[i];
        if (t === WATER || t === BRIDGE) continue;
        const fall = Math.max(0, 1 - dist / (r + 0.75));
        const d = Math.round(strDmg * (0.35 + 0.65 * fall));
        if (d <= 0) continue;
        // Protect safe-zone perimeter buildings and buildings holding friendly rooftop units/supports from collapsing
        const protectedBld = t === BUILDING && (
          this.unitInZone({ x: cx, y: cy }) ||
          this.units.some(u => Math.abs(u.x - cx) <= 1 && Math.abs(u.y - cy) <= 1) ||
          this.supports.some(b => Math.abs(b.x - cx) <= 1 && Math.abs(b.y - cy) <= 1)
        );
        const prev = this.damage[i];
        if (protectedBld) {
          const next = Math.min(150, prev + Math.round(d * 0.5));
          if (next !== prev) { this.damage[i] = next; changed = true; }
          continue;
        }
        const next = Math.min(255, prev + d);
        if (next !== prev) { this.damage[i] = next; changed = true; }
        if (t === BUILDING) {
          const floorsLost = ((next / 52) | 0) - ((prev / 52) | 0);
          if (floorsLost > 0 && this.map.height[i] > 0) {
            this.map.height[i] = Math.max(0, this.map.height[i] - floorsLost);
            changed = true;
          }
          if (next >= 180 || this.map.height[i] === 0) {
            this.map.tile[i] = 0; // collapsed into walkable rubble
            this.map.height[i] = 0;
            this.rubble[i] = 1;
            this.buildingsCollapsed++;
            this.fieldDirty = true;
            changed = true;
            // Falling masonry crushes infected in the footprint
            this.areaDamage(cx + 0.5, cy + 0.5, 1.4, 450, false);
          }
        }
      }
    }
    if (changed && bumpVersion) this.mapVersion++;
  }

  place(kind: C.UnitKind, x: number, y: number): string | null {
    const err = this.canPlace(kind, x, y);
    if (err) return err;
    const spec = C.UNITS[kind];
    const cost = this.unitCost(kind, x, y);
    const lvl = this.map.height[this.idx(x, y)];
    const roof = this.map.tile[this.idx(x, y)] === BUILDING;
    const u: Unit = {
      kind, x, y, range: spec.range + spec.roofBonus * roofLv(lvl), ammo: spec.ammo,
      cooldown: 0, kills: 0, shotX: 0, shotY: 0, shotT: -1, paid: cost,
    };
    const squad = this.squadFor(kind, x, y); if (squad) u.soldiers = squad; // 0.49
    if (spec.mobile) { u.post = [x, y]; u.hp = spec.mobile.hp; u.ai = "hunt"; u.thinkT = 0; }
    if (kind === "garrison" || kind === "sniper") { // 0.50: fortified on a roof, or a ground squad that holds
      if (roof) u.fort = "up"; else { u.ai = "hold"; u.range = spec.range; u.holdAt = [x, y]; }
    }
    else if (spec.hp) u.hp = spec.hp; // 0.24: street emplacements can be clawed down
    this.units.push(u);
    const cls = Sup.ammoClass(kind);
    if (cls === "shells" || cls === "rockets") u.reserve = Sup.startingStock(this.difficulty, this.mutators.has("supply_shortage")).reserve * spec.ammo; // 0.60
    else if (cls) u.reserve = Sup.basicLoad(cls, kind) * spec.ammo; // 0.60 lab: spare magazines on hand, refilled by engineers
    if (this.phase !== "plan") {
      u.deployT = this.dev.instantDeploy ? 0 : spec.deploy;
      this.pay(cost);
      if (u.deployT > 0) {
        const info = C.UNIT_INFO[kind];
        if (info.vehicle === "helo_uh60") {
          this.spawnHelo("helo_uh60", x + 0.5, y + 0.5, u.deployT + 1.5, u.deployT * 0.45, spec.color, `UH-60: ${spec.name}`);
        } else if (info.vehicle === "helo_ch47") {
          this.spawnHelo("helo_ch47", x + 0.5, y + 0.5, u.deployT + 1.8, u.deployT * 0.45, spec.color, `CH-47: ${spec.name}`);
        } else if (info.vehicle === "c130_apc") {
          this.spawnFlyover("c130_apc", x + 0.5, y + 0.5, Math.min(6, u.deployT * 0.8), spec.color, undefined, "C-130J: APC Heavy Drop");
          this.spawnChutes("apc", x + 0.5, y + 0.5, 1, Math.max(2, u.deployT * 0.75), spec.color);
        }
      }
    }
    this.refreshAuras();
    return null;
  }

  canPlaceSupport(kind: C.SupportKind, x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    if (!this.zoneClosed) return "Draw a safe zone first: support buildings go inside it.";
    const spec = C.SUPPORTS[kind];
    const t = this.tileAt(x, y);
    // 0.35.1: an Evac Point can be a rooftop helipad or a landing zone on open ground (street or park)
    if (kind === "evac") { if (t !== BUILDING && t !== ROAD && t !== PARK) return `${spec.name}s go on a rooftop, a street or a park.`; }
    else if (t !== BUILDING) return `${spec.name}s go on buildings.`;
    if (!this.unitInZone({ x, y })) return kind === "evac" ? `${spec.name}s must be placed inside a safe zone.` : `${spec.name}s must be placed on a building inside a safe zone.`;
    if (kind === "militia" && this.supports.filter(b => b.kind === "militia").length >= C.MILITIA_MAX) return `Only ${C.MILITIA_MAX} Armories per battle.`;
    if (kind === "repair" && this.supports.filter(b => b.kind === "repair").length >= C.REPAIR_MAX) return `Only ${C.REPAIR_MAX} Repair Yards per battle.`; // 0.50 stopgap
    const near = this.overlapAt(spec.foot, x, y);
    if (near) return near;
    if (this.remaining() < this.supportCost(kind, x, y)) return "Not enough budget.";
    return null;
  }

  placeSupport(kind: C.SupportKind, x: number, y: number): string | null {
    const err = this.canPlaceSupport(kind, x, y);
    if (err) return err;
    const spec = C.SUPPORTS[kind];
    const cost = this.supportCost(kind, x, y);
    const b: Support = { kind, x, y, paid: cost };
    if (this.phase !== "plan") {
      b.deployT = this.dev.instantDeploy ? 0 : spec.deploy;
      this.pay(cost);
      if (b.deployT > 0) {
        this.spawnHelo("helo_ch47", x + 0.5, y + 0.5, b.deployT + 1.8, b.deployT * 0.45, spec.color, `CH-47: ${spec.name}`);
      }
    }
    this.supports.push(b);
    this.refreshAuras();
    return null;
  }

  /** Mid-battle sale: the unit or support building stops working until it is extracted, then refunds. Returns seconds, or an error. */
  /** 0.44: the unit (first) or support building under (x, y), same hit box as selling. Units being pulled out are skipped. */
  /** 0.49: the living soldier within 0.8 cell of x,y (nearest), with their squad. */
  soldierAt(x: number, y: number): { unit: Unit; soldier: Soldier } | null {
    let best: { unit: Unit; soldier: Soldier } | null = null, bd = 0.8;
    for (const u of this.units) if (u.soldiers && u.extractT === undefined) for (const so of u.soldiers) {
      if (!so.alive) continue;
      const d = hyp(so.x - x, so.y - y); if (d < bd) { bd = d; best = { unit: u, soldier: so }; }
    }
    return best;
  }
  entityAt(x: number, y: number): Entity | null {
    const hit = this.soldierAt(x, y); if (hit) return { unit: hit.unit }; // 0.49: a soldier's dot picks the squad
    const u = this.units.find(u => u.extractT === undefined && Math.abs(u.x + 0.5 - x) <= 1.5 && Math.abs(u.y + 0.5 - y) <= 1.5);
    if (u) return { unit: u };
    const b = this.supports.find(b => b.extractT === undefined && Math.abs(b.x + 0.5 - x) <= 1.5 && Math.abs(b.y + 0.5 - y) <= 1.5);
    if (b) return { support: b };
    // 0.46: an AC-130, by its plane or the middle of its orbit
    const o = this.orbits.find(o => { if (o.leaving) return false; const [px, py] = this.orbitPos(o); return hyp(px - x, py - y) <= 3 || hyp(o.x - x, o.y - y) <= 3; });
    return o ? { orbit: o } : null;
  }

  sellAt(x: number, y: number): number | string {
    if (this.phase !== "battle") return "Nothing to sell.";
    const u = this.units.find(u => Math.abs(u.x + 0.5 - x) <= 1.5 && Math.abs(u.y + 0.5 - y) <= 1.5);
    if (u) return this.sellEntity({ unit: u });
    const b = this.supports.find(b => Math.abs(b.x + 0.5 - x) <= 1.5 && Math.abs(b.y + 0.5 - y) <= 1.5);
    if (!b) return "No unit or building there.";
    return this.sellEntity({ support: b });
  }

  /** 0.44: pull one unit or building out mid-battle (helicopter extraction, refund when it is out). Seconds, or why not. */
  sellEntity(e: Entity): number | string {
    if (this.phase !== "battle") return "Nothing to sell.";
    if ("orbit" in e) return this.sendHome(e.orbit) ? 0 : "Already heading home.";
    if ("unit" in e) {
      const u = e.unit;
      if (u.kind === "para") return "Paratroopers can't be sold. They walk home when out of ammo.";
      if (u.kind === "police" || u.kind === "militia") return "Squads from support buildings or APCs can't be sold directly.";
      if (u.extractT !== undefined) return "Already being pulled out.";
      u.extractT = u.kind === "garrison" ? C.TROOPS_EXTRACT_S : Math.max(5, C.UNITS[u.kind].deploy * C.EXTRACT_MUL); // 0.53.1: Troops 10 s
      if (C.UNITS[u.kind].on !== "water") {
        this.spawnHelo("helo_extract", u.x + 0.5, u.y + 0.5, u.extractT + 1.2, u.extractT * 0.4, "#cfd8dc", `EVAC: ${C.UNITS[u.kind].name}`);
      }
      return u.extractT;
    }
    const b = e.support;
    if (b.extractT !== undefined) return "Already being pulled out.";
    b.extractT = Math.max(5, C.SUPPORTS[b.kind].deploy * C.EXTRACT_MUL);
    this.spawnHelo("helo_extract", b.x + 0.5, b.y + 0.5, b.extractT + 1.2, b.extractT * 0.4, "#cfd8dc", `EVAC: ${C.SUPPORTS[b.kind].name}`);
    this.refreshAuras();
    return b.extractT;
  }

  removeAt(x: number, y: number) {
    if (this.phase !== "plan") return false;
    const u = this.units.find(u => Math.abs(u.x - x) <= 1 && Math.abs(u.y - y) <= 1);
    if (u) return this.removeEntity({ unit: u });
    const b = this.supports.find(b => Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1);
    return b ? this.removeEntity({ support: b }) : false;
  }

  /** 0.44: remove one unit or building in planning, full refund. False if it is not there, or (a Budget Office)
   *  removing it would put the plan in debt. */
  removeEntity(e: Entity): boolean {
    if (this.phase !== "plan" || "orbit" in e) return false;
    if ("unit" in e) {
      const k = this.units.indexOf(e.unit);
      if (k < 0) return false;
      this.units.splice(k, 1);
      this.pruneGroupsNow(); // 0.50
      for (const u of this.units) if (u.kind === e.unit.kind) u.paid = this.unitCost(u.kind, u.x, u.y); // 0.48: the rest move up the price line
      return true;
    }
    const sk = this.supports.indexOf(e.support);
    if (sk < 0) return false;
    const removed = this.supports.splice(sk, 1)[0];
    if (this.phase === "plan") for (const b of this.supports) if (b.kind === removed.kind) b.paid = this.supportCost(b.kind, b.x, b.y); // the rest move up the price line (0.49: every support kind)
    if (removed.kind === "budget") {
      // Recompute prices of anything that was discounted by this Budget Office; if removing it would put
      // the plan in debt, put it back and refuse.
      for (const u of this.units) u.paid = this.unitCost(u.kind, u.x, u.y);
      for (const b of this.supports) b.paid = this.supportCost(b.kind, b.x, b.y);
      if (this.remaining() < 0) {
        this.supports.splice(sk, 0, removed);
        for (const u of this.units) u.paid = this.unitCost(u.kind, u.x, u.y);
        for (const b of this.supports) b.paid = this.supportCost(b.kind, b.x, b.y);
        return false;
      }
    }
    this.refreshAuras();
    return true;
  }

  /** 0.48: price of the next charge. Paratroopers follow the price line (the n-th bought costs more); the rest are flat. */
  abilityCost(k: C.AbilityKind, nth = this.bought[k]) { return k === "para" ? Math.round(C.ABILITIES[k].cost * this.stepMul(nth)) : C.ABILITIES[k].cost; }
  abilitySpent(k: C.AbilityKind, n: number) { let s = 0; for (let i = 0; i < n; i++) s += this.abilityCost(k, i); return s; }
  /** 0.48: cost of operations due this tick: upkeepPct of what every standing unit and support paid. */
  upkeepDue() {
    const p = this.diff.upkeepPct;
    if (!p) return 0;
    let s = 0;
    for (const u of this.units) if (u.hp === undefined || u.hp > 0) s += u.paid ?? C.UNITS[u.kind].cost;
    for (const b of this.supports) s += b.paid;
    return Math.round(s * p);
  }
  buyAbility(k: C.AbilityKind): string | null {
    if (this.phase === "over") return "The battle is over.";
    if (this.bought[k] >= C.ABILITIES[k].max && !this.dev.noStockpileLimits) return `Only ${C.ABILITIES[k].max} ${C.ABILITIES[k].name} available per battle.`;
    const cost = this.abilityCost(k);
    if (this.remaining() < cost) return "Not enough money.";
    this.bought[k]++; this.charges[k]++;
    this.pay(cost);
    return null;
  }
  sellAbility(k: C.AbilityKind) {
    if (this.phase !== "plan" || !this.bought[k]) return false;
    this.bought[k]--; this.charges[k]--;
    return true;
  }
  /** Plant (or, if already planted, remove) a charge on the bridge at x,y during planning. */
  toggleC4(x: number, y: number): string | null {
    if (this.phase === "over") return "The battle is over.";
    const b = this.bridgeAt(x, y);
    if (b < 0) return "Charges go on bridges.";
    if (this.c4.has(b)) { if (this.phase !== "plan") return "Already charged."; this.c4.delete(b); return null; }
    if (this.blown.has(b)) return "That bridge is gone.";
    if (this.remaining() < C.C4_COST) return "Not enough money.";
    this.c4.add(b);
    this.pay(C.C4_COST);
    return null;
  }
  // ---------- 0.38: building demolition ----------
  /** The building cells (connected roof cells, capped) that a charge at cell i brings down. */
  demoCells(i0: number): number[] {
    const w = this.w, h = this.h, tile = this.map.tile;
    if (tile[i0] !== BUILDING) return [];
    const seen = new Set([i0]), st = [i0], out: number[] = [];
    while (st.length && out.length < C.DEMO_MAX_CELLS) {
      const i = st.pop()!; out.push(i);
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && tile[j] === BUILDING && !seen.has(j)) { seen.add(j); st.push(j); }
    }
    return out;
  }
  /** The planted charge whose building covers cell i, or -1. */
  demoAt(x: number, y: number): number {
    const i = this.idx(x, y);
    for (const c of this.demo) if (!this.demoBlown.has(c) && (c === i || this.demoCells(c).includes(i))) return c;
    return -1;
  }
  private demoProblem(cells: number[]): string | null {
    if (!cells.length) return "Demolition charges go on buildings (or bridges).";
    const set = new Set(cells);
    if (cells.some(i => this.inZone[i])) return "That building is part of your safe zone. Bringing it down would open the perimeter.";
    for (const u of this.units) if ((u.hp === undefined || u.hp > 0) && set.has(this.idx(u.x | 0, u.y | 0))) return "Your unit is on that roof. Move it first.";
    for (const b of this.supports) if (set.has(this.idx(b.x, b.y))) return "A support building is on that roof.";
    return null;
  }
  /** Plant (or, while planning, remove) a demolition charge on the building at x,y. */
  toggleDemo(x: number, y: number): string | null {
    if (this.phase === "over") return "The battle is over.";
    const at = this.demoAt(x, y);
    if (at >= 0) { if (this.phase !== "plan") return "Already charged."; this.demo.delete(at); return null; }
    const i = this.idx(x, y);
    const p = this.demoProblem(this.demoCells(i));
    if (p) return p;
    if (this.remaining() < C.DEMO_COST) return "Not enough money.";
    this.demo.add(i);
    this.pay(C.DEMO_COST);
    return null;
  }
  /** Blow the charged building at x,y: a controlled demolition into its footprint, with rubble spilling into the
   *  streets beside it. Infected inside the fall die. */
  blowBuilding(x: number, y: number): string | null {
    if (this.phase !== "battle") return "Buildings can only be brought down during the battle.";
    const c = this.demoAt(x, y);
    if (c < 0) return "No charge on that building. Plant charges while planning.";
    const cells = this.demoCells(c);
    const p = this.demoProblem(cells);
    if (p) return p;
    this.demoBlown.add(c);
    St.event(this.stats, St.SE_DEMOLISH, this.time, x, y); // 0.57
    const w = this.w, h = this.h, foot = new Set(cells);
    let sx = 0, sy = 0;
    for (const i of cells) {
      this.map.tile[i] = 0; this.map.height[i] = 0; this.rubble[i] = 1; this.damage[i] = 255;
      sx += i % w; sy += (i / w) | 0;
    }
    this.buildingsCollapsed += cells.length;
    // spill: every street cell next to the footprint, and about half of the ring beyond it
    const rr = rng((c * 2654435761) >>> 0);
    for (const i of cells) {
      const x = i % w, y = (i / w) | 0;
      for (let dy = -C.DEMO_SPILL; dy <= C.DEMO_SPILL; dy++) for (let dx = -C.DEMO_SPILL; dx <= C.DEMO_SPILL; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx, t = this.map.tile[j];
        if (foot.has(j) || this.rubble[j] || this.inZone[j] || t === WATER || t === BRIDGE || t === BUILDING) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d === 1 || rr() < 0.5 / d) { this.rubble[j] = 1; if (this.rough[j] < 200) this.rough[j] = 200; }
      }
    }
    for (let k = 0; k < this.n; k++) {
      const st = this.state[k];
      if (st === DEAD || !foot.has(this.idx(this.ax[k] | 0, this.ay[k] | 0))) continue;
      if (st === INF) { this.state[k] = DEAD; this.recordKill(k, undefined, "demolition"); }
    }
    const cx = sx / cells.length, cy = sy / cells.length, rad = Math.max(3, Math.sqrt(cells.length) * 0.7);
    this.blasts.push({ x: cx, y: cy, r: rad, t: this.time, color: "#bcaaa4" });
    this.scare(cx, cy, rad + 10, 0.8); this.noise(cx, cy, rad + 30, 1.2);
    this.mapVersion++; this.fieldDirty = true;
    return null;
  }

  // ---------- 0.38: armed wall guards ----------
  /** Posts along the standing walls (every GUARD_SPACING cells) and gates (one per opening). Kept per cell, so a post
   *  that died stays dead when the zone grows. */
  private placeGuards() {
    const key = this.zoneCells * 31 + this.zones.length;
    if (key === this.guardKey) return;
    this.guardKey = key;
    const w = this.w, keep = new Map(this.guardPosts.map(p => [p.i, p]));
    const posts: number[] = [];
    const near = (i: number, sp: number) => {
      const x = i % w, y = (i / w) | 0;
      for (const p of posts) { const dx = (p % w) - x, dy = ((p / w) | 0) - y; if (dx * dx + dy * dy < sp * sp) return true; }
      return false;
    };
    for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i] === 3 && this.wallHp[i] > 0 && !near(i, C.GUARD_GATE_SPACING)) posts.push(i);
    for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i] === 2 && this.wallHp[i] > 0 && !near(i, C.GUARD_SPACING)) posts.push(i);
    this.guardPosts = posts.map(i => keep.get(i) ?? { i, cd: 0, dead: 0 });
    for (const p of keep.values()) if (p.dead && !posts.includes(p.i)) this.guardPosts.push(p);
  }
  /** Nearest infected outside the zone that a guard on the wall at (x, y) can see, within r. */
  private guardTarget(x: number, y: number, r: number) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bd = r * r, checks = 0;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== INF) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d2 = dx * dx + dy * dy;
        if (d2 >= bd || this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)]) continue;
        if (checks++ > 12) continue;
        if (!this.sightClear(x, y, C.GUARD_EYE_M, this.ax[k], this.ay[k])) continue;
        bd = d2; best = k;
      }
    return best;
  }
  private stepGuards(dt: number) {
    this.placeGuards();
    if (!this.outbreak) return;
    const roofMul = this.mutators.has("fragile_walls") ? 1.3 : 1, wMax = this.wallMaxHp(), gMax = this.gateMaxHp();
    for (const p of this.guardPosts) {
      if (p.dead) continue;
      const z = this.inZone[p.i], hp = this.wallHp[p.i];
      if ((z !== 2 && z !== 3) || hp <= 0) { p.dead = 1; this.guardsLost++; continue; } // the wall fell: so did they
      p.cd -= dt;
      if (p.cd > 0) continue;
      const x = (p.i % this.w) + 0.5, y = ((p.i / this.w) | 0) + 0.5;
      const rate = C.GUARD_RATE * Math.min(1, hp / (z === 2 ? wMax : gMax)) * (this.hasActiveSupport("command", x, y) ? C.COMMAND_RATE_MUL : 1);
      if (rate < 0.05) { p.cd = 1; continue; }
      const range = C.GUARD_RANGE * (this.hasActiveSupport("radio", x, y) ? C.RADIO_RANGE_MUL : 1) * roofMul;
      const t = this.guardTarget(x, y, range);
      if (t < 0) { p.cd = 0.3; continue; }
      p.cd = 1 / rate;
      const tx = this.ax[t], ty = this.ay[t];
      if (this.shots.length < 4000) this.shots.push({ x0: x, y0: y, x1: tx, y1: ty, t: this.time, land: this.time + Math.max(0.03, hyp(tx - x, ty - y) * C.CELL_M / 900), cls: SHOT_SMALL, kind: "garrison" });
      const r = rng((this.tick * 2246822519 + p.i * 3266489917) >>> 0);
      if (r() < C.GUARD_ACC) {
        this.hp[t] -= C.GUARD_DAMAGE;
        if (this.hp[t] <= 0) { this.state[t] = DEAD; this.recordKill(t, undefined, "guard"); this.guardKills++; }
      }
    }
  }
  /** Live guard posts (for the renderer and stats). */
  guardsAlive() { let n = 0; for (const p of this.guardPosts) if (!p.dead) n++; return n; }

  /** Blow the charged bridge at x,y: it becomes river and whoever is on it falls. */
  blowBridge(x: number, y: number): string | null {
    if (this.phase !== "battle") return "Bridges can only be blown during the battle.";
    const b = this.bridgeAt(x, y);
    if (b < 0 || !this.c4.has(b)) return "No charge on that bridge. Plant charges while planning.";
    if (this.blown.has(b)) return "Already blown.";
    this.blown.add(b);
    St.event(this.stats, St.SE_BRIDGE, this.time, x, y); // 0.57
    if (!this.memDir) { if (this.fieldDirty) this.buildFields(); this.memDir = this.infDir.slice(); } // 0.33: what the infected still believe
    const cells = new Set(this.bridges[b]);
    for (const i of cells) { this.map.tile[i] = WATER; this.inZone[i] = 0; if (this.walkMask) this.walkMask[i] = 0; }
    this.navVersion++; // 0.40
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD || !cells.has(this.idx(this.ax[k] | 0, this.ay[k] | 0))) continue;
      if (s === INF) this.recordKill(k, undefined, "bridge"); else { this.civKilledByUs++; this.note(k, EV_KILLED_BY_US); }
      this.state[k] = DEAD;
    }
    let sx = 0, sy = 0;
    for (const i of cells) { sx += i % this.w; sy += (i / this.w) | 0; }
    this.blasts.push({ x: sx / cells.size, y: sy / cells.size, r: 8, t: this.time, color: "#ffcc80" });
    this.mapVersion++; this.fieldDirty = true;
    return null;
  }

  /** Fire an ability at (x,y); the airstrike also takes the end of its run (x2,y2). */
  useAbility(k: C.AbilityKind, x: number, y: number, x2 = x, y2 = y): string | null {
    if (this.phase !== "battle") return "Abilities are used during the battle.";
    if (this.charges[k] <= 0) return `No ${C.ABILITIES[k].name.toLowerCase()} left. Buy them while planning.`;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    if (k === "para" || k === "supply_drop") {
      const t = this.tileAt(x | 0, y | 0);
      if (t === WATER) return `${C.ABILITIES[k].name} can't land in the river.`;
    }
    if (k === "para") {
      const live = this.units.filter(u => u.kind === "para" && (u.hp ?? 1) > 0).length + this.pending.filter(p => p.kind === "para").length;
      if (live >= C.PARA_LIVE_MAX) return `${C.PARA_LIVE_MAX} paratrooper squads are already deployed. Wait for one to go home.`;
    }
    if (k === "a10") {
      const dx = x2 - x, dy = y2 - y, l = hyp(dx, dy);
      if (l < 4) return "Drag the run out a bit longer.";
      if (l > C.A10_LEN) { x2 = x + (dx / l) * C.A10_LEN; y2 = y + (dy / l) * C.A10_LEN; }
    }
    if (k === "airstrike") { // clamp the run length
      const dx = x2 - x, dy = y2 - y, l = hyp(dx, dy);
      if (l < 4) return "Drag the run out a bit longer.";
      if (l > C.AIRSTRIKE_LEN) { x2 = x + (dx / l) * C.AIRSTRIKE_LEN; y2 = y + (dy / l) * C.AIRSTRIKE_LEN; }
    }
    const nf = this.strikeRefusal(k, x, y, x2, y2);
    if (nf) return nf;
    this.charges[k]--; this.abilitiesUsed++;
    const delay = C.ABILITIES[k].delay;
    const si = St.strike(this.stats, k, this.time, x, y); // 0.57
    if (k !== "gunship") this.pending.push({ kind: k, at: this.time + delay, x, y, x2, y2, strike: si });
    if (k === "airstrike") {
      const ang = Math.atan2(y2 - y, x2 - x);
      this.spawnFlyover("jet_strike", (x + x2) / 2, (y + y2) / 2, delay * 1.35, "#ff5252", ang, "F-15E Airstrike");
    } else if (k === "firebomb") {
      this.spawnFlyover("jet_strike", x, y, delay * 1.6, "#ff9100", undefined, "Firebomb Run");
    } else if (k === "para") {
      this.spawnFlyover("c130_para", x, y, delay * 1.25, "#a5d6a7", undefined, "C-130J Airborne Drop");
    } else if (k === "supply_drop") {
      this.spawnFlyover("c130_supply", x, y, delay * 1.25, "#4fc3f7", undefined, "C-130J Supply Drop");
    } else if (k === "a10") {
      this.spawnFlyover("jet_strike", (x + x2) / 2, (y + y2) / 2, delay * 1.35, "#90a4ae", Math.atan2(y2 - y, x2 - x), "A-10 Gun Run", "a10");
    } else if (k === "cluster") {
      this.spawnFlyover("jet_strike", x, y, delay * 1.3, "#ffab91", undefined, "CBU-97 Cluster Drop");
    } else if (k === "tomahawk") {
      this.spawnMissile(x, y, delay, "#e0e0e0", "TOMAHAWK INBOUND");
    } else if (k === "gunship") {
      // 0.46: no C-130 delivers it: the gunship itself flies in from the nearest map edge and joins its orbit
      // at the point facing that edge.
      const [fx, fy] = this.edgeEntry(x, y);
      this.orbits.push({ x, y, until: 0, angle: Math.atan2(fy - y, fx - x), inbound: true, fx, fy, stationLeft: C.GUNSHIP_S,
        g25: 0, g40: 0, g105: 1, shots25: 0, shots40: 0, shots105: 0, strike: si });
    } else if (k === "moab") {
      this.spawnFlyover("c130_supply", x, y, delay * 1.2, "#ffcc80", undefined, "MC-130J: GBU-43 MOAB", "mc130");
    } else if (k === "nuke") {
      this.spawnFlyover("jet_strike", x, y, delay * 1.1, "#76ff03", undefined, "INBOUND: TACTICAL NUCLEAR STRIKE");
    }
    return null;
  }

  private recordKill(k: number, u?: Unit, other?: OtherKill) {
    this.kills++;
    if (u) {
      St.killBy(this.stats, this.time, { unit: St.unitIndex(this.stats, u, this.time) });
      if (u.drop !== undefined) St.dropKill(this.stats, u.drop); // 0.59
      if (u.kind === "sniper") { const d = hyp(this.ax[k] - u.x, this.ay[k] - u.y) * C.CELL_M; if (d > this.stats.c.longShot) this.stats.c.longShot = d; }
    } else if (other) St.killBy(this.stats, this.time, { other });
    else if (this.curStrike >= 0) St.killBy(this.stats, this.time, { strike: this.curStrike });
    else St.killBy(this.stats, this.time, { other: "env" });
    if (this.mutant[k]) this.swimmersKilled++;
    if (u) u.kills++;
    const cx = Math.max(0, Math.min(this.w - 1, this.ax[k] | 0));
    const cy = Math.max(0, Math.min(this.h - 1, this.ay[k] | 0));
    const ci = cy * this.w + cx;
    const v = Math.min(65535, this.killGrid[ci] + 1);
    this.killGrid[ci] = v;
    if (v > this.maxKillCell) this.maxKillCell = v;
    if (u) {
      let kg = this.killByKind[u.kind];
      if (!kg) kg = this.killByKind[u.kind] = new Uint16Array(this.w * this.h);
      if (kg[ci] < 65535) kg[ci]++;
    }
  }

  /** Damage everyone (or only infected) within r of (x,y). Returns infected killed. */
  areaDamage(x: number, y: number, r: number, dmg: number, hitsCivilians: boolean, u?: Unit, maxHits = Infinity, ignoreDevFF = false) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    const r2 = r * r;
    let killed = 0;
    if (!this.dev.friendlyFire && !ignoreDevFF) hitsCivilians = false;
    for (const list of hitsCivilians ? [this.head, this.headC] : [this.head])
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      for (let k = list[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        const s = this.state[k];
        if (s === DEAD || (s !== INF && !hitsCivilians)) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y;
        if (dx * dx + dy * dy > r2) continue;
        if (maxHits-- <= 0) return killed;
        if (s === INF) {
          this.hp[k] -= dmg;
          if (this.hp[k] <= 0) { this.state[k] = DEAD; killed++; this.recordKill(k, u); }
        } else if (dmg >= 50) { this.state[k] = DEAD; this.civKilledByUs++; this.note(k, EV_KILLED_BY_US); } // civilians have no armor
      }
    }
    return killed;
  }

  private runPending(dt: number) {
    // Release paratrooper and supply parachutes as the C-130 passes over the drop zone (~1.8 s before touchdown)
    for (const p of this.pending) {
      if (!p.chuteSpawned && p.at - this.time <= 1.8) {
        if (p.kind === "para") {
          p.chuteSpawned = true;
          this.spawnChutes("trooper", p.x, p.y, 6, Math.max(0.8, p.at - this.time), "#a5d6a7");
        } else if (p.kind === "supply_drop") {
          p.chuteSpawned = true;
          this.spawnChutes("supply", p.x, p.y, 4, Math.max(0.8, p.at - this.time), "#4fc3f7");
        }
      }
    }
    if (this.pending.length) {
      const due = this.pending.filter(p => p.at <= this.time);
      this.pending = this.pending.filter(p => p.at > this.time);
      for (const p of due) {
        this.curStrike = p.strike ?? -1; // 0.57: kills and civilian losses below go to this strike
        if (p.kind === "airstrike") { // a stick of bombs walking along the run
          const l = hyp(p.x2 - p.x, p.y2 - p.y), n = Math.max(2, Math.round(l / 5));
          for (let i = 0; i <= n; i++) {
            const f = i / n;
            this.pending.push({ kind: "bomb", at: this.time + i * 0.08, x: p.x + (p.x2 - p.x) * f, y: p.y + (p.y2 - p.y) * f, x2: 0, y2: 0, strike: p.strike });
          }
        } else if (p.kind === "bomb") {
          this.areaDamage(p.x, p.y, C.AIRSTRIKE_RADIUS, 5000, true);
          this.damageTerrain(p.x, p.y, C.AIRSTRIKE_RADIUS, C.STRUCT_DMG_AIRSTRIKE);
          this.blasts.push({ x: p.x, y: p.y, r: C.AIRSTRIKE_RADIUS + 1, t: this.time, color: "#ffab40" });
        } else if (p.kind === "firebomb") {
          const park = this.tileAt(p.x | 0, p.y | 0) === PARK;
          const r = park ? C.FIRE_RADIUS_PARK : C.FIRE_RADIUS;
          this.fires.push({ x: p.x, y: p.y, r, until: this.time + C.FIRE_S, strike: p.strike });
          this.damageTerrain(p.x, p.y, r * 0.85, C.STRUCT_DMG_FIREBOMB);
          this.blasts.push({ x: p.x, y: p.y, r: 4, t: this.time, color: "#ff9100" });
        } else if (p.kind === "para") {
          const spec = C.UNITS.para;
          this.units.push({ kind: "para", x: p.x | 0, y: p.y | 0, range: spec.range, ammo: spec.ammo, cooldown: 0.5, kills: 0, shotX: 0, shotY: 0, shotT: -1,
            post: [p.x | 0, p.y | 0], hp: spec.mobile!.hp, ai: "hunt", thinkT: 0, soldiers: this.squadFor("para", p.x | 0, p.y | 0), ...(p.strike !== undefined ? { drop: p.strike } : {}) });
        } else if (p.kind === "supply_drop") {
          this.applySupplyDrop(p.x, p.y);
        } else if (p.kind === "a10") { // 30 mm along the line: deadly, narrow, light on buildings
          const l = hyp(p.x2 - p.x, p.y2 - p.y), n = Math.max(2, Math.round(l / 1.5));
          for (let i = 0; i <= n; i++) {
            const f = i / n, bx = p.x + (p.x2 - p.x) * f, by = p.y + (p.y2 - p.y) * f;
            this.areaDamage(bx, by, C.A10_WIDTH, C.A10_DMG, true);
            if (i % 3 === 0) { this.damageTerrain(bx, by, 1, 20, false); this.blasts.push({ x: bx, y: by, r: 1.2, t: this.time, color: "#ffe082" }); }
          }
          this.mapVersion++;
        } else if (p.kind === "cluster") {
          const rr = rng((this.tick * 2654435761 + (p.y * 97 | 0)) >>> 0);
          for (let i = 0; i < C.CLUSTER_BOMBLETS; i++) {
            const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.CLUSTER_RADIUS;
            const bx = Math.max(0, Math.min(this.w - 1, p.x + Math.cos(a) * d)), by = Math.max(0, Math.min(this.h - 1, p.y + Math.sin(a) * d));
            this.areaDamage(bx, by, C.CLUSTER_SPLASH, C.CLUSTER_DMG, true);
            if (i % 4 === 0) this.blasts.push({ x: bx, y: by, r: C.CLUSTER_SPLASH + 0.5, t: this.time, color: "#ffab91" });
          }
          this.damageTerrain(p.x, p.y, C.CLUSTER_RADIUS * 0.7, 30);
        } else if (p.kind === "tomahawk") {
          this.areaDamage(p.x, p.y, C.TOMAHAWK_RADIUS, 1e6, true);
          this.damageTerrain(p.x, p.y, C.TOMAHAWK_RADIUS, 255);
          this.hurtWalls(p.x, p.y, C.TOMAHAWK_RADIUS, 6000);
          this.blasts.push({ x: p.x, y: p.y, r: C.TOMAHAWK_RADIUS + 2, t: this.time, color: "#ffffff" });
        } else if (p.kind === "barrage") { // a fire mission: shells land scattered over a few seconds
          const rr = rng((this.tick * 2246822519 + (p.x * 131 | 0)) >>> 0);
          for (let i = 0; i < C.BARRAGE_SHELLS; i++) {
            const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.BARRAGE_RADIUS;
            this.pending.push({ kind: "shell", at: this.time + rr() * C.BARRAGE_S, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, x2: 0, y2: 0, strike: p.strike });
          }
        } else if (p.kind === "shell") {
          const sx = Math.max(0, Math.min(this.w - 1, p.x)), sy = Math.max(0, Math.min(this.h - 1, p.y));
          this.areaDamage(sx, sy, C.BARRAGE_SPLASH, C.BARRAGE_DMG, true);
          this.damageTerrain(sx, sy, C.BARRAGE_SPLASH, C.STRUCT_DMG_HOWITZER);
          this.blasts.push({ x: sx, y: sy, r: C.BARRAGE_SPLASH, t: this.time, color: "#f48fb1" });
        } else if (p.kind === "moab") {
          this.areaDamage(p.x, p.y, C.MOAB_RADIUS, 1e6, true);
          this.damageTerrain(p.x, p.y, C.MOAB_RADIUS, 220);
          this.hurtWalls(p.x, p.y, C.MOAB_RADIUS, C.MOAB_WALL_DMG);
          this.blasts.push({ x: p.x, y: p.y, r: C.MOAB_RADIUS, t: this.time, color: "#ffcc80" });
        } else if (p.kind === "nuke") {
          this.nukesUsed++;
          this.areaDamage(p.x, p.y, C.NUKE_RADIUS, 1e9, true, undefined, Infinity, true);
          this.damageTerrain(p.x, p.y, C.NUKE_RADIUS, 255);
          this.hurtWalls(p.x, p.y, C.NUKE_RADIUS, 1e9);
          for (let i = this.units.length - 1; i >= 0; i--) { const u = this.units[i]; if (hyp(u.x - p.x, u.y - p.y) <= C.NUKE_RADIUS && u.hp !== -1) u.hp = 0; }
          for (let i = this.supports.length - 1; i >= 0; i--) { const b = this.supports[i]; if (hyp(b.x - p.x, b.y - p.y) <= C.NUKE_RADIUS) { this.lostLog.push(b.kind); this.supports.splice(i, 1); } }
          this.fallout.push({ x: p.x, y: p.y, r: C.FALLOUT_RADIUS, until: this.time + C.FALLOUT_S, strike: p.strike });
          this.blasts.push({ x: p.x, y: p.y, r: C.NUKE_RADIUS, t: this.time, color: "#f4ff81" });
          this.refreshAuras(); this.fieldDirty = true;
        }
      }
      this.curStrike = -1;
    }
    if (this.fires.length) {
      this.fires = this.fires.filter(f => f.until > this.time);
      // Fire hurts every 4th tick, in a bigger bite.
      if (this.tick % 4 === 0) { for (const f of this.fires) { this.curStrike = f.strike ?? -1; this.areaDamage(f.x, f.y, f.r, C.FIRE_DPS * dt * 4, true); } this.curStrike = -1; }
    }
    if (this.orbits.length) { this.stepOrbits(dt); this.curStrike = -1; }
    if (this.fallout.length) {
      this.fallout = this.fallout.filter(f => f.until > this.time);
      if (this.tick % 4 === 0) { for (const f of this.fallout) { this.curStrike = f.strike ?? -1; this.irradiate(f, dt * 4); } this.curStrike = -1; }
    }
    if (this.blasts.length) this.blasts = this.blasts.filter(b => this.time - b.t < 1);
    this.stepTransports(dt);
  }

  /** 0.46: the point on the map border nearest (x, y): where an AC-130 comes in and goes home. */
  edgeEntry(x: number, y: number): [number, number] {
    const l = x, r = this.w - 1 - x, t = y, b = this.h - 1 - y, m = Math.min(l, r, t, b);
    return m === l ? [0, y] : m === r ? [this.w - 1, y] : m === t ? [x, 0] : [x, this.h - 1];
  }
  /** 0.46: where the AC-130's plane is now: flying (in, to a new spot, home), circling, or out refueling (as drawn). */
  orbitPos(o: Orbit): [number, number] {
    if (o.inbound || o.leaving) return [o.fx, o.fy];
    const [jx, jy] = this.orbitEntry(o);
    if (!o.away) return [jx, jy];
    const left = o.until - this.time, gone = C.GUNSHIP_REFUEL_S - left, fly = 14, v = C.GUNSHIP_RADIUS * 1.15 * 0.5;
    const d = gone < fly ? gone * v : left < fly ? -left * v : fly * v, h = o.angle - Math.PI / 2;
    return [jx + Math.cos(h) * d, jy + Math.sin(h) * d];
  }
  /** 0.46: still under the player's command (not gone, not heading home). */
  orbitAlive(o: Orbit) { return !o.leaving && this.orbits.includes(o); }
  /** 0.46: send an AC-130 to circle (x, y). On station it keeps the station time it had left (flying there costs
   *  none); refueling, it just comes back to the new spot when done; inbound, it turns for the new spot. */
  redeployOrbit(o: Orbit, x: number, y: number): string | null {
    if (!this.orbitAlive(o)) return "That AC-130 is heading home.";
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    if (o.away) { o.x = x; o.y = y; return null; }
    const [px, py] = this.orbitPos(o);
    if (!o.inbound) o.stationLeft = Math.max(0, o.until - this.time);
    o.x = x; o.y = y; o.fx = px; o.fy = py;
    o.angle = Math.atan2(py - y, px - x); // joins the new circle at the point facing it
    o.inbound = true;
    return null;
  }
  /** 0.46: what to tell the player after a redeploy (a refueling plane only comes back when it's done). */
  redeployNote(o: Orbit): string {
    return o.away ? `AC-130 refueling: back over the new spot in ${Math.ceil(o.until - this.time)} s.` : "AC-130 moving to the new spot.";
  }
  /** 0.46: send an AC-130 home: it flies off the nearest edge and is gone. Before it ever reached station the charge
   *  comes back. False if it is already leaving. */
  sendHome(o: Orbit): boolean {
    if (!this.orbitAlive(o)) return false;
    if (!o.arrived) { this.charges.gunship++; this.abilitiesUsed = Math.max(0, this.abilitiesUsed - 1); }
    if (o.away) { this.orbits = this.orbits.filter(p => p !== o); o.leaving = true; return true; } // already off the map
    [o.fx, o.fy] = this.orbitPos(o);
    o.inbound = false; o.leaving = true;
    return true;
  }
  /** Where an inbound AC-130 joins its circle (the plane's spot on the orbit at its current angle). */
  private orbitEntry(o: Orbit): [number, number] {
    return [o.x + Math.cos(o.angle) * C.GUNSHIP_RADIUS * 1.15, o.y + Math.sin(o.angle) * C.GUNSHIP_RADIUS * 1.15];
  }

  /** 0.46: an infected in the orbit for one gun. Samples `tries` spots (seeded), takes the nearest infected to each
   *  and classifies it by how many infected stand within 2.5 cells: 1-2 suits the 25 mm, 3-9 the 40 mm. The 25 mm
   *  falls back to any infected, the 40 mm to packs (never stragglers). -1 when none found. */
  private gunTarget(o: Orbit, gun: 25 | 40, tries: number): number {
    const rr = rng((this.tick * 69069 + gun * 40503 + (o.shots25 + o.shots40) * 2654435761) >>> 0);
    let fallback = -1;
    for (let i = 0; i < tries; i++) {
      const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.GUNSHIP_RADIUS;
      const t = this.nearest(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, 8, INF, 255, 60);
      if (t < 0) continue;
      const n = this.countInf(this.ax[t], this.ay[t], 2.5, 10);
      if (gun === 25 ? n <= 2 : n >= 3 && n <= 9) return t;
      if (fallback < 0 && (gun === 25 || n >= 3)) fallback = t;
    }
    return fallback;
  }

  /** AC-130 on station: circles the spot with the AC-130U's three guns. Precise: infected only. */
  private stepOrbits(dt: number) {
    let gone: Orbit[] | null = null;
    for (const o of this.orbits) {
      this.curStrike = o.strike ?? -1; // 0.57
      if (o.inbound || o.leaving) { // 0.46: flying in, to a new spot, or home
        const [tx, ty] = o.inbound ? this.orbitEntry(o) : this.edgeEntry(o.fx, o.fy);
        const d = hyp(tx - o.fx, ty - o.fy), step = C.GUNSHIP_SPEED * dt;
        if (d > step) { o.fx += (tx - o.fx) / d * step; o.fy += (ty - o.fy) / d * step; continue; }
        o.fx = tx; o.fy = ty;
        if (o.leaving) { (gone ??= []).push(o); continue; }
        o.inbound = false; o.arrived = true; o.away = false;
        o.until = this.time + o.stationLeft;
        o.g25 = 0; o.g40 = 0; o.g105 = 1;
      }
      if (this.time >= o.until) { // 0.32: 40 s on station, off the map to refuel, back to the same spot, repeat
        o.away = !o.away;
        o.until = this.time + (o.away ? C.GUNSHIP_REFUEL_S : C.GUNSHIP_S);
        o.g25 = 0; o.g40 = 0; o.g105 = 1;
      }
      if (o.away) continue;
      o.angle -= dt * 0.5; // a left-hand orbit: the guns point out the left side, at the middle
      const [gx, gy] = this.orbitEntry(o);
      // 0.46: the AC-130U's three guns, each on its own cooldown, each picking the targets it suits.
      // 25 mm GAU-12 Gatling: stragglers (1-2 together), else whatever it finds.
      o.g25 -= dt;
      while (o.g25 <= 0) {
        o.g25 += 1 / C.G25_RATE;
        const t = this.gunTarget(o, 25, 1);
        if (t < 0) continue; // like the old 30 mm: each round looks once, and a miss is a round spent
        o.shots25++;
        if (this.shots.length < 4000) this.shots.push({ x0: gx, y0: gy, x1: this.ax[t], y1: this.ay[t], t: this.time - 0.2, land: this.time, cls: SHOT_SMALL, kind: "ac130" });
        this.hp[t] -= C.G25_DMG;
        if (this.hp[t] <= 0) { this.state[t] = DEAD; this.recordKill(t); }
      }
      // 40 mm L/60 Bofors: small groups (3-9), or packs when there are none; a small splash, infected only.
      o.g40 -= dt;
      if (o.g40 <= 0) {
        o.g40 = 1 / C.G40_RATE;
        const t = this.gunTarget(o, 40, 1);
        if (t >= 0) {
          const sx = this.ax[t], sy = this.ay[t];
          o.shots40++;
          if (this.shots.length < 4000) this.shots.push({ x0: gx, y0: gy, x1: sx, y1: sy, t: this.time - 0.25, land: this.time, cls: SHOT_CANNON, kind: "ac130" });
          this.areaDamage(sx, sy, C.G40_SPLASH, C.G40_DMG, false);
          this.blasts.push({ x: sx, y: sy, r: C.G40_SPLASH, t: this.time, color: "#ffcc80" });
        }
      }
      // 105 mm M102 howitzer: the densest pack in the orbit with at least G105_MIN inside its splash.
      o.g105 -= dt;
      if (o.g105 <= 0) {
        o.g105 = C.GUNSHIP_HOW_EVERY;
        let best = -1, bn = C.G105_MIN - 1;
        const rr = rng((this.tick * 1103515245) >>> 0);
        for (let s = 0; s < 24; s++) {
          const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.GUNSHIP_RADIUS, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
          const n = this.countInf(x, y, C.GUNSHIP_HOW_SPLASH, 40);
          if (n > bn) { const k = this.nearest(x, y, C.GUNSHIP_HOW_SPLASH, INF, 255, 40); if (k >= 0) { bn = n; best = k; } }
        }
        if (best >= 0 && this.clearOfZone(this.ax[best], this.ay[best], C.GUNSHIP_HOW_SPLASH) && !this.strikeBlocked(this.ax[best], this.ay[best], C.GUNSHIP_HOW_SPLASH)) {
          const sx = this.ax[best], sy = this.ay[best];
          o.shots105++;
          if (this.shots.length < 4000) this.shots.push({ x0: gx, y0: gy, x1: sx, y1: sy, t: this.time - 0.35, land: this.time, cls: SHOT_SHELL, kind: "ac130" });
          this.areaDamage(sx, sy, C.GUNSHIP_HOW_SPLASH, C.GUNSHIP_HOW_DMG, false);
          this.damageTerrain(sx, sy, C.GUNSHIP_HOW_SPLASH * 0.7, 60);
          this.blasts.push({ x: sx, y: sy, r: C.GUNSHIP_HOW_SPLASH, t: this.time, color: "#ce93d8" });
        } else if (best < 0) o.g105 = 0.5; // no pack yet: look again soon
      }
    }
    if (gone) this.orbits = this.orbits.filter(o => !gone!.includes(o)); // flown off the map for good
  }

  /** Walls and gates within r take dmg (a breach once they drop to 0). */
  private hurtWalls(x: number, y: number, r: number, dmg: number) {
    const x0 = Math.max(0, (x - r) | 0), x1 = Math.min(this.w - 1, Math.ceil(x + r)), y0 = Math.max(0, (y - r) | 0), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    let broke = false;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const i = this.idx(cx, cy), z = this.inZone[i];
      if ((z !== 2 && z !== 3) || this.wallHp[i] <= 0 || hyp(cx - x, cy - y) > r) continue;
      this.wallHp[i] = Math.max(0, this.wallHp[i] - dmg);
      if (this.wallHp[i] <= 0) { if (!broke) this.ping("breach", cx, cy); broke = true; }
    }
    if (broke) { this.breaches++; this.fieldDirty = true; St.event(this.stats, St.SE_BREACH, this.time, x, y); }
  }

  /** Fallout: infected inside burn down; people inside sicken and die. */
  private irradiate(f: Fallout, dt: number) {
    this.areaDamage(f.x, f.y, f.r, C.FALLOUT_DPS * dt, false);
    const r2 = f.r * f.r, rr = rng((this.tick * 3266489917) >>> 0);
    const b0x = Math.max(0, ((f.x - f.r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((f.x + f.r) / BUCKET) | 0);
    const b0y = Math.max(0, ((f.y - f.r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((f.y + f.r) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        const s = this.state[k];
        if (s !== CIV && s !== SAFE_CIV) continue;
        const dx = this.ax[k] - f.x, dy = this.ay[k] - f.y;
        if (dx * dx + dy * dy <= r2 && rr() < C.FALLOUT_CIV_P) { this.state[k] = DEAD; this.civKilledByUs++; this.note(k, EV_KILLED_BY_US); }
      }
  }

  /** Strike order: send a mobile unit to clear and hold a spot (land units on streets, boats on the river). */
  /** Why unit u can't be sent to cell (x, y), or null. */
  orderTargetError(u: Unit, x: number, y: number): string | null {
    const mob = C.UNITS[u.kind].mobile;
    if (!mob) return "Only mobile units take orders (APCs, squads, paratroopers, boats).";
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    const t = this.map.tile[this.idx(x, y)];
    if (mob.nav !== "air" && (mob.nav === "water" ? t !== WATER : !walkable(t))) return mob.nav === "water" ? "Boats go on the river." : "Send it to a street or park.";
    return null;
  }

  /** 0.45: can the player give this unit orders? (mobile, not an APC's own squad, not being pulled out) */
  /** 0.50: which safe zone (index into zones) the cell is inside, -1 for none. */
  zoneAt(x: number, y: number): number {
    const px = x + 0.5, py = y + 0.5;
    for (let z = 0; z < this.zones.length; z++) {
      const poly = this.zones[z]; let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return z;
    }
    return -1;
  }
  /** 0.50: buy Troops or a Sniper team at a safe zone mid-battle: a ground squad on the zone's street nearest its middle. */
  placeFromZone(kind: "garrison" | "sniper", zone: number): string | null {
    if (this.phase !== "battle") return kind === "garrison" ? "Buy Troops at a zone during the battle; in planning place them directly." : "Buy Snipers at a zone during the battle; in planning place them directly.";
    const poly = this.zones[zone];
    if (!poly) return "No such zone.";
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const cells: [number, number, number][] = [];
    for (let i = 0; i < this.inZone.length; i++) {
      if (this.inZone[i] !== 1 || !walkable(this.map.tile[i])) continue;
      const x = i % this.w, y = (i / this.w) | 0;
      if (this.zoneAt(x, y) !== zone) continue;
      cells.push([(x - cx) ** 2 + (y - cy) ** 2, x, y]);
    }
    cells.sort((a, b) => a[0] - b[0]);
    let err: string | null = "No room in that zone.";
    for (const [, x, y] of cells.slice(0, 400)) { err = this.place(kind, x, y); if (!err || err === "Not enough budget.") return err; }
    return err;
  }
  /** 0.50 review I6: the Troops/Sniper build tool in battle: the squad deploys from the zone under the cursor (or the
   *  nearest zone) and, if a roof was clicked, sets off to fortify it. */
  placeTroopsAt(kind: "garrison" | "sniper", x: number, y: number): string | null {
    let z = this.zoneAt(x, y);
    if (z < 0) { let bd = Infinity; this.zones.forEach((p, i) => { const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cy = p.reduce((a, q) => a + q[1], 0) / p.length, d = (cx - x) ** 2 + (cy - y) ** 2; if (d < bd) { bd = d; z = i; } }); }
    if (z < 0) return "Draw a safe zone first.";
    const e = this.placeFromZone(kind, z);
    if (e) return e;
    if (this.map.tile[this.idx(x, y)] === BUILDING) this.issue(this.units[this.units.length - 1], { k: "fortify", x, y }, false); // a taken roof: it just waits in the zone
    return null;
  }
  /** 0.50: up on a roof as a fortified squad (or an old fixed rooftop unit): can't be bitten, doesn't walk. */
  isFortified(u: Unit): boolean { const spec = C.UNITS[u.kind]; return u.fort === "up" || (!spec.mobile && spec.on === "building"); }
  canOrder(u: Unit): boolean { return !!C.UNITS[u.kind].mobile && !u.parentUnit && u.extractT === undefined; }

  /** 0.45: give unit u an order; queue = add it after the ones it has (Shift). Error message, or null. */
  issue(u: Unit, o: Order, queue: boolean): string | null {
    if (!this.canOrder(u)) return "This unit can't take orders.";
    let q: Order = { ...o, x: Math.floor(o.x), y: Math.floor(o.y) };
    if (o.k === "escort") {
      const k = o.who ?? -1;
      if (k < 0 || k >= this.civN || (this.state[k] !== CIV && this.state[k] !== SAFE_CIV)) return "Click a living person to escort.";
      q = { k: "escort", x: Math.floor(this.ax[k]), y: Math.floor(this.ay[k]), who: k };
    } else if (o.k === "fortify") { // 0.50: walk to the street beside that building, then climb
      if (u.kind !== "garrison" && u.kind !== "sniper") return "Only Troops and Snipers fortify.";
      const rx = q.x, ry = q.y;
      if (rx < 0 || ry < 0 || rx >= this.w || ry >= this.h || this.map.tile[this.idx(rx, ry)] !== BUILDING || this.buildingId[this.idx(rx, ry)] < 0) return "Click a roof to fortify.";
      if (this.buildingTaken(u.kind, rx, ry, u)) return u.kind === "garrison" ? "One Troops squad per building." : "One Sniper team per building.";
      const side = this.inZone[this.idx(Math.floor(u.x), Math.floor(u.y))] === 1; // climb from the squad's side of the wall
      const base = (side && this.buildingBase(rx, ry, u.x, u.y, true)) || this.buildingBase(rx, ry, u.x, u.y);
      if (!base) return "No way up there.";
      if (this.phase === "plan") { // planning: no walking or climbing, it just goes up there
        if (u.fort === "up" || u.fort === "climb" || u.fort === "descend") u.fort = undefined;
        u.fort = "climb"; u.fortT = 0; u.fortAt = [rx, ry]; this.stepFort(u, 0); this.stats.c.fortifies++; return null;
      }
      q = { k: "fortify", x: base[0], y: base[1], px: rx, py: ry };
      if (u.fort === "up") { const e = this.dismount(u, base[0], base[1]); if (e) return e; } // already on another roof: come down first
    } else {
      const e = this.orderTargetError(u, q.x, q.y);
      if (e) return e;
    }
    if (u.fort === "climb" && q.k !== "fortify") { u.fort = undefined; u.fortT = undefined; u.fortAt = undefined; } // 0.50: a new order stops the climb
    else if (u.fort === "up" && q.k !== "fortify") { const e = this.dismount(u, q.x, q.y); if (e) return e; } // 0.50: come down, then go
    const list = queue ? (u.orders ?? []) : [];
    if (q.k === "patrol") {
      const last = list[list.length - 1];
      if (last && last.k !== "escort") { q.px = last.x; q.py = last.y; } else { q.px = u.x; q.py = u.y; }
    }
    u.orders = [...list, q]; u.cmd = true; u.standby = false; u.recallOrders = undefined; // a new order takes it off the recall
    return null;
  }

  /** 0.45: one order for several units. The first gets the clicked cell, the rest the nearest free cells around it
   *  they can go to (same order, so the group doesn't pile onto one spot). Error only if nobody could take it. */
  issueGroup(us: Unit[], o: Order, queue: boolean): string | null {
    const taken = new Set<number>();
    let err: string | null = null, ok = 0;
    for (const u of us) {
      if (o.k === "escort") { const e = this.issue(u, o, queue); if (e) err ??= e; else ok++; continue; }
      let placed = false;
      for (const [dx, dy] of SPREAD) {
        const x = Math.floor(o.x) + dx, y = Math.floor(o.y) + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h || taken.has(this.idx(x, y)) || this.orderTargetError(u, x, y)) continue;
        const e = this.issue(u, { ...o, x, y }, queue);
        if (e) { err ??= e; break; }
        taken.add(this.idx(x, y)); placed = true; ok++; break;
      }
      if (!placed && !err) err = this.orderTargetError(u, Math.floor(o.x), Math.floor(o.y)) ?? "No room there.";
    }
    return ok ? null : err;
  }

  /** 0.45: S: drop its orders and hold right here, shooting what comes in range. */
  stopUnit(u: Unit) { u.orders = []; u.cmd = true; u.standby = false; u.holdAt = [u.x, u.y]; u.recallOrders = undefined; }

  /** 0.45: D: stay put and hold fire. */
  standBy(u: Unit) { u.orders = []; u.cmd = true; u.standby = true; u.holdAt = [u.x, u.y]; u.recallOrders = undefined; }

  orderUnit(u: Unit, x: number, y: number): string | null {
    const err = this.orderTargetError(u, x, y);
    if (err) return err;
    u.post = [x, y]; u.goal = undefined; u.thinkT = 0; u.recallFrom = undefined;
    if (u.ai !== "reload") u.ai = "hunt";
    return null;
  }

  /** 0.24: every mobile unit (not boats) goes to the nearest safe zone and holds there; called again,
   *  they all go back to their posts. A strike order on a unit takes it off the recall. Returns how many moved. */
  recalled = false;
  recallAll(): number {
    let n = 0;
    if (this.recalled) {
      for (const u of this.units) if (u.recallFrom) { u.post = u.recallFrom; u.recallFrom = undefined; u.goal = undefined; u.thinkT = 0; n++; }
      for (const u of this.units) if (u.recallOrders) { // 0.45: commanded units get their exact orders back
        u.orders = u.recallOrders.orders; u.holdAt = u.recallOrders.holdAt; u.standby = u.recallOrders.standby;
        u.recallOrders = undefined; u.goal = undefined; u.thinkT = 0; n++;
      }
      this.recalled = false;
      return n;
    }
    const cells: number[] = [];
    for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i] === 1 && walkable(this.map.tile[i])) cells.push(i);
    if (!cells.length) return 0;
    for (const u of this.units) {
      const mob = C.UNITS[u.kind].mobile;
      if (!mob || mob.nav === "water" || !u.post || u.extractT !== undefined || u.fort) continue; // 0.50: fortified squads stay up
      let best = -1, bd = Infinity;
      for (const i of cells) { const dx = (i % this.w) - u.x, dy = ((i / this.w) | 0) - u.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      if (u.cmd || u.kind === "garrison" || u.kind === "sniper") { // 0.45: keep its orders for Send back; hold in the zone meanwhile (0.50: Troops/Snipers only move on orders)
        u.recallOrders = { orders: u.orders ?? [], holdAt: u.holdAt, standby: u.standby };
        u.orders = []; u.holdAt = [best % this.w, (best / this.w) | 0]; u.standby = false; u.goal = undefined; u.thinkT = 0; u.cmd = true;
        if (u.ai !== "reload" && u.ai !== "leave") u.ai = "hunt";
        n++; continue;
      }
      u.recallFrom = u.post;
      u.post = [best % this.w, (best / this.w) | 0]; u.goal = undefined; u.thinkT = 0;
      if (u.ai !== "reload" && u.ai !== "leave") u.ai = "hunt";
      n++;
    }
    this.recalled = n > 0;
    return n;
  }

  /** The mobile unit nearest (x, y) within r, or null. */
  mobileAt(x: number, y: number, r = 3): Unit | null {
    let best: Unit | null = null, bd = r * r;
    for (const u of this.units) {
      if (!C.UNITS[u.kind].mobile || u.extractT !== undefined || (u.deployT && u.deployT > 0)) continue;
      const d = (u.x + 0.5 - x) ** 2 + (u.y + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Apply immediate resupply, mobile healing, wall repair, and persistent field supply crates at (x, y). */
  private applySupplyDrop(x: number, y: number) {
    const R = C.SUPPLY_DROP_RADIUS, R2 = R * R;
    const shortage = this.mutators.has("supply_shortage");
    for (const u of this.units) {
      const dx = u.x + 0.5 - x, dy = u.y + 0.5 - y;
      if (dx * dx + dy * dy > R2) continue;
      const spec = C.UNITS[u.kind];
      if (u.ammo !== Infinity) {
        const cap = spec.ammo;
        u.ammo = Math.max(u.ammo, cap);
      }
      if (C.maxHp(spec) !== undefined && u.hp !== undefined && u.hp > 0) {
        u.hp = C.maxHp(spec)!;
        if (u.ai === "home" || u.ai === "reload") { u.ai = "hunt"; u.thinkT = 0; }
      }
    }
    const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(this.w - 1, Math.ceil(x + R));
    const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(this.h - 1, Math.ceil(y + R));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if ((cx - x) * (cx - x) + (cy - y) * (cy - y) > R2) continue;
        const ci = cy * this.w + cx, z = this.inZone[ci];
        if ((z === 2 || z === 3) && this.wallHp[ci] > 0) {
          const maxHp = z === 3 ? this.gateMaxHp() : this.wallMaxHp();
          this.wallHp[ci] = Math.min(maxHp, this.wallHp[ci] + C.SUPPLY_DROP_WALL_HP);
        }
      }
    }
    this.supplyCrates.push({ x, y, until: this.time + C.SUPPLY_CRATE_S });
    this.blasts.push({ x, y, r: 5, t: this.time, color: "#4fc3f7" });
  }

  private stepTransports(dt: number) {
    if (this.transports.length) {
      for (let i = this.transports.length - 1; i >= 0; i--) {
        const tr = this.transports[i];
        tr.t += dt;
        if (tr.t >= tr.dur) { this.transports.splice(i, 1); continue; }
        if (tr.hoverS > 0) {
          const leg = (tr.dur - tr.hoverS) / 2;
          if (tr.t < leg) {
            const k = tr.t / Math.max(0.01, leg);
            const ease = 1 - Math.pow(1 - k, 2);
            tr.x = tr.sx + (tr.tx - tr.sx) * ease;
            tr.y = tr.sy + (tr.ty - tr.sy) * ease;
            tr.angle = Math.atan2(tr.ty - tr.sy, tr.tx - tr.sx);
          } else if (tr.t < leg + tr.hoverS) {
            tr.x = tr.tx + Math.sin(tr.t * 4) * 0.35;
            tr.y = tr.ty + Math.cos(tr.t * 3) * 0.35;
          } else {
            const k = (tr.t - leg - tr.hoverS) / Math.max(0.01, leg);
            const ease = k * k;
            tr.x = tr.tx + (tr.ex - tr.tx) * ease;
            tr.y = tr.ty + (tr.ey - tr.ty) * ease;
            tr.angle = Math.atan2(tr.ey - tr.ty, tr.ex - tr.tx);
          }
        } else {
          const k = tr.t / tr.dur;
          tr.x = tr.sx + (tr.ex - tr.sx) * k;
          tr.y = tr.sy + (tr.ey - tr.sy) * k;
        }
      }
    }
    if (this.chutes.length) {
      for (let i = this.chutes.length - 1; i >= 0; i--) {
        const ch = this.chutes[i];
        ch.z -= ch.vz * dt;
        ch.x += ch.driftX * dt;
        ch.y += ch.driftY * dt;
        if (ch.z <= 0) this.chutes.splice(i, 1);
      }
    }
    if (this.supplyCrates.length) {
      this.supplyCrates = this.supplyCrates.filter(c => c.until > this.time);
      if (this.tick % 4 === 0 && this.supplyCrates.length) {
        const dt4 = dt * 4, R = C.SUPPLY_CRATE_RADIUS, R2 = R * R;
        const shortage = this.mutators.has("supply_shortage");
        for (const c of this.supplyCrates) {
          for (const u of this.units) {
            if (u.extractT !== undefined || (u.deployT && u.deployT > 0)) continue;
            const dx = u.x + 0.5 - c.x, dy = u.y + 0.5 - c.y;
            if (dx * dx + dy * dy > R2) continue;
            const spec = C.UNITS[u.kind];
            if (u.ammo !== Infinity) {
              const cap = spec.ammo;
              if (u.ammo < cap) u.ammo = Math.min(cap, u.ammo + spec.ammo * 0.12 * dt4);
            }
            if (spec.mobile && spec.mobile.hp !== Infinity && u.hp !== undefined && u.hp > 0 && u.hp < spec.mobile.hp) {
              u.hp = Math.min(spec.mobile.hp, u.hp + 20 * dt4);
            }
          }
        }
      }
    }
    // Mass Transit Evacuation Trains along rail / light-rail / subway corridors
    if (this.railLines.length > 0 && this.time >= this.nextTrainT) {
      this.nextTrainT += C.TRAIN_EVERY_S;
      const line = this.railLines[Math.floor(this.time / C.TRAIN_EVERY_S) % this.railLines.length];
      // Check that no rail bridge along this corridor has been blown into water
      const intact = line.every(([px, py]) => this.map.tile[this.idx(px | 0, py | 0)] !== WATER);
      if (intact && line.length >= 2) {
        const rev = (Math.floor(this.time / C.TRAIN_EVERY_S) & 1) === 1;
        const pts = rev ? [...line].reverse() : line;
        const [x0, y0] = pts[0], [x1, y1] = pts[1];
        this.trains.push({ pts, pos: 0, x: x0, y: y0, angle: Math.atan2(y1 - y0, x1 - x0), boarded: 0 });
      }
    }
    if (this.trains.length) {
      for (let i = this.trains.length - 1; i >= 0; i--) {
        const tr = this.trains[i];
        tr.pos += (C.TRAIN_SPEED * dt) / 3.2;
        const idx = Math.floor(tr.pos);
        if (idx >= tr.pts.length - 1) {
          this.trains.splice(i, 1);
          continue;
        }
        const frac = tr.pos - idx;
        const [x0, y0] = tr.pts[idx], [x1, y1] = tr.pts[idx + 1];
        tr.x = x0 + (x1 - x0) * frac;
        tr.y = y0 + (y1 - y0) * frac;
        tr.angle = Math.atan2(y1 - y0, x1 - x0);
        if (this.map.tile[this.idx(tr.x | 0, tr.y | 0)] === WATER) {
          this.trains.splice(i, 1);
          continue;
        }
        // Crush infected standing directly on the tracks
        const cr = 1.9, cr2 = cr * cr;
        const b0x = Math.max(0, ((tr.x - cr) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((tr.x + cr) / BUCKET) | 0);
        const b0y = Math.max(0, ((tr.y - cr) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((tr.y + cr) / BUCKET) | 0);
        for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
          for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
            if (this.state[k] !== INF) continue;
            const dx = this.ax[k] - tr.x, dy = this.ay[k] - tr.y;
            if (dx * dx + dy * dy <= cr2) {
              this.hp[k] -= C.TRAIN_CRUSH_DMG;
              if (this.hp[k] <= 0) { this.state[k] = DEAD; this.recordKill(k, undefined, "train"); }
            }
          }
        }
        // Board fleeing civilians near stations or along the transit corridor
        const cap = Math.round(C.TRAIN_CAPACITY * this.popMul);
        if (tr.boarded < cap && this.tick % 2 === 0) {
          const br = C.TRAIN_BOARD_RADIUS, br2 = br * br;
          const c0x = Math.max(0, ((tr.x - br) / BUCKET) | 0), c1x = Math.min(this.bw - 1, ((tr.x + br) / BUCKET) | 0);
          const c0y = Math.max(0, ((tr.y - br) / BUCKET) | 0), c1y = Math.min(this.bh - 1, ((tr.y + br) / BUCKET) | 0);
          for (let by = c0y; by <= c1y && tr.boarded < cap; by++) {
            for (let bx = c0x; bx <= c1x && tr.boarded < cap; bx++) {
              for (let k = this.headC[by * this.bw + bx]; k !== -1 && tr.boarded < cap; k = this.next[k]) {
                if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
                const dx = this.ax[k] - tr.x, dy = this.ay[k] - tr.y;
                if (dx * dx + dy * dy <= br2 && this.trainBoard(k)) {
                  tr.boarded++;
                  this.trainsEvacuated++;
                  this.evacuated++;
                  if (this.dev.income) this.evacPay += C.TRAIN_BONUS_PER_CIV * this.incomeMul / this.popMul;
                }
              }
            }
          }
        }
      }
    }
  }

  /** A unit or building counts as inside when its cell or a neighbor is inside the zone (buildings sit beside walls). */
  unitInZone(u: { x: number; y: number }) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(u.x + 0.5) + dx, y = Math.floor(u.y + 0.5) + dy;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      if (this.inZone[this.idx(x, y)] === 1) return true;
    }
    return false;
  }

  /** 0.60: no endless ammo in a zone any more: in planning every unit simply starts with a full magazine. */
  private refreshUnitAmmo() {
    if (this.phase === "plan") for (const u of this.units) u.ammo = C.UNITS[u.kind].ammo;
  }
  /** 0.60: a new zone's supply (free starting stock, auto-restock by difficulty). */
  private newZoneSupply(z: number): Sup.ZoneSupply {
    const st = Sup.startingStock(this.difficulty, this.mutators.has("supply_shortage"));
    const zs: Sup.ZoneSupply = { small: st.small, vehicle: st.vehicle, auto: Sup.autoDefault(this.difficulty), prio: "ammo", bought: 0, spent: 0, crew: [], log: [], logV: [], orders: [], store: [0, 0], engineersBought: 0, planCrates: { small: 0, vehicle: 0 } };
    this.supply[z] = zs; zs.store = this.storeOf(z);
    for (let i = 0; i < C.ENGINEERS_FREE; i++) zs.crew.push(newEngineer(this, z, i));
    return zs;
  }
  engineersOf(z: number): Sup.Engineer[] { return this.supply[z]?.crew ?? []; }
  /** 0.60: hire an engineer for zone z (in planning on site now; in battle walks in from the store point). */
  buyEngineer(z: number): string | null {
    const zs = this.supply[z]; if (!zs) return "No such safe zone.";
    if (this.phase === "over") return "The battle is over.";
    if (zs.crew.filter(e => e.alive).length >= C.ENGINEERS_MAX) return `A safe zone holds at most ${C.ENGINEERS_MAX} engineers.`;
    const price = Sup.engineerPrice(zs.engineersBought, this.difficulty);
    if (this.remaining() < price) return "Not enough money.";
    if (this.phase === "plan") zs.bought += price; else { this.pay(price); zs.spent += price; }
    zs.engineersBought++;
    zs.crew.push(newEngineer(this, z, zs.crew.length));
    return null;
  }
  private wallCellsCache: { v: number; n: number; cells: number[][] } | null = null;
  /** 0.60: wall and gate cells of zone z (each crossing belongs to the zone of an inside cell next to it). */
  zoneWallCells(z: number): number[] {
    const c = this.wallCellsCache;
    if (c && c.v === this.navVersion && c.n === this.zones.length) return c.cells[z] ?? [];
    const cells: number[][] = this.zones.map(() => []);
    for (let i = 0; i < this.inZone.length; i++) {
      if (this.inZone[i] !== 2 && this.inZone[i] !== 3) continue;
      const x = i % this.w, y = (i / this.w) | 0;
      let zz = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        if (this.inZone[this.idx(nx, ny)] === 1) { zz = this.zoneAt(nx, ny); if (zz >= 0) break; }
      }
      if (zz < 0) zz = this.zoneAt(x, y);
      if (zz >= 0 && cells[zz]) cells[zz].push(i);
    }
    this.wallCellsCache = { v: this.navVersion, n: this.zones.length, cells };
    return cells[z] ?? [];
  }
  /** 0.60: the zone's store point: its Supply Depot, else its first Evac Point, else the zone cell nearest its middle. */
  storeOf(z: number): [number, number] {
    const inZ = (b: { x: number; y: number }) => this.zoneAt(b.x, b.y) === z;
    const live = this.supports.filter(b => b.extractT === undefined && inZ(b));
    const depot = live.find(b => b.kind === "supply"), evac = live.find(b => b.kind === "evac");
    const poly = this.zones[z] ?? [];
    let cx = 0, cy = 0; for (const [x, y] of poly) { cx += x; cy += y; } cx /= Math.max(1, poly.length); cy /= Math.max(1, poly.length);
    let center: [number, number] = [Math.floor(cx), Math.floor(cy)], bd = Infinity;
    const r = 40, x0 = Math.max(0, (cx | 0) - r), x1 = Math.min(this.w - 1, (cx | 0) + r), y0 = Math.max(0, (cy | 0) - r), y1 = Math.min(this.h - 1, (cy | 0) + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, y);
      if (this.inZone[i] !== 1 || !walkable(this.map.tile[i]) || this.zoneAt(x, y) !== z) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (d < bd) { bd = d; center = [x, y]; }
    }
    return Sup.storePoint({ depot: depot ? [depot.x, depot.y] : null, evac: evac ? [evac.x, evac.y] : null, center });
  }
  private gateMasks: { v: number; near: Uint8Array; approach: Uint8Array } | null = null;
  /** 0.60 review 7: per navigation version, two masks: cells within SUPPLY_WAIT_GATE_D of a gate, and gate approaches
   *  (the street straight out from a gate cell, 12 cells out and one either side). One pass over the gates. */
  private gateMasksNow() {
    const m = this.gateMasks;
    if (m && m.v === this.navVersion && m.near.length === this.inZone.length) return m;
    const near = new Uint8Array(this.inZone.length), approach = new Uint8Array(this.inZone.length), D = C.SUPPLY_WAIT_GATE_D - 1;
    for (let i = 0; i < this.inZone.length; i++) {
      if (this.inZone[i] !== 3) continue;
      const gx = i % this.w, gy = (i / this.w) | 0;
      for (let y = Math.max(0, gy - D); y <= Math.min(this.h - 1, gy + D); y++) for (let x = Math.max(0, gx - D); x <= Math.min(this.w - 1, gx + D); x++) near[this.idx(x, y)] = 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ox = gx + dx, oy = gy + dy; if (ox < 0 || oy < 0 || ox >= this.w || oy >= this.h || this.inZone[this.idx(ox, oy)] !== 0) continue; // outward neighbors only
        for (let k = 1; k <= 12; k++) for (let l = -1; l <= 1; l++) {
          const px = gx + dx * k + (dy ? l : 0), py = gy + dy * k + (dx ? l : 0);
          if (px >= 0 && py >= 0 && px < this.w && py < this.h) approach[this.idx(px, py)] = 1;
        }
      }
    }
    return (this.gateMasks = { v: this.navVersion, near, approach });
  }
  /** 0.60: is (x, y) on the way into a gate (see gateMasksNow). */
  onGateApproach(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.gateMasksNow().approach[this.idx(x, y)] === 1; }
  /** 0.60: where a low unit outside waits for an engineer: an outside street cell next to one of its zone's walls, at
   *  least SUPPLY_WAIT_GATE_D from every gate and off every gate approach, not taken by another waiting unit; nearest
   *  first. null = none (it waits where it is). */
  supplyWaitSpot(u: Unit): [number, number] | null {
    const z = this.zoneOfUnit(u); if (z < 0) return null;
    const gm = this.gateMasksNow();
    const taken = this.units.filter(v => v !== u && v.waitAt).map(v => v.waitAt!);
    let best: [number, number] | null = null, bd = Infinity;
    for (const w of this.zoneWallCells(z)) {
      if (this.inZone[w] !== 2) continue;
      const wx = w % this.w, wy = (w / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = wx + dx, y = wy + dy; if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = this.idx(x, y);
        if (this.inZone[i] !== 0 || !walkable(this.map.tile[i])) continue;
        const d = (x - u.x) * (x - u.x) + (y - u.y) * (y - u.y); if (d >= bd) continue;
        if (gm.near[i]) continue;
        if (taken.some(t => Math.abs(t[0] - x) <= 1 && Math.abs(t[1] - y) <= 1)) continue;
        if (gm.approach[i]) continue;
        bd = d; best = [x, y];
      }
    }
    if (best) return best;
    // no usable wall (a zone of open gates): park inside the zone, clear of every gate and its approach
    const poly = this.zones[z]; let bx0 = this.w, by0 = this.h, bx1 = 0, by1 = 0;
    for (const [px, py] of poly) { bx0 = Math.min(bx0, px | 0); by0 = Math.min(by0, py | 0); bx1 = Math.max(bx1, Math.ceil(px)); by1 = Math.max(by1, Math.ceil(py)); }
    for (let y = Math.max(0, by0); y <= Math.min(this.h - 1, by1); y++) for (let x = Math.max(0, bx0); x <= Math.min(this.w - 1, bx1); x++) {
      const i = this.idx(x, y);
      if (this.inZone[i] !== 1 || !walkable(this.map.tile[i])) continue;
      if (this.zoneAt(x, y) !== z) continue;
      const d = (x - u.x) * (x - u.x) + (y - u.y) * (y - u.y); if (d >= bd) continue;
      if (gm.near[i]) continue;
      if (taken.some(t => Math.abs(t[0] - x) <= 1 && Math.abs(t[1] - y) <= 1)) continue;
      bd = d; best = [x, y];
    }
    return best;
  }
  /** 0.60 lab: Repair Yards work at REPAIR_YARD_MUL on Hard and Insane (the corner-Yard play, queue item E); Easy and
   *  Medium keep the full rate (half cost Medium ~4 points in the lab). */
  yardMul(): number { return this.difficulty === "hard" || this.difficulty === "insane" ? C.REPAIR_YARD_MUL : 1; }
  /** 0.60 review: can this unit's zone fill it (stock of its class, or a Chinook on the way)? */
  supplyCanFill(u: Unit): boolean {
    const zs = this.supply[this.zoneOfUnit(u)], cls = Sup.ammoClass(u.kind);
    return !!zs && (cls === "small" || cls === "vehicle") && (zs[cls] > 0 || zs.orders.some(o => o.cls === cls && o.unit === undefined));
  }
  /** 0.60 review: is a trip to the wall worth it: a live engineer, and either something to fill it with or repairs to do. */
  supplyHelps(u: Unit): boolean {
    const zs = this.supply[this.zoneOfUnit(u)]; if (!zs || !zs.crew.some(e => e.alive)) return false;
    const mob = C.UNITS[u.kind].mobile, hurt = !!mob && mob.hp !== Infinity && (u.hp ?? mob.hp) < mob.hp;
    return hurt || this.supplyCanFill(u);
  }
  /** 0.60: a crossing cell that is swinging open or shut right now. */
  isSwitching(i: number): boolean { return this.switching.some(sw => sw.cells.includes(i)); }
  /** 0.60: buy crates for a zone: in planning they are on site now; in battle a Chinook brings them. */
  buySupply(z: number, cls: "small" | "vehicle", crates: number): string | null {
    const zs = this.supply[z]; if (!zs) return "No such safe zone.";
    if (this.phase === "over") return "The battle is over.";
    crates = Math.max(1, Math.floor(crates));
    const price = crates * Sup.cratePrice(cls);
    if (this.remaining() < price) return "Not enough money.";
    if (this.phase === "plan") { zs[cls] += crates * Sup.crateRounds(cls); zs.bought += price; zs.planCrates[cls] += crates; return null; }
    this.pay(price); zs.spent += price;
    this.orderSupply(zs, { cls, crates, at: 0, auto: false, waveOffs: 0 });
    return null;
  }
  /** 0.60: buy magazines for a battery's reserve: in planning on site now; in battle a sling load to the gun. */
  buyReserve(u: Unit, mags: number): string | null {
    const cls = Sup.ammoClass(u.kind);
    if (cls !== "shells" && cls !== "rockets") return "Only Mortars, Howitzers and HIMARS hold a reserve.";
    if (this.phase === "over") return "The battle is over.";
    mags = Math.max(1, Math.floor(mags));
    const price = mags * Sup.cratePrice(cls), mag = C.UNITS[u.kind].ammo;
    if (this.remaining() < price) return "Not enough money.";
    if (this.phase === "plan") { u.reserve = (u.reserve ?? 0) + mags * mag; u.resPaid = (u.resPaid ?? 0) + price; u.resMags = (u.resMags ?? 0) + mags; return null; }
    this.pay(price);
    const z = this.zoneOfUnit(u); if (this.supply[z]) this.supply[z].spent += price;
    const zs = this.supply[z] ?? this.supply[0];
    if (!zs) { u.reserve = (u.reserve ?? 0) + mags * mag; return null; } // no zone at all: nothing to fly to (cannot happen in a battle)
    this.orderSupply(zs, { cls, crates: mags, at: 0, auto: false, unit: St.unitIndex(this.stats, u, this.time), waveOffs: 0 });
    return null;
  }
  /** 0.60: what planning bought, for the saved plan (reserves by index into `planned`, the plan's unit list). */
  exportSupplyPlan(planned: Unit[]): { supply: Sup.PlanSupply[]; reserves: [number, number][] } {
    const supply = this.supply.map(zs => ({ small: zs.planCrates.small, vehicle: zs.planCrates.vehicle, auto: zs.auto, prio: zs.prio, engineers: zs.engineersBought }));
    const reserves: [number, number][] = [];
    planned.forEach((u, i) => { const n = u.resMags ?? 0; if (n > 0) reserves.push([i, n]); });
    return { supply, reserves };
  }
  /** 0.60: buy back what a saved plan had (in planning). Units that didn't fit (not in sim.units) are skipped. */
  importSupplyPlan(supply: Sup.PlanSupply[] | undefined, reserves: [number, number][] | undefined, placed: Unit[]) {
    (supply ?? []).forEach((p, z) => {
      if (!this.supply[z]) return;
      if (p.small > 0) this.buySupply(z, "small", p.small);
      if (p.vehicle > 0) this.buySupply(z, "vehicle", p.vehicle);
      for (let i = 0; i < p.engineers; i++) if (this.buyEngineer(z)) break;
      this.setAuto(z, p.auto); this.setPrio(z, p.prio);
    });
    for (const [i, n] of reserves ?? []) { const u = placed[i]; if (u && this.units.includes(u)) this.buyReserve(u, n); }
  }
  /** 0.60 review: a unit's stable id (the recorder's index; array positions shift as units go). */
  sidOf(u: Unit): number { return St.unitIndex(this.stats, u, this.time); }
  unitBySid(sid: number): Unit | undefined { return this.units.find(v => v.sid === sid); }
  setAuto(z: number, on: boolean) { if (this.supply[z]) this.supply[z].auto = on; }
  setPrio(z: number, p: "ammo" | "repair") { if (this.supply[z]) this.supply[z].prio = p; }
  /** Where an order flies to: the battery for a reserve order, else the zone's store point. */
  private orderTarget(zs: Sup.ZoneSupply, o: Sup.SupplyOrder): [number, number] {
    if (o.unit !== undefined) { const u = this.units.find(v => v.sid === o.unit); if (u) return [u.x, u.y]; }
    return zs.store;
  }
  private orderSupply(zs: Sup.ZoneSupply, o: Sup.SupplyOrder) {
    const [tx, ty] = this.orderTarget(zs, o), [ex, ey] = this.nearestEdgePoint(tx, ty);
    const eta = Sup.chinookEta(Math.hypot(tx - ex, ty - ey) - 24, this.mutators.has("supply_shortage"));
    o.at = this.time + eta; zs.orders.push(o);
    this.spawnHelo(o.unit !== undefined ? "helo_uh60" : "helo_ch47", tx + 0.5, ty + 0.5, eta + 3, 2, "#ffb74d", o.unit !== undefined ? "SLING LOAD" : "SUPPLY CHINOOK");
  }
  private supplyT = 0;
  /** 0.60: orders land (or wave off and come around again); auto-restock checks every 2 s. */
  private stepSupply(dt: number) {
    for (const zs of this.supply) {
      for (let i = 0; i < zs.orders.length; i++) {
        const o = zs.orders[i]; if (this.time < o.at) continue;
        const [tx, ty] = this.orderTarget(zs, o);
        if (this.countInf(tx + 0.5, ty + 0.5, C.SUPPORTS.evac.radius, C.EVAC_ABORT_INF, false, true) >= C.EVAC_ABORT_INF) {
          o.waveOffs++; o.at = this.time + C.CHINOOK_RETRY_S;
          St.event(this.stats, St.SE_CHINOOK_ABORT, this.time, tx, ty, o.crates); this.ping("abort", tx, ty);
          this.spawnHelo(o.unit !== undefined ? "helo_uh60" : "helo_ch47", tx + 0.5, ty + 0.5, C.CHINOOK_RETRY_S + 3, 2, "#ffb74d", "SUPPLY: COMING AROUND");
          continue;
        }
        if (o.unit !== undefined) { const u = this.units.find(v => v.sid === o.unit); if (u) u.reserve = (u.reserve ?? 0) + o.crates * C.UNITS[u.kind].ammo; }
        else if (o.cls === "small" || o.cls === "vehicle") zs[o.cls] += o.crates * Sup.crateRounds(o.cls);
        St.event(this.stats, St.SE_CHINOOK, this.time, tx, ty, o.crates);
        zs.orders.splice(i--, 1);
      }
    }
    this.supplyT -= dt; if (this.supplyT > 0) return;
    this.supplyT = 2;
    const st = Sup.startingStock(this.difficulty, this.mutators.has("supply_shortage"));
    this.supply.forEach((zs, z) => {
      if (!zs.auto) { zs.waitingMoney = false; return; }
      let waiting = false;
      for (const cls of Sup.ZONE_CLASSES) {
        if (!Sup.wantsAuto(zs[cls], st[cls], zs.orders.some(o => o.auto && o.cls === cls && o.unit === undefined), true)) continue;
        const price = C.AUTO_CRATES * Sup.cratePrice(cls);
        if (this.remaining() < price) { waiting = true; continue; }
        this.pay(price); zs.spent += price;
        this.orderSupply(zs, { cls, crates: C.AUTO_CRATES, at: 0, auto: true, waveOffs: 0 });
      }
      for (const u of this.units) {
        const cls = Sup.ammoClass(u.kind); if ((cls !== "shells" && cls !== "rockets") || this.zoneOfUnit(u) !== z || u.deployT) continue;
        const full = st.reserve * C.UNITS[u.kind].ammo, sid = St.unitIndex(this.stats, u, this.time);
        if (!Sup.wantsAuto(u.reserve ?? 0, full, zs.orders.some(o => o.unit === sid), true)) continue;
        const price = st.reserve * Sup.cratePrice(cls);
        if (this.remaining() < price) { waiting = true; continue; }
        this.pay(price); zs.spent += price;
        this.orderSupply(zs, { cls, crates: st.reserve, at: 0, auto: true, unit: sid, waveOffs: 0 });
      }
      zs.waitingMoney = waiting;
    });
  }
  /** 0.60: each zone's store point (Depot, else Evac Point, else the middle) and its Depot engineers (+ENGINEERS_DEPOT
   *  while a Depot stands; in planning they go again with the Depot, in battle they stay: they are people). */
  private refreshStores() {
    this.supply.forEach((zs, z) => {
      zs.store = this.storeOf(z);
      const depot = this.supports.some(b => b.kind === "supply" && b.extractT === undefined && this.zoneAt(b.x, b.y) === z);
      if (depot && !zs.depotGiven) {
        for (let i = 0; i < C.ENGINEERS_DEPOT && zs.crew.filter(e => e.alive).length < C.ENGINEERS_MAX; i++) zs.crew.push(newEngineer(this, z, zs.crew.length));
        zs.depotGiven = true;
      } else if (!depot && zs.depotGiven && this.phase === "plan") {
        zs.crew.splice(Math.max(0, zs.crew.length - C.ENGINEERS_DEPOT), C.ENGINEERS_DEPOT); zs.depotGiven = false;
      }
    });
  }
  /** 0.60: the zone a unit draws supply from: the one it stands in, else the nearest (by store point), else -1. */
  zoneOfUnit(u: { x: number; y: number }): number {
    const z = this.zoneAt(u.x, u.y); if (z >= 0) return z;
    let best = -1, bd = Infinity;
    this.supply.forEach((s, i) => { const d = (s.store[0] - u.x) ** 2 + (s.store[1] - u.y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  /** Recompute range, firing rate and supply buffs on every unit from active support buildings. */
  refreshAuras() {
    this.refreshStores(); // 0.60: supports moved: store points and Depot engineers follow
    const roofMul = this.mutators.has("fragile_walls") ? 1.3 : 1;
    for (const u of this.units) {
      const spec = C.UNITS[u.kind];
      const up = spec.on === "building" && (!spec.mobile || u.fort === "up"); // 0.50 review I5: a Troops/Sniper squad on the street is not on a roof
      const lvl = spec.roofBonus && (up || spec.on !== "building") && this.map.tile[this.idx(u.x | 0, u.y | 0)] === BUILDING ? this.map.height[this.idx(u.x | 0, u.y | 0)] : 0; // road cells keep infra codes in height
      u.rangeBoosted = this.hasActiveSupport("radio", u.x, u.y);
      const rm = (u.rangeBoosted ? C.RADIO_RANGE_MUL : 1) * (up ? roofMul : 1);
      u.range = (spec.range + spec.roofBonus * roofLv(lvl)) * rm;
      u.rateMul = this.hasActiveSupport("command", u.x, u.y) ? C.COMMAND_RATE_MUL : 1;
      u.supplied = this.hasActiveSupport("supply", u.x, u.y);
    }
  }

  // ---------- Battle ----------

  /** Outbreak sites depend on the layout, so a restart with a changed plan gets new spawns. */
  layoutHash() {
    let h = this.map.seed | 0;
    const mix = (v: number) => { h = Math.imul(h ^ v, 0x9e3779b1); h ^= h >>> 15; };
    for (const [x, y] of this.zonePoly) { mix(Math.round(x * 10)); mix(Math.round(y * 10)); }
    for (const u of this.units) { mix(u.x); mix(u.y); mix(u.kind.length); }
    for (const b of this.supports) { mix(b.x); mix(b.y); mix(b.kind.length); }
    return h >>> 0;
  }

  startBattle() {
    for (const u of this.units) if (u.cmd) u.planOrders = { orders: (u.orders ?? []).map(o => ({ ...o })), standby: !!u.standby }; // 0.45: for Retry
    for (const u of this.units) u.planPos = [Math.floor(u.x), Math.floor(u.y)]; // 0.50: squads walk now; Retry puts them back here
    if (this.phase !== "plan") return;
    const r = rng(this.layoutHash());
    const wanted = Math.max(1, Math.round(this.sitesN * this.diff.sitesMul));
    // Outbreak sites: walkable cells outside the zone, at least OUTBREAK_MIN_ZONE_DIST cells from it and 60 from each other.
    const sites: [number, number][] = [];
    let guard = 0;
    while (sites.length < wanted && guard++ < 20000) {
      const x = 2 + Math.floor(r() * (this.w - 4)), y = 2 + Math.floor(r() * (this.h - 4));
      const i = this.idx(x, y);
      if (!walkable(this.map.tile[i]) || this.inZone[i]) continue;
      if (this.zoneClosed && this.distToZone(x, y) < C.OUTBREAK_MIN_ZONE_DIST) continue;
      if (sites.some(([sx, sy]) => hyp(sx - x, sy - y) < 60)) continue;
      sites.push([x, y]);
    }
    this.sites = sites; // the first cases: they turn when the warning runs out
    // 0.24: more outbreaks roll in after the first cases, at random times inside the difficulty's window
    const d = this.diff, nSpread = d.spreadMin + Math.floor(r() * (d.spreadMax - d.spreadMin + 1));
    const spread: { x: number; y: number; t: number }[] = [];
    guard = 0;
    while (spread.length < nSpread && guard++ < 20000) {
      const x = 2 + Math.floor(r() * (this.w - 4)), y = 2 + Math.floor(r() * (this.h - 4));
      const i = this.idx(x, y);
      if (!walkable(this.map.tile[i]) || this.inZone[i]) continue;
      if (this.zoneClosed && this.distToZone(x, y) < C.OUTBREAK_MIN_ZONE_DIST) continue;
      if (sites.some(([sx, sy]) => hyp(sx - x, sy - y) < 40) || spread.some(p => hyp(p.x - x, p.y - y) < 40)) continue;
      spread.push({ x, y, t: C.WARNING_S + Math.max(0.5, r() * d.spreadS) });
    }
    this.spreadSites = spread.sort((a, b) => a.t - b.t);
    this.spreadNext = 0;
    // 0.38: hidden carriers, bitten before the warning; they turn at random in the first CARRIER_WINDOW_S
    const nCar = Math.round(this.civN * C.CARRIER_PCT / 100), picked = new Set<number>();
    this.carriers = [];
    for (let g = 0; this.carriers.length < nCar && g < nCar * 20; g++) {
      const k = Math.floor(r() * this.civN);
      if (picked.has(k)) continue;
      picked.add(k);
      this.carriers.push({ k, t: C.WARNING_S + 2 + r() * C.CARRIER_WINDOW_S });
    }
    this.carriers.sort((a, b) => a.t - b.t);
    this.carrierNext = 0;
    this.placeGuards();
    this.findEntries();
    this.planWave(r);
    this.lockedSpend = this.spent();
    this.origFloors = Uint8Array.from(this.map.height);
    this.phase = "battle";
    St.event(this.stats, St.SE_SIRENS, this.time, 0, 0); // 0.57
    for (const u of this.units) St.unitIndex(this.stats, u, this.time);
    this.fieldDirty = true;
    this.rebuildBuckets();
    if (this.dayLife) { this.walkMask = Uint8Array.from(this.map.tile, t => walkable(t) ? 1 : 0); this.navVersion++; this.assignPlans(); }
  }
  sites: [number, number][] = [];

  // ---------- 0.40: alert plans ----------
  /** The phone alert lands: each household decides. Singles, friends out together and households already together go
   *  straight to a zone. Split households meet at home or at the zone (rallyFor); a parent fetches the kids from school. */
  private assignPlans() {
    const N = this.civN, seed = this.seed;
    this.plan.fill(PLAN_STRAIGHT); this.goal.fill(-1); this.planT.fill(0); this.stuckT.fill(0);
    this.solo.fill(0); this.refuser.fill(0); this.resolve.fill(0); this.persuadeT.fill(0); this.refusers = 0; this.talkedOut = 0; this.broke = 0; this.refuserList = [];
    for (let k = 0; k < N; k++) {
      const lead = this.famLead[k];
      if (lead !== k && lead >= 0) continue; // households only, handled from their lead
      const end = lead < 0 ? k + 1 : Math.min(N, k + this.famSize[k]);
      if (this.atVenue[k]) continue; // friends out together
      if (this.refuseRoll(k, end)) continue; // 0.42: staying home
      if (lead < 0) continue; // singles go straight
      let r = rallyFor(seed, k, this.startMin);
      for (let m = k; m < end; m++) if (this.state[m] === SAFE_CIV || this.inZone[this.homeCell[m]] === 1) r = RALLY_ZONE; // already safe, or home is in the zone
      let away = false, kid = -1;
      for (let m = k; m < end; m++) {
        this.rally[m] = r;
        if (this.state[m] === CIV && this.dayPlace[m] !== PL_HOME) away = true;
        if (kid < 0 && this.state[m] === CIV && this.dayPlace[m] === PL_SCHOOL && this.schoolCell[m] >= 0) kid = m;
      }
      if (!away) continue; // together already
      // 0.41: the school walks its classes to the zone and tells the parents; the family meets them there
      if (kid >= 0) { r = RALLY_ZONE; for (let m = k; m < end; m++) this.rally[m] = r; }
      for (let m = k; m < end; m++) {
        if (this.state[m] === SAFE_CIV) { if (r === RALLY_ZONE) { this.plan[m] = PLAN_MEET; this.note(m, EV_ZONE_WAIT); } continue; }
        if (this.state[m] !== CIV) continue;
        const delay = -C.DEPART_SPREAD_S * (hash32(seed, m, 60) / 4294967296); // finishing up, grabbing keys
        if (this.dayPlace[m] === PL_SCHOOL && this.schoolCell[m] >= 0) continue; // the class (below)
        else if (r === RALLY_HOME) {
          this.goal[m] = this.homeCell[m];
          if (this.dayPlace[m] === PL_HOME) { this.plan[m] = PLAN_HOME_WAIT; this.note(m, EV_HOME_WAIT); }
          else { this.plan[m] = PLAN_GATHER; this.planT[m] = delay; this.note(m, EV_HEAD_HOME); }
        } else this.note(m, EV_TO_ZONE); // they meet in the zone (noteSafe sets PLAN_MEET)
      }
    }
    for (let k = 0; k < N; k++) { // 0.42: some teens go on their own
      if (this.state[k] !== CIV || this.famLead[k] < 0 || this.atVenue[k] || this.refuser[k] || this.age[k] < 13 || this.age[k] > 17) continue;
      if (this.dayPlace[k] === PL_SCHOOL && this.schoolCell[k] >= 0) continue; // with the class
      if (hash32(seed, k, 73) / 4294967296 >= C.TEEN_SOLO_P) continue;
      this.solo[k] = 1; this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; this.planT[k] = 0; this.note(k, EV_SOLO);
    }
    for (let k = 0; k < N; k++) if (this.state[k] === CIV && this.dayPlace[k] === PL_SCHOOL && this.schoolCell[k] >= 0) { // 0.41: the classes
      this.plan[k] = PLAN_CLASS; this.goal[k] = this.schoolCell[k]; this.planT[k] = 0; this.note(k, EV_CLASS); this.classKids++;
    }
  }
  /** 0.42: household k..end-1 refuses to leave (design: 2 to 4% of households, more among the elderly; some bluff).
   *  Not when anyone is already safe, home is inside a zone, or a kid is walking with a class. Members at home stay;
   *  members out head home and stay. */
  private refuseRoll(k: number, end: number): boolean {
    const seed = this.seed, u = (i: number, salt: number) => hash32(seed, i, salt) / 4294967296;
    let elder = false;
    for (let m = k; m < end; m++) {
      if (this.state[m] === SAFE_CIV || this.inZone[this.homeCell[m]] === 1 || (this.dayPlace[m] === PL_SCHOOL && this.schoolCell[m] >= 0)) return false;
      if (this.age[m] >= 65) elder = true;
    }
    if (u(k, 70) >= (elder ? C.REFUSE_P_ELDER : C.REFUSE_P)) return false;
    const bluff = u(k, 71) < C.REFUSE_BLUFF_P;
    for (let m = k; m < end; m++) {
      if (this.state[m] !== CIV) continue;
      this.refuser[m] = 1; this.refusers++; this.refuserList.push(m); this.rally[m] = RALLY_HOME; this.goal[m] = this.homeCell[m];
      this.resolve[m] = bluff ? 0.15 + 0.25 * u(m, 72) : 2 + u(m, 72);
      this.note(m, EV_REFUSE);
      if (this.dayPlace[m] === PL_HOME) this.plan[m] = PLAN_REFUSE;
      else { this.plan[m] = PLAN_GATHER; this.planT[m] = -C.DEPART_SPREAD_S * u(m, 60); this.note(m, EV_HEAD_HOME); }
    }
    return true;
  }
  /** Person k gets on a passing train (carried out of the city); 0.42: a refuser at home won't, one still on the way
   *  home takes the ride and stops refusing. */
  private trainBoard(k: number): boolean {
    if (k < this.civN && this.refuser[k] === 1) { if (this.plan[k] === PLAN_REFUSE) return false; this.refuser[k] = 0; }
    this.state[k] = DEAD;
    this.note(k, EV_EVAC, 1); // arg 1: by train
    return true;
  }
  /** 0.43: v just turned. Each family member out on the street who sees it (close, clear view) may freeze in shock, go
   *  back toward them, or refuse to leave (design: rare enough to read as a story beat). Rolled by hash, keyed on
   *  witness and turned person, so replays match. */
  private grieve(v: number) {
    if (!this.dayLife || v >= this.civN || this.famLead[v] < 0) return;
    const lead = this.famLead[v], seed = this.seed, vx = this.ax[v], vy = this.ay[v], R2 = C.GRIEF_SIGHT_R * C.GRIEF_SIGHT_R;
    for (let m = lead, e = Math.min(this.civN, lead + this.famSize[v]); m < e; m++) {
      if (m === v || this.state[m] !== CIV) continue;
      const dx = this.ax[m] - vx, dy = this.ay[m] - vy;
      if (dx * dx + dy * dy > R2 || !this.seen(this.ax[m], this.ay[m], vx, vy, true, C.EYE_M)) continue;
      let again = false; for (let ev = this.lastEv[m]; ev >= 0 && !again; ev = this.evPrev[ev]) again = this.evCode[ev] === EV_SAW_TURN && this.evArg[ev] === v;
      if (again) continue; // (once per person turned)
      this.note(m, EV_SAW_TURN, v);
      const u = (salt: number) => hash32(seed ^ Math.imul(v + 1, 0x27d4eb2d), m, salt) / 4294967296;
      if (u(80) >= C.GRIEF_P) continue;
      const pick = u(81), onlyFreeze = this.age[m] < 13 || this.refuser[m] !== 0 || this.plan[m] === PLAN_CLASS;
      if (onlyFreeze || pick < C.GRIEF_FREEZE_SHARE) {
        this.act[m] = 2; this.actT[m] = C.GRIEF_FREEZE_S_MIN + (C.GRIEF_FREEZE_S_MAX - C.GRIEF_FREEZE_S_MIN) * u(82);
        this.note(m, EV_FROZE);
      } else if (pick < C.GRIEF_FREEZE_SHARE + C.GRIEF_GO_BACK_SHARE) {
        this.plan[m] = PLAN_GO_BACK; this.goal[m] = v; this.planT[m] = 0; this.resetProgress(m);
        this.note(m, EV_GO_BACK, v);
      } else {
        this.refuser[m] = 1; this.refusers++; this.refuserList.push(m); this.resolve[m] = 0.5; this.persuadeT[m] = 0;
        this.goal[m] = this.homeCell[m]; this.planT[m] = 0; this.resetProgress(m);
        this.plan[m] = this.cellNear(this.ax[m], this.ay[m], this.homeCell[m], C.HOME_REACHED_CELLS) ? PLAN_REFUSE : PLAN_GATHER;
        this.note(m, EV_GRIEF_STAY, v);
      }
    }
  }
  /** 0.42: stamp the cells within PERSUADE_R of every set-up ground unit (once a tick, only while someone refuses). */
  private stampUnitNear() {
    const w = this.w, h = this.h, g = this.tick + 1, R = C.PERSUADE_R;
    const a = this.unitNear ??= new Int32Array(w * h);
    for (const u of this.units) {
      if ((u.deployT ?? 0) > 0 || u.extractT !== undefined || u.kind === "apache" || u.kind === "reaper") continue;
      const ux = Math.floor(u.x), uy = Math.floor(u.y);
      for (let y = Math.max(0, uy - R); y <= Math.min(h - 1, uy + R); y++) for (let x = Math.max(0, ux - R); x <= Math.min(w - 1, ux + R); x++)
        if ((x - ux) * (x - ux) + (y - uy) * (y - uy) <= R * R) a[y * w + x] = g;
    }
  }
  private cellNear(x: number, y: number, c: number, r: number) { return Math.abs(x - (c % this.w) - 0.5) <= r + 0.5 && Math.abs(y - ((c / this.w) | 0) - 0.5) <= r + 0.5; }
  private famEnd(k: number) { const lead = this.famLead[k]; return lead < 0 ? k + 1 : Math.min(this.civN, lead + this.famSize[k]); }
  /** Everyone of k's household still out on the street is at home (the rest are safe, out or gone). */
  private homeDone(k: number): boolean {
    const lead = this.famLead[k]; if (lead < 0) return true;
    for (let m = lead, e = this.famEnd(k); m < e; m++) if (this.state[m] === CIV && this.fate[m] === 0 && !this.solo[m] && !this.cellNear(this.ax[m], this.ay[m], this.homeCell[m], C.HOME_REACHED_CELLS)) return false;
    return true;
  }
  /** Nobody of k's household is still out on the street. */
  private meetDone(k: number): boolean {
    const lead = this.famLead[k]; if (lead < 0) return true;
    for (let m = lead, e = this.famEnd(k); m < e; m++) if (this.state[m] === CIV && this.fate[m] === 0 && !this.solo[m] && !(this.refuser[m] === 1 && this.plan[m] === PLAN_REFUSE)) return false; // (0.43: not for someone staying home)
    return true;
  }
  /** Someone of k's household is still on the way home. */
  private coming(k: number): boolean {
    const lead = this.famLead[k]; if (lead < 0) return false;
    for (let m = lead, e = this.famEnd(k); m < e; m++) if (m !== k && this.state[m] === CIV && (this.plan[m] === PLAN_GATHER || this.plan[m] === PLAN_FOLLOW)) return true;
    return false;
  }
  private resetProgress(k: number) { this.stuckT[k] = 0; this.progT[k] = 0; this.ancX[k] = -1e4; this.ancY[k] = -1e4; }
  private giveUp(k: number) { if (this.refuser[k] === 1) this.refuser[k] = 0; this.resetProgress(k); const p = this.plan[k]; this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; this.note(k, EV_GAVE_UP, p === PLAN_GATHER ? 1 : 0); } // arg 1: turned back on the way
  /** The household's own plan for k once an errand is over: home (rally HOME) or the zone. */
  private backToRally(k: number) {
    this.resetProgress(k);
    if (this.rally[k] === RALLY_HOME && this.famLead[k] >= 0) { this.plan[k] = PLAN_GATHER; this.goal[k] = this.homeCell[k]; this.planT[k] = 0; this.note(k, EV_HEAD_HOME); }
    else { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; this.note(k, EV_TO_ZONE); }
  }
  /** One think of an errand: a direction to walk, ERRAND_HOLD to stand, or null when the errand ended (walk to a zone). */
  private errand(k: number, x: number, y: number, f: number, dt: number): [number, number] | typeof ERRAND_HOLD | null {
    const p = this.plan[k];
    this.planT[k] += dt;
    const refusing = this.refuser[k] === 1 && (p === PLAN_REFUSE || p === PLAN_GATHER); // (0.43: on the way home too)
    if (refusing && this.zStim[k] > 0 && (this.resolve[k] -= this.zStim[k] * C.REFUSE_BREAK_PER_S * dt) <= 0) { // the infected came close: they run after all
      this.refuser[k] = 3; this.broke++; this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; this.resetProgress(k); this.note(k, EV_BROKE); return null;
    }
    if (f > C.ABANDON_FEAR && p !== PLAN_FOLLOW && !refusing && p !== PLAN_GO_BACK) { this.giveUp(k); return null; } // (a refuser's test is their resolve)
    if (this.planT[k] < 0) return ERRAND_HOLD; // still getting ready to leave
    const check = (k + this.tick) % 10 === 0, g = this.goal[k];
    const toward = (c: number, near: number, travel = false): [number, number] | typeof ERRAND_HOLD | null => {
      if (this.cellNear(x, y, c, near)) return ERRAND_HOLD;
      if (!travel || hyp(x - this.ancX[k], y - this.ancY[k]) > 2) { this.ancX[k] = x; this.ancY[k] = y; this.progT[k] = 0; }
      else if ((this.progT[k] += dt) > 30) { this.giveUp(k); return null; } // pinned in place for 30 s: drop it
      const d = navOf(this).dirTo(c, x, y);
      if (d) { this.stuckT[k] = 0; return d; }
      this.stuckT[k] += dt;
      if (this.stuckT[k] > 5) { this.giveUp(k); return null; } // no way there
      const tx = (c % this.w) + 0.5 - x, ty = ((c / this.w) | 0) + 0.5 - y, l = hyp(tx, ty) || 1;
      return [tx / l, ty / l];
    };
    switch (p) {
      case PLAN_GATHER: {
        if (this.cellNear(x, y, g, C.HOME_REACHED_CELLS) && this.refuser[k] === 1) { this.plan[k] = PLAN_REFUSE; this.planT[k] = 0; this.resetProgress(k); return ERRAND_HOLD; } // 0.42: home, and staying
        if (this.cellNear(x, y, g, C.HOME_REACHED_CELLS)) {
          this.plan[k] = PLAN_HOME_WAIT; this.planT[k] = 0; this.resetProgress(k); this.note(k, EV_HOME_WAIT);
          for (let m = this.famLead[k], e = this.famEnd(k); m >= 0 && m < e; m++) if (this.plan[m] === PLAN_FOLLOW && this.goal[m] === k) { this.plan[m] = PLAN_HOME_WAIT; this.goal[m] = this.homeCell[m]; this.planT[m] = 0; }
          return ERRAND_HOLD;
        }
        return toward(g, 0, true); // travelling: dropped if pinned in place
      }
      case PLAN_HOME_WAIT: {
        if (check && this.homeDone(k)) {
          for (let m = this.famLead[k], e = this.famEnd(k); m >= 0 && m < e; m++) if (this.state[m] === CIV && (this.plan[m] === PLAN_HOME_WAIT || this.plan[m] === PLAN_FOLLOW)) {
            this.plan[m] = PLAN_STRAIGHT; this.goal[m] = -1; this.note(m, EV_FAMILY_TOGETHER);
          }
          return null;
        }
        if (this.planT[k] > C.GATHER_WAIT_S || (check && !this.coming(k))) { this.giveUp(k); return null; } // nobody else is on the way
        return toward(g, 2);
      }
      case PLAN_REFUSE: { // 0.42: sheltering at home
        if (this.inZone[g] === 1) { this.refuser[k] = 0; this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; this.resetProgress(k); return null; } // home is inside a zone now: in they go
        const ci = this.idx(Math.max(0, Math.min(this.w - 1, x | 0)), Math.max(0, Math.min(this.h - 1, y | 0)));
        if (this.unitNear && this.unitNear[ci] === this.tick + 1) {
          if ((this.persuadeT[k] += dt) >= C.PERSUADE_S) { // talked out: the family at home leaves with them
            for (let m = this.famLead[k] >= 0 ? this.famLead[k] : k, e = this.famEnd(k); m < e; m++) if (this.refuser[m] === 1 && this.plan[m] === PLAN_REFUSE && this.state[m] === CIV && hyp(this.ax[m] - x, this.ay[m] - y) <= 3) {
              this.refuser[m] = 2; this.talkedOut++; this.plan[m] = PLAN_STRAIGHT; this.goal[m] = -1; this.resetProgress(m); this.note(m, EV_TALKED_OUT);
            }
            return null;
          }
        }
        return toward(g, 2);
      }
      case PLAN_GO_BACK: { // 0.43: back toward the one who turned, then they run for it
        const l = g;
        if (l < 0 || this.state[l] !== INF || this.planT[k] >= C.GO_BACK_S) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; return null; }
        const tx = this.ax[l] - x, ty = this.ay[l] - y, d = hyp(tx, ty);
        if (d < 1.5) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; return null; }
        return [tx / d, ty / d];
      }
      case PLAN_CLASS: { // 0.41: lining up with the teachers, then the class walks to the zone
        if (this.planT[k] >= C.CLASS_READY_S) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; return null; }
        return toward(g, 2);
      }
      case PLAN_FOLLOW: {
        const l = g;
        if (l < 0 || this.state[l] !== CIV) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; return null; } // with them in the zone, or they're gone
        if (this.plan[l] === PLAN_STRAIGHT && hyp(this.ax[l] - x, this.ay[l] - y) < 3) { this.plan[k] = PLAN_STRAIGHT; this.goal[k] = -1; return null; } // walking to the zone together
        const tx = this.ax[l] - x, ty = this.ay[l] - y, d = hyp(tx, ty);
        return d < 1.2 ? ERRAND_HOLD : [tx / d, ty / d];
      }
    }
    return null;
  }
  outbreak = false; // the warning is over and the first cases have turned
  /** 0.24: outbreaks rolled after the first cases (sorted by time); spreadNext = the next one to turn. */
  spreadSites: { x: number; y: number; t: number }[] = [];
  private spreadNext = 0;
  wave = 0;
  nextWaveT = Infinity;
  entries: Entry[] = [];
  upcoming: number[] = []; // entry indices the next horde will use (shown WAVE_WARN_S ahead)
  private marching: { e: number; left: number; per: number; hp: number; swim: number }[] = [];
  private evacPay = 0; // fractional evac money waiting to be paid out

  /** Storyteller heat at the current battle time (scans civilian slots only when called). */
  heatNow(): number {
    let left = 0;
    for (let k = 0; k < this.civN; k++) {
      const s = this.state[k];
      if (s === CIV || s === SAFE_CIV) left++;
    }
    const gone = this.civN > 0 ? 1 - left / this.civN : 1;
    return heat(this.diff, (this.time - C.WARNING_S) / 60, gone);
  }

  /** Ways into the city: walkable runs along the map edge (2 cells in), plus river mouths for swimmers. */
  private findEntries() {
    const out: Entry[] = [];
    for (let edge = 0; edge < 4; edge++) {
      const along = edge % 2 === 0 ? this.w : this.h;
      let run: [number, number][] = [], runWater = false;
      const flush = () => {
        if (run.length) {
          let kind: Entry["kind"] = runWater ? "river" : "road";
          if (!runWater) {
            for (const [x, y] of run) {
              const i = this.idx(x, y), t = this.map.tile[i], inf = this.map.height[i];
              if ((t === 0 || t === BRIDGE) && inf === INFRA_HIGHWAY) { kind = "highway"; break; }
              if ((t === 0 || t === BRIDGE) && (inf === INFRA_RAIL || inf === INFRA_STATION)) kind = "rail";
              else if (t === BRIDGE && kind === "road") kind = "bridge";
            }
          }
          const [mx, my] = run[run.length >> 1];
          const weight = (kind === "highway" ? 5 : kind === "rail" ? 3 : kind === "bridge" ? 3 : kind === "river" ? 2 : 1) * Math.min(3, Math.sqrt(run.length));
          out.push({ kind, cells: run, x: mx, y: my, edge, weight });
        }
        run = [];
      };
      for (let a = 0; a < along; a++) {
        const [x, y] = edge === 0 ? [a, 2] : edge === 1 ? [this.w - 3, a] : edge === 2 ? [a, this.h - 3] : [2, a];
        const i = this.idx(x, y), t = this.map.tile[i];
        const water = t === WATER, land = walkable(t) && !this.inZone[i];
        if (!water && !land) { flush(); continue; }
        if (run.length && water !== runWater) flush();
        runWater = water; run.push([x, y]);
      }
      flush();
    }
    // keep the main routes: the busiest roads in, not every alley that touches the edge
    out.sort((a, b) => b.weight - a.weight);
    const land = out.filter(e => e.kind !== "river"), keep = land.slice(0, 8);
    // 0.36: every edge with a way in keeps its best one (a busy edge used to take all 8 slots: Castle Rock's Rock Park)
    for (let edge = 0; edge < 4; edge++) {
      if (keep.some(e => e.edge === edge)) continue;
      const best = land.find(e => e.edge === edge); if (!best) continue;
      const counts = [0, 0, 0, 0]; for (const e of keep) counts[e.edge]++;
      let drop = -1; for (let i = keep.length - 1; i >= 0; i--) if (counts[keep[i].edge] > 1) { drop = i; break; }
      if (keep.length < 8) keep.push(best); else if (drop >= 0) keep[drop] = best;
    }
    keep.sort((a, b) => b.weight - a.weight);
    this.entries = keep.concat(out.filter(e => e.kind === "river").slice(0, 2));
  }

  /** Choose where the next horde comes in (more routes at once as heat climbs). */
  private planWave(r: () => number, h = this.heatNow()) {
    const land = this.entries.map((e, i) => i).filter(i => this.entries[i].kind !== "river");
    const pool = land.length ? land : this.entries.map((e, i) => i);
    const n = Math.min(pool.length, routesFor(h));
    const pick: number[] = [];
    for (let j = 0; j < n; j++) {
      let tot = 0; for (const i of pool) if (!pick.includes(i)) tot += this.entries[i].weight;
      let x = r() * tot;
      for (const i of pool) { if (pick.includes(i)) continue; x -= this.entries[i].weight; if (x <= 0) { pick.push(i); break; } }
    }
    this.upcoming = pick;
  }
  waveEdge = -1; // 0 top, 1 right, 2 bottom, 3 left: where the last wave came from
  private freeSlot = 0;

  /** Put an infected into a free slot (reuses killed ones). Returns false when the reserve is full. */
  spawnInfected(x: number, y: number, hp: number, isSwimmer = false) {
    for (let tries = 0; tries < this.n - this.civN; tries++) {
      const k = this.freeSlot;
      this.freeSlot = this.freeSlot + 1 >= this.n ? this.civN : this.freeSlot + 1;
      if (this.state[k] !== DEAD) continue;
      this.ax[k] = x; this.ay[k] = y; this.state[k] = INF; this.hp[k] = hp; this.chase[k] = 0;
      this.civWep[k] = 0; this.civAmmo[k] = 0; this.civMilitia[k] = 0; this.civCd[k] = 0;
      this.zMem[k] = 0; { const a = k * 2.39996; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); } // 0.33: walks the routes it knows; some heading to keep
      this.mutant[k] = isSwimmer ? 1 : 0;
      this.infectedEver++;
      return true;
    }
    return false;
  }

  private spawnWave(r: () => number, hpScale: number, h = this.heatNow()) {
    const { count, big } = rollSize(this.diff, h, C.WAVE_BASE * this.waveMul * this.popMul, r);
    const swimmerFrac = this.mutators.has("swimmer_surge") ? 0.35
      : this.wave >= C.SWIMMER_WAVE_START ? Math.min(C.SWIMMER_MAX_FRAC, C.SWIMMER_BASE_FRAC + (this.wave - C.SWIMMER_WAVE_START) * C.SWIMMER_WAVE_GROWTH) : 0;
    const baseHp = C.INF_HP * hpScale * this.infHpMul;
    const ents = this.upcoming.length ? this.upcoming : [0];
    if (!this.entries.length) return;
    const rivers = this.entries.map((e, i) => i).filter(i => this.entries[i].kind === "river");
    const nSwim = rivers.length ? Math.round(count * swimmerFrac) : 0;
    const steps = Math.max(1, Math.round(C.WAVE_MARCH_S / C.DT));
    for (const e of ents) { const left = Math.round((count - nSwim) / ents.length); this.marching.push({ e, left, per: left / steps, hp: baseHp, swim: rivers.length ? 0 : swimmerFrac }); }
    if (nSwim) { const e = rivers[Math.floor(r() * rivers.length)]; this.marching.push({ e, left: nSwim, per: nSwim / steps, hp: baseHp * C.SWIMMER_HP_MUL, swim: 1 }); }
    const first = this.entries[ents[0]];
    this.wave++; this.waveEdge = first ? first.edge : 0; this.waveT = this.time; this.lastWaveCount = count; this.lastWaveBig = big;
    St.event(this.stats, St.SE_HORDE, this.time, first ? first.x : 0, first ? first.y : 0, count, big ? 1 : 0); // 0.57
    this.waveEntries = ents.slice();
    this.planWave(r, h);
  }
  waveEntries: number[] = []; // routes the latest horde came in on

  /** Hordes walk in over a few seconds, a column along the route. */
  private stepMarch(r: () => number, dt: number) {
    for (let i = this.marching.length - 1; i >= 0; i--) {
      const m = this.marching[i], e = this.entries[m.e];
      let n = Math.min(m.left, Math.max(1, Math.round(m.per * dt / C.DT)));
      m.left -= n;
      while (n-- > 0) {
        const [x, y] = e.cells[Math.floor(r() * e.cells.length)];
        const swim = e.kind === "river" || r() < m.swim;
        if (!this.spawnInfected(x + r(), y + r(), swim && e.kind !== "river" ? m.hp * C.SWIMMER_HP_MUL : m.hp, swim)) { m.left = 0; break; }
      }
      if (m.left <= 0) this.marching.splice(i, 1);
    }
  }
  waveT = -1;

  distToZone(x: number, y: number) {
    let d = Infinity;
    for (const [px, py] of this.zonePoly) d = Math.min(d, hyp(px - x, py - y));
    return d;
  }

  /** Distance fields (0.28): 8-way with true diagonal costs (FIELD_STEP per straight step), so crowds
   *  cross open ground on the diagonal instead of in staircase lanes. A standing ground unit is a heavy
   *  cost, not a wall: people and infected walk around a turret, and only squeeze up to one when there is
   *  no other way. Civilians head for the zone interior through gates and breaches; infected head for the
   *  standing perimeter, and through a breach into the interior (a broken wall is a doorway, not the goal). */
  private buildFields() {
    const cells = this.w * this.h, w = this.w, FS = FIELD_STEP, DG = FIELD_DIAG, OCC = FIELD_OCC;
    const occS = this.occStatic;
    // Dial's bucket queue: costs are small integers, so a ring of buckets replaces a heap.
    const RING = DG + OCC + 1;
    const pass = new Uint8Array(cells);
    // neighbor offsets: 4 straight then 4 diagonal
    const ODX = [1, -1, 0, 0, 1, 1, -1, -1], ODY = [0, 0, 1, -1, 1, -1, 1, -1];
    const run = (field: Uint16Array, infected: boolean, swim: boolean) => {
      field.fill(65535);
      const tile = this.map.tile, zone = this.inZone, hp = this.wallHp, h = this.h;
      for (let n = 0; n < cells; n++) {
        const t = tile[n];
        if (!walkable(t) && !(swim && t === WATER)) { pass[n] = 0; continue; }
        const z = zone[n];
        pass[n] = infected ? (z === 0 || z === 1 || hp[n] <= 0 ? 1 : 0) : (z !== 2 || hp[n] <= 0 ? 1 : 0); // civilians pass gates and breaches
      }
      const buckets: number[][] = Array.from({ length: RING }, () => []);
      let pending = 0;
      for (let i = 0; i < cells; i++) {
        const z = zone[i];
        if (!walkable(tile[i])) continue;
        // Infected aim at the standing perimeter and the interior; civilians at the interior.
        const seed = infected ? (z === 1 || ((z === 2 || z === 3) && hp[i] > 0)) : z === 1;
        if (seed) { field[i] = 0; buckets[0].push(i); pending++; }
      }
      for (let d = 0; pending > 0; d++) {
        const b = buckets[d % RING];
        while (b.length) {
          const c = b.pop()!; pending--;
          if (field[c] !== d) continue; // stale entry
          const cx = c % w, cy = (c / w) | 0;
          for (let j = 0; j < 8; j++) {
            const nx = cx + ODX[j], ny = cy + ODY[j];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (!pass[n]) continue;
            if (j >= 4 && (!pass[cy * w + nx] || !pass[ny * w + cx])) continue; // no corner cutting
            const nd = d + (j >= 4 ? DG : FS) + (occS[n] ? OCC : 0);
            if (nd < field[n] && nd < 65535) { field[n] = nd; buckets[nd % RING].push(n); pending++; }
          }
        }
      }
    };
    run(this.civField, false, false);
    run(this.infField, true, false);
    run(this.swimField, true, true);
    this.buildDepth();
    for (const [f, dir] of [[this.civField, this.civDir], [this.infField, this.infDir], [this.swimField, this.swimDir]] as const)
      for (let i = 0; i < cells; i++) {
        if (f[i] === 65535 || f[i] === 0) { dir[2 * i] = 0; dir[2 * i + 1] = 0; continue; }
        const d = this.downhill(f, i % this.w, (i / this.w) | 0); dir[2 * i] = d ? d[0] : 0; dir[2 * i + 1] = d ? d[1] : 0;
      }
    const q = new Int32Array(cells);
    // Ground units drive through our own gates; standing walls stop them (0.27).
    this.apcField.fill(65535);
    let qh = 0, qt = 0;
    for (let i = 0; i < cells; i++) if (this.inZone[i] === 1 && walkable(this.map.tile[i])) { this.apcField[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const c = q[qh++], cx = c % this.w, d = this.apcField[c] + 1;
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (n < 0 || n >= cells || this.apcField[n] !== 65535 || !this.unitPass(n)) continue;
        this.apcField[n] = d; q[qt++] = n;
      }
    }
    this.fieldDirty = false;
  }

  private rebuildBuckets() {
    this.head.fill(-1); this.headC.fill(-1); this.dens.fill(0); this.sumX.fill(0); this.sumY.fill(0); this.gen++;
    // 0.30: last tick's fear per bucket becomes this tick's contagion source
    for (let b = 0; b < this.panPrev.length; b++) { this.panPrev[b] = this.panCnt[b] ? this.panSum[b] / this.panCnt[b] : 0; }
    this.panSum.fill(0); this.panCnt.fill(0);
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD) continue;
      const ci = (this.ay[k] | 0) * this.w + (this.ax[k] | 0);
      if (this.cellGen[ci] !== this.gen) { this.cellGen[ci] = this.gen; this.cellHead[ci] = -1; }
      this.cellNext[k] = this.cellHead[ci]; this.cellHead[ci] = k;
      if (this.dens[ci] < 65535) this.dens[ci]++;
      this.sumX[ci] += this.ax[k]; this.sumY[ci] += this.ay[k];
      const b = ((this.ay[k] / BUCKET) | 0) * this.bw + ((this.ax[k] / BUCKET) | 0);
      if (s === INF) { this.next[k] = this.head[b]; this.head[b] = k; }
      else { this.next[k] = this.headC[b]; this.headC[b] = k; }
    }
  }

  /** Nearest agent in `want` state within radius r of (x, y); -1 if none. */
  nearest(x: number, y: number, r: number, want: number, alsoWant = 255, maxCheck = 40) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bd = r * r;
    const list = want === INF ? this.head : this.headC;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      for (let k = list[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        // In a dense crowd any close match will do: cap the work.
        if (--maxCheck <= 0) return best;
        const s = this.state[k];
        if (s !== want && s !== alsoWant) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }

  /** Smooth direction down a distance field at (x,y): a weighted sum over the 8 neighbors, so crowds spread
   *  over the whole street instead of marching in one line. Returns [dx,dy] or null at the goal / off-field. */
  private downhill(field: Uint16Array, x: number, y: number): [number, number] | null {
    const f0 = field[this.idx(x, y)];
    if (f0 === 65535 || f0 === 0) return null;
    let gx = 0, gy = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const f = field[this.idx(nx, ny)];
      if (f === 65535 || f >= f0) continue;
      if (dx && dy && (field[this.idx(x + dx, y)] === 65535 || field[this.idx(x, y + dy)] === 65535)) continue;
      const wgt = (f0 - f) / (dx && dy ? 1.414 : 1);
      gx += dx * wgt; gy += dy * wgt;
    }
    const l = hyp(gx, gy);
    return l < 1e-6 ? null : [gx / l, gy / l];
  }

  /** Advance one tick. dt may be larger than C.DT at high game speeds (fewer, longer ticks). */
  step(dt: number = C.DT) {
    if (this.phase !== "battle") return;
    this.inStep = true;
    try { this.stepInner(dt); } finally { this.inStep = false; }
  }
  private stepInner(dt: number) {
    if (this.fieldDirty) this.buildFields();
    this.rebuildBuckets();
    this.time += dt; this.tick++;
    if (this.time >= this.stats.nextT) this.sampleStats(); // 0.57
    if (this.phase === "battle" && this.supply.length) this.stepSupply(dt); // 0.60
    if (this.tick % 10 === 0) this.pruneGroupsNow(); // 0.50 (a closure here slowed the whole tick by ~15%: kept out of this function)
    const tOut = Math.max(0, this.time - C.WARNING_S); // the hordes toughen from the outbreak on
    const infHpScale = 1 + C.INF_HP_GROWTH * this.diff.toughMul * tOut;
    const infSpeed = C.INF_SPEED * this.speedMul * Math.min(1.6, 1 + C.INF_SPEED_GROWTH * this.diff.toughMul * tOut);
    const r = rng((this.tick * 2654435761) >>> 0);
    if (!this.outbreak && this.time >= C.WARNING_S) {
      this.outbreak = true; // the first cases turn
      for (const [x, y] of this.sites) for (let j = 0; j < C.INFECTED_PER_SITE; j++) this.spawnInfected(x + r() * 2, y + r() * 2, C.INF_HP * this.infHpMul, false);
      this.nextWaveT = this.time + rollGap(this.diff, this.heatNow(), r, this.mutators.has("blitz_hordes"));
    }
    while (this.outbreak && this.spreadNext < this.spreadSites.length && this.time >= this.spreadSites[this.spreadNext].t) {
      const p = this.spreadSites[this.spreadNext++];
      for (let j = 0; j < C.INFECTED_PER_SITE; j++) this.spawnInfected(p.x + r() * 2, p.y + r() * 2, C.INF_HP * this.infHpMul, false);
    }
    while (this.outbreak && this.carrierNext < this.carriers.length && this.time >= this.carriers[this.carrierNext].t) {
      const v = this.carriers[this.carrierNext++].k;
      if (this.state[v] !== CIV || !this.dev.bites) continue; // made it into a zone, got out, or already gone
      this.note(v, EV_TURNED);
      this.state[v] = INF; this.mutant[v] = 0; this.hp[v] = C.INF_HP * infHpScale * this.infHpMul; this.chase[v] = 0;
      this.civWep[v] = 0; this.civAmmo[v] = 0; this.civMilitia[v] = 0; this.civCd[v] = 0;
      this.infectedEver++; this.carriersTurned++;
      this.grieve(v);
      this.scare(this.ax[v], this.ay[v], 8, 0.95);
    }
    if (this.time >= this.nextWaveT) {
      const h = this.heatNow();
      if (this.dev.waves) this.spawnWave(r, infHpScale, h);
      this.nextWaveT = this.time + rollGap(this.diff, h, r, this.mutators.has("blitz_hordes"));
    }
    if (this.marching.length) this.stepMarch(r, dt);
    if (this.switching.length) this.stepSwitching();
    this.rebuildOcc(dt);
    { this.waitN = this.waitCount; this.waitCount = 0;
      const need = Math.ceil(this.waitN / (C.WAIT_RHO * C.CELL_M * C.CELL_M)), ring = this.padRing; // street cells the crowd needs
      this.gatherD = Math.max(C.EVAC_GATHER_D, ring.length ? ring[Math.min(ring.length - 1, need)] : 0); }
    { let alive = 0; for (let k = 0; k < this.civN; k++) if (this.state[k] === CIV || this.state[k] === SAFE_CIV) alive++;
      this.lod = alive > 120000 ? 8 : alive > 6000 ? 4 : alive > 2000 ? 2 : 1; } // people rethink every 0.2 s (8 ticks = 0.4 s for huge crowds): human reaction time
    if (this.refusers) this.stampUnitNear(); // 0.42: units talking refusers out
    { const fd = Math.pow(0.5, dt / C.FEAR_GRID_HALF), nd = Math.pow(0.5, dt / C.NOISE_HALF), fb = this.fearB, nzb = this.noiseB;
      for (let b = 0; b < fb.length; b++) { fb[b] *= fd; nzb[b] *= nd; } }

    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD) continue;
      if ((s === SAFE_CIV || s === CIV) && this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)] === 2 && this.wallHp[this.idx(this.ax[k] | 0, this.ay[k] | 0)] > 0) { this.stepInside(k); continue; } // 0.30.1: never stuck in a wall
      if (s === SAFE_CIV) {
        // 0.28: just through the gate: walk on in every tick at full pace, so the doorway never plugs
        // 0.30: through the gate they stay on the crowd model until clear of the gateway (no grid-stepping jam)
        const gi = this.idx(this.ax[k] | 0, this.ay[k] | 0);
        const gateway = this.depth[gi] < C.GATE_CLEAR_DEPTH;
        const routed = this.hasPads && this.inZone[gi] === 1 && this.padField[gi] !== 65535, waiting = routed && this.padField[gi] <= this.gatherD;
        if (routed) this.waitCount++; // everyone headed for a pad ends up in its crowd
        // 0.30.1: everyone inside is on the crowd model too (no grid-stepping lines or piles); mill only steps
        // people out from under a unit
        if (this.occ[gi] !== 1) this.stepCiv(k, r, dt, gi, 0, true); // 0.33: beside/under a tank they edge out on foot
        else this.mill(k, r, dt);
        continue;
      }
      const x = this.ax[k], y = this.ay[k];
      const cx = x | 0, cy = y | 0;
      const cellIdx = cy * this.w + cx;
      const cellTile = this.map.tile[cellIdx];
      const cellInfra = (cellTile === 0 || cellTile === BRIDGE) ? this.map.height[cellIdx] : 0;
      let vx = 0, vy = 0, speed: number;
      if (s === CIV && this.occ[cellIdx] === 1) { // 0.24: a unit was put down on them: step out (0.33: a tank's edge they walk out of)
        const out = this.wallExit(cx, cy, false);
        if (out >= 0) { this.ax[k] = (out % this.w) + 0.5; this.ay[k] = ((out / this.w) | 0) + 0.5; }
        continue;
      }
      if (s === CIV) { this.stepCiv(k, r, dt, cellIdx, cellInfra); continue; } // 0.30: the crowd model
      {
        const swimmer = this.mutant[k] === 1;
        // 0.22.1: an infected caught inside a standing wall or gate (a person bitten in a gateway,
        // a gate locked or a zone drawn on top of it) could not step out and jittered there. Put it on the
        // nearest open cell, outside the zone first.
        if (!this.passable(cellIdx, true, swimmer)) {
          const inUnit = this.occ[cellIdx] === 1;
          const out = this.wallExit(cx, cy, swimmer, !inUnit); // under a unit: the nearest open cell; in a wall: outside first
          if (!inUnit) this.wallEjects++;
          if (out >= 0) { this.ax[k] = (out % this.w) + 0.5; this.ay[k] = ((out / this.w) | 0) + 0.5; }
          continue;
        }
        const onWater = swimmer && cellTile === WATER;
        speed = infSpeed * (swimmer ? (onWater ? C.SWIMMER_SPEED_WATER : C.SWIMMER_SPEED_LAND) : this.isRunner(k) ? C.RUNNER_MUL : C.SHAMBLER_MUL);
        if (!onWater) {
          if (cellInfra === INFRA_HIGHWAY) speed *= C.HIGHWAY_SPEED_MUL;
          else if (cellInfra === INFRA_RAIL || cellInfra === INFRA_STATION) speed *= C.RAIL_SPEED_MUL;
          speed *= this.roughMul(cellIdx);
        }
        // Chase the nearest civilian in sight (retarget every 5th tick), else follow the field to the zone.
        const nb = ((y / BUCKET) | 0) * this.bw + ((x / BUCKET) | 0), deaf = k % C.NOISE_STRAGGLER === 0;
        const loud = !deaf && this.noiseB[nb] > C.NOISE_MIN;
        if ((k + this.tick) % 6 === 0) {
          // 0.30: loud gunfire and blasts pull them off the people unless someone is right in front of them
          const t = this.nearest(x, y, loud && this.noiseB[nb] > 1 ? 4 : C.INF_SENSE, CIV, SAFE_CIV);
          if (t >= 0) {
            const dx = this.ax[t] - x, dy = this.ay[t] - y, l = hyp(dx, dy) || 1;
            this.hx[k] = dx / l; this.hy[k] = dy / l;
            this.chase[k] = 1;
            if (this.zMem[k] === 1) this.zMem[k] = 2; // 0.33: a person in sight shakes them out of milling
          } else this.chase[k] = 0;
        }
        if (this.chase[k]) { vx = this.hx[k]; vy = this.hy[k]; speed *= C.INF_LUNGE_MUL; } // a live person in sight: they surge
        else {
          let dir = swimmer ? this.swimDir : this.infDir;
          // 0.33: after a bridge goes they keep walking the routes they knew; near the zone they see the way in
          if (!swimmer && this.memDir && this.zMem[k] !== 2 && this.infField[cellIdx] > C.INF_KNOW_D * FIELD_STEP) dir = this.memDir;
          if (loud && this.zMem[k] === 1) this.zMem[k] = 2; // noise gives them somewhere new to go
          const milling = dir === this.memDir && this.zMem[k] === 1;
          const di = 2 * (cy * this.w + cx);
          let ddx = this.zoneClosed && !milling ? dir[di] : 0, ddy = this.zoneClosed && !milling ? dir[di + 1] : 0;
          if (dir === this.memDir && (ddx !== 0 || ddy !== 0)) { // the old route walks into the river where the bridge was: stop here and mill
            const ax = (x + ddx * 0.9) | 0, ay = (y + ddy * 0.9) | 0;
            if (ax >= 0 && ay >= 0 && ax < this.w && ay < this.h && this.map.tile[ay * this.w + ax] === WATER) {
              this.zMem[k] = 1; this.hx[k] = ddx; this.hy[k] = ddy; ddx = 0; ddy = 0;
            }
          }
          let gx = 0, gy = 0;
          if (loud) { // climb the noise toward the shooting
            const bx = (x / BUCKET) | 0, by = (y / BUCKET) | 0, nz = this.noiseB, bw = this.bw;
            gx = (bx < bw - 1 ? nz[nb + 1] : 0) - (bx > 0 ? nz[nb - 1] : 0); gy = (by < this.bh - 1 ? nz[nb + bw] : 0) - (by > 0 ? nz[nb - bw] : 0);
          }
          const gl = hyp(gx, gy);
          // 0.30: a slow sway around the way they're going, not a fixed lean (a fixed lean walks them into the walls)
          // 0.30.1: a shamble: the heading wanders at random around the way they're going and drifts back, so a
          // horde becomes a mob instead of marching in fixed lanes
          let zw = this.zWand[k];
          zw += -zw * C.INF_WANDER_BACK * dt + C.INF_WANDER * Math.sqrt(dt) * (r() + r() + r() - 1.5) * 2;
          if (zw > 1.1) zw = 1.1; else if (zw < -1.1) zw = -1.1;
          this.zWand[k] = zw;
          const c = Math.cos(zw), sn = Math.sin(zw);
          if (gl > 0.02) { gx /= gl; gy /= gl; vx = gx * c - gy * sn; vy = gx * sn + gy * c; }
          else if (ddx !== 0 || ddy !== 0) { vx = ddx * c - ddy * sn; vy = ddx * sn + ddy * c; }
          else { // 0.33: nothing to follow: they keep going the way they were heading, swaying (walls turn them)
            vx = this.hx[k] * c - this.hy[k] * sn; vy = this.hx[k] * sn + this.hy[k] * c;
            if (milling) speed *= 0.35; // milling on the bank: a slow shuffle
          }
        }
        // Bite.
        // Safe civilians can only be reached from inside the zone (through a breach).
        const v = (k + this.tick) % 3 === 0 ? this.nearest(x, y, C.BITE_RANGE, CIV, this.inZone[this.idx(cx, cy)] ? SAFE_CIV : 255) : -1;
        if (v >= 0 && this.dev.bites) {
          let p = BITE_P3;
          if (this.state[v] === SAFE_CIV) {
            p *= this.dev.safeBiteMul;
            if (this.hasActiveSupport("militia", this.ax[v], this.ay[v])) p *= C.MILITIA_BITE_MUL;
          }
          if (r() < p) {
            this.ping(this.state[v] === SAFE_CIV ? "zone" : "bite", this.ax[v], this.ay[v]); // 0.48
            this.note(v, EV_TURNED);
            this.state[v] = INF; this.mutant[v] = 0; this.hp[v] = C.INF_HP * infHpScale * this.infHpMul; this.chase[v] = 0;
            this.civWep[v] = 0; this.civAmmo[v] = 0; this.civMilitia[v] = 0; this.civCd[v] = 0;
            this.infectedEver++;
            this.grieve(v);
            this.scare(this.ax[v], this.ay[v], 8, 0.95); // 0.30: watching someone get bitten
          }
        }
        // Gnaw on an adjacent standing wall or closed gate.
        this.gnaw(cx, cy, dt);
      }
      // Crowd separation: drift from crowded cells (and off walls) toward emptier ones.
      // Infected barely make room (they press like a tide); panicked people spread out less than calm ones.
      if (this.dens[cy * this.w + cx] > 1) {
        this.spread(cx, cy); const kk = s === INF ? 0.15 : this.hp[k] > 0 ? 0.35 : 0.7; vx += this.spx * kk; vy += this.spy * kk;
        // 0.28: sand grains: people sharing a cell push apart from each other, so a crowd fills the street's full width
        // (sideways and forward only: a grain never pushes anyone back against the way they are going)
        this.grain(k, cellIdx); const g = C.GRAIN_PUSH * (s === INF ? 0.5 : 1);
        const vl = hyp(vx, vy);
        if (vl > 1e-6) { const ux = vx / vl, uy = vy / vl, dot = this.spx * ux + this.spy * uy; if (dot < 0) { this.spx -= dot * ux; this.spy -= dot * uy; } }
        vx += this.spx * g; vy += this.spy * g;
      }
      // 0.30: shortest routes hug the inside of every turn; bodies keep off the walls instead of riding them
      { const l0 = hyp(vx, vy); if (l0 > 1e-6) { this.wallAway(x, y, true, s === INF && this.mutant[k] === 1); vx = vx / l0 + this.spx * C.INF_WALL_PUSH; vy = vy / l0 + this.spy * C.INF_WALL_PUSH; } }
      // Move with collision against blocked cells (slide along axes).
      const l = hyp(vx, vy);
      if (l < 1e-6) continue;
      const jitter = 0.85 + r() * 0.3;
      const mx = (vx / l) * speed * dt * jitter, my = (vy / l) * speed * dt * jitter;
      const infected = s === INF, swimmer = infected && this.mutant[k] === 1;
      // Round to float32 first: the check must see exactly the position that gets stored.
      const nx = Math.fround(x + mx), ny = Math.fround(y + my);
      const movedX = this.free(nx, y, infected, swimmer);
      if (movedX) this.ax[k] = nx; else this.hx[k] = -this.hx[k];
      const movedY = this.free(this.ax[k], ny, infected, swimmer);
      if (movedY) this.ay[k] = ny; else this.hy[k] = -this.hy[k];
      if (!movedX && !movedY) {
        // 0.28: boxed in (a unit's corner, a building's corner): sidestep along it instead of bouncing in place
        const side = this.biasS[k] >= 0 ? 1 : -1, sx = Math.fround(x - my * side), sy = Math.fround(y + mx * side);
        if (this.free(sx, sy, infected, swimmer)) { this.ax[k] = sx; this.ay[k] = sy; }
        else { const tx = Math.fround(x + my * side), ty = Math.fround(y - mx * side); if (this.free(tx, ty, infected, swimmer)) { this.ax[k] = tx; this.ay[k] = ty; } }
      }
      { // 0.30: never ride a wall's exact edge (bodies have width)
        let px = this.ax[k], py = this.ay[k];
        const qx = px | 0, qy = py | 0, mn = C.WALL_MIN / C.CELL_M;
        if (px - qx < mn && !this.free(qx - 0.5, py, infected, swimmer)) px = qx + mn; else if (qx + 1 - px < mn && !this.free(qx + 1.5, py, infected, swimmer)) px = qx + 1 - mn;
        if (py - qy < mn && !this.free(px, qy - 0.5, infected, swimmer)) py = qy + mn; else if (qy + 1 - py < mn && !this.free(px, qy + 1.5, infected, swimmer)) py = qy + 1 - mn;
        this.ax[k] = Math.fround(px); this.ay[k] = Math.fround(py);
      }
    }

    if (this.tick % 20 === 0) { this.refreshAuras(); this.hasPads = this.supports.some(b => b.kind === "evac"); if (this.hasPads) this.buildPadField(); }
    this.stepSupports(dt);
    this.fireUnits(dt);
    this.stepSquadMoves(dt); // 0.49
    this.stepRoofShuffle(dt); // 0.52
    this.stepSquadBites(dt, infHpScale, r); // 0.49
    if (this.phase === "battle" && this.tick % 2 === 0 && this.supply.length) stepEngineers(this, dt * 2, r); // 0.60
    if ((this.tick & 1) === 0) this.stepGuards(dt * 2);
    this.scanEvents();
    this.units = this.units.filter(u => {
      if (u.hp === undefined || u.hp > 0) return true;
      if (u.parentUnit) return false;
      this.unitsLost++;
      if (u.hp !== -1) { const si = St.unitIndex(this.stats, u, this.time); this.stats.units[si].lostT = this.time; St.event(this.stats, St.SE_UNIT_LOST, this.time, u.x, u.y, si); } // 0.57
      if (u.hp !== -1) this.lostLog.push(u.kind); // -1 = left on purpose (sold or evacuated)
      return false;
    });
    this.runPending(dt);
    this.incomeT += dt;
    if (this.incomeT >= C.INCOME_EVERY_S && !this.dev.income) this.incomeT = 0;
    if (this.incomeT >= C.INCOME_EVERY_S) {
      this.incomeT -= C.INCOME_EVERY_S;
      let safe = 0;
      for (let k = 0; k < this.civN; k++) if (this.state[k] === SAFE_CIV) safe++;
      const pay = Math.round((safe * C.INCOME_PER_SAFE * this.incomeMul + (this.kills - this.killsPaid) * C.KILL_BOUNTY * this.killBountyMul) / this.popMul); // same money at any population
      this.killsPaid = this.kills;
      this.earned += pay; this.lastIncome = pay;
      // 0.48: cost of operations. Never takes money below zero.
      const up = Math.min(this.upkeepDue(), Math.max(0, this.remaining()));
      if (up > 0 && !this.dev.unlimitedMoney) { this.battleSpend += up; this.upkeepPaid += up; }
      this.lastUpkeep = up > 0 && !this.dev.unlimitedMoney ? up : 0;
    }
    if (this.evacPay >= 1) { const p = Math.floor(this.evacPay); this.evacPay -= p; this.earned += p; this.evacEarned += p;
    }
    this.checkEnd();
  }
  evacEarned = 0;
  /** Infected put back out of a wall or gate they were caught in (0.22.1; logged). */
  wallEjects = 0;
  /** Infected standing inside a standing wall or gate right now (should stay 0). */
  get stuckInWall() {
    let n = 0;
    for (let k = this.civN; k < this.n; k++) if (this.state[k] === INF && !this.passable(this.idx(this.ax[k] | 0, this.ay[k] | 0), true, this.mutant[k] === 1)) n++;
    return n;
  }
  /** Nearest open cell around a wall cell, ring by ring: outside the zone first, then inside; -1 if none in 4 cells. */
  private wallExit(cx: number, cy: number, swimmer: boolean, preferOutside = true) {
    let inside = -1;
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = this.idx(x, y);
        if (!this.passable(i, true, swimmer)) continue;
        if (this.inZone[i] === 0) return i;
        if (inside < 0) inside = i;
      }
      if (inside >= 0 && (r >= 2 || !preferOutside)) return inside;
    }
    return inside;
  }
  private hasPads = false;
  chase: Uint8Array;
  gnawTick: Uint32Array;
  gnawCnt: Uint8Array;

  /** Each agent leans a fixed amount left or right of the field direction (up to ~30 degrees). */
  private bias(k: number, d: [number, number]): [number, number] {
    const a = (((k * 0.6180339887) % 1) - 0.5) * 1.0;
    const c = Math.cos(a), sn = Math.sin(a);
    return [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c];
  }

  /** Safe civilians drift slowly inside the zone, away from the gates. */
  /** Push from a cell toward its less crowded neighbors. Blocked neighbors count as crowded, so people
   *  also keep off building walls. Roughly unit-sized when the difference is large. */
  private spx = 0; private spy = 0; // result of spread(), kept in fields so the hot loop allocates nothing
  private spread(cx: number, cy: number) {
    const w = this.w, i = cy * w + cx, d0 = this.dens[i];
    if (d0 <= 1) { this.spx = 0; this.spy = 0; return; }
    const t = this.map.tile, dn = this.dens, wall = d0 + 3;
    // tiles 0 road, 2 park, 4 bridge are walkable
    const tl = cx > 0 ? t[i - 1] : 1, tr = cx < w - 1 ? t[i + 1] : 1, tu = cy > 0 ? t[i - w] : 1, td = cy < this.h - 1 ? t[i + w] : 1;
    const dl = tl === 0 || tl === 2 || tl === 4 ? dn[i - 1] : wall, dr = tr === 0 || tr === 2 || tr === 4 ? dn[i + 1] : wall;
    const du = tu === 0 || tu === 2 || tu === 4 ? dn[i - w] : wall, dd = td === 0 || td === 2 || td === 4 ? dn[i + w] : wall;
    const k = 1 / (d0 + 2);
    this.spx = (dl - dr) * k; this.spy = (du - dd) * k;
  }

  /** 0.28: push agent k away from the middle of everyone sharing its cell (scaled by how crowded the cell is). */
  private grain(k: number, ci: number) {
    const d = this.dens[ci];
    if (d <= 1) { this.spx = 0; this.spy = 0; return; }
    // centroid of the others in the cell
    const ox = (this.sumX[ci] - this.ax[k]) / (d - 1), oy = (this.sumY[ci] - this.ay[k]) / (d - 1);
    let dx = this.ax[k] - ox, dy = this.ay[k] - oy;
    const l = hyp(dx, dy);
    if (l < 1e-4) { const a = k * 2.399963; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= l; dy /= l; }
    const f = Math.min(1, (d - 1) / 3);
    this.spx = dx * f; this.spy = dy * f;
  }
  /** 0.28: direction deeper into the zone (away from walls and gates) at an interior cell near the perimeter. */
  private inward(cx: number, cy: number): [number, number] | null {
    const d0 = this.depth[this.idx(cx, cy)];
    let gx = 0, gy = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const i = this.idx(nx, ny);
      if (this.inZone[i] !== 1 || !walkable(this.map.tile[i]) || this.occ[i]) continue;
      const d = this.depth[i];
      if (d <= d0) continue;
      const wgt = Math.min(4, d - d0) / (dx && dy ? 1.414 : 1);
      gx += dx * wgt; gy += dy * wgt;
    }
    const l = hyp(gx, gy);
    return l < 1e-6 ? null : [gx / l, gy / l];
  }

  // ---------- 0.30 crowd model ----------

  private rdx = 0; private rdy = 0;
  /** The route direction at (x, y), blended between the four nearest cell centers so it turns smoothly. */
  private routeAt(dir: Float32Array, x: number, y: number): boolean {
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    let gx = 0, gy = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const cx = x0 + i, cy = y0 + j;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
      const di = 2 * (cy * this.w + cx), dx = dir[di], dy = dir[di + 1];
      if (dx === 0 && dy === 0) continue;
      const wt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      gx += dx * wt; gy += dy * wt;
    }
    const l = hyp(gx, gy);
    if (l < 1e-6) return false;
    this.rdx = gx / l; this.rdy = gy / l; return true;
  }

  /** People per square meter around a cell (3x3 cells, counting only the ones a person can stand on). */
  private rhoAt(cx: number, cy: number) {
    let n = 0, a = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = cx + i, y = cy + j;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const c = y * this.w + x;
      if (!walkable(this.map.tile[c])) continue;
      n += this.dens[c]; a++;
    }
    return a ? n / (a * C.CELL_M * C.CELL_M) : 0;
  }

  /** A scare in the air around (x, y), r cells across: fear on the bucket grid, fading with distance (the strongest wins). */
  scare(x: number, y: number, r: number, amt: number) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      const d = hyp((bx + 0.5) * BUCKET - x, (by + 0.5) * BUCKET - y);
      if (d > r) continue;
      const v = amt * (1 - d / r), b = by * this.bw + bx;
      if (v > this.fearB[b]) this.fearB[b] = v;
    }
  }
  /** Noise that draws infected toward (x, y): adds up (a long firefight is louder), capped. */
  noise(x: number, y: number, r: number, amt: number) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      const d = hyp((bx + 0.5) * BUCKET - x, (by + 0.5) * BUCKET - y);
      if (d > r) continue;
      const b = by * this.bw + bx;
      this.noiseB[b] = Math.min(3, this.noiseB[b] + amt * (1 - d / r));
    }
  }
  /** A close blast throws people away from it and terrifies them. */
  private shove(x: number, y: number, r: number) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== CIV) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d = hyp(dx, dy);
        if (d > r) continue;
        const q = 1 - d / r, s = C.SHOVE * q / (d || 1);
        this.velX[k] += dx * s; this.velY[k] += dy * s;
        this.fear[k] = Math.max(this.fear[k], 0.6 + 0.4 * q);
      }
  }
  /** Gunfire and explosions since the last tick become fear (people) and noise (infected). */
  private scanEvents() {
    const t0 = this.scanT, t1 = this.time;
    for (const sh of this.shots) {
      if (sh.t <= t0 || sh.t > t1) continue;
      const loud = sh.cls === SHOT_SMALL ? 15 : sh.cls === SHOT_SNIPER ? 20 : sh.cls === SHOT_CANNON ? 30 : 40;
      this.scare(sh.x0, sh.y0, loud, 0.6);
      if (sh.cls <= SHOT_CANNON) this.scare(sh.x1, sh.y1, loud * 0.5, 0.7);
      this.noise(sh.x0, sh.y0, loud * 1.8, 0.35);
    }
    for (const bl of this.blasts) {
      if (bl.t <= t0 || bl.t > t1) continue;
      this.scare(bl.x, bl.y, 12 + bl.r * 6, 1);
      this.noise(bl.x, bl.y, 30 + bl.r * 8, 1.5);
      this.shove(bl.x, bl.y, bl.r * 2.5 + 2);
    }
    this.scanT = t1;
  }

  /**
   * One person outside a zone, one tick. Social force (Helbing): they keep a velocity and steer it toward where they
   * want to go, pushed by personal space and walls; time-to-collision avoidance (Karamouzas 2014) makes them give way
   * to oncoming people early; speed falls with density (Weidmann). Fear speeds them up, packs them tighter, makes
   * them follow the crowd, and sometimes run the wrong way or freeze. A pressing panicked crowd crushes people.
   */
  private vehEsc = false;
  private civOk(x: number, y: number, safe: boolean) {
    if (this.vehEsc && x >= 0 && y >= 0 && x < this.w && y < this.h) { const i = this.idx(x | 0, y | 0); if (this.occ[i] === 2 && walkable(this.map.tile[i])) return true; }
    return safe ? this.freeSafe(x, y) : this.free(x, y, false);
  }
  /** 0.30: a push away from blocked cells within WALL_RANGE (0 to about 1), into spx/spy. */
  private wallAway(x: number, y: number, infected: boolean, swimmer: boolean) {
    const cx = x | 0, cy = y | 0, w = this.w, R = C.WALL_RANGE / C.CELL_M;
    let fx = 0, fy = 0;
    const ox = x - cx, oy = y - cy;
    if (ox > R && ox < 1 - R && oy > R && oy < 1 - R) { this.spx = 0; this.spy = 0; return; } // nothing within reach
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const nx = cx + i, ny = cy + j;
      if (nx >= 0 && ny >= 0 && nx < w && ny < this.h && this.passable(ny * w + nx, infected, swimmer)) continue;
      const qx = Math.max(nx, Math.min(nx + 1, x)) - x, qy = Math.max(ny, Math.min(ny + 1, y)) - y, d = hyp(qx, qy);
      if (d >= R || d < 1e-5) continue;
      const p = 1 - d / R; fx -= (qx / d) * p; fy -= (qy / d) * p;
    }
    this.spx = fx; this.spy = fy;
  }
  /** 0.30: runners sprint, shamblers shuffle; the share of runners comes with the difficulty. Fixed per slot. */
  isRunner(k: number) { return this.mutant[k] !== 1 && ((Math.imul(k + 1, 0x9e3779b1) >>> 24) * 100) / 256 < this.diff.runnerPct; }
  /** Where a person already inside may step: the zone's own cells, or a gate they are still standing in. */
  private sqFrom = -1; // the cell a person inside is stepping from (to squeeze past units like mill does)
  private freeSafe(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = this.idx(x | 0, y | 0), z = this.inZone[i], sq = this.padSqueeze;
    return walkable(this.map.tile[i]) && (!this.occ[i] || (sq.length > 0 && sq[i] === 1 && this.sqFrom >= 0 && sq[this.sqFrom] === 1)) && (z === 1 || z === 3);
  }

  private stepCiv(k: number, r: () => number, dt0: number, ci: number, infra: number, safe = false) {
    const w = this.w, M = C.CELL_M, x = this.ax[k], y = this.ay[k], cx = x | 0, cy = y | 0;
    if (safe) this.sqFrom = ci;
    const byTank = this.movers.length > 0 && this.lod > 1 && this.nearMover(x, y);
    if (this.lod > 1 && (k + this.tick) % this.lod !== 0 && !byTank) { // big crowds: coast on the velocity between thinks (not beside a tank)
      if (this.downT[k] <= 0) this.moveCiv(k, x, y, this.velX[k], this.velY[k], 0, 0, dt0, safe);
      return;
    }
    const dt = byTank ? dt0 : dt0 * this.lod; // time since this person last thought
    if (safe) this.sqFrom = ci;
    const b = ((y / BUCKET) | 0) * this.bw + ((x / BUCKET) | 0);
    // --- senses and fear
    if ((k + this.tick) % 4 === 0) {
      const e = this.nearest(x, y, C.CIV_SENSE, INF);
      if (e >= 0) {
        const dx = x - this.ax[e], dy = y - this.ay[e], l = hyp(dx, dy) || 1;
        if (this.act[k] !== 1) { this.hx[k] = dx / l; this.hy[k] = dy / l; }
        this.zStim[k] = Math.min(1, 1.15 - 0.85 * l / C.CIV_SENSE);
      } else this.zStim[k] = 0;
    }
    let f = this.fear[k];
    // an evacuation order is out: nobody strolls (EVAC_URGENCY is the floor of everyone's fear outside a zone)
    const stim = Math.min(1, Math.max(this.zStim[k], this.fearB[b], C.FEAR_SPREAD * this.panPrev[b], safe ? 0 : C.EVAC_URGENCY));
    f += (stim - f) * Math.min(1, stim > f ? C.FEAR_RISE * dt : 3 * dt / C.FEAR_FADE_S);
    this.fear[k] = f;
    this.panSum[b] += f; if (this.panCnt[b] < 65535) this.panCnt[b]++;
    // --- crush: a panicked crowd pressed past what bodies can take knocks people down, then tramples them
    const rho = this.rhoAt(cx, cy);
    // (inside the zone soldiers keep order: no crush past the gate)
    if (rho > C.CRUSH_RHO && f > 0.4 && (!safe || this.inZone[ci] === 3)) this.crushT[k] += dt * (rho - C.CRUSH_RHO) * f; // the push from behind does it
    else this.crushT[k] = Math.max(0, this.crushT[k] - dt);
    if (this.downT[k] > 0) {
      this.downT[k] -= dt; this.velX[k] = 0; this.velY[k] = 0;
      if (this.crushT[k] > C.CRUSH_S * 1.5) { this.state[k] = DEAD; this.crushed++; this.note(k, EV_CRUSHED); this.scare(x, y, 4, 0.7); }
      else if (this.downT[k] <= 0) this.crushT[k] = 0;
      return;
    }
    if (this.crushT[k] > C.CRUSH_S) { this.downT[k] = C.DOWN_S; this.crushT[k] = 0; this.scare(x, y, 4, 0.6); return; }
    // --- odd panic: run the wrong way or freeze for a few seconds
    if (this.actT[k] > 0) { this.actT[k] -= dt; if (this.actT[k] <= 0) this.act[k] = 0; }
    else if (f > 0.7 && r() < C.PANIC_ODD_RATE * dt) {
      if (r() < 0.6) { this.act[k] = 1; this.actT[k] = 2 + r() * 3; const a = r() * 6.2832; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); }
      else { this.act[k] = 2; this.actT[k] = 1 + r() * 3; }
    }
    // --- neighbors: personal space, overlap, time to collision, and who is around (for herding)
    const ri = C.BODY_R + (C.PANIC_BODY_R - C.BODY_R) * f;
    const vxm = this.velX[k] * M, vym = this.velY[k] * M;
    let fx = 0, fy = 0, hvx = 0, hvy = 0, hn = 0, ox = 0, oy = 0;
    const spA = C.SPACE_A * (1 - 0.7 * f);
    // a few from every side (a cap that ran out on one side would push the whole crowd the other way)
    // in a packed cell only the nearest 2x2 cells matter (touching distance); in the open, 3x3 lets them look ahead
    const dense = this.dens[ci] > 6, i0 = dense ? (x - cx < 0.5 ? -1 : 0) : -1, j0 = dense ? (y - cy < 0.5 ? -1 : 0) : -1, span = dense ? 1 : 2;
    for (let j = j0; j <= j0 + span; j++) for (let i = i0; i <= i0 + span; i++) {
      const nx = cx + i, ny = cy + j;
      if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
      let checks = i === 0 && j === 0 ? (dense ? 6 : 8) : 3;
      const nc = ny * w + nx;
      for (let m = this.cellGen[nc] === this.gen ? this.cellHead[nc] : -1; m !== -1; m = this.cellNext[m]) {
        if (m === k) continue;
        if (--checks < 0) break;
        const sm = this.state[m];
        if (sm === DEAD) continue;
        const wx = (this.ax[m] - x) * M, wy = (this.ay[m] - y) * M, d2 = wx * wx + wy * wy;
        if (d2 > 16) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const inf = sm === INF, rj = inf ? 0.25 : C.BODY_R + (C.PANIC_BODY_R - C.BODY_R) * this.fear[m], R = ri + rj;
        const e = (R - d) / C.SPACE_B, p = e < -6 ? 0 : spA * fexp(e);
        fx -= (wx / d) * p; fy -= (wy / d) * p;
        if (d < R) { const o = (R - d) * 0.5; ox -= (wx / d) * o; oy -= (wy / d) * o; }
        const rvx = vxm - (inf ? 0 : this.velX[m] * M), rvy = vym - (inf ? 0 : this.velY[m] * M);
        const a = rvx * rvx + rvy * rvy, bb = wx * rvx + wy * rvy, c = d2 - R * R;
        if (c > 0 && a > 1e-4) {
          let disc = bb * bb - a * c;
          if (disc > 0) {
            disc = Math.sqrt(disc);
            const t = (bb - disc) / a;
            if (t > 0 && t < 8) {
              let kk = -C.TTC_K * fexp(-t / C.TTC_T0) / (a * t * t) * (2 / t + 1 / C.TTC_T0);
              if (!inf) { const vjx = this.velX[m], vjy = this.velY[m], al = (vjx * this.velX[k] + vjy * this.velY[k]) / ((hyp(vjx, vjy) * hyp(this.velX[k], this.velY[k])) || 1); if (al > 0) kk *= 1 - C.TTC_FOLLOW * al; }
              fx += kk * (rvx - (bb * rvx - a * wx) / disc); fy += kk * (rvy - (bb * rvy - a * wy) / disc);
            }
          }
        }
        if (!inf && d2 < 4) { hvx += this.velX[m]; hvy += this.velY[m]; hn++; }
      }
    }
    // --- crowd pressure: from a packed cell toward emptier ones (covers the people the capped scan skipped)
    if (this.dens[ci] > C.PRESS_DENS * C.CELL_M * C.CELL_M) { this.spread(cx, cy); const pr = C.CROWD_PRESS * (1 - 0.7 * f); fx += this.spx * pr; fy += this.spy * pr; } // the terrified don't give way
    // --- walls: buildings (and zone walls) push people off within WALL_RANGE
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const nx = cx + i, ny = cy + j;
      if (safe ? this.freeSafe(nx + 0.5, ny + 0.5) : nx >= 0 && ny >= 0 && nx < w && ny < this.h && this.passable(ny * w + nx, false)) continue;
      const qx = (Math.max(nx, Math.min(nx + 1, x)) - x) * M, qy = (Math.max(ny, Math.min(ny + 1, y)) - y) * M, d = hyp(qx, qy);
      if (d >= C.WALL_RANGE || d < 1e-4) continue;
      const p = C.WALL_A * (1 - d / C.WALL_RANGE);
      fx -= (qx / d) * p; fy -= (qy / d) * p;
    }
    // --- vehicles: people get out of the way of a tank or APC, sideways off its path (it never runs them over)
    let byVeh = false;
    for (const v of this.movers) {
      const px = x - v.x, py = y - v.y, R = v.h + C.VEH_CLEAR;
      if (px * px + py * py > (R + C.VEH_AHEAD) * (R + C.VEH_AHEAD)) continue;
      const d = hyp(px, py) || 1e-3;
      if (v.moving && d < R + 1) byVeh = true;
      if (d < R) { const p = C.VEH_A * (1 - d / R) * 2; fx += (px / d) * p; fy += (py / d) * p; } // too close: away from it
      if (v.moving) {
        const along = px * v.dx + py * v.dy, side = px * -v.dy + py * v.dx;
        if (along > -v.h && along < v.h + C.VEH_AHEAD && Math.abs(side) < v.h + C.VEH_CLEAR) { // in its path: step aside
          const sg = Math.abs(side) > 0.05 ? Math.sign(side) : (k & 1 ? 1 : -1), p = C.VEH_A * (1 - Math.abs(side) / (v.h + C.VEH_CLEAR));
          fx += -v.dy * sg * p; fy += v.dx * sg * p;
        }
      }
    }
    // --- family: drift back toward the group (until terror takes over), wait slightly when someone falls behind, and cover the group
    const lead = this.famLead[k];
    let famWait = false;
    // 0.40: with daily life, only members walking together (to a zone, or a kid with the parent) keep together
    const pk = this.plan[k], walking = (q: number) => q === PLAN_NONE || q === PLAN_STRAIGHT || q === PLAN_FOLLOW;
    if (lead >= 0 && f < C.GROUP_COHESION_FEAR && (!this.dayLife || (walking(pk) && !this.solo[k]))) {
      let sx = 0, sy = 0, n = 0, maxBehind = 0;
      const myDist = !safe && this.zoneClosed ? this.civField[ci] : 65535;
      for (let m = lead, e = lead + this.famSize[k]; m < e; m++) if (m !== k && this.state[m] === CIV && (!this.dayLife || (walking(this.plan[m]) && !this.solo[m]))) {
        sx += this.ax[m]; sy += this.ay[m]; n++;
        if (myDist < 65535) {
          const mDist = this.civField[this.idx(this.ax[m] | 0, this.ay[m] | 0)];
          if (mDist < 65535 && mDist - myDist > maxBehind) maxBehind = mDist - myDist;
        }
      }
      if (n) {
        const ddx = (sx / n - x) * M, ddy = (sy / n - y) * M, d = hyp(ddx, ddy);
        if (d > 1 && d < 45) {
          const pull = this.civWep[k] > 0 && this.civAmmo[k] > 0 ? 1.15 : 0.9;
          const p = Math.min(2.4, pull * (d - 1));
          fx += (ddx / d) * p; fy += (ddy / d) * p;
        }
        if (maxBehind >= 2 * FIELD_STEP && maxBehind <= 25 * FIELD_STEP && this.zStim[k] < 0.5) famWait = true;
      }
    }
    // --- 0.37: armed civilian self-defense on the street (finite ammo, panic degrades aim, gunfire draws infected)
    if (this.outbreak && this.civWep[k] > 0 && this.civAmmo[k] > 0 && (!safe || this.breaches > 0)) {
      this.civCd[k] -= dt;
      if (this.civCd[k] <= 0 && (this.zStim[k] > 0 || (k + this.tick) % 4 === 0)) {
        const wep = C.CIV_WEAPONS[this.civWep[k] as C.CivWeaponId];
        const t = this.civTarget(k, x, y, wep.range);
        if (t < 0) this.civCd[k] = 0.15;
        else {
          this.civAmmo[k]--;
          this.civCd[k] = (1 / wep.rate) * (0.85 + r() * 0.3);
          if (this.time - this.lastShotNote[k] >= 10) { this.lastShotNote[k] = this.time; this.note(k, EV_SHOT); } // 0.39: once per 10 s in the story
          this.civShotT[k] = this.time; this.lastCivShotT = this.time; this.lastCivShotX = x; this.lastCivShotY = y;
          const tx = this.ax[t], ty = this.ay[t], dist = hyp(tx - x, ty - y) || 1;
          const hitP = wep.accuracy * (1 - C.CIV_FEAR_AIM_PENALTY * f);
          if (r() < hitP) {
            if (this.shots.length < 4000) this.shots.push({ x0: x, y0: y, x1: tx, y1: ty, t: this.time, land: this.time + Math.max(0.04, dist * C.CELL_M / 900), cls: SHOT_SMALL, kind: "militia" });
            this.hp[t] -= wep.damage;
            if (this.hp[t] <= 0) { this.state[t] = DEAD; this.civKills++; this.recordKill(t, undefined, "civilian"); }
          } else {
            const baseAng = Math.atan2(ty - y, tx - x), errAng = (r() < 0.5 ? -1 : 1) * (0.12 + 0.28 * f);
            const mDist = dist * (0.85 + r() * 0.35), mx = x + Math.cos(baseAng + errAng) * mDist, my = y + Math.sin(baseAng + errAng) * mDist;
            if (this.shots.length < 4000) this.shots.push({ x0: x, y0: y, x1: mx, y1: my, t: this.time, land: this.time + Math.max(0.04, mDist * C.CELL_M / 900), cls: SHOT_SMALL, kind: "militia" });
            if (f > 0.6 && this.dev.friendlyFire && r() < C.CIV_FF_CHANCE) {
              const v = this.nearest(mx, my, 0.9, CIV);
              if (v >= 0 && v !== k && (this.famLead[v] < 0 || this.famLead[v] !== this.famLead[k])) {
                this.state[v] = DEAD; this.civWep[v] = 0; this.civAmmo[v] = 0; this.civFriendlyFire++; this.note(v, EV_FRIENDLY_FIRE); this.scare(this.ax[v], this.ay[v], 5, 0.85);
              }
            }
          }
        }
      }
    }
    // --- where they want to go
    let dx = 0, dy = 0, wander = false, queue = false, hold = false;
    if (this.act[k] === 1) { dx = this.hx[k]; dy = this.hy[k]; }
    else {
      let meetHold = false;
      if (safe && this.dayLife && this.plan[k] === PLAN_MEET) { // 0.40: waiting in the zone for the family: not in the lift queue yet
        this.planT[k] += dt;
        if ((k + this.tick) % 10 === 0 && this.meetDone(k)) { this.plan[k] = PLAN_STRAIGHT; this.note(k, EV_FAMILY_TOGETHER); }
        else if (this.planT[k] > C.GATHER_WAIT_S) this.giveUp(k);
        else meetHold = true;
      }
      let routed = false;
      if (!safe && this.dayLife && this.plan[k] >= PLAN_GATHER && this.plan[k] !== PLAN_MEET) { // 0.40: a family errand
        const d = this.errand(k, x, y, f, dt);
        if (d === ERRAND_HOLD) { hold = true; routed = true; }
        else if (d) { const a = C.AIM_SWAY * Math.sin(this.time * 0.3 + k * 2.399963), ca = Math.cos(a), sa = Math.sin(a); dx = d[0] * ca - d[1] * sa; dy = d[0] * sa + d[1] * ca; routed = true; }
      }
      if (safe) { // just inside: walk on in, away from the gate
        const pf = this.hasPads && this.inZone[ci] === 1 && !meetHold ? this.padField[ci] : 65535;
        const d = this.inZone[ci] !== 1 ? (this.routeAt(this.civDir, x, y) ? [this.rdx, this.rdy] : null)
          : (pf !== 65535 && pf > C.EVAC_GATHER_D ? (queue = true, this.downhill(this.padGo, cx, cy)) : null) // on to the Evac Point (a queue: they stop where it's full)
            ?? (this.depth[ci] < C.GATE_CLEAR_DEPTH ? this.inward(cx, cy) : null); // clear of the gate; deeper in they settle
        if (d) { const a = C.AIM_SWAY * Math.sin(this.time * 0.3 + k * 2.399963), ca = Math.cos(a), sa = Math.sin(a); dx = d[0] * ca - d[1] * sa; dy = d[0] * sa + d[1] * ca; }
        else if (this.dens[ci] > C.SETTLE_DENS * C.CELL_M * C.CELL_M) { // nowhere to be: move off toward emptier ground, filling the zone evenly
          this.spread(cx, cy);
          if (hyp(this.spx, this.spy) > 0.05) { dx = this.spx; dy = this.spy; queue = true; }
        }
      } else if (!routed && this.zoneClosed && this.routeAt(this.civDir, x, y)) {
        const a = C.AIM_SWAY * Math.sin(this.time * (0.15 + 0.25 * ((k * 0.754877666) % 1)) + k * 2.399963), ca = Math.cos(a), sa = Math.sin(a);
        dx = this.rdx * ca - this.rdy * sa; dy = this.rdx * sa + this.rdy * ca;
      }
      const zs = this.zStim[k];
      if (zs > 0 && !(routed && this.plan[k] === PLAN_GO_BACK)) { dx += this.hx[k] * zs * 1.5; dy += this.hy[k] * zs * 1.5; } // (0.43: not while going back for them)
      if (dx === 0 && dy === 0 && !hold) {
        if (r() < 0.02) { const a = r() * 6.283; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); }
        dx = this.hx[k]; dy = this.hy[k]; wander = true;
      }
      if (hn && f > 0.5) { // herding: a panicked person goes where the people around them go
        const hl = hyp(hvx, hvy);
        if (hl > 1e-3) { const q = C.HERD_MAX * (f - 0.5) / 0.5, dl = hyp(dx, dy) || 1; dx = dx / dl * (1 - q) + hvx / hl * q; dy = dy / dl * (1 - q) + hvy / hl * q; }
      }
    }
    // 0.32: an evacuation is a hurry, not a stroll: on the way to a pad people jog (speed only;
    // fear, and with it panic, crush and herding, stays as it was)
    const hurry = safe ? (queue || this.inZone[ci] !== 1 ? C.EVAC_HURRY : 0) : C.EVAC_HURRY_OUT;
    let v0 = this.pspd[k] * (C.CIV_SPEED + Math.max(f, hurry) * (C.CIV_SPRINT - C.CIV_SPEED));
    if (this.dayLife && k < this.civN) v0 *= AGE_PACE[this.age[k]]; // 0.42: pace by age
    v0 *= infra === INFRA_HIGHWAY ? C.HIGHWAY_SPEED_MUL : infra === INFRA_RAIL || infra === INFRA_STATION ? C.RAIL_SPEED_MUL : 1;
    if (this.rough[ci]) v0 *= this.roughMul(ci);
    // speed is set by the space in front of them (Weidmann), not by the crowd behind
    const dl0 = hyp(dx, dy) || 1, fcx = (x + (dx / dl0) * 0.9) | 0, fcy = (y + (dy / dl0) * 0.9) | 0;
    const rhoF = fcx >= 0 && fcy >= 0 && fcx < w && fcy < this.h && walkable(this.map.tile[fcy * w + fcx]) && fcy * w + fcx !== ci ? this.dens[fcy * w + fcx] / (M * M) : this.dens[ci] / (M * M); // the front of a jam sees open space and goes
    const rmax = queue ? C.WAIT_RHO * 1.5 : C.RHO_MAX + (C.PANIC_RHO_MAX - C.RHO_MAX) * f;
    const rv = C.SPEED_RHO_CELL ? rhoF : rho;
    if (rv > 0.05) v0 *= rv >= rmax ? 0 : Math.max(0, 1 - Math.exp(-C.RHO_GAMMA * (1 / rv - 1 / rmax)));
    // faster is slower (Helbing 2000): a panicked crowd pushing into a packed opening jams; bodies wedge and arch
    if (f > 0.3 && rv > C.CLOG_RHO) v0 /= 1 + C.PANIC_CLOG * (f - 0.3) * (rv - C.CLOG_RHO);
    if (this.act[k] === 2) v0 = 0;
    if (wander) v0 *= safe ? 0.25 : 0.5; // the waiting crowd mostly stands and shuffles
    if (byVeh) v0 *= C.VEH_SLOW; // 0.33: right beside a tank: they edge around it, not sprint
    if (famWait) v0 *= C.GROUP_WAIT_MUL; // 0.37: wait slightly for a family member who fell behind
    if (hold && this.zStim[k] <= 0) v0 = 0; // 0.40: waiting at home or school, or getting ready to leave
    if (this.time - this.civShotT[k] < C.CIV_SHOOT_PAUSE_S) v0 *= C.CIV_SHOOT_SLOW; // 0.37: pause briefly to aim and fire
    const dl = hyp(dx, dy) || 1;
    // --- steer: relax toward the wanted velocity, add the pushes (m/s2 -> cells/s2)
    const fl = hyp(fx, fy); if (fl > 12) { fx *= 12 / fl; fy *= 12 / fl; }
    const tau = C.CROWD_TAU + (C.PANIC_TAU - C.CROWD_TAU) * f, kr = Math.min(1, dt / tau);
    let vx = this.velX[k] + ((dx / dl) * v0 - this.velX[k]) * kr + (fx / M) * dt;
    let vy = this.velY[k] + ((dy / dl) * v0 - this.velY[k]) * kr + (fy / M) * dt;
    const vl = hyp(vx, vy), vmax = C.CIV_SPRINT * 1.3;
    if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
    // --- move, overlap push-out, walls are solid; never ride a wall's edge
    const ol = hyp(ox, oy), oc = Math.min(0.1, ol / M), oxs = ol > 1e-6 ? (ox / ol) * oc : 0, oys = ol > 1e-6 ? (oy / ol) * oc : 0;
    this.moveCiv(k, x, y, vx, vy, oxs, oys, dt0, safe);
  }

  private moveCiv(k: number, x: number, y: number, vx: number, vy: number, oxs: number, oys: number, dt: number, safe: boolean) {
    this.vehEsc = this.occ[this.idx(x | 0, y | 0)] === 2; // 0.33: caught at a tank's edge: they can shuffle out across its cells
    let nx = Math.fround(x + vx * dt + oxs), ny = Math.fround(y);
    if (!this.civOk(nx, ny, safe)) { nx = x; vx = 0; }
    ny = Math.fround(y + vy * dt + oys);
    if (!this.civOk(nx, ny, safe)) { ny = y; vy = 0; }
    const ncx = nx | 0, ncy = ny | 0, mn = C.WALL_MIN / C.CELL_M;
    if (nx - ncx < mn && !this.civOk(ncx - 0.5, ny, safe)) { nx = ncx + mn; if (vx < 0) vx = 0; }
    else if (ncx + 1 - nx < mn && !this.civOk(ncx + 1.5, ny, safe)) { nx = ncx + 1 - mn; if (vx > 0) vx = 0; }
    if (ny - ncy < mn && !this.civOk(nx, ncy - 0.5, safe)) { ny = ncy + mn; if (vy < 0) vy = 0; }
    else if (ncy + 1 - ny < mn && !this.civOk(nx, ncy + 1.5, safe)) { ny = ncy + 1 - mn; if (vy > 0) vy = 0; }
    this.ax[k] = Math.fround(nx); this.ay[k] = Math.fround(ny);
    this.velX[k] = vx; this.velY[k] = vy;
    if (safe) return;
    const z = this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)];
    if (z === 1 || z === 3) { this.state[k] = SAFE_CIV; this.noteSafe(k); } // a gate is a guarded checkpoint
  }

  private mill(k: number, r: () => number, dt: number) {
    const sqz = this.padSqueeze.length ? this.padSqueeze : null;
    const here = this.idx(this.ax[k] | 0, this.ay[k] | 0);
    if (this.occ[here] && !(sqz && sqz[here])) { // 0.24: step out from under a unit (unless squeezing past it, 0.27)
      for (let rr = 1; rr <= 5; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const x = (this.ax[k] | 0) + dx, y = (this.ay[k] | 0) + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = this.idx(x, y);
        if (!this.occ[i] && this.inZone[i] === 1 && walkable(this.map.tile[i])) { this.ax[k] = x + 0.5; this.ay[k] = y + 0.5; return; }
      }
      return;
    }
    let sp = C.CIV_SPEED * 0.35 * dt;
    const e = this.breaches && (k + this.tick) % 8 === 0 ? this.nearest(this.ax[k], this.ay[k], C.CIV_SENSE, INF) : -1;
    if (e >= 0) {
      const dx = this.ax[k] - this.ax[e], dy = this.ay[k] - this.ay[e], l = hyp(dx, dy) || 1;
      this.hx[k] = dx / l; this.hy[k] = dy / l; this.hp[k] = 2;
    }
    if (this.hp[k] > 0) { this.hp[k] -= dt; sp = C.CIV_SPRINT * dt; }
    else if (r() < 0.05) { const a = r() * 6.283; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); }
    const ci = this.idx(this.ax[k] | 0, this.ay[k] | 0);
    let clearing = false;
    if (this.inZone[ci] !== 1) { // still in the gateway (or on a broken wall): step inside
      const d = this.downhill(this.civField, this.ax[k] | 0, this.ay[k] | 0);
      if (d) { this.hx[k] = d[0]; this.hy[k] = d[1]; }
      clearing = true;
    } else if (this.depth[ci] < C.GATE_CLEAR_DEPTH && this.hp[k] <= 0) { // 0.28: just inside: keep walking in
      const d = this.inward(this.ax[k] | 0, this.ay[k] | 0);
      if (d) { this.hx[k] = d[0]; this.hy[k] = d[1]; clearing = true; }
    }
    if (clearing) {
      sp = Math.max(sp, C.CIV_SPEED * dt);
      const dn = this.dens[ci];
      if (dn > C.CIV_JAM_DENS) sp *= Math.max(0.35, C.CIV_JAM_DENS / dn);
    }
    // 0.22: people know where the Evac Points are and walk the zone's streets to the nearest one
    const pf = this.hasPads && this.inZone[ci] === 1 && this.hp[k] <= 0 ? this.padField[ci] : 65535;
    if (pf !== 65535 && pf > this.gatherD) {
      const d = this.downhill(this.padGo, this.ax[k] | 0, this.ay[k] | 0);
      if (d) { this.hx[k] = d[0]; this.hy[k] = d[1]; sp = C.CIV_SPEED * C.EVAC_WALK_MUL * dt; }
    }
    let hx = this.hx[k], hy = this.hy[k];
    if (clearing) {
      if (this.dens[ci] > 1) { this.grain(k, ci); hx += this.spx * C.GRAIN_PUSH; hy += this.spy * C.GRAIN_PUSH; }
      const l = hyp(hx, hy); if (l > 1) { hx /= l; hy /= l; }
    }
    if (this.inZone[ci] === 1 && this.hp[k] <= 0 && (pf === 65535 || (pf <= this.gatherD && this.dens[ci] > C.WAIT_RHO * C.CELL_M * C.CELL_M))) { this.spread(this.ax[k] | 0, this.ay[k] | 0); hx += this.spx * 1.5; hy += this.spy * 1.5; } // fill the zone evenly
    const nx = Math.fround(this.ax[k] + hx * sp), ny = Math.fround(this.ay[k] + hy * sp);
    const ok = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      const i = this.idx(x | 0, y | 0);
      if (i !== ci && this.dens[i] > C.MILL_MAX_DENS) return false; // 0.30: no piling into a packed cell
      return walkable(this.map.tile[i]) && (!this.occ[i] || (sqz !== null && sqz[i] === 1 && sqz[ci] === 1)) && (this.inZone[i] === 1 || i === ci || this.inZone[ci] !== 1 && this.inZone[i] === 3);
    };
    if (ok(nx, this.ay[k])) this.ax[k] = nx; else this.hx[k] = -this.hx[k];
    if (ok(this.ax[k], ny)) this.ay[k] = ny; else this.hy[k] = -this.hy[k];
  }

  private free(x: number, y: number, infected: boolean, swimmer = false) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.passable(this.idx(x | 0, y | 0), infected, swimmer);
  }

  private gnaw(cx: number, cy: number, dt: number) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const n = this.idx(nx, ny);
      const z = this.inZone[n];
      if ((z === 2 || z === 3) && this.wallHp[n] > 0) {
        if (this.gnawTick[n] !== this.tick) { this.gnawTick[n] = this.tick; this.gnawCnt[n] = 0; }
        if (this.gnawCnt[n] >= C.WALL_MAX_ATTACKERS) continue; // crowded: try another side
        this.gnawCnt[n]++;
        if (this.dev.wallDamage) { this.wallHp[n] -= C.WALL_DPS * dt; this.ping("wall", nx, ny); } // 0.48
        if (this.wallHp[n] <= 0) { this.wallHp[n] = -1; this.breaches++; this.fieldDirty = true; this.ping("breach", nx, ny); St.event(this.stats, St.SE_BREACH, this.time, nx, ny); }
        return;
      }
    }
  }

  private stepSupports(dt: number) {
    if (!this.supports.length) return;
    let aurasChanged = false;
    for (let i = this.supports.length - 1; i >= 0; i--) {
      const b = this.supports[i];
      if (b.extractT !== undefined) {
        b.extractT -= dt;
        if (b.extractT <= 0) {
          this.battleSpend -= b.paid;
          this.soldLog.push(b.kind);
          for (const u of this.units) if (u.parentSupport === b) u.ai = "leave";
          this.supports.splice(i, 1);
          aurasChanged = true;
        }
        continue;
      }
      if (b.deployT && b.deployT > 0) {
        b.deployT -= dt;
        if (b.deployT <= 0) { b.deployT = 0; aurasChanged = true; }
        else continue;
      }
      const spec = C.SUPPORTS[b.kind], R = spec.radius, R2 = R * R;
      if (b.kind === "evac") { this.stepEvac(b, dt); continue; }
      if (b.kind === "repair" && this.tick % 4 === 0) {
        const dt4 = dt * 4;
        const x0 = Math.max(0, b.x - R), x1 = Math.min(this.w - 1, b.x + R);
        const y0 = Math.max(0, b.y - R), y1 = Math.min(this.h - 1, b.y + R);
        for (let y = y0; y <= y1; y++) {
          const dy2 = (y - b.y) * (y - b.y);
          for (let x = x0; x <= x1; x++) {
            if ((x - b.x) * (x - b.x) + dy2 > R2) continue;
            const ci = y * this.w + x, z = this.inZone[ci];
            if ((z === 2 || z === 3) && this.wallHp[ci] > 0) {
              const maxHp = z === 3 ? this.gateMaxHp() : this.wallMaxHp();
              if (this.wallHp[ci] < maxHp) {
                if (this.wallHp[ci] < maxHp / 2) this.repairLow.add(ci); // 0.59: a section counts as repaired when it goes from under half to full
                this.wallHp[ci] = Math.min(maxHp, this.wallHp[ci] + C.REPAIR_WALL_HPS * this.yardMul() * dt4); // 0.60: engineers do most repairs
                if (this.wallHp[ci] >= maxHp && this.repairLow.delete(ci)) this.stats.c.repairs++;
              }
            }
          }
        }
        for (const u of this.units) {
          const max = C.maxHp(C.UNITS[u.kind]); // 0.24: emplacements too
          if (max === undefined || u.hp === undefined || u.hp <= 0 || u.hp >= max) continue;
          const dx = u.x - b.x, dy = u.y - b.y;
          if (dx * dx + dy * dy <= R2) u.hp = Math.min(max, u.hp + C.REPAIR_UNIT_HPS * this.yardMul() * dt4);
        }
      } else if (b.kind === "police" || b.kind === "militia") {
        let active = 0;
        for (const u of this.units) if (u.parentSupport === b && (u.hp === undefined || u.hp > 0) && u.ai !== "leave") active++;
        const maxSquads = b.kind === "police" ? C.POLICE_MAX_SQUADS : C.MILITIA_MAX_SQUADS;
        const spawnEvery = b.kind === "police" ? C.POLICE_SPAWN_S : C.MILITIA_SPAWN_S;
        if (active < maxSquads) {
          b.spawnT = (b.spawnT ?? 1.5) - dt;
          if (b.spawnT <= 0) {
            const spot = this.findSquadSpawn(b.x, b.y);
            if (spot) {
              const ukind: C.UnitKind = b.kind;
              const uspec = C.UNITS[ukind];
              this.units.push({
                kind: ukind, x: spot[0], y: spot[1], range: uspec.range, ammo: uspec.ammo,
                cooldown: 0.3, kills: 0, shotX: 0, shotY: 0, shotT: -1,
                mode: ukind === "militia" ? "wall" : "civ",
                post: [spot[0], spot[1]], hp: uspec.mobile!.hp, ai: "hunt", thinkT: 0, parentSupport: b,
                soldiers: this.squadFor(ukind, spot[0], spot[1]), // 0.52: officers / militiamen are people (dots that can be bitten)
              });
              aurasChanged = true;
            }
            b.spawnT = spawnEvery;
          }
        } else {
          b.spawnT = spawnEvery;
        }
      }
    }
    if (aurasChanged) this.refreshAuras();
  }

  /** Evac Point: a lift comes in on a timer, waves off if the pad is swarmed, else flies a load of people out. */
  private stepEvac(b: Support, dt: number) {
    const x = b.x + 0.5, y = b.y + 0.5;
    if (b.pickupAt !== undefined) {
      if (this.time < b.pickupAt) return;
      b.pickupAt = undefined;
      // 0.34: only infected inside the zone (or in its gates) wave a lift off; a crowd outside a wall or gate is no
      // threat to the pad (a pad near the east gates on Ashford waved off six lifts in a row)
      if (this.countInf(x, y, C.SUPPORTS.evac.radius, C.EVAC_ABORT_INF, false, true) >= C.EVAC_ABORT_INF) {
        // 0.49: with nobody waiting at the pad the lift just stands down: no wave-off counted, no alert (a fallen
        // zone used to rack up a wave-off every 6 s per pad for the rest of the battle)
        if (!this.anySafeNear(x, y, C.SUPPORTS.evac.radius)) { b.liftT = C.EVAC_EVERY_S * 0.5; return; }
        this.liftsAborted++; this.liftLog.push({ kind: "abort", n: 0, x: b.x, y: b.y }); St.event(this.stats, St.SE_LIFT_ABORT, this.time, b.x, b.y); this.ping("abort", b.x, b.y); // 0.48
        b.liftT = C.EVAC_EVERY_S * 0.5; return;
      }
      // load the people nearest the pad, inside the zone
      const cap = Math.round(C.EVAC_CAP * this.popMul), R = C.SUPPORTS.evac.radius;
      let n = 0;
      for (let rr = 4; rr <= R && n < cap; rr += 4) {
        const b0x = Math.max(0, ((x - rr) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + rr) / BUCKET) | 0);
        const b0y = Math.max(0, ((y - rr) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + rr) / BUCKET) | 0);
        for (let by = b0y; by <= b1y && n < cap; by++) for (let bx = b0x; bx <= b1x && n < cap; bx++)
          for (let k = this.headC[by * this.bw + bx]; k !== -1 && n < cap; k = this.next[k]) {
            if (this.state[k] !== SAFE_CIV) continue;
            const dx = this.ax[k] - x, dy = this.ay[k] - y;
            if (dx * dx + dy * dy > rr * rr) continue;
            this.state[k] = DEAD; n++; this.note(k, EV_EVAC); // flown out
          }
      }
      this.evacuated += n; this.liftsFlown++;
      St.event(this.stats, St.SE_LIFT, this.time, b.x, b.y, n); // 0.57
      if (this.dev.income) this.evacPay += n * C.EVAC_PAY * this.incomeMul / this.popMul;
      this.liftLog.push({ kind: "ok", n, x: b.x, y: b.y });
      b.liftT = C.EVAC_EVERY_S;
      return;
    }
    b.liftT = (b.liftT ?? 2) - dt;
    if (b.liftT > 0) return;
    // inbound: a Chinook flies in, sets down for a moment, flies out
    b.pickupAt = this.time + 3;
    this.spawnHelo("helo_ch47", x, y, 6, 1.5, C.SUPPORTS.evac.color, "EVAC LIFT");
  }

  /** 0.22: walking distance inside the zone to the nearest active Evac Point (65535 = no pad reachable). */
  padField = new Uint16Array(0);
  private padQ = new Int32Array(0);
  private buildPadField() {
    const cells = this.w * this.h;
    if (this.padField.length !== cells) { this.padField = new Uint16Array(cells); this.padQ = new Int32Array(cells); }
    const f = this.padField, q = this.padQ;
    f.fill(65535);
    let qh = 0, qt = 0;
    const padSeeds: { b: Support; from: number; to: number }[] = [];
    for (const b of this.supports) {
      if (b.kind !== "evac" || b.extractT !== undefined || (b.deployT && b.deployT > 0)) continue;
      const from = qt;
      // the street cells around the pad's building. 0.34: the nearest ring of street around the footprint, out to
      // EVAC_SEED_D cells (a pad set in the middle of a wide block had no street within 2 cells of its centre, so
      // nobody walked to it and its lifts flew out empty: an Ashford pad at 203,241)
      const [x0, y0, x1, y1] = this.footRect(C.SUPPORTS.evac.foot, b.x, b.y);
      for (let d = 0, found = false; d <= C.EVAC_SEED_D && !found; d++) {
        for (let y = y0 - d; y <= y1 + d; y++) for (let x = x0 - d; x <= x1 + d; x++) {
          if (d && x > x0 - d && x < x1 + d && y > y0 - d && y < y1 + d) continue; // this ring only
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const i = this.idx(x, y);
          if (this.inZone[i] === 1 && walkable(this.map.tile[i])) { found = true; if (f[i] === 65535) { f[i] = 0; q[qt++] = i; } }
        }
      }
      if (qt > from) padSeeds.push({ b, from, to: qt });
    }
    // 0.27: first around the units (people never walk into a howitzer when there is a way past it)...
    const sq = this.padSqueeze.length === cells ? this.padSqueeze : (this.padSqueeze = new Uint8Array(cells));
    sq.fill(0);
    const open = (n: number) => n >= 0 && n < cells && f[n] === 65535 && this.inZone[n] === 1 && walkable(this.map.tile[n]);
    while (qh < qt) {
      const c = q[qh++], cx = c % this.w, d = f[c] + 1;
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (!open(n) || this.occ[n]) continue;
        f[n] = d; q[qt++] = n;
      }
    }
    const seedCells = q.slice(0, qt);
    // 0.30: the street cells around the pads in order of distance, so the waiting area can be sized to its crowd
    this.padRing = new Uint16Array(qt); for (let i = 0; i < qt; i++) this.padRing[i] = f[q[i]];
    // ...then, for anyone a unit has cut off, squeezing past it (dearer, so only the cut-off side uses it)
    const seeds: number[] = [];
    for (let i = 0; i < qt; i++) {
      const c = q[i], cx = c % this.w;
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (!open(n) || !this.occ[n]) continue;
        f[n] = Math.min(65534, f[c] + C.SQUEEZE_COST); sq[n] = 1; seeds.push(n);
      }
    }
    if (seeds.length) {
    seeds.sort((x, y) => f[x] - f[y]);
    qh = 0; qt = 0;
    for (const n of seeds) q[qt++] = n;
    while (qh < qt) {
      const c = q[qh++], cx = c % this.w, d = Math.min(65534, f[c] + 1);
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (!open(n)) continue;
        f[n] = d; sq[n] = 1; q[qt++] = n;
      }
    }
    }
    this.buildPadGo(padSeeds, seedCells);
  }
  /** 0.34: which pad to walk to. People pick the pad that gets them out soonest, not just the nearest: a pad's
   *  crowd counts as extra walking (EVAC_LOAD_CELLS per full lift already waiting there), so once one pad has a
   *  queue the people behind it head for an emptier pad in the zone (playtest: "actively and urgently look for the evac
   *  point"). padField stays the plain walking distance (who is standing at a pad); padGo only steers. */
  padGo = new Uint16Array(0);
  private buildPadGo(pads: { b: Support; from: number; to: number }[], seedCells: Int32Array) {
    const cells = this.w * this.h, f = this.padField;
    if (pads.length < 2) { this.padGo = f; return; }
    if (this.padGo.length !== cells || this.padGo === f) this.padGo = new Uint16Array(cells);
    const g = this.padGo, q = this.padQ, cap = Math.max(1, Math.round(C.EVAC_CAP * this.popMul)), R = C.SUPPORTS.evac.radius * C.EVAC_LOAD_R;
    g.fill(65535);
    // each pad's crowd: people in the zone around it
    const load = pads.map(({ b }) => {
      const x = b.x + 0.5, y = b.y + 0.5;
      const b0x = Math.max(0, ((x - R) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + R) / BUCKET) | 0);
      const b0y = Math.max(0, ((y - R) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + R) / BUCKET) | 0);
      let n = 0;
      for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
        for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
          if (this.state[k] !== SAFE_CIV) continue;
          const dx = this.ax[k] - x, dy = this.ay[k] - y;
          if (dx * dx + dy * dy <= R * R) n++;
        }
      return Math.min(C.EVAC_LOAD_MAX, Math.round((n / cap) * C.EVAC_LOAD_CELLS));
    });
    const order = pads.map((_, i) => i).sort((p0, p1) => load[p0] - load[p1]);
    // breadth-first, level by level, from every pad's street; each pad's street joins at the level of its crowd cost
    const nxt = this.padGoQ.length === cells ? this.padGoQ : (this.padGoQ = new Int32Array(cells));
    let cur = q, curN = 0, oi = 0, d = load[order[0]];
    while (curN || oi < order.length) {
      while (oi < order.length && load[order[oi]] <= d) {
        const p = pads[order[oi++]];
        for (let j = p.from; j < p.to; j++) { const c = seedCells[j]; if (g[c] > d) { g[c] = d; cur[curN++] = c; } }
      }
      if (!curN) { d = load[order[oi]]; continue; }
      const out = cur === q ? nxt : q;
      let outN = 0;
      const d1 = d + 1;
      if (d1 >= 65535) break;
      for (let i = 0; i < curN; i++) {
        const c = cur[i], cx = c % this.w;
        if (g[c] !== d) continue;
        for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
          if (n < 0 || n >= cells || f[n] === 65535 || g[n] <= d1) continue;
          g[n] = d1; out[outN++] = n;
        }
      }
      cur = out; curN = outN; d = d1;
    }
  }
  private padGoQ = new Int32Array(0);
  /** 0.27: cells whose way to an Evac Point squeezes past a unit (a unit plugs the street). */
  padSqueeze = new Uint8Array(0);

  private findSquadSpawn(bx: number, by: number): [number, number] | null {
    for (const insideFirst of [true, false]) {
      for (let r = 1; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = bx + dx, y = by + dy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const i = this.idx(x, y);
          if (!walkable(this.map.tile[i])) continue;
          if (insideFirst && this.inZone[i] !== 1) continue;
          return [x, y];
        }
      }
    }
    return null;
  }

  private fireUnits(dt: number) {
    if (this.shots.length) { let i = 0; while (i < this.shots.length && this.time - this.shots[i].land > 0.25) i++; if (i) this.shots.splice(0, i); }
    if (this.impacts.length) {
      const due = this.impacts.filter(m => m.t <= this.time);
      if (due.length) {
        this.impacts = this.impacts.filter(m => m.t > this.time);
        for (const m of due) {
          const k0 = this.kills;
          this.areaDamage(m.x, m.y, m.r, m.dmg, false, m.u, m.maxHits);
          if (m.gren) this.stats.c.grenadierKills += this.kills - k0; // 0.59
          // 0.38: direct-fire shells (tank, APC, Apache, Reaper) still fire near the zone but don't crater or wreck
          // buildings inside the no-fire band; artillery never aims into it (farTarget)
          if (C.UNITS[m.u.kind].minRange || !this.inNoFire(m.x, m.y)) this.damageTerrain(m.x, m.y, m.r, m.sDmg);
          this.blasts.push({ x: m.x, y: m.y, r: m.r, t: this.time, color: m.color });
        }
      }
    }
    for (const u of this.units) {
      u.cooldown -= dt;
      const spec = C.UNITS[u.kind];
      if (u.extractT !== undefined) {
        u.extractT -= dt;
        if (spec.mobile && spec.mobile.hp !== Infinity && !u.fort && (this.tick + u.post![0]) % 4 === 0) u.hp! -= this.dev.unitDamage ? this.countInf(u.x + 0.5, u.y + 0.5, 1.3, 12) * C.MOBILE_HURT_DPS * dt * 4 : 0;
        if (u.extractT <= 0 && (u.hp === undefined || u.hp > 0)) { u.hp = -1; this.unitsLost--; this.battleSpend -= u.paid ?? spec.cost; this.soldLog.push(u.kind); }
        continue;
      }
      if (u.deployT && u.deployT > 0) { u.deployT -= dt; if (u.deployT <= 0) { u.deployT = 0; this.refreshAuras(); } else continue; }
      if (spec.ammo !== Infinity) this.ammoState(u, spec.ammo, dt); // 0.60
      // 0.24: infected pressing on a street emplacement claw at it like a wall (it keeps shooting)
      if (!spec.mobile && spec.hp && u.hp !== undefined && u.hp > 0 && (this.tick + u.x) % 4 === 0 && this.dev.unitDamage && !this.onRoof(u)) {
        const [x0, y0, x1, y1] = this.footRect(spec.foot, u.x, u.y);
        const hurt = this.countInf((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, spec.foot * 0.7 + 1.2, 16) * C.MOBILE_HURT_DPS * dt * 4; // footprint plus the ring of cells around it
        u.hp -= hurt;
        if (hurt > 0) this.ping("unit", u.x, u.y); // 0.48
      }
      if (u.fort === "climb" || u.fort === "descend") { this.stepFort(u, dt); continue; } // 0.50: busy on the wall: no firing
      if (spec.mobile && !u.fort) { this.think(u, dt); if (u.ai === "home" || u.ai === "reload" || u.ai === "leave") continue; }
      if (u.standby) continue; // 0.45: stand by = hold fire
      if (u.soldiers) { this.fireSquad(u, dt); continue; } // 0.49: every soldier is a firing point
      while (u.cooldown <= 0 && u.ammo >= 1) {
        const t = spec.minRange ? this.farTarget(u, spec.minRange) : this.pickTarget(u);
        if (t < 0) { u.cooldown = 0; break; }
        u.cooldown += 1 / (spec.rate * (u.rateMul ?? 1));
        u.ammo -= 1;
        u.shotX = this.ax[t]; u.shotY = this.ay[t]; u.shotT = this.time;
        if (spec.splash) {
          const sDmg = u.kind === "howitzer" || u.kind === "himars" ? C.STRUCT_DMG_HOWITZER : u.kind === "battleship" ? C.STRUCT_DMG_BATTLESHIP : C.STRUCT_DMG_MORTAR;
          const rr = rng((this.tick * 40503 + t * 7 + 1) >>> 0); // deterministic scatter
          for (let k = 0; k < (spec.salvo ?? 1); k++) {
            // first shell on the target, the rest of a broadside scattered around it
            const a = rr() * Math.PI * 2, r = k ? spec.splash * (0.8 + rr() * 0.9) : 0;
            const sx = Math.min(this.w - 1, Math.max(0, this.ax[t] + Math.cos(a) * r)), sy = Math.min(this.h - 1, Math.max(0, this.ay[t] + Math.sin(a) * r));
            // 0.28: the shell flies, then explodes where it lands (salvos ripple out a beat apart)
            const rocket = u.kind === "himars" || u.kind === "reaper";
            const mps = u.kind === "mortar" ? 120 : u.kind === "reaper" ? 350 : rocket ? 300 : 250;
            // a ripple, not a wall of fire: battleship turrets a beat apart, HIMARS rockets leave the pod one by one
            const ripple = u.kind === "battleship" ? 0.45 : u.kind === "himars" ? 0.6 : 0.18;
            const fl = this.shoot(u, sx, sy, rocket ? SHOT_ROCKET : SHOT_SHELL, mps, k * ripple);
            this.impacts.push({ x: sx, y: sy, r: spec.splash, dmg: spec.damage, maxHits: spec.maxHits, sDmg, u, t: this.time + fl, color: spec.color });
          }
          continue;
        }
        this.shoot(u, this.ax[t], this.ay[t], u.kind === "sniper" ? SHOT_SNIPER : SHOT_SMALL, SHOT_MPS[u.kind === "sniper" ? SHOT_SNIPER : SHOT_SMALL]);
        this.hp[t] -= spec.damage;
        if (this.hp[t] <= 0) { this.state[t] = DEAD; this.recordKill(t, u); }
      }
      const cn = spec.cannon;
      if (cn) {
        u.cooldown2 = (u.cooldown2 ?? 0) - dt;
        if (u.cooldown2 <= 0 && u.ammo >= 1) {
          const cr = cn.range * (u.range / spec.range);
          const walls = this.blockedByWalls(u.kind), eye = this.sightLine(u.kind) ? this.eyeOf(u) : -1;
          const t = walls || eye >= 0 ? this.nearestSeen(u.x + 0.5, u.y + 0.5, cr, walls, eye) : this.nearest(u.x + 0.5, u.y + 0.5, cr, INF, 255, 400);
          if (t < 0) u.cooldown2 = 0;
          else {
            u.cooldown2 += 1 / (cn.rate * (u.rateMul ?? 1));
            u.ammo -= 1;
            const sx = this.ax[t], sy = this.ay[t];
            this.shoot(u, sx, sy, SHOT_CANNON, SHOT_MPS[SHOT_CANNON]);
            this.areaDamage(sx, sy, cn.splash, cn.damage, false, u, cn.maxHits);
            this.blasts.push({ x: sx, y: sy, r: cn.splash, t: this.time, color: spec.color });
          }
        }
      }
    }
  }

  /** 0.52: a fortified squad that has not fired for ROOF_IDLE_S shuffles: now and then one soldier walks (slowly) to a
   *  free firing point of its building. Cosmetic; each soldier fires from wherever it stands. Stops when shooting starts. */
  private stepRoofShuffle(dt: number) {
    for (const u of this.units) {
      if (!u.soldiers || u.fort !== "up" && !(this.isFortified(u) && !C.UNITS[u.kind].mobile)) continue;
      const fb = u.fortBox ?? this.fortBoxOf(u); if (!fb) continue;
      const quiet = u.shotT === undefined || u.shotT < 0 || this.time - u.shotT > ROOF_IDLE_S; // shotT -1 = never fired
      for (const so of u.soldiers) {
        if (!so.alive || !so.to) continue;
        const tx = so.to[0] + 0.5, ty = so.to[1] + 0.5, dx = tx - so.x, dy = ty - so.y, d = hyp(dx, dy), st = ROOF_WALK * (quiet ? 1 : 1.6) * dt;
        if (d <= st) { so.x = tx; so.y = ty; so.to = undefined; } else { so.x += dx / d * st; so.y += dy / d * st; }
      }
      // 0.52.1 (design ruling): they jostle inside the sandbags all the time; in a fight each one shifts toward the side facing what
      // it shoots (a better firing position), when quiet they wander. One soldier picks a new spot every so often.
      if ((this.tick + Math.floor(u.x * 31)) % (quiet ? ROOF_SHUFFLE_TICKS : ROOF_SHUFFLE_TICKS / 2) !== 0) continue;
      const living = u.soldiers.filter(so => so.alive && !so.to);
      if (!living.length) continue;
      const roll = hash32(this.seed, this.tick * 977 + Math.floor(u.x) * 31 + Math.floor(u.y)) / 4294967296;
      const r2 = hash32(this.seed, this.tick * 131 + 7) / 4294967296;
      const so = living[Math.floor(roll * living.length) % living.length];
      const inset = fb[2] > 1 ? 0.35 : 0.3, lo = inset, hi = fb[2] - inset, cx = fb[0] + fb[2] / 2, cy = fb[1] + fb[2] / 2;
      let px: number, py: number;
      if (!quiet && this.time - so.shotT < ROOF_IDLE_S) { // toward its target's side, a little jitter so they don't stack
        const ax = so.shotX - cx, ay = so.shotY - cy, l = hyp(ax, ay) || 1, reach = (hi - lo) / 2;
        px = cx + ax / l * reach + (roll - 0.5) * 0.5; py = cy + ay / l * reach + (r2 - 0.5) * 0.5;
      } else { px = fb[0] + lo + roll * (hi - lo); py = fb[1] + lo + r2 * (hi - lo); }
      px = Math.max(fb[0] + lo, Math.min(fb[0] + hi, px)); py = Math.max(fb[1] + lo, Math.min(fb[1] + hi, py));
      so.to = [px - 0.5, py - 0.5]; // a spot inside the sandbags (to + 0.5 = position)
    }
  }
  /** 0.52.1: a rooftop squad's fortification (computed once for squads placed straight onto a roof). */
  fortBoxOf(u: Unit): [number, number, number] | null {
    if (u.fortBox) return u.fortBox;
    const x = Math.floor(u.x), y = Math.floor(u.y), id = this.buildingId[this.idx(x, y)];
    if (id < 0 || !u.soldiers) return null;
    const fb = fortBlock(this.buildingId, this.w, id, x, y, u.soldiers.length);
    return (u.fortBox = [fb.x, fb.y, fb.size]);
  }
  /** 0.52: open street across a heading at (x,y): cells to the nearest building or water on each side, summed (max 12). */
  streetWidth(x: number, y: number, hd: [number, number]): number {
    return this.sideRoom(x, y, -hd[1], hd[0]) + this.sideRoom(x, y, hd[1], -hd[0]) + 1;
  }
  /** 0.52: open cells from (x,y) along (px,py) before a building or water, up to 6. */
  private sideRoom(x: number, y: number, px: number, py: number): number {
    for (let k = 1; k <= 6; k++) { if (!this.openAt(x + px * k, y + py * k)) return k - 1; }
    return 6;
  }
  /** 0.52: people (out in the city or in the zone) within r of (x,y), up to cap. */
  private civNear(x: number, y: number, r: number, cap: number): number {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let n = 0;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y;
        if (dx * dx + dy * dy <= r * r && ++n >= cap) return n;
      }
    return n;
  }
  /** 0.49: the middle of a squad's living soldiers (the unit's point when it has none). */
  squadCenter(u: Unit): [number, number] {
    let x = 0, y = 0, n = 0;
    for (const so of u.soldiers ?? []) if (so.alive) { x += so.x; y += so.y; n++; }
    return n ? [x / n, y / n] : [u.x + 0.5, u.y + 0.5];
  }
  /** 0.49: ground squads: the unit's point moves as before (orders, hunting, fleeing); each soldier walks to their
   *  slot in a loose formation around it, a little faster than the squad so they keep up, never onto a roof or
   *  into the river (blocked: they slide along one axis, or go to the squad's point). */
  private stepSquadMoves(dt: number) {
    for (const u of this.units) {
      if (!u.soldiers || this.isFortified(u) || u.fort) continue; // 0.50: up, climbing or descending: no walking
      const sp = (C.UNITS[u.kind].mobile?.speed ?? 2.4) * 1.4 * dt, cx = u.x + 0.5, cy = u.y + 0.5;
      // 0.52: a fire team: wedge in the open, file in a narrow or crowded street, turned to the way it walks
      const hd: [number, number] = u.headX !== undefined ? [u.headX, u.headY ?? 0] : [0, 1], living = u.soldiers.filter(so => so.alive);
      const moving = u.movedT !== undefined && this.time - u.movedT < 0.6; // halted: close up into a wedge
      const narrow = moving && (this.streetWidth(cx, cy, hd) < 4 || this.civNear(cx, cy, 2.5, 8) >= 8);
      const form = fireTeamForm(hd[0], hd[1], living.length, narrow);
      let li = 0;
      u.soldiers.forEach((so) => {
        if (!so.alive) return;
        const [fx, fy] = form[li++];
        let tx = cx + fx, ty = cy + fy;
        if (!this.openAt(tx, ty)) { tx = cx; ty = cy; }
        const dx = tx - so.x, dy = ty - so.y, d = hyp(dx, dy);
        if (d < 0.05) return;
        const k = Math.min(1, sp / d), nx = so.x + dx * k, ny = so.y + dy * k;
        if (this.openAt(nx, ny)) { so.x = nx; so.y = ny; }
        else if (this.openAt(nx, so.y)) so.x = nx;
        else if (this.openAt(so.x, ny)) so.y = ny;
        // cut off behind a building corner for a while: they catch up along the squad's route (rejoin at its point)
        so.lag = d > 3 ? (so.lag ?? 0) + dt : 0;
        if (so.lag > 2) { so.x = cx; so.y = cy; so.lag = 0; }
      });
    }
  }
  private openAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const t = this.map.tile[this.idx(x | 0, y | 0)];
    return t !== BUILDING && t !== WATER;
  }
  /** 0.49: soldiers who turned (bitten in the street). */
  soldiersTurned = 0;
  /** 0.49: infected bite soldiers in the street (Paratroopers) like people; rooftop soldiers are out of reach
   *  (design ruling). A bitten soldier turns into a real infected; a squad with nobody left is lost (hp 0, the usual lost path). */
  private stepSquadBites(dt: number, infHpScale: number, r: () => number) {
    if (this.phase !== "battle" || !this.dev.bites) return;
    for (const u of this.units) {
      if (!u.soldiers || u.extractT !== undefined || u.hp === -1) continue;
      const living = u.soldiers.filter(so => so.alive);
      if (!living.length) continue;
      const spec = C.UNITS[u.kind];
      if (this.isFortified(u) || u.fort === "descend") continue; // Design ruling: rooftop soldiers can't be bitten (0.50: climbing ones can)
      if ((this.tick + Math.floor(u.x)) % 3 === 0) { // 0.50: u.x is fractional once a squad has walked (it was never bitten then)
        for (const so of living) {
          if (this.nearest(so.x, so.y, C.BITE_RANGE, INF, 255, 20) < 0) continue;
          if (r() < BITE_P3 * C.SOLDIER_BITE_MUL) this.turnSoldier(u, so, infHpScale);
        }
      }
      const left = u.soldiers.filter(so => so.alive).length;
      if (!left) u.hp = 0; // lost: removed with the units filter, counted once
      else if (spec.mobile) u.hp = spec.mobile.hp * left / u.soldiers.length; // the squad's strength (its AI flees when hurt)
    }
  }
  /** 0.49: a bitten soldier turns where they stand (at the nearest open cell). */
  private turnSoldier(u: Unit, so: Soldier, infHpScale: number) {
    so.alive = false; this.soldiersTurned++;
    let x = so.x, y = so.y;
    if (this.tileAt(x | 0, y | 0) === BUILDING) {
      let bd = Infinity;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const cx = (so.x | 0) + dx, cy = (so.y | 0) + dy;
        if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h || !walkable(this.map.tile[this.idx(cx, cy)])) continue;
        const d = dx * dx + dy * dy; if (d < bd) { bd = d; x = cx + 0.5; y = cy + 0.5; }
      }
    }
    this.spawnInfected(x, y, C.INF_HP * infHpScale * this.infHpMul);
    this.scare(x, y, 8, 0.95);
    this.ping("unit", so.x, so.y);
  }
  /** 0.49: replace one lost soldier (in battle) for 1/N of what the squad first cost. Rooftop replacements take the
   *  fallen soldier's spot; ground ones join at the squad's middle. */
  topUp(u: Unit): string | null {
    if (!u.soldiers) return "Only squads can be topped up.";
    const dead = u.soldiers.find(so => !so.alive);
    if (!dead) return "The squad is at full strength.";
    if (this.phase !== "battle" || u.extractT !== undefined || u.hp === -1) return "Squads are topped up during the battle.";
    const base = u.squadPaid ?? u.paid ?? C.UNITS[u.kind].cost, cost = Math.round(base / u.soldiers.length);
    if (this.remaining() < cost) return "Not enough money.";
    const st = soldierStats(u.kind, dead.role);
    if (this.isFortified(u)) { // 0.50 review I2: back on the squad's roof (it may have died down on the street)
      const id = this.buildingId[this.idx(Math.floor(u.x), Math.floor(u.y))], i = u.soldiers.indexOf(dead);
      const slot = fortBlock(this.buildingId, this.w, id, Math.floor(u.x), Math.floor(u.y), u.soldiers.length).slots[i]; // 0.52.1
      dead.x = slot[0] + 0.5; dead.y = slot[1] + 0.5;
    } else [dead.x, dead.y] = this.squadCenter(u);
    Object.assign(dead, { alive: true, hp: st.hp, ammo: st.ammo, cooldown: 0.5, lag: 0 });
    u.squadPaid = base; u.paid = (u.paid ?? base) + cost; this.pay(cost); this.stats.c.topUps++;
    const spec = C.UNITS[u.kind];
    if (spec.mobile) u.hp = spec.mobile.hp * u.soldiers.filter(so => so.alive).length / u.soldiers.length;
    return null;
  }
  /** 0.50: a ground Troops/Sniper squad: endless ammo inside a zone; leaving one it carries the full pool
   *  (spec.ammo) and fights it down; walking back into a zone refills it. */
  /** 0.60: a battery reloads from its own reserve; a supplied unit that runs dry says so once (ping, event). */
  private ammoState(u: Unit, mag: number, dt: number) {
    if (u.ammo >= 1) { u.dry = false; return; }
    if (u.dry && u.sid !== undefined && this.stats.units[u.sid]) this.stats.units[u.sid].dryS = (this.stats.units[u.sid].dryS ?? 0) + dt; // 0.60: time out of ammo
    if (u.reserve && u.reserve > 0) {
      u.resT = (u.resT ?? C.APC_RELOAD_S) - dt;
      if (u.resT <= 0) { const n = Math.min(mag, u.reserve); u.reserve -= n; u.ammo += n; u.resT = undefined; u.dry = false; }
      return;
    }
    if (!u.dry && Sup.ammoClass(u.kind)) { u.dry = true; this.ping("ammo", u.x, u.y); St.event(this.stats, St.SE_OUT_OF_AMMO, this.time, u.x, u.y, u.sid ?? -1); }
  }
  /** 0.49: the squad's soldiers still standing. */
  livingSoldiers(u: Unit): Soldier[] { return u.soldiers ? u.soldiers.filter(so => so.alive) : []; }
  /** 0.49: each living soldier picks and shoots their own target from their own spot. The squad shares one ammo
   *  pool (u.ammo: endless in a zone, refilled by drops and depots as before) until 0.50 supply. Range and rate
   *  boosts on the unit apply to every soldier. */
  private fireSquad(u: Unit, dt: number) {
    const spec = C.UNITS[u.kind], boost = u.range / spec.range;
    for (const so of u.soldiers!) {
      if (!so.alive) continue;
      const st = soldierStats(u.kind, so.role);
      so.cooldown -= dt;
      if (so.role === "grenadier" && (so.grenades ?? 0) > 0) { // 0.53: an M320 round into the biggest pack in range
        so.gCool = (so.gCool ?? 0) - dt;
        if (so.gCool <= 0) {
          const t = this.packTarget(so.x, so.y, st.range * boost);
          if (t) {
            so.grenades!--; so.gCool = C.GREN_EVERY_S;
            const fl = this.shoot(u, t[0], t[1], SHOT_SHELL, 75, 0, so.x, so.y);
            so.shotX = u.shotX = t[0]; so.shotY = u.shotY = t[1]; so.shotT = u.shotT = this.time;
            this.impacts.push({ x: t[0], y: t[1], r: C.GREN_SPLASH, dmg: C.GREN_DMG, maxHits: C.GREN_MAX_HITS, sDmg: 0, u, t: this.time + fl, color: "#ffb74d", gren: true });
            continue; // the launcher this beat, not the rifle
          }
        }
      }
      while (so.cooldown <= 0 && u.ammo >= 1) {
        const t = this.pickTarget(u, so.x, so.y, st.range * boost);
        if (t < 0) { so.cooldown = 0; break; }
        so.cooldown += 1 / (st.rate * (u.rateMul ?? 1));
        u.ammo -= 1;
        const cls = so.role === "sniper" ? SHOT_SNIPER : SHOT_SMALL;
        so.shotX = u.shotX = this.ax[t]; so.shotY = u.shotY = this.ay[t]; so.shotT = u.shotT = this.time;
        this.shoot(u, this.ax[t], this.ay[t], cls, SHOT_MPS[cls], 0, so.x, so.y);
        this.hp[t] -= st.damage;
        if (this.hp[t] <= 0) { this.state[t] = DEAD; this.recordKill(t, u); so.kills++; }
      }
    }
  }

  /** 0.53: the grenadier's aim point: the infected in range with the most infected within the blast (at least
   *  GREN_MIN_PACK), outside the no-fire band and clear of the zone; null when nothing is worth a round. */
  private packTarget(x: number, y: number, R: number): [number, number] | null {
    const b0x = Math.max(0, ((x - R) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + R) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - R) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + R) / BUCKET) | 0);
    let best: [number, number] | null = null, bn = C.GREN_MIN_PACK - 1, seen = 0;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1 && seen < 60; k = this.next[k]) {
        if (this.state[k] !== INF) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y; if (dx * dx + dy * dy > R * R || dx * dx + dy * dy < 4) continue; // not on top of himself
        seen++;
        const n = this.countInf(this.ax[k], this.ay[k], C.GREN_SPLASH, 20);
        if (n > bn && this.clearOfZone(this.ax[k], this.ay[k], C.GREN_SPLASH) && !this.inNoFire(this.ax[k], this.ay[k])) { bn = n; best = [this.ax[k], this.ay[k]]; }
      }
    return best;
  }
  /** Target for a direct-fire unit, by its priority. */
  private pickTarget(u: Unit, ox?: number, oy?: number, range?: number) {
    const x = ox ?? u.x + 0.5, y = oy ?? u.y + 0.5, R = range ?? u.range, mode = u.mode ?? "near"; // 0.49: per soldier
    const walls = this.blockedByWalls(u.kind) || ((u.kind === "garrison" || u.kind === "sniper") && !u.fort); // 0.27: can't shoot through a standing wall (0.50: nor can Troops/Snipers on the ground)
    const eye = this.sightLine(u.kind) ? this.eyeOf(u) : -1, los = walls || eye >= 0; // 0.33: nor through a building
    if (mode === "near") return los ? this.nearestSeen(x, y, R, walls, eye) : this.nearest(x, y, R, INF, 255, 400);
    const b0x = Math.max(0, ((x - R) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + R) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - R) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + R) / BUCKET) | 0);
    let best = -1, bs = Infinity, checks = 600;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (--checks <= 0) return best;
        if (this.state[k] !== INF) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y, d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const score = mode === "wall" ? (this.infField[this.idx(this.ax[k] | 0, this.ay[k] | 0)] / FIELD_STEP) * 1000 + d2
          : (this.chase[k] ? 0 : 1e6) + d2;
        if (score < bs && (!los || this.seen(x, y, this.ax[k], this.ay[k], walls, eye))) { bs = score; best = k; }
      }
    }
    return best;
  }

  /** Distance field to `goal` over what this unit can travel: roads (through our own gates) or the river. */
  /** 0.45: the middle of person `who`'s family members still out in the city (CIV), or of everyone alive (CIV or
   *  safe) when none is out; null when nobody is left alive. */
  escortCenter(who: number): [number, number] | null {
    if (who < 0 || who >= this.civN) return null;
    const lead = this.famLead[who], a = lead >= 0 ? lead : who, b = lead >= 0 ? lead + this.famSize[lead] : who + 1;
    let x = 0, y = 0, n = 0;
    for (let m = a; m < b; m++) if (this.state[m] === CIV || this.state[m] === SAFE_CIV) { x += this.ax[m]; y += this.ay[m]; n++; }
    return n ? [x / n, y / n] : null;
  }
  /** 0.45: an escort is over once nobody in the family is still out in the city. */
  private escortDone(who: number): boolean {
    if (who < 0 || who >= this.civN) return true;
    const lead = this.famLead[who], a = lead >= 0 ? lead : who, b = lead >= 0 ? lead + this.famSize[lead] : who + 1;
    for (let m = a; m < b; m++) if (this.state[m] === CIV) return false;
    return true;
  }

  /** 0.45: messages for the player about orders (main.ts shows and empties it). */
  orderLog: string[] = [];

  /** 0.45: point a commanded unit at its current order (or where it holds). */
  private planOrders(u: Unit) {
    const fx = u.x + 0.5, fy = u.y + 0.5;
    const head = u.orders?.[0];
    if (head?.k === "fortify" && arrived(head, fx, fy)) { // 0.50: at the foot of the building: start climbing
      u.orders = []; u.goal = undefined; u.nav = undefined;
      if (this.buildingTaken(u.kind, head.px!, head.py!, u)) {
        this.orderLog.push(u.kind === "garrison" ? "One Troops squad per building." : "One Sniper team per building.");
        u.cmd = false; u.ai = "hold"; u.holdAt = [Math.floor(u.x), Math.floor(u.y)]; return;
      }
      u.fort = "climb"; u.fortT = C.FORTIFY_S; u.fortAt = [head.px!, head.py!];
      return;
    }
    const had = u.orders?.[0];
    u.orders = nextOrder(u.orders ?? [], fx, fy);
    while (u.orders[0]?.k === "escort" && this.escortDone(u.orders[0].who!)) { u.orders = u.orders.slice(1); if (!u.orders.length) u.holdAt = [u.x | 0, u.y | 0]; }
    if (had && had.k !== "escort" && !u.orders.length) u.holdAt = [had.x, had.y]; // the queue just ran out: hold at the last point
    const o = u.orders[0];
    if (o?.k === "escort") { const c = this.escortCenter(o.who!)!; o.x = Math.floor(c[0]); o.y = Math.floor(c[1]); } // follows the family
    const air = C.UNITS[u.kind].mobile!.nav === "air";
    const at = o ? [o.x, o.y] : u.holdAt ?? [u.x | 0, u.y | 0];
    const goal = this.idx(Math.max(0, Math.min(this.w - 1, at[0] | 0)), Math.max(0, Math.min(this.h - 1, at[1] | 0)));
    if (goal === u.goal && (air || u.nav)) return;
    if (air) { u.goal = goal; return; }
    this.navTo(u, goal);
    if (o && o.k !== "escort" && this.cutOff(u)) { // walled off, a blown bridge, another stretch of water: drop it, say so, go on
      this.orderLog.push(`${C.UNITS[u.kind].name} can't get there.`);
      u.orders = u.orders.slice(1);
      if (!u.orders.length) u.holdAt = [u.x | 0, u.y | 0];
      u.goal = undefined;
      this.planOrders(u);
    }
  }
  /** 0.45: no route from the unit's cell (or any cell next to it) to its goal. */
  private cutOff(u: Unit): boolean {
    const cx = (u.x + 0.5) | 0, cy = (u.y + 0.5) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < this.w && y < this.h && u.nav![this.idx(x, y)] !== 65535) return false;
    }
    return true;
  }

  private navTo(u: Unit, goal: number) {
    const water = C.UNITS[u.kind].mobile!.nav === "water";
    const f = u.nav ?? (u.nav = new Uint16Array(this.w * this.h));
    f.fill(65535);
    const q = this.navQ ?? (this.navQ = new Int32Array(this.w * this.h));
    let qh = 0, qt = 0;
    f[goal] = 0; q[qt++] = goal;
    const ok = (n: number) => { const t = this.map.tile[n]; return water ? (t === WATER || t === BRIDGE) : this.unitPass(n); };
    // search far enough to reach the unit (a strike order can be across the map), not the whole map every time
    const maxD = Math.min(65000, Math.max(400, (Math.abs((goal % this.w) - u.x) + Math.abs(((goal / this.w) | 0) - u.y)) * 2 + 100));
    while (qh < qt) {
      const c = q[qh++], cx = c % this.w, d = f[c] + 1;
      if (d > maxD) break;
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (n < 0 || n >= f.length || f[n] !== 65535 || !ok(n)) continue;
        f[n] = d; q[qt++] = n;
      }
    }
    u.goal = goal;
  }
  private navQ?: Int32Array;

  /** 0.49: is anyone in the zone (SAFE_CIV) within r of (x,y)? */
  private anySafeNear(x: number, y: number, r: number) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== SAFE_CIV) continue;
        const dx = this.ax[k] - x, dy = this.ay[k] - y;
        if (dx * dx + dy * dy <= r * r) return true;
      }
    return false;
  }

  /** Infected within r of (x,y), up to cap. */
  private countInf(x: number, y: number, r: number, cap = 50, chasingOnly = false, zoneOnly = false) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let n = 0;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== INF || (chasingOnly && !this.chase[k])) continue;
        if (zoneOnly) { const z = this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)]; if (z !== 1 && z !== 3) continue; }
        const dx = this.ax[k] - x, dy = this.ay[k] - y;
        if (dx * dx + dy * dy <= r * r && ++n >= cap) return n;
      }
    return n;
  }

  /** The brain of an APC, gunboat or paratrooper squad. Re-plans every ~1.5 s, moves every tick. */
  private think(u: Unit, dt: number) {
    const spec = C.UNITS[u.kind], mob = spec.mobile!;
    const fx = u.x + 0.5, fy = u.y + 0.5;
    if (u.kind === "apc" && !u.dismounted && this.nearest(fx, fy, u.range * 1.1, INF, 255, 80) >= 0) {
      u.dismounted = true;
      const mspec = C.UNITS.militia;
      const sx = Math.max(0, Math.min(this.w - 1, Math.round(u.x))), sy = Math.max(0, Math.min(this.h - 1, Math.round(u.y)));
      if (walkable(this.map.tile[this.idx(sx, sy)])) {
        this.units.push({
          kind: "militia", x: sx, y: sy, range: mspec.range, ammo: 240, cooldown: 0.25, kills: 0,
          shotX: 0, shotY: 0, shotT: -1, mode: "near", post: [sx, sy], hp: 260, ai: "hunt", thinkT: 0, parentUnit: u,
          soldiers: this.squadFor("militia", sx, sy), // 0.52: the dismount team gets out as dots (design ruling)
        });
      }
    }
    // Getting bitten: infected touching it wear it down (boats are out of reach).
    if (mob.hp !== Infinity && (this.tick + u.post![0]) % 4 === 0) {
      const hurt = this.dev.unitDamage ? this.countInf(fx, fy, spec.on === "ground" ? Math.max(1.3, spec.foot * 0.7 + 1.2) : 1.3, spec.on === "ground" ? 16 : 12) * C.MOBILE_HURT_DPS * (spec.clawMul ?? 1) * dt * 4 : 0; // 0.25: armor
      u.hp! -= hurt;
      if (hurt > 0 && !u.parentUnit) this.ping("unit", fx, fy); // 0.48 (an APC's dismounts ping through the APC's own fights)
    }
    if (u.ai === "reload") {
      u.reloadT! -= dt * (u.supplied ? 2 : 1);
      if (u.reloadT! <= 0) { u.ammo = spec.ammo; u.hp = Math.min(mob.hp, u.hp! + mob.hp * 0.5); u.ai = "hunt"; u.thinkT = 0; }
      return;
    }
    u.thinkT = (u.thinkT ?? 0) - dt;
    if (u.thinkT <= 0) {
      u.thinkT = 1.5;
      const low = u.ammo !== Infinity && u.ammo + (u.reserve ?? 0) < spec.ammo * 0.15; // 0.60: spares count
      const hurt = mob.hp !== Infinity && u.hp! < mob.hp * 0.35;
      const crowd = this.countInf(fx, fy, 5, 30);
      const troop = u.kind === "garrison" || u.kind === "sniper"; // 0.50: no flee, no reload trip, no hunting: orders or hold
      if (troop) {
        if (u.cmd) { this.planOrders(u); u.ai = "hunt"; }
        else { u.ai = "hold"; u.goal = undefined; u.nav = undefined; }
      } else if (mob.nav === "air" && (low || u.ammo < 1)) {
        u.ai = "home"; // fly back to the zone to rearm
      } else if (u.ai === "supply" || ((low || hurt) && (u.kind === "apc" || u.kind === "tank" || u.kind === "police" || u.kind === "militia") && this.supply.length && !u.parentUnit
        && this.time >= (u.supplyAgainT ?? 0) && this.supplyHelps(u))) {
        // 0.60: no gates open for supply: drive to a spot at the wall, clear of every entrance, and wait
        const full = spec.ammo * (1 + Sup.basicLoad(Sup.ammoClass(u.kind), u.kind)), onHand = u.ammo + (u.reserve ?? 0), hurtNow = mob.hp !== Infinity && u.hp! < mob.hp;
        const release = () => { u.waitingSupply = false; u.waitAt = undefined; u.ai = "hunt"; };
        if (u.waitingSupply && onHand >= full && !hurtNow) release();
        // review I4: never latched for good: out of engineer reach, no crew left, or nothing to fill it with (and enough to fight) -> back to fighting, try again later
        else if (u.waitingSupply && (!inEngineerReach(this, Math.floor(fx), Math.floor(fy)) || !this.supplyHelps(u) || (!hurtNow && !this.supplyCanFill(u) && onHand >= spec.ammo * 0.15))) { release(); u.supplyAgainT = this.time + C.SUPPLY_RETRY_S; }
        else if (!u.waitingSupply) {
          if (u.ai !== "supply" || !u.waitAt) { u.waitAt = this.supplyWaitSpot(u) ?? [fx | 0, fy | 0]; u.ai = "supply"; this.navTo(u, this.idx(u.waitAt[0], u.waitAt[1])); }
          if (hyp(fx - u.waitAt[0] - 0.5, fy - u.waitAt[1] - 0.5) < 1.2) u.waitingSupply = true;
        }
      } else if ((u.kind === "para" || u.parentUnit) && u.ammo < 1) {
        u.ai = "leave"; // out of ammo: the squad walks back to the zone and is evacuated
      } else if (crowd >= mob.flee) {
        u.ai = "flee";
        // run to the reachable spot nearby with the fewest infected, leaning toward the zone
        let best = -1, bs = Infinity;
        const r = rng((this.tick * 977 + u.post![0] * 13) >>> 0);
        for (let s = 0; s < 16; s++) {
          const a = r() * 6.283, d = 6 + r() * 10;
          const x = (fx + Math.cos(a) * d) | 0, y = (fy + Math.sin(a) * d) | 0;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h || !walkable(this.map.tile[this.idx(x, y)])) continue;
          const sc = this.countInf(x + 0.5, y + 0.5, 6, 40) * 10 + (this.civField[this.idx(x, y)] === 65535 ? 50 : (this.civField[this.idx(x, y)] / FIELD_STEP) * 0.05)
            + (49 - this.openness(x, y)) * 0.8; // dead ends and corners are traps
          if (sc < bs) { bs = sc; best = this.idx(x, y); }
        }
        if (best >= 0) this.navTo(u, best);
      } else if (u.cmd) {
        this.planOrders(u); // 0.45: the player's orders, not its own hunting
        u.ai = "hunt";
      } else {
        // Hunt: sample spots within the leash; infected chasing civilians count triple.
        const r = rng((this.tick * 7919 + u.post![1] * 31) >>> 0);
        const water = mob.nav === "water", air = mob.nav === "air";
        const leash = mob.leash * (u.rateMul && u.rateMul > 1 ? C.COMMAND_LEASH_MUL : 1);
        let best = -1, bs = 2;
        for (let s = 0; s < 40; s++) {
          const a = r() * 6.283, d = r() * leash;
          const x = (u.post![0] + Math.cos(a) * d) | 0, y = (u.post![1] + Math.sin(a) * d) | 0;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const t = this.map.tile[this.idx(x, y)];
          if (!air && (water ? t !== WATER : !walkable(t))) continue;
          const sc = this.countInf(x + 0.5, y + 0.5, u.range * 0.8, 60) + 2 * this.countInf(x + 0.5, y + 0.5, u.range * 0.8, 30, true);
          if (sc > bs) { bs = sc; best = this.idx(x, y); }
        }
        const goal = best < 0 ? this.idx(u.post![0], u.post![1]) : best; // nothing worth chasing: drift back to the post
        if (goal !== u.goal) {
          if (air) u.goal = goal;
          else {
            this.navTo(u, goal);
            const home = this.idx(u.post![0], u.post![1]); // 0.27: a wall between it and the crowd: back to its post instead
            if (u.nav![this.idx(fx | 0, fy | 0)] === 65535 && goal !== home) this.navTo(u, home);
          }
        }
        u.ai = "hunt";
      }
    }
    // Move.
    const cx = fx | 0, cy = fy | 0;
    const mIdx = this.idx(cx, cy);
    const mInfra = (this.map.tile[mIdx] === 0 || this.map.tile[mIdx] === BRIDGE) ? this.map.height[mIdx] : 0;
    const sp = mob.speed * (mInfra === INFRA_HIGHWAY ? C.HIGHWAY_SPEED_MUL : 1) * (mob.nav === "water" ? 1 : this.roughMul(mIdx)) * dt // 0.23: rough ground (air returns above)
      * (u.crushT && u.crushT > 0 ? spec.crushSlow ?? 1 : 1) * (u.yieldMul ?? 1); // 0.25: crushing slows it; people around it, it creeps
    let d: [number, number] | null = null;
    if (u.cmd && u.ai === "hunt") { // 0.45: arrived at an order point: the next one right away (not at the next re-plan)
      if (u.standby) return;
      const o = u.orders?.[0];
      if (o && o.k !== "escort" && arrived(o, fx, fy)) { this.planOrders(u); u.thinkT = 1.5; }
    }
    const ordMove = !!u.cmd && u.orders?.[0]?.k === "move"; // 0.45: a plain move never stops or dodges
    if (mob.nav === "air") { // flies straight to its goal (or home to its post to rearm)
      if (u.cmd) { if (u.ai === "hunt" && !ordMove && this.nearest(fx, fy, u.range * 0.75, INF, 255, 120) >= 0) return; }
      else if (u.ai === "hunt" && hyp(fx - u.post![0], fy - u.post![1]) < mob.leash * 0.6 && this.nearest(fx, fy, u.range * 0.75, INF, 255, 120) >= 0) return;
      const ea = u.cmd ? u.orders?.[0] : undefined;
      if (ea?.k === "escort") { const c = this.escortCenter(ea.who!); if (c && hyp(fx - c[0], fy - c[1]) < ESCORT_R) return; }
      const g = u.ai === "home" ? this.idx(u.post![0], u.post![1]) : u.goal;
      if (g === undefined) return;
      const gx = (g % this.w) + 0.5 - fx, gy = ((g / this.w) | 0) + 0.5 - fy, l = hyp(gx, gy);
      if (l < 1) { if (u.ai === "home") { u.ai = "reload"; u.reloadT = mob.rearmS ?? 10; } return; }
      const step = Math.min(l, mob.speed * dt);
      u.x += gx / l * step; u.y += gy / l * step;
      return;
    }
    if (u.ai === "supply") { // 0.60: to the wait spot, then stand still (it still shoots what comes into range)
      if (u.waitingSupply || !u.waitAt) return;
      if (hyp(fx - u.waitAt[0] - 0.5, fy - u.waitAt[1] - 0.5) < 1.2) { u.waitingSupply = true; return; }
      d = u.nav ? this.downhill(u.nav, cx, cy) : null;
      if (!d) { // no way there: wait here if an engineer can reach it, else back to fighting (review I4)
        if (inEngineerReach(this, cx, cy)) u.waitingSupply = true; else { u.ai = "hunt"; u.waitAt = undefined; u.supplyAgainT = this.time + C.SUPPLY_RETRY_S; }
        return;
      }
    } else if (u.ai === "home" || u.ai === "leave") {
      if (this.inZone[this.idx(cx, cy)] === 1) {
        if (u.ai === "leave") { u.hp = -1; if (!u.parentUnit) this.unitsLost--; return; } // evacuated, not lost
        u.ai = "reload"; u.reloadT = C.APC_RELOAD_S; return;
      }
      d = this.downhill(this.apcField, cx, cy);
      if (!d && u.ai === "home") {
        if (this.apcField[this.idx(cx, cy)] === 65535) { u.ai = "hunt"; u.thinkT = 1.5; return; } // 0.27: walled out: holds out there, a supply drop can rearm it
        u.ai = "reload"; u.reloadT = C.APC_RELOAD_S; return;
      }
    } else {
      // In transit to a far post (a strike order): keep driving, shoot on the move, only dodge what is right on it.
      const transit = u.cmd ? ordMove : hyp(fx - u.post![0], fy - u.post![1]) > mob.leash * 0.6;
      // Kite: infected closing in, back off while shooting, never into a corner.
      if (u.ai === "hunt" && mob.hp !== Infinity && !ordMove) {
        const near = this.nearest(fx, fy, transit ? 2.5 : u.range * C.KITE_R, INF, 255, 120);
        if (near >= 0) { const k = this.kiteStep(fx, fy, near, sp); if (k) { u.x += k[0]; u.y += k[1]; u.kiting = true; } return; }
      }
      u.kiting = false;
      // Hold still while there is something to shoot (and nothing about to swarm it).
      if (u.ai === "hunt" && !transit && this.nearestSeen(fx, fy, u.range * 0.75, this.blockedByWalls(u.kind), this.sightLine(u.kind) ? this.eyeOf(u) : -1) >= 0) return; // 0.33: only what it can see
      if (u.nav && u.goal !== undefined) d = this.downhill(u.nav, cx, cy);
      const eo = u.cmd ? u.orders?.[0] : undefined; // 0.45: close enough to the family it guards: stand with them
      if (eo?.k === "escort") { const c = this.escortCenter(eo.who!); if (c && hyp(fx - c[0], fy - c[1]) < ESCORT_R) d = null; }
    }
    if (!d && u.nav && u.goal !== undefined && u.nav[this.idx(cx, cy)] === 65535) d = this.unstick(u.nav, cx, cy); // knocked off its route
    if (!d) return;
    // Stay on streets (or water): slide along an axis instead of cutting a corner into a building.
    const water = mob.nav === "water";
    const okc = (x: number, y: number) => { const i = this.idx(Math.min(this.w - 1, Math.max(0, (x + 0.5) | 0)), Math.min(this.h - 1, Math.max(0, (y + 0.5) | 0))), t = this.map.tile[i]; return water ? (t === WATER || t === BRIDGE) : this.unitPass(i); };
    // 0.33: a tank or APC never rolls onto people: it waits for them to step aside
    // (0.33: it can nudge into a person or two at its edge, who then shuffle out; a crowd in front, it waits)
    const ok = spec.crushSlow === undefined ? okc : (x: number, y: number) => okc(x, y) && this.civOnNewCells(spec.foot, u.x, u.y, x, y) <= C.VEH_NUDGE;
    if (u.soldiers && !water) d = this.hugWall(u.x + 0.5, u.y + 0.5, d); // 0.52: fire teams walk along building fronts
    const nx = u.x + d[0] * sp, ny = u.y + d[1] * sp;
    const x0 = u.x, y0 = u.y;
    if (ok(nx, ny)) { u.x = nx; u.y = ny; }
    else if (ok(nx, u.y)) u.x = nx;
    else if (ok(u.x, ny)) u.y = ny;
    if (u.soldiers) { const mx = u.x - x0, my = u.y - y0, l = hyp(mx, my); if (l > 1e-4) { u.headX = mx / l; u.headY = my / l; u.movedT = this.time; } }
  }
  /** 0.52: in a street wider than 4 cells, lean toward the nearer building front until about one cell off it. */
  private hugWall(x: number, y: number, d: [number, number]): [number, number] {
    const hd: [number, number] = [d[0], d[1]], a = this.sideRoom(x, y, -d[1], d[0]), b = this.sideRoom(x, y, d[1], -d[0]);
    if (a + b + 1 < 4) return d;
    const [px, py, room] = a <= b ? [-d[1], d[0], a] : [d[1], -d[0], b];
    if (room <= 1 || room >= 6) return d; // already along a front, or open ground (a park, a square)
    const k = 0.35, gx = hd[0] + px * k, gy = hd[1] + py * k, l = hyp(gx, gy);
    return [gx / l, gy / l];
  }

  /** Off the route field (pushed into a corner): head for the neighboring cell that is on it, closest to the goal. */
  private unstick(f: Uint16Array, cx: number, cy: number): [number, number] | null {
    let best: [number, number] | null = null, bv = 65535;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const v = f[this.idx(x, y)];
      if (v < bv) { bv = v; const l = hyp(dx, dy); best = [dx / l, dy / l]; }
    }
    return best;
  }

  /** Walkable cells in the 7x7 around (x, y): low means a corner, alley end or dead end. */
  openness(x: number, y: number) {
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx >= 0 && cy >= 0 && cx < this.w && cy < this.h && walkable(this.map.tile[this.idx(cx, cy)])) n++;
    }
    return n;
  }

  /** One step away from infected `t`: the open, uncrowded direction that keeps the most distance. */
  private kiteStep(fx: number, fy: number, t: number, sp: number): [number, number] | null {
    let best: [number, number] | null = null, bs = -Infinity;
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * 6.2832, cx = Math.cos(a), cy = Math.sin(a);
      const px = fx + cx * 3, py = fy + cy * 3, mx = fx + cx * 1.5, my = fy + cy * 1.5;
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
      if (!walkable(this.map.tile[this.idx(px | 0, py | 0)]) || !walkable(this.map.tile[this.idx(mx | 0, my | 0)])) continue;
      const sc = hyp(px - this.ax[t], py - this.ay[t]) * 2 + this.openness(px | 0, py | 0) * 0.25 - this.countInf(px, py, 3, 20) * 3;
      if (sc > bs) { bs = sc; best = [cx * sp, cy * sp]; }
    }
    return best;
  }

  /** Mortar targeting: the densest-looking infected in range but beyond the minimum range.
   *  Samples a few buckets in range and picks the one holding the most infected. */
  private farTarget(u: Unit, minR: number) {
    const x = u.x + 0.5, y = u.y + 0.5, R = u.range;
    let best = -1, bestN = 2; // don't waste a shell on one or two
    const mode = u.mode ?? "near";
    const r = rng((this.tick * 7919 + u.x * 31 + u.y) >>> 0);
    const samples = Math.min(60, Math.round(R / 2));
    for (let s = 0; s < samples; s++) {
      const a = r() * 6.283, d = minR + r() * (R - minR);
      const bx = ((x + Math.cos(a) * d) / BUCKET) | 0, by = ((y + Math.sin(a) * d) / BUCKET) | 0;
      if (bx < 0 || by < 0 || bx >= this.bw || by >= this.bh) continue;
      let n = 0, pick = -1, ch = 0;
      for (let k = this.head[by * this.bw + bx]; k !== -1 && n < 40; k = this.next[k]) {
        if (this.state[k] !== INF) continue;
        n++; pick = k; ch += this.chase[k];
      }
      if (n <= 2) continue;
      // covering fire: weight the crowd by what this gun is told to protect
      const sc = mode === "wall" ? n * 30 / (10 + this.infField[this.idx(this.ax[pick] | 0, this.ay[pick] | 0)] / FIELD_STEP)
        : mode === "civ" ? n + 3 * ch : n;
      // never shell a spot where the blast would reach the inside of the zone
      if (sc > bestN && pick >= 0 && this.clearOfZone(this.ax[pick], this.ay[pick], C.UNITS[u.kind].splash ?? 0) && !this.strikeBlocked(this.ax[pick], this.ay[pick], C.UNITS[u.kind].splash ?? 0)) { bestN = sc; best = pick; } // 0.38: and outside the no-fire band
    }
    return best;
  }

  // ---------- 0.38: no-fire band ----------
  /** Cells from the nearest protected cell (the zone, a building touching it, a building with a rooftop unit or
   *  support), 255 beyond NOFIRE_SCAN_M. Worked out lazily and cached until the zone, the map or a roof changes. */
  private protDist = new Uint8Array(0);
  private protKey = "";
  private protTick = -1;
  private inStep = false;
  protectDist(): Uint8Array {
    // inside a tick the answer can't change between calls; outside one (UI, paused) check the key every time
    if (this.inStep && this.protTick === this.tick && this.protDist.length) return this.protDist;
    this.protTick = this.inStep ? this.tick : -1;
    let key = `${this.zoneCells}|${this.zones.length}|${this.buildingsCollapsed}|${this.demoBlown.size}|`; // not mapVersion: that bumps on every scratch
    for (const u of this.units) if ((u.hp === undefined || u.hp > 0) && u.extractT === undefined && this.onRoof(u)) key += `${u.x | 0},${u.y | 0};`;
    for (const b of this.supports) key += `${b.x},${b.y};`;
    if (key === this.protKey && this.protDist.length) return this.protDist;
    this.protKey = key;
    const w = this.w, h = this.h, n = w * h, tile = this.map.tile;
    const d = this.protDist.length === n ? this.protDist : (this.protDist = new Uint8Array(n));
    d.fill(255);
    const q = new Int32Array(n); let qh = 0, qt = 0;
    const seed = (i: number) => { if (d[i] !== 0) { d[i] = 0; q[qt++] = i; } };
    // a whole building (connected roof cells, capped) from one of its cells
    const building = (i0: number) => {
      if (tile[i0] !== BUILDING || d[i0] === 0) return;
      const st = [i0]; seed(i0); let cnt = 0;
      while (st.length && cnt++ < C.DEMO_MAX_CELLS) {
        const i = st.pop()!, x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
          if (j >= 0 && tile[j] === BUILDING && d[j] !== 0) { seed(j); st.push(j); }
      }
    };
    for (let i = 0; i < n; i++) if (this.inZone[i]) seed(i);
    if (this.zones.length) for (let i = 0; i < n; i++) {
      if (!this.inZone[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && !this.inZone[j] && tile[j] === BUILDING) building(j);
    }
    for (const u of this.units) if ((u.hp === undefined || u.hp > 0) && u.extractT === undefined && this.onRoof(u)) building(this.idx(u.x | 0, u.y | 0));
    for (const b of this.supports) if (tile[this.idx(b.x, b.y)] === BUILDING) building(this.idx(b.x, b.y));
    const lim = Math.min(254, Math.ceil(C.NOFIRE_SCAN_M / C.CELL_M));
    while (qh < qt) {
      const i = q[qh++], nd = d[i] + 1;
      if (nd > lim) continue;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx | dy) === 0 || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (d[j] > nd) { d[j] = nd; q[qt++] = j; }
      }
    }
    return d;
  }
  /** Band width in cells for a weapon: big air bombs get the wider one. */
  static noFireCells(big = false) { return Math.ceil((big ? C.NOFIRE_BIG_M : C.NOFIRE_M) / C.CELL_M); }
  /** True when a crater weapon may not land at (x, y). */
  inNoFire(x: number, y: number, big = false) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.protectDist()[this.idx(x | 0, y | 0)] <= Sim.noFireCells(big);
  }
  /** True when any part of a blast of radius r at (x, y) falls in the band. */
  strikeBlocked(x: number, y: number, r: number, big = false) {
    if (this.inNoFire(x, y, big)) return true;
    for (let a = 0; a < 8; a++) if (this.inNoFire(x + Math.cos(a * 0.785) * r, y + Math.sin(a * 0.785) * r, big)) return true;
    return false;
  }
  /** Why a called-in strike can't go at (x, y) [to (x2, y2)], or null. The nuke and MOAB are never refused here. */
  strikeRefusal(k: C.AbilityKind, x: number, y: number, x2 = x, y2 = y): string | null {
    const msg = "Too close to your people. Strikes can't land within %m m of the safe zone, a manned roof or a building beside the zone.";
    const say = (big: boolean) => msg.replace("%m", String(big ? C.NOFIRE_BIG_M : C.NOFIRE_M));
    if (k === "airstrike") {
      const l = hyp(x2 - x, y2 - y), n = Math.max(2, Math.round(l / 5));
      for (let i = 0; i <= n; i++) { const f = i / n; if (this.strikeBlocked(x + (x2 - x) * f, y + (y2 - y) * f, C.AIRSTRIKE_RADIUS, true)) return say(true); }
      return null;
    }
    if (k === "tomahawk") return this.strikeBlocked(x, y, C.TOMAHAWK_RADIUS, true) ? say(true) : null;
    if (k === "firebomb") return this.strikeBlocked(x, y, (this.tileAt(x | 0, y | 0) === PARK ? C.FIRE_RADIUS_PARK : C.FIRE_RADIUS) * 0.85) ? say(false) : null;
    if (k === "cluster") return this.strikeBlocked(x, y, C.CLUSTER_RADIUS) ? say(false) : null;
    if (k === "barrage") return this.strikeBlocked(x, y, C.BARRAGE_RADIUS + C.BARRAGE_SPLASH) ? say(false) : null;
    return null;
  }
  /** 0.38: share of the safe zone's cells a nuke or MOAB at (x, y) would reach (0 = clear). For the warning. */
  zoneHitShare(k: C.AbilityKind, x: number, y: number) {
    const r = k === "nuke" ? C.NUKE_RADIUS : k === "moab" ? C.MOAB_RADIUS : 0;
    if (!r || !this.zoneCells) return 0;
    let hit = 0, all = 0;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i]) all++;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++)
      if (this.inZone[yy * this.w + xx] && hyp(xx + 0.5 - x, yy + 0.5 - y) <= r) hit++;
    return all ? hit / all : 0;
  }

  /** True when a blast of radius r at (x,y) would not reach inside the zone. */
  private clearOfZone(x: number, y: number, r: number) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const px = (x + dx) | 0, py = (y + dy) | 0;
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
      if (this.inZone[this.idx(px, py)]) return false;
    }
    return true;
  }

  counts() {
    let civ = 0, safe = 0, inf = 0, refusing = 0, refusedLost = 0;
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === CIV) civ++; else if (s === SAFE_CIV) safe++; else if (s === INF) inf++;
      if (this.refusers && k < this.civN && this.refuser[k] === 1) { if (s === CIV) refusing++; else if ((s === INF || s === DEAD) && this.fate[k] !== FATE_EVAC) refusedLost++; } // 0.42
    }
    return { civ, safe, inf, total: this.civN, refusing, refusedLost };
  }

  result: Score | null = null;
  roundDone = false; // 0.20: the city emptied (everyone left alive is out) or only stalled stragglers remain
  roundAt: number | null = null; // sim time the round ended
  private roundEmptied = false; private killsAtRound = 0; private damageAtRound = 0;
  private lastProgressT = 0; private lastSafe = 0; private lastLifts = 0;
  roundResult: Score | null = null;

  /** How much of the city's buildings is still standing, 0-100. */
  intactPct() { return this.cityDamage().intact; }

  /** Building damage: share still standing and the property damage bill in dollars. */
  cityDamage() {
    let n = 0, dmg = 0, bill = 0;
    for (let i = 0; i < this.damage.length; i++) {
      const t = this.map.tile[i];
      if (t !== BUILDING && !this.rubble[i]) continue;
      const d = this.rubble[i] ? 1 : Math.min(1, this.damage[i] / 180);
      n++; dmg += d;
      if (d > 0) bill += d * C.BUILDING_CELL_FLOOR_VALUE * Math.max(1, this.origFloors ? this.origFloors[i] : this.map.height[i]);
    }
    return { intact: n ? 100 * (1 - dmg / n) : 100, bill: Math.round(bill) };
  }
  origFloors?: Uint8Array; // building heights before the battle (collapses lower them)

  /** The score as it stands: evacuated share, medal, city damage bonus and XP. */
  scoreNow(reason: string, zoneCredit = 0): Score {
    const cnt = this.counts();
    const saved = this.evacuated + zoneCredit, pct = savedPct(saved, this.civN, cnt.refusing, cnt.refusedLost); // 0.42: refusers cost a little
    const { intact, bill } = this.cityDamage();
    const emptiedAfterS = this.roundDone && this.roundEmptied && this.roundAt !== null ? Math.max(0, this.roundAt - C.WARNING_S) : null;
    const parts = roundParts({ pct, emptiedAfterS, intact, kills: this.kills, infAlive: this.counts().inf });
    const score = roundScore(parts), medal = medalFor(score, pct);
    const bonus = intact >= C.INTACT_BONUS_PCT ? "Light Touch" : 100 - intact >= C.SCORCHED_BONUS_PCT || bill >= C.BILLION ? "Scorched Earth" : null;
    const spent = this.spent(), perM = spent > 0 ? saved / (spent / 1e6) : 0;
    const underBudget = !!medal && spent <= C.UNDER_BUDGET_PCT * (this.budget + this.earned);
    const xp = Math.max(0, Math.round((score * 10 + this.wave * 20 + (bonus ? C.BONUS_XP : 0) - this.nukesUsed * C.NUKE_XP_PENALTY) * this.diff.xpMul));
    return { saved, pct, medal, reason, intact, bonus, xp, waves: this.wave, round: this.roundDone && saved > 0, damage: bill, spent, perM, underBudget, score, parts, kills: this.kills, left: cnt.civ - cnt.refusing, zoneHeld: cnt.safe,
      refused: cnt.refusing, refusedLost: cnt.refusedLost, talkedOut: this.talkedOut, broke: this.broke, civKilledByUs: this.civKilledByUs, civFriendlyFire: this.civFriendlyFire };
  }
  /** The round is over (city empty or stalled): score it, freeze it, keep the battle running for Keep fighting. */
  /** 0.57: the page says the player chose Keep fighting. */
  markKeepFighting() { St.event(this.stats, St.SE_KEEP_FIGHTING, this.time, 0, 0); }
  /** 0.59: copy the sim's own running counts into the recorder (each sample, and before the record is built). */
  syncCounters() {
    const c = this.stats.c; c.swimmers = this.swimmersKilled; c.guardKills = this.guardKills; c.talkedOut = this.talkedOut;
    let sp = 0; for (const z of this.supply) sp += z.bought + z.spent; for (const u of this.units) sp += u.resPaid ?? 0;
    c.supplySpent = sp; // 0.60
  }
  /** 0.57: one recorder sample (every SAMPLE_S of battle time); also registers units placed since the last one. */
  private sampleStats() {
    const r = this.stats, c = this.counts();
    for (const u of this.units) if (u.sid === undefined) St.unitIndex(r, u, this.time);
    let strikeKills = 0; for (const x of r.strikes) strikeKills += x.kills;
    const dmg = this.cityDamage();
    this.syncCounters();
    St.sample(r, { t: this.time, saved: this.evacuated, byTrain: this.trainsEvacuated, inZone: c.safe, outside: c.civ, infected: c.inf, kills: this.kills,
      killsStrikes: strikeKills, civKilledByUs: this.civKilledByUs, money: this.remaining(), spent: this.spent(), damage: dmg.bill, intact: dmg.intact,
      hordes: this.wave, breaches: this.breaches, unitsAlive: this.units.length, lifts: this.liftsFlown, liftsAborted: this.liftsAborted });
  }
  /** 0.30.1: the player ends the round (only stragglers left): people inside the zone count as saved, the zone
   *  holds them until the lifts take them; everyone still outside is left behind. */
  endRoundNow(): string | null {
    if (this.phase !== "battle" || this.roundDone) return "No round to end.";
    if (!this.outbreak) return "Wait for the outbreak first.";
    const c = this.counts();
    this.endRound(`You ended the round. ${c.safe.toLocaleString()} people in the zone count as saved; ${(c.civ - c.refusing).toLocaleString()} left behind.${c.refusing ? ` ${c.refusing.toLocaleString()} refused to leave.` : ""}`, false, c.safe);
    return null;
  }
  private endRound(reason: string, emptied: boolean, zoneCredit = 0) {
    this.roundDone = true; this.roundAt = this.time; this.roundEmptied = emptied;
    St.event(this.stats, St.SE_ROUND, this.time, 0, 0); // 0.57
    this.killsAtRound = this.kills; this.damageAtRound = this.cityDamage().bill;
    this.roundResult = this.scoreNow(reason, zoneCredit);
  }

  /** 0.40: someone is still on a family errand or waiting for family (the round isn't stalled). */
  private errandsActive(): boolean {
    for (let k = 0; k < this.civN; k++) { const q = this.plan[k]; if (q >= PLAN_GATHER && q !== PLAN_REFUSE && (this.state[k] === CIV || this.state[k] === SAFE_CIV)) return true; }
    return false;
  }
  private checkEnd(force = false) {
    if (!force && this.tick % 10) return;
    const c = this.counts();
    if (!this.roundDone && this.phase === "battle") {
      const left = c.civ - c.refusing + c.safe, out = this.evacuated.toLocaleString(); // 0.42: refusers at home don't hold the round up
      const few = left <= this.civN * C.ROUND_STRAGGLERS_PCT / 100;
      if (c.safe > this.lastSafe || this.liftsFlown > this.lastLifts || (few && this.dayLife && this.errandsActive())) this.lastProgressT = this.time; // 0.40: families still on errands aren't a stall
      this.lastSafe = c.safe; this.lastLifts = this.liftsFlown;
      const stay = c.refusing ? ` ${c.refusing.toLocaleString()} refused to leave.` : "";
      if (left === 0) this.endRound(this.evacuated ? `Round complete: everyone left alive is out. ${out} people saved.${stay}` : `Everyone is lost.${stay}`, true);
      else if (this.outbreak && left <= this.civN * C.ROUND_STRAGGLERS_PCT / 100 && this.time - this.lastProgressT >= C.ROUND_STALL_S)
        this.endRound(`Round complete: nobody else can be reached. ${out} people saved.`, false);
    }
    if (!this.endNow) return; // after the round the fight goes on until the player pulls out
    if (this.roundDone && this.roundResult) {
      const { intact, bill } = this.cityDamage();
      const killsAfter = this.kills - this.killsAtRound, damageAfter = Math.max(0, bill - this.damageAtRound);
      const r = this.roundResult;
      if (killsAfter === 0 && damageAfter === 0) this.result = { ...r }; // "End here" right from the round screen: no Mayhem
      else {
        // the round score, medal and round XP stay frozen; damage, intact and the bonus are live (for achievements)
        const bonus = intact >= C.INTACT_BONUS_PCT ? "Light Touch" : 100 - intact >= C.SCORCHED_BONUS_PCT || bill >= C.BILLION ? "Scorched Earth" : null;
        this.result = { ...r, reason: `You pulled out after ${this.wave} hordes. ${killsAfter.toLocaleString()} more infected killed after the round.`, killsAfter, damageAfter, civKilledByUs: this.civKilledByUs, civFriendlyFire: this.civFriendlyFire, mayhem: mayhem(killsAfter, damageAfter), xp: r.xp + Math.round(killsAfter * C.MAYHEM_XP_PER_KILL * this.diff.xpMul), waves: this.wave, damage: bill, intact, bonus };
      }
    } else {
      this.result = this.scoreNow(this.calledIt ? `You called it there: ${this.evacuated.toLocaleString()} people got out.` : this.evacuated ? `You pulled out. ${this.evacuated.toLocaleString()} people got out.` : "You pulled out.");
    }
    this.phase = "over";
  }

}
