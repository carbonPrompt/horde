import * as C from "./config";
import { padCost, roundParts, roundScore, medalFor, mayhem, type RoundParts } from "./scoring";
import { heat, rollGap, rollSize, routesFor } from "./storyteller";
import { BRIDGE, BUILDING, CityMap, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, WATER, extractRailLines, generateCity, rng, walkable } from "./map";
import { decodeCityMap } from "./osm";
import { REAL_CITY_MAPS } from "./realcities";

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
export interface Score {
  saved: number; pct: number; medal: string | null; reason: string; intact: number; bonus: string | null; xp: number; waves: number; round: boolean; damage: number; spent: number;
  score: number; parts: RoundParts; kills: number; // 0.20: round score 0..100 and its four parts
  killsAfter?: number; damageAfter?: number; mayhem?: number; // Keep fighting (after the round)
}

export interface Entry { kind: "highway" | "rail" | "bridge" | "road" | "river"; cells: [number, number][]; x: number; y: number; edge: number; weight: number }

export interface Unit {
  kind: C.UnitKind;
  x: number; y: number; // cell
  range: number;
  ammo: number; // Infinity when it reloads inside the zone
  cooldown: number;
  cooldown2?: number; // second gun (APC autocannon)
  kiting?: boolean; // backing away from infected while firing
  kills: number;
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
  ai?: "hunt" | "hold" | "flee" | "home" | "reload" | "leave";
  recallFrom?: [number, number]; // 0.24: its post before a Recall
  crushT?: number; // 0.25: seconds left slowed from crushing infected
  yieldCiv?: boolean; // 0.25: civilians in its way this tick: it creeps
  goal?: number; nav?: Uint16Array; thinkT?: number; reloadT?: number;
}

export type Phase = "plan" | "battle" | "over";

/** Something scheduled to happen at battle time `at` (airstrike bombs, fire landing, a para drop). */
interface Pending { kind: C.AbilityKind | "bomb" | "shell"; at: number; x: number; y: number; x2: number; y2: number; chuteSpawned?: boolean }
export interface Fire { x: number; y: number; r: number; until: number }
export interface Fallout { x: number; y: number; r: number; until: number }
export interface Blast { x: number; y: number; r: number; t: number; color: string }
/** 0.28: what a round looks like in flight: small arms, sniper, cannon, shell, rocket. */
export const SHOT_SMALL = 0, SHOT_SNIPER = 1, SHOT_CANNON = 2, SHOT_SHELL = 3, SHOT_ROCKET = 4;
/** 0.28: one round in the air, for the renderer: fired at t from (x0,y0), arrives at `land` at (x1,y1). */
export interface Shot { x0: number; y0: number; x1: number; y1: number; t: number; land: number; cls: number; kind: C.UnitKind }
/** 0.28: a shell or rocket on its way; it explodes (damage, craters, blast) when it lands. */
interface Impact { x: number; y: number; r: number; dmg: number; maxHits?: number; sDmg: number; u: Unit; t: number; color: string }
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
const BUCKET = 4; // cells per spatial bucket
/** 0.28: distance-field units. A straight step costs FIELD_STEP, a diagonal FIELD_DIAG (~sqrt 2), and a cell
 *  under a standing ground unit adds FIELD_OCC (walk around it unless it plugs the only way). */
export const FIELD_STEP = 10, FIELD_DIAG = 14, FIELD_OCC = 300;
const BITE_P3 = 1 - Math.pow(1 - C.BITE_CHANCE, 3); // bite checked every 3rd tick

export interface SimOpts {
  budget?: number;
  waveMul?: number;
  sites?: number;
  speedMul?: number;
  civilians?: number;
  realCityId?: string;
  customMap?: CityMap;
  mutators?: C.MutatorId[];
  difficulty?: C.Difficulty;
}

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
  biasC: Float32Array; biasS: Float32Array; // each agent's fixed lean left/right of the field direction
  fieldDirty = true;

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
  private rebuildOcc(dt = 0) {
    this.occ.fill(0);
    let sig = 0;
    for (const u of this.units) {
      const spec = C.UNITS[u.kind];
      if (spec.on !== "ground" || u.extractT !== undefined || (u.hp !== undefined && u.hp <= 0)) continue;
      const [x0, y0, x1, y1] = this.footRect(spec.foot, Math.floor(u.x), Math.floor(u.y));
      if (spec.crushSlow !== undefined && !(u.deployT && u.deployT > 0)) this.crushUnder(u, x0, y0, x1, y1, dt);
      for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.occ[y * this.w + x] = 1;
      if (!spec.mobile) sig = (sig + Math.imul((x0 + 1) * 73856093 ^ (y0 + 1) * 19349663, spec.foot + 1)) | 0;
    }
    if (sig !== this.occSig) {
      this.occSig = sig;
      this.occStatic.fill(0);
      for (const u of this.units) {
        const spec = C.UNITS[u.kind];
        if (spec.on !== "ground" || spec.mobile || u.extractT !== undefined || (u.hp !== undefined && u.hp <= 0)) continue;
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
    let crushed = 0, civ = false;
    const b0x = Math.max(0, ((x0 - 1) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x1 + 2) / BUCKET) | 0);
    const b0y = Math.max(0, ((y0 - 1) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y1 + 2) / BUCKET) | 0);
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) {
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== INF) continue;
        const x = this.ax[k], y = this.ay[k];
        if (x >= x0 && x < x1 + 1 && y >= y0 && y < y1 + 1) { this.state[k] = DEAD; this.hp[k] = 0; this.recordKill(k, u); crushed++; }
      }
      if (!civ) for (let k = this.headC[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== CIV && this.state[k] !== SAFE_CIV) continue;
        const x = this.ax[k], y = this.ay[k];
        if (x >= x0 - 1 && x < x1 + 2 && y >= y0 - 1 && y < y1 + 2) { civ = true; break; }
      }
    }
    if (crushed) u.crushT = C.CRUSH_SLOW_S;
    u.yieldCiv = civ;
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
  orbits: { x: number; y: number; until: number; gunT: number; howT: number; angle: number }[] = []; // AC-130s on station
  nukesUsed = 0;
  bridges: number[][] = []; // cells of each bridge
  c4 = new Set<number>(); // bridge ids with a charge planted
  blown = new Set<number>();
  mapVersion = 0; // bumps when the map itself changes (a bridge falls or buildings/terrain take damage)
  pending: Pending[] = [];
  fires: Fire[] = [];
  blasts: Blast[] = [];
  shots: Shot[] = [];
  private impacts: Impact[] = [];
  /** 0.28: record a round for the renderer; returns its flight time in seconds. */
  private shoot(u: Unit, x1: number, y1: number, cls: number, mps: number, delay = 0) {
    const x0 = u.x + 0.5, y0 = u.y + 0.5;
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
  liftLog: { kind: "ok" | "abort"; n: number; x: number; y: number }[] = []; // for the UI
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
    const rle = opts.realCityId && REAL_CITY_MAPS[opts.realCityId];
    this.map = opts.customMap ? opts.customMap : rle ? decodeCityMap(rle, seed) : generateCity(seed);
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
    if (!u) return null;
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
  /** 0.27: nearest infected in r that the unit can see past the walls. */
  private nearestSeen(x: number, y: number, r: number) {
    const t = this.nearest(x, y, r, INF, 255, 400);
    if (t < 0 || this.lineClear(x, y, this.ax[t], this.ay[t])) return t;
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let best = -1, bs = r * r, checks = 600;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (--checks <= 0) return best;
        if (this.state[k] !== INF) continue;
        const ddx = this.ax[k] - x, ddy = this.ay[k] - y, d2 = ddx * ddx + ddy * ddy;
        if (d2 <= bs && this.lineClear(x, y, this.ax[k], this.ay[k])) { bs = d2; best = k; }
      }
    return best;
  }

  private placeCivilians(seed: number) {
    const r = rng(seed ^ 0x5bd1e995);
    const spots: number[] = [];
    for (let i = 0; i < this.w * this.h; i++) if (walkable(this.map.tile[i])) spots.push(i);
    for (let k = 0; k < this.civN; k++) {
      const c = spots[Math.floor(r() * spots.length)];
      this.ax[k] = (c % this.w) + r(); this.ay[k] = ((c / this.w) | 0) + r();
      this.state[k] = CIV;
      const a = r() * Math.PI * 2;
      this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a);
    }
    for (let k = this.civN; k < this.n; k++) this.state[k] = DEAD; // outbreak slots, filled at battle start
  }

  // ---------- Planning ----------

  /** Cost of a zone of `cells` cells when it is the `index`-th zone (0 = the first, cheap one). */
  static zonePrice(cells: number, index: number) {
    return index === 0 ? C.ZONE_BASE_COST + Math.round(cells * C.ZONE_COST_PER_CELL) : C.EXTRA_ZONE_BASE + Math.round(cells * C.EXTRA_ZONE_PER_CELL);
  }
  zoneCost() {
    let c = 0;
    this.zoneCellsEach.forEach((n, i) => (c += Sim.zonePrice(n, i)));
    return c;
  }
  // While planning, spending is worked out from the plan (so removing refunds). From the battle on it is a
  // ledger: what was locked in at the start plus every purchase since. Losses and used abilities never refund.
  lockedSpend = 0; battleSpend = 0; earned = 0; lastIncome = 0; private incomeT = 0; private killsPaid = 0;
  unitsLost = 0;
  abilitiesUsed = 0;
  lostLog: string[] = []; // kinds lost, drained by the UI for messages
  soldLog: string[] = [];
  spent() {
    if (this.phase !== "plan") return this.lockedSpend + this.battleSpend;
    let s = this.zoneCost();
    for (const u of this.units) s += u.paid ?? C.UNITS[u.kind].cost;
    for (const b of this.supports) s += b.paid;
    for (const k in this.bought) s += this.bought[k as C.AbilityKind] * C.ABILITIES[k as C.AbilityKind].cost;
    return s + this.c4.size * C.C4_COST;
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
    this.zoneCellsEach.push(cells.length);
    this.zoneCells += cells.length;
    this.pay(price);
    for (let k = 0; k < this.civN; k++) { // civilians already inside are safe
      if (this.state[k] !== CIV) continue;
      if (this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)] === 1) this.state[k] = SAFE_CIV;
    }
    this.refreshUnitAmmo();
    this.fieldDirty = true;
    return null;
  }

  clearZone() {
    if (this.phase !== "plan") return;
    this.zones = []; this.zoneCellsEach = []; this.inZone.fill(0); this.zoneCells = 0;
    this.supports = []; // support buildings require a safe zone; removing the zone refunds them
    for (let k = 0; k < this.civN; k++) if (this.state[k] === SAFE_CIV) this.state[k] = CIV;
    this.refreshUnitAmmo();
    this.refreshAuras();
    this.fieldDirty = true;
  }

  /** Toggle a gate on a wall cell (and its wall neighbors across the road width). */
  toggleGate(x: number, y: number): string | null {
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
    for (const c of run) {
      if (this.phase === "plan") this.wallHp[c] = to === 3 ? gMax : wMax;
      else this.wallHp[c] = to === 2 ? (this.wallHp[c] / gMax) * wMax : (this.wallHp[c] / wMax) * gMax; // keeps its damage
      this.inZone[c] = to;
    }
    this.fieldDirty = true;
    return null;
  }

  /** Turn every intact gate into a wall (planning or battle). Returns how many crossings changed. */
  closeAllGates() {
    let n = 0;
    const gMax = this.gateMaxHp(), wMax = this.wallMaxHp();
    for (let i = 0; i < this.inZone.length; i++) {
      if (this.inZone[i] !== 3 || this.wallHp[i] <= 0) continue;
      this.wallHp[i] = this.phase === "plan" ? wMax : (this.wallHp[i] / gMax) * wMax;
      this.inZone[i] = 2; n++;
    }
    if (n) this.fieldDirty = true;
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

  unitCost(kind: C.UnitKind, x?: number, y?: number) {
    let base = C.UNITS[kind].cost;
    if (this.mutators.has("swimmer_surge") && (kind === "gunboat" || kind === "battleship")) base = Math.round(base * 0.75);
    return x !== undefined && y !== undefined && this.hasActiveSupport("budget", x, y)
      ? Math.round(base * (1 - C.BUDGET_DISCOUNT)) : base;
  }

  supportCost(kind: C.SupportKind, x?: number, y?: number) {
    let base = C.SUPPORTS[kind].cost;
    if (kind === "evac") { // 0.20: each extra pad costs EVAC_COST_MUL times the last; a standing pad keeps its own place in line
      const pads = this.supports.filter(b => b.kind === "evac");
      const at = x !== undefined ? pads.findIndex(b => b.x === x && b.y === y) : -1;
      base = padCost(base, at >= 0 ? at : pads.length);
    }
    if (this.mutators.has("supply_shortage") && kind === "supply") base = Math.round(base * 0.5);
    if (this.mutators.has("fragile_walls") && kind === "repair") base = Math.round(base * 0.75);
    return x !== undefined && y !== undefined && kind !== "budget" && this.hasActiveSupport("budget", x, y)
      ? Math.round(base * (1 - C.BUDGET_DISCOUNT)) : base;
  }

  canPlace(kind: C.UnitKind, x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    const spec = C.UNITS[kind];
    const t = this.tileAt(x, y);
    if (spec.on === "building" && t !== BUILDING) return `${spec.name}s go on buildings.`;
    if (spec.on === "ground" && !walkable(t)) return `${spec.name}s go on streets or parks.`;
    if (spec.on === "water" && t !== WATER) return `${spec.name}s go on the river.`;
    if (spec.on === "zone" && this.inZone[this.idx(x, y)] !== 1) return `${spec.name}s take off from inside a safe zone.`;
    if (spec.on === "any") return "That unit can't be built.";
    const near = this.overlapAt(spec.foot, x, y);
    if (near) return near;
    if (this.remaining() < this.unitCost(kind, x, y)) return "Not enough budget.";
    return null;
  }

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
    const u: Unit = {
      kind, x, y, range: spec.range + spec.roofBonus * lvl, ammo: spec.ammo,
      cooldown: 0, kills: 0, shotX: 0, shotY: 0, shotT: -1, paid: cost,
    };
    if (spec.mobile) { u.post = [x, y]; u.hp = spec.mobile.hp; u.ai = "hunt"; u.thinkT = 0; }
    else if (spec.hp) u.hp = spec.hp; // 0.24: street emplacements can be clawed down
    this.units.push(u);
    if (this.phase === "plan") this.refreshUnitAmmo();
    else {
      const inside = spec.reloadsInZone && this.unitInZone(u);
      u.ammo = inside ? (this.mutators.has("supply_shortage") ? spec.ammo * 2 : Infinity) : spec.ammo;
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
    if (this.tileAt(x, y) !== BUILDING) return `${spec.name}s go on buildings.`;
    if (!this.unitInZone({ x, y })) return `${spec.name}s must be placed on a building inside a safe zone.`;
    if (kind === "militia" && this.supports.filter(b => b.kind === "militia").length >= C.MILITIA_MAX) return `Only ${C.MILITIA_MAX} Armories per battle.`;
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
  sellAt(x: number, y: number): number | string {
    if (this.phase !== "battle") return "Nothing to sell.";
    const u = this.units.find(u => Math.abs(u.x + 0.5 - x) <= 1.5 && Math.abs(u.y + 0.5 - y) <= 1.5);
    if (u) {
      if (u.kind === "para") return "Paratroopers can't be sold. They walk home when out of ammo.";
      if (u.kind === "police" || u.kind === "militia") return "Squads from support buildings or APCs can't be sold directly.";
      if (u.extractT !== undefined) return "Already being pulled out.";
      u.extractT = Math.max(5, C.UNITS[u.kind].deploy * C.EXTRACT_MUL);
      if (C.UNITS[u.kind].on !== "water") {
        this.spawnHelo("helo_extract", u.x + 0.5, u.y + 0.5, u.extractT + 1.2, u.extractT * 0.4, "#cfd8dc", `EVAC: ${C.UNITS[u.kind].name}`);
      }
      return u.extractT;
    }
    const b = this.supports.find(b => Math.abs(b.x + 0.5 - x) <= 1.5 && Math.abs(b.y + 0.5 - y) <= 1.5);
    if (!b) return "No unit or building there.";
    if (b.extractT !== undefined) return "Already being pulled out.";
    b.extractT = Math.max(5, C.SUPPORTS[b.kind].deploy * C.EXTRACT_MUL);
    this.spawnHelo("helo_extract", b.x + 0.5, b.y + 0.5, b.extractT + 1.2, b.extractT * 0.4, "#cfd8dc", `EVAC: ${C.SUPPORTS[b.kind].name}`);
    this.refreshAuras();
    return b.extractT;
  }

  removeAt(x: number, y: number) {
    if (this.phase !== "plan") return false;
    const k = this.units.findIndex(u => Math.abs(u.x - x) <= 1 && Math.abs(u.y - y) <= 1);
    if (k >= 0) { this.units.splice(k, 1); return true; }
    const sk = this.supports.findIndex(b => Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1);
    if (sk >= 0) {
      const removed = this.supports.splice(sk, 1)[0];
      if (removed.kind === "evac" && this.phase === "plan") for (const b of this.supports) if (b.kind === "evac") b.paid = this.supportCost(b.kind, b.x, b.y); // pads move up the price line
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
    return false;
  }

  buyAbility(k: C.AbilityKind): string | null {
    if (this.phase === "over") return "The battle is over.";
    if (this.bought[k] >= C.ABILITIES[k].max && !this.dev.noStockpileLimits) return `Only ${C.ABILITIES[k].max} ${C.ABILITIES[k].name} available per battle.`;
    if (this.remaining() < C.ABILITIES[k].cost) return "Not enough money.";
    this.bought[k]++; this.charges[k]++;
    this.pay(C.ABILITIES[k].cost);
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
  /** Blow the charged bridge at x,y: it becomes river and whoever is on it falls. */
  blowBridge(x: number, y: number): string | null {
    if (this.phase !== "battle") return "Bridges can only be blown during the battle.";
    const b = this.bridgeAt(x, y);
    if (b < 0 || !this.c4.has(b)) return "No charge on that bridge. Plant charges while planning.";
    if (this.blown.has(b)) return "Already blown.";
    this.blown.add(b);
    const cells = new Set(this.bridges[b]);
    for (const i of cells) { this.map.tile[i] = WATER; this.inZone[i] = 0; }
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD || !cells.has(this.idx(this.ax[k] | 0, this.ay[k] | 0))) continue;
      if (s === INF) this.recordKill(k); else this.civKilledByUs++;
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
    this.charges[k]--; this.abilitiesUsed++;
    const delay = C.ABILITIES[k].delay;
    this.pending.push({ kind: k, at: this.time + delay, x, y, x2, y2 });
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
      this.spawnFlyover("c130_para", x, y, delay * 1.2, "#ce93d8", undefined, "AC-130J Ghostrider", "ac130");
    } else if (k === "moab") {
      this.spawnFlyover("c130_supply", x, y, delay * 1.2, "#ffcc80", undefined, "MC-130J: GBU-43 MOAB", "mc130");
    } else if (k === "nuke") {
      this.spawnFlyover("jet_strike", x, y, delay * 1.1, "#76ff03", undefined, "INBOUND: TACTICAL NUCLEAR STRIKE");
    }
    return null;
  }

  private recordKill(k: number, u?: Unit) {
    this.kills++;
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
        } else if (dmg >= 50) { this.state[k] = DEAD; this.civKilledByUs++; } // civilians have no armor
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
        if (p.kind === "airstrike") { // a stick of bombs walking along the run
          const l = hyp(p.x2 - p.x, p.y2 - p.y), n = Math.max(2, Math.round(l / 5));
          for (let i = 0; i <= n; i++) {
            const f = i / n;
            this.pending.push({ kind: "bomb", at: this.time + i * 0.08, x: p.x + (p.x2 - p.x) * f, y: p.y + (p.y2 - p.y) * f, x2: 0, y2: 0 });
          }
        } else if (p.kind === "bomb") {
          this.areaDamage(p.x, p.y, C.AIRSTRIKE_RADIUS, 5000, true);
          this.damageTerrain(p.x, p.y, C.AIRSTRIKE_RADIUS, C.STRUCT_DMG_AIRSTRIKE);
          this.blasts.push({ x: p.x, y: p.y, r: C.AIRSTRIKE_RADIUS + 1, t: this.time, color: "#ffab40" });
        } else if (p.kind === "firebomb") {
          const park = this.tileAt(p.x | 0, p.y | 0) === PARK;
          const r = park ? C.FIRE_RADIUS_PARK : C.FIRE_RADIUS;
          this.fires.push({ x: p.x, y: p.y, r, until: this.time + C.FIRE_S });
          this.damageTerrain(p.x, p.y, r * 0.85, C.STRUCT_DMG_FIREBOMB);
          this.blasts.push({ x: p.x, y: p.y, r: 4, t: this.time, color: "#ff9100" });
        } else if (p.kind === "para") {
          const spec = C.UNITS.para;
          this.units.push({ kind: "para", x: p.x | 0, y: p.y | 0, range: spec.range, ammo: spec.ammo, cooldown: 0.5, kills: 0, shotX: 0, shotY: 0, shotT: -1,
            post: [p.x | 0, p.y | 0], hp: spec.mobile!.hp, ai: "hunt", thinkT: 0 });
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
        } else if (p.kind === "gunship") {
          this.orbits.push({ x: p.x, y: p.y, until: this.time + C.GUNSHIP_S, gunT: 0, howT: 1, angle: 0 });
        } else if (p.kind === "barrage") { // a fire mission: shells land scattered over a few seconds
          const rr = rng((this.tick * 2246822519 + (p.x * 131 | 0)) >>> 0);
          for (let i = 0; i < C.BARRAGE_SHELLS; i++) {
            const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.BARRAGE_RADIUS;
            this.pending.push({ kind: "shell", at: this.time + rr() * C.BARRAGE_S, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, x2: 0, y2: 0 });
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
          this.fallout.push({ x: p.x, y: p.y, r: C.FALLOUT_RADIUS, until: this.time + C.FALLOUT_S });
          this.blasts.push({ x: p.x, y: p.y, r: C.NUKE_RADIUS, t: this.time, color: "#f4ff81" });
          this.refreshAuras(); this.fieldDirty = true;
        }
      }
    }
    if (this.fires.length) {
      this.fires = this.fires.filter(f => f.until > this.time);
      // Fire hurts every 4th tick, in a bigger bite.
      if (this.tick % 4 === 0) for (const f of this.fires) this.areaDamage(f.x, f.y, f.r, C.FIRE_DPS * dt * 4, true);
    }
    if (this.orbits.length) this.stepOrbits(dt);
    if (this.fallout.length) {
      this.fallout = this.fallout.filter(f => f.until > this.time);
      if (this.tick % 4 === 0) for (const f of this.fallout) this.irradiate(f, dt * 4);
    }
    if (this.blasts.length) this.blasts = this.blasts.filter(b => this.time - b.t < 1);
    this.stepTransports(dt);
  }

  /** AC-130 on station: circles the spot, 30 mm on single infected, 105 mm on packs. Precise: infected only. */
  private stepOrbits(dt: number) {
    this.orbits = this.orbits.filter(o => o.until > this.time);
    for (const o of this.orbits) {
      o.angle -= dt * 0.5; // a left-hand orbit: the guns point out the left side, at the middle
      o.gunT -= dt;
      while (o.gunT <= 0) {
        o.gunT += 1 / C.GUNSHIP_GUN_RATE;
        const rr = rng((this.tick * 69069 + (o.gunT * 1e4 | 0)) >>> 0);
        const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.GUNSHIP_RADIUS;
        const t = this.nearest(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, 8, INF, 255, 60);
        if (t < 0) continue;
        this.hp[t] -= C.GUNSHIP_GUN_DMG;
        if (this.hp[t] <= 0) { this.state[t] = DEAD; this.recordKill(t); }
      }
      o.howT -= dt;
      if (o.howT <= 0) {
        o.howT = C.GUNSHIP_HOW_EVERY;
        // the densest pack in the orbit
        let best = -1, bn = 2;
        const rr = rng((this.tick * 1103515245) >>> 0);
        for (let s = 0; s < 24; s++) {
          const a = rr() * 6.2832, d = Math.sqrt(rr()) * C.GUNSHIP_RADIUS, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
          const n = this.countInf(x, y, C.GUNSHIP_HOW_SPLASH, 40);
          if (n > bn) { bn = n; best = this.nearest(x, y, C.GUNSHIP_HOW_SPLASH, INF, 255, 40); }
        }
        if (best >= 0 && this.clearOfZone(this.ax[best], this.ay[best], C.GUNSHIP_HOW_SPLASH)) {
          const sx = this.ax[best], sy = this.ay[best];
          this.areaDamage(sx, sy, C.GUNSHIP_HOW_SPLASH, C.GUNSHIP_HOW_DMG, false);
          this.damageTerrain(sx, sy, C.GUNSHIP_HOW_SPLASH * 0.7, 60);
          this.blasts.push({ x: sx, y: sy, r: C.GUNSHIP_HOW_SPLASH, t: this.time, color: "#ce93d8" });
        }
      }
    }
  }

  /** Walls and gates within r take dmg (a breach once they drop to 0). */
  private hurtWalls(x: number, y: number, r: number, dmg: number) {
    const x0 = Math.max(0, (x - r) | 0), x1 = Math.min(this.w - 1, Math.ceil(x + r)), y0 = Math.max(0, (y - r) | 0), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    let broke = false;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const i = this.idx(cx, cy), z = this.inZone[i];
      if ((z !== 2 && z !== 3) || this.wallHp[i] <= 0 || hyp(cx - x, cy - y) > r) continue;
      this.wallHp[i] = Math.max(0, this.wallHp[i] - dmg);
      if (this.wallHp[i] <= 0) { broke = true; }
    }
    if (broke) { this.breaches++; this.fieldDirty = true; }
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
        if (dx * dx + dy * dy <= r2 && rr() < C.FALLOUT_CIV_P) { this.state[k] = DEAD; this.civKilledByUs++; }
      }
  }

  /** Strike order: send a mobile unit to clear and hold a spot (land units on streets, boats on the river). */
  orderUnit(u: Unit, x: number, y: number): string | null {
    const mob = C.UNITS[u.kind].mobile;
    if (!mob) return "Only mobile units take orders (APCs, squads, paratroopers, boats).";
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "Off the map.";
    const t = this.map.tile[this.idx(x, y)];
    if (mob.nav !== "air" && (mob.nav === "water" ? t !== WATER : !walkable(t))) return mob.nav === "water" ? "Boats go on the river." : "Send it to a street or park.";
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
      this.recalled = false;
      return n;
    }
    const cells: number[] = [];
    for (let i = 0; i < this.inZone.length; i++) if (this.inZone[i] === 1 && walkable(this.map.tile[i])) cells.push(i);
    if (!cells.length) return 0;
    for (const u of this.units) {
      const mob = C.UNITS[u.kind].mobile;
      if (!mob || mob.nav === "water" || !u.post || u.extractT !== undefined) continue;
      let best = -1, bd = Infinity;
      for (const i of cells) { const dx = (i % this.w) - u.x, dy = ((i / this.w) | 0) - u.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
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
        const cap = shortage && spec.reloadsInZone && this.unitInZone(u) ? spec.ammo * 2 : spec.ammo;
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
              const cap = shortage && spec.reloadsInZone && this.unitInZone(u) ? spec.ammo * 2 : spec.ammo;
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
              if (this.hp[k] <= 0) { this.state[k] = DEAD; this.recordKill(k); }
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
                if (dx * dx + dy * dy <= br2) {
                  this.state[k] = DEAD; // carried out of the city
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

  private refreshUnitAmmo() {
    const shortage = this.mutators.has("supply_shortage");
    for (const u of this.units) {
      const spec = C.UNITS[u.kind];
      const inside = spec.reloadsInZone && this.unitInZone(u);
      const zoneAmmo = shortage ? spec.ammo * 2 : Infinity;
      if (this.phase === "plan") u.ammo = inside ? zoneAmmo : spec.ammo;
      else if (inside && !shortage) u.ammo = Infinity; // a zone built around it mid-battle: supplied from now on (never a free refill otherwise)
    }
  }

  /** Recompute range, firing rate and supply buffs on every unit from active support buildings. */
  refreshAuras() {
    const roofMul = this.mutators.has("fragile_walls") ? 1.3 : 1;
    for (const u of this.units) {
      const spec = C.UNITS[u.kind];
      const lvl = spec.roofBonus ? this.map.height[this.idx(u.x | 0, u.y | 0)] : 0;
      u.rangeBoosted = this.hasActiveSupport("radio", u.x, u.y);
      const rm = (u.rangeBoosted ? C.RADIO_RANGE_MUL : 1) * (spec.on === "building" ? roofMul : 1);
      u.range = (spec.range + spec.roofBonus * lvl) * rm;
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
    this.findEntries();
    this.planWave(r);
    this.lockedSpend = this.spent();
    this.origFloors = Uint8Array.from(this.map.height);
    this.phase = "battle";
    this.fieldDirty = true;
    this.rebuildBuckets();
  }
  sites: [number, number][] = [];
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
    this.entries = out.filter(e => e.kind !== "river").slice(0, 8).concat(out.filter(e => e.kind === "river").slice(0, 2));
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
    this.head.fill(-1); this.headC.fill(-1); this.dens.fill(0); this.sumX.fill(0); this.sumY.fill(0);
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD) continue;
      const ci = (this.ay[k] | 0) * this.w + (this.ax[k] | 0);
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
    if (this.fieldDirty) this.buildFields();
    this.rebuildBuckets();
    this.time += dt; this.tick++;
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
    if (this.time >= this.nextWaveT) {
      const h = this.heatNow();
      if (this.dev.waves) this.spawnWave(r, infHpScale, h);
      this.nextWaveT = this.time + rollGap(this.diff, h, r, this.mutators.has("blitz_hordes"));
    }
    if (this.marching.length) this.stepMarch(r, dt);
    this.rebuildOcc(dt);

    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === DEAD) continue;
      if (s === SAFE_CIV) {
        // 0.28: just through the gate: walk on in every tick at full pace, so the doorway never plugs
        if (this.depth[this.idx(this.ax[k] | 0, this.ay[k] | 0)] < C.GATE_CLEAR_DEPTH) this.mill(k, r, dt);
        else if ((k + this.tick) % 4 === 0) this.mill(k, r, dt * 4);
        continue;
      }
      const x = this.ax[k], y = this.ay[k];
      const cx = x | 0, cy = y | 0;
      const cellIdx = cy * this.w + cx;
      const cellTile = this.map.tile[cellIdx];
      const cellInfra = (cellTile === 0 || cellTile === BRIDGE) ? this.map.height[cellIdx] : 0;
      let vx = 0, vy = 0, speed: number;
      if (s === CIV && this.occ[cellIdx]) { // 0.24: a unit was put down or drove onto them: step out
        const out = this.wallExit(cx, cy, false);
        if (out >= 0) { this.ax[k] = (out % this.w) + 0.5; this.ay[k] = ((out / this.w) | 0) + 0.5; }
        continue;
      }
      if (s === CIV) {
        speed = C.CIV_SPEED * (cellInfra === INFRA_HIGHWAY ? C.HIGHWAY_SPEED_MUL : cellInfra === INFRA_RAIL || cellInfra === INFRA_STATION ? C.RAIL_SPEED_MUL : 1)
        if (this.rough[cellIdx]) speed *= this.roughMul(cellIdx); // 0.23: craters slow everyone
        // Flee: steer away from the nearest infected (checked every 4th tick, staggered).
        if ((k + this.tick) % 4 === 0) {
          const e = this.nearest(x, y, C.CIV_SENSE, INF);
          if (e >= 0) {
            const dx = x - this.ax[e], dy = y - this.ay[e], l = hyp(dx, dy) || 1;
            this.hx[k] = dx / l; this.hy[k] = dy / l;
            this.hp[k] = 1.5; // panic timer (seconds) reuses hp for civilians
          }
        }
        if (this.hp[k] > 0) { this.hp[k] -= dt; vx = this.hx[k]; vy = this.hy[k]; speed *= 1.15; }
        // Crowds jam: a packed cell slows everyone in it (panicked people shove instead of spreading out).
        const dn = this.dens[cellIdx];
        if (dn > C.CIV_JAM_DENS) speed *= Math.max(0.2, C.CIV_JAM_DENS / dn);
        const di = 2 * cellIdx, ddx = this.zoneClosed ? this.civDir[di] : 0, ddy = this.zoneClosed ? this.civDir[di + 1] : 0;
        if (ddx !== 0 || ddy !== 0) { const c = this.biasC[k], sn = this.biasS[k]; vx = vx * 0.6 + ddx * c - ddy * sn; vy = vy * 0.6 + ddx * sn + ddy * c; }
        else if (this.hp[k] <= 0) {
          if (r() < 0.02) { const a = r() * 6.283; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); }
          vx = this.hx[k]; vy = this.hy[k]; speed *= 0.5; // aimless when there's nowhere safe to go
        }
      } else {
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
        speed = infSpeed * (swimmer ? (onWater ? C.SWIMMER_SPEED_WATER : C.SWIMMER_SPEED_LAND) : 1);
        if (!onWater) {
          if (cellInfra === INFRA_HIGHWAY) speed *= C.HIGHWAY_SPEED_MUL;
          else if (cellInfra === INFRA_RAIL || cellInfra === INFRA_STATION) speed *= C.RAIL_SPEED_MUL;
          speed *= this.roughMul(cellIdx);
        }
        // Chase the nearest civilian in sight (retarget every 5th tick), else follow the field to the zone.
        if ((k + this.tick) % 6 === 0) {
          const t = this.nearest(x, y, C.INF_SENSE, CIV, SAFE_CIV);
          if (t >= 0) {
            const dx = this.ax[t] - x, dy = this.ay[t] - y, l = hyp(dx, dy) || 1;
            this.hx[k] = dx / l; this.hy[k] = dy / l;
            this.chase[k] = 1;
          } else this.chase[k] = 0;
        }
        if (this.chase[k]) { vx = this.hx[k]; vy = this.hy[k]; speed *= C.INF_LUNGE_MUL; } // a live person in sight: they surge
        else {
          const dir = swimmer ? this.swimDir : this.infDir;
          const di = 2 * (cy * this.w + cx), ddx = this.zoneClosed ? dir[di] : 0, ddy = this.zoneClosed ? dir[di + 1] : 0;
          if (ddx !== 0 || ddy !== 0) { const c = this.biasC[k], sn = this.biasS[k]; vx = ddx * c - ddy * sn; vy = ddx * sn + ddy * c; }
          else {
            if (r() < 0.03) { const a = r() * 6.283; this.hx[k] = Math.cos(a); this.hy[k] = Math.sin(a); }
            vx = this.hx[k]; vy = this.hy[k];
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
            this.state[v] = INF; this.mutant[v] = 0; this.hp[v] = C.INF_HP * infHpScale * this.infHpMul; this.chase[v] = 0; this.infectedEver++;
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
      if (s === CIV) { const z = this.inZone[this.idx(this.ax[k] | 0, this.ay[k] | 0)]; if (z === 1 || z === 3) this.state[k] = SAFE_CIV; } // a gate is a guarded checkpoint
    }

    if (this.tick % 20 === 0) { this.refreshAuras(); this.hasPads = this.supports.some(b => b.kind === "evac"); if (this.hasPads) this.buildPadField(); }
    this.stepSupports(dt);
    this.fireUnits(dt);
    this.units = this.units.filter(u => {
      if (u.hp === undefined || u.hp > 0) return true;
      if (u.parentUnit) return false;
      this.unitsLost++;
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
    if (this.hp[k] > 0) { this.hp[k] -= dt; sp = C.CIV_SPEED * dt; }
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
    if (pf !== 65535 && pf > C.EVAC_GATHER_D) {
      const d = this.downhill(this.padField, this.ax[k] | 0, this.ay[k] | 0);
      if (d) { this.hx[k] = d[0]; this.hy[k] = d[1]; sp = C.CIV_SPEED * C.EVAC_WALK_MUL * dt; }
    }
    let hx = this.hx[k], hy = this.hy[k];
    if (clearing) {
      if (this.dens[ci] > 1) { this.grain(k, ci); hx += this.spx * C.GRAIN_PUSH; hy += this.spy * C.GRAIN_PUSH; }
      const l = hyp(hx, hy); if (l > 1) { hx /= l; hy /= l; }
    }
    if (this.inZone[ci] === 1 && this.hp[k] <= 0 && pf === 65535) { this.spread(this.ax[k] | 0, this.ay[k] | 0); hx += this.spx * 1.5; hy += this.spy * 1.5; } // fill the zone evenly
    const nx = Math.fround(this.ax[k] + hx * sp), ny = Math.fround(this.ay[k] + hy * sp);
    const ok = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      const i = this.idx(x | 0, y | 0);
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
        if (this.dev.wallDamage) this.wallHp[n] -= C.WALL_DPS * dt;
        if (this.wallHp[n] <= 0) { this.wallHp[n] = -1; this.breaches++; this.fieldDirty = true; }
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
              if (this.wallHp[ci] < maxHp) this.wallHp[ci] = Math.min(maxHp, this.wallHp[ci] + C.REPAIR_WALL_HPS * dt4);
            }
          }
        }
        for (const u of this.units) {
          const max = C.maxHp(C.UNITS[u.kind]); // 0.24: emplacements too
          if (max === undefined || u.hp === undefined || u.hp <= 0 || u.hp >= max) continue;
          const dx = u.x - b.x, dy = u.y - b.y;
          if (dx * dx + dy * dy <= R2) u.hp = Math.min(max, u.hp + C.REPAIR_UNIT_HPS * dt4);
        }
      } else if (b.kind === "supply" && this.tick % 4 === 0) {
        const dt4 = dt * 4;
        const shortage = this.mutators.has("supply_shortage");
        for (const u of this.units) {
          if (u.ammo === Infinity || u.extractT !== undefined || (u.deployT && u.deployT > 0)) continue;
          const uspec = C.UNITS[u.kind];
          const cap = shortage && uspec.reloadsInZone && this.unitInZone(u) ? uspec.ammo * 2 : uspec.ammo;
          if (u.ammo >= cap) continue;
          const dx = u.x - b.x, dy = u.y - b.y;
          if (dx * dx + dy * dy <= R2) {
            u.ammo = Math.min(cap, u.ammo + uspec.ammo * C.SUPPLY_AMMO_RATE * dt4);
            if (this.tick % 48 === 0 && this.transports.length < 10 && dx * dx + dy * dy > 9) {
              this.spawnHelo("drone_supply", u.x + 0.5, u.y + 0.5, 2.2, 0.3, "#ffb74d", undefined, b.x + 0.5, b.y + 0.5);
            }
          }
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
      if (this.countInf(x, y, C.SUPPORTS.evac.radius, C.EVAC_ABORT_INF) >= C.EVAC_ABORT_INF) {
        this.liftsAborted++; this.liftLog.push({ kind: "abort", n: 0, x: b.x, y: b.y });
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
            this.state[k] = DEAD; n++; // flown out
          }
      }
      this.evacuated += n; this.liftsFlown++;
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
    for (const b of this.supports) {
      if (b.kind !== "evac" || b.extractT !== undefined || (b.deployT && b.deployT > 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { // the street cells around the pad's building
        const x = b.x + dx, y = b.y + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = this.idx(x, y);
        if (f[i] === 65535 && this.inZone[i] === 1 && walkable(this.map.tile[i])) { f[i] = 0; q[qt++] = i; }
      }
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
    // ...then, for anyone a unit has cut off, squeezing past it (dearer, so only the cut-off side uses it)
    const seeds: number[] = [];
    for (let i = 0; i < qt; i++) {
      const c = q[i], cx = c % this.w;
      for (const n of [cx > 0 ? c - 1 : -1, cx < this.w - 1 ? c + 1 : -1, c - this.w, c + this.w]) {
        if (!open(n) || !this.occ[n]) continue;
        f[n] = Math.min(65534, f[c] + C.SQUEEZE_COST); sq[n] = 1; seeds.push(n);
      }
    }
    if (!seeds.length) return;
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
          this.areaDamage(m.x, m.y, m.r, m.dmg, false, m.u, m.maxHits);
          this.damageTerrain(m.x, m.y, m.r, m.sDmg);
          this.blasts.push({ x: m.x, y: m.y, r: m.r, t: this.time, color: m.color });
        }
      }
    }
    for (const u of this.units) {
      u.cooldown -= dt;
      const spec = C.UNITS[u.kind];
      if (u.extractT !== undefined) {
        u.extractT -= dt;
        if (spec.mobile && spec.mobile.hp !== Infinity && (this.tick + u.post![0]) % 4 === 0) u.hp! -= this.dev.unitDamage ? this.countInf(u.x + 0.5, u.y + 0.5, 1.3, 12) * C.MOBILE_HURT_DPS * dt * 4 : 0;
        if (u.extractT <= 0 && (u.hp === undefined || u.hp > 0)) { u.hp = -1; this.unitsLost--; this.battleSpend -= u.paid ?? spec.cost; this.soldLog.push(u.kind); }
        continue;
      }
      if (u.deployT && u.deployT > 0) { u.deployT -= dt; if (u.deployT <= 0) { u.deployT = 0; this.refreshAuras(); } else continue; }
      // 0.24: infected pressing on a street emplacement claw at it like a wall (it keeps shooting)
      if (!spec.mobile && spec.hp && u.hp !== undefined && u.hp > 0 && (this.tick + u.x) % 4 === 0 && this.dev.unitDamage) {
        const [x0, y0, x1, y1] = this.footRect(spec.foot, u.x, u.y);
        u.hp -= this.countInf((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, spec.foot * 0.7 + 1.2, 16) * C.MOBILE_HURT_DPS * dt * 4; // footprint plus the ring of cells around it
      }
      if (spec.mobile) { this.think(u, dt); if (u.ai === "home" || u.ai === "reload" || u.ai === "leave") continue; }
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
          const t = this.blockedByWalls(u.kind) ? this.nearestSeen(u.x + 0.5, u.y + 0.5, cr) : this.nearest(u.x + 0.5, u.y + 0.5, cr, INF, 255, 400);
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

  /** Target for a direct-fire unit, by its priority. */
  private pickTarget(u: Unit) {
    const x = u.x + 0.5, y = u.y + 0.5, R = u.range, mode = u.mode ?? "near";
    const los = this.blockedByWalls(u.kind); // 0.27: can't shoot through a standing wall
    if (mode === "near") return los ? this.nearestSeen(x, y, R) : this.nearest(x, y, R, INF, 255, 400);
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
        if (score < bs && (!los || this.lineClear(x, y, this.ax[k], this.ay[k]))) { bs = score; best = k; }
      }
    }
    return best;
  }

  /** Distance field to `goal` over what this unit can travel: roads (through our own gates) or the river. */
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

  /** Infected within r of (x,y), up to cap. */
  private countInf(x: number, y: number, r: number, cap = 50, chasingOnly = false) {
    const b0x = Math.max(0, ((x - r) / BUCKET) | 0), b1x = Math.min(this.bw - 1, ((x + r) / BUCKET) | 0);
    const b0y = Math.max(0, ((y - r) / BUCKET) | 0), b1y = Math.min(this.bh - 1, ((y + r) / BUCKET) | 0);
    let n = 0;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++)
      for (let k = this.head[by * this.bw + bx]; k !== -1; k = this.next[k]) {
        if (this.state[k] !== INF || (chasingOnly && !this.chase[k])) continue;
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
        });
      }
    }
    // Getting bitten: infected touching it wear it down (boats are out of reach).
    if (mob.hp !== Infinity && (this.tick + u.post![0]) % 4 === 0) u.hp! -= this.dev.unitDamage ? this.countInf(fx, fy, spec.on === "ground" ? Math.max(1.3, spec.foot * 0.7 + 1.2) : 1.3, spec.on === "ground" ? 16 : 12) * C.MOBILE_HURT_DPS * (spec.clawMul ?? 1) * dt * 4 : 0; // 0.25: armor
    if (u.ai === "reload") {
      u.reloadT! -= dt * (u.supplied ? 2 : 1);
      if (u.reloadT! <= 0) { u.ammo = spec.ammo; u.hp = Math.min(mob.hp, u.hp! + mob.hp * 0.5); u.ai = "hunt"; u.thinkT = 0; }
      return;
    }
    u.thinkT = (u.thinkT ?? 0) - dt;
    if (u.thinkT <= 0) {
      u.thinkT = 1.5;
      const low = u.ammo !== Infinity && u.ammo < spec.ammo * 0.15;
      const hurt = mob.hp !== Infinity && u.hp! < mob.hp * 0.35;
      const crowd = this.countInf(fx, fy, 5, 30);
      if (mob.nav === "air" && (low || u.ammo < 1)) {
        u.ai = "home"; // fly back to the zone to rearm
      } else if ((low || hurt) && (u.kind === "apc" || u.kind === "tank" || u.kind === "police" || u.kind === "militia") && this.zoneClosed) {
        u.ai = "home"; // the APC field already leads into the zone
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
      * (u.crushT && u.crushT > 0 ? spec.crushSlow ?? 1 : 1) * (u.yieldCiv ? C.CRUSH_YIELD_MUL : 1); // 0.25: crushing slows it; people in the way, it creeps
    let d: [number, number] | null = null;
    if (mob.nav === "air") { // flies straight to its goal (or home to its post to rearm)
      if (u.ai === "hunt" && hyp(fx - u.post![0], fy - u.post![1]) < mob.leash * 0.6 && this.nearest(fx, fy, u.range * 0.75, INF, 255, 120) >= 0) return;
      const g = u.ai === "home" ? this.idx(u.post![0], u.post![1]) : u.goal;
      if (g === undefined) return;
      const gx = (g % this.w) + 0.5 - fx, gy = ((g / this.w) | 0) + 0.5 - fy, l = hyp(gx, gy);
      if (l < 1) { if (u.ai === "home") { u.ai = "reload"; u.reloadT = mob.rearmS ?? 10; } return; }
      const step = Math.min(l, mob.speed * dt);
      u.x += gx / l * step; u.y += gy / l * step;
      return;
    }
    if (u.ai === "home" || u.ai === "leave") {
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
      const transit = hyp(fx - u.post![0], fy - u.post![1]) > mob.leash * 0.6;
      // Kite: infected closing in, back off while shooting, never into a corner.
      if (u.ai === "hunt" && mob.hp !== Infinity) {
        const near = this.nearest(fx, fy, transit ? 2.5 : u.range * C.KITE_R, INF, 255, 120);
        if (near >= 0) { const k = this.kiteStep(fx, fy, near, sp); if (k) { u.x += k[0]; u.y += k[1]; u.kiting = true; } return; }
      }
      u.kiting = false;
      // Hold still while there is something to shoot (and nothing about to swarm it).
      if (u.ai === "hunt" && !transit && this.nearest(fx, fy, u.range * 0.75, INF, 255, 120) >= 0) return;
      if (u.nav && u.goal !== undefined) d = this.downhill(u.nav, cx, cy);
    }
    if (!d && u.nav && u.goal !== undefined && u.nav[this.idx(cx, cy)] === 65535) d = this.unstick(u.nav, cx, cy); // knocked off its route
    if (!d) return;
    // Stay on streets (or water): slide along an axis instead of cutting a corner into a building.
    const water = mob.nav === "water";
    const okc = (x: number, y: number) => { const i = this.idx(Math.min(this.w - 1, Math.max(0, (x + 0.5) | 0)), Math.min(this.h - 1, Math.max(0, (y + 0.5) | 0))), t = this.map.tile[i]; return water ? (t === WATER || t === BRIDGE) : this.unitPass(i); };
    const nx = u.x + d[0] * sp, ny = u.y + d[1] * sp;
    if (okc(nx, ny)) { u.x = nx; u.y = ny; }
    else if (okc(nx, u.y)) u.x = nx;
    else if (okc(u.x, ny)) u.y = ny;
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
      if (sc > bestN && pick >= 0 && this.clearOfZone(this.ax[pick], this.ay[pick], C.UNITS[u.kind].splash ?? 0)) { bestN = sc; best = pick; }
    }
    return best;
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
    let civ = 0, safe = 0, inf = 0;
    for (let k = 0; k < this.n; k++) {
      const s = this.state[k];
      if (s === CIV) civ++; else if (s === SAFE_CIV) safe++; else if (s === INF) inf++;
    }
    return { civ, safe, inf, total: this.civN };
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
  scoreNow(reason: string): Score {
    const saved = this.evacuated, pct = (100 * saved) / this.civN;
    const { intact, bill } = this.cityDamage();
    const emptiedAfterS = this.roundDone && this.roundEmptied && this.roundAt !== null ? Math.max(0, this.roundAt - C.WARNING_S) : null;
    const parts = roundParts({ pct, emptiedAfterS, intact, kills: this.kills, infAlive: this.counts().inf });
    const score = roundScore(parts), medal = medalFor(score, pct);
    const bonus = intact >= C.INTACT_BONUS_PCT ? "Light Touch" : 100 - intact >= C.SCORCHED_BONUS_PCT || bill >= C.BILLION ? "Scorched Earth" : null;
    const xp = Math.max(0, Math.round((score * 10 + this.wave * 20 + (bonus ? C.BONUS_XP : 0) - this.nukesUsed * C.NUKE_XP_PENALTY) * this.diff.xpMul));
    return { saved, pct, medal, reason, intact, bonus, xp, waves: this.wave, round: this.roundDone && saved > 0, damage: bill, spent: this.spent(), score, parts, kills: this.kills };
  }
  /** The round is over (city empty or stalled): score it, freeze it, keep the battle running for Keep fighting. */
  private endRound(reason: string, emptied: boolean) {
    this.roundDone = true; this.roundAt = this.time; this.roundEmptied = emptied;
    this.killsAtRound = this.kills; this.damageAtRound = this.cityDamage().bill;
    this.roundResult = this.scoreNow(reason);
  }

  private checkEnd(force = false) {
    if (!force && this.tick % 10) return;
    const c = this.counts();
    if (!this.roundDone && this.phase === "battle") {
      if (c.safe > this.lastSafe || this.liftsFlown > this.lastLifts) this.lastProgressT = this.time;
      this.lastSafe = c.safe; this.lastLifts = this.liftsFlown;
      const left = c.civ + c.safe, out = this.evacuated.toLocaleString();
      if (left === 0) this.endRound(this.evacuated ? `Round complete: everyone left alive is out. ${out} people saved.` : "Everyone is lost.", true);
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
        this.result = { ...r, reason: `You pulled out after ${this.wave} hordes. ${killsAfter.toLocaleString()} more infected killed after the round.`, killsAfter, damageAfter, mayhem: mayhem(killsAfter, damageAfter), xp: r.xp + Math.round(killsAfter * C.MAYHEM_XP_PER_KILL * this.diff.xpMul), waves: this.wave, damage: bill, intact, bonus };
      }
    } else {
      this.result = this.scoreNow(this.calledIt ? `You called it there: ${this.evacuated.toLocaleString()} people got out.` : this.evacuated ? `You pulled out. ${this.evacuated.toLocaleString()} people got out.` : "You pulled out.");
    }
    this.phase = "over";
  }

}
