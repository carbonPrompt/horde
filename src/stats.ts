// 0.57: the battle recorder. Plain data on the Sim (so a snapshot carries it): a sample of the battle every
// SAMPLE_S seconds (stored as columns), events with time and place, and kill buckets: every kill lands in exactly
// one of a unit, a strike or an "other" source. Nothing here changes the battle.
import * as C from "./config";

export const SAMPLE_S = 10;
export const COLS = ["t", "saved", "byTrain", "inZone", "outside", "infected", "kills", "killsStrikes", "civKilledByUs",
  "money", "spent", "damage", "intact", "hordes", "breaches", "unitsAlive", "lifts", "liftsAborted"] as const;
export type Col = typeof COLS[number];
// event kinds (SE_: people.ts already uses EV_)
export const SE_SIRENS = 1, SE_HORDE = 2, SE_BREACH = 3, SE_GATE_TO_WALL = 4, SE_WALL_TO_GATE = 5, SE_GATES_LOCKED = 6,
  SE_BRIDGE = 7, SE_STRIKE = 8, SE_UNIT_PLACED = 9, SE_UNIT_LOST = 10, SE_LIFT = 11, SE_LIFT_ABORT = 12, SE_DEMOLISH = 13,
  SE_ROUND = 14, SE_KEEP_FIGHTING = 15,
  SE_CHINOOK = 16, SE_CHINOOK_ABORT = 17, SE_ENGINEER_LOST = 18, SE_OUT_OF_AMMO = 19, // 0.60 supply
  SE_EVENT_START = 20, SE_EVENT_WON = 21, SE_EVENT_LOST = 22; // 0.62 Battle Events (a: kind index)
export type OtherKill = "guard" | "civilian" | "train" | "bridge" | "demolition" | "env";
export const OTHER_KILLS: OtherKill[] = ["guard", "civilian", "train", "bridge", "demolition", "env"];
export interface StrikeRec { kind: string; t: number; x: number; y: number; kills: number; civ: number; dropKills?: number } // 0.59 dropKills: a paratrooper drop's squads' kills (also counted on their units)
export interface UnitRec { kind: string; label: string; placedT: number; kills: number; lostT: number; dryS?: number } // lostT -1 = alive; 0.60 dryS: seconds out of ammo
export interface Recorder {
  battleId: string; nextT: number;
  cols: Record<Col, number[]>;
  ev: { t: number[]; k: number[]; x: number[]; y: number[]; a: number[]; b: number[] }; // a/b: kind-specific
  units: UnitRec[]; strikes: StrikeRec[];
  other: Record<OtherKill, number>;
  c: { maxZone: number; best60: number; longShot: number; swimmers: number; guardKills: number; crushedByVehicles: number;
    grenadierKills: number; fortifies: number; topUps: number; repairs: number; talkedOut: number;
    strikeKinds: Record<string, number>; crates?: number; engineersLost?: number; supplySpent?: number }; // 0.60: crates delivered by engineers, engineers lost
  win: number[]; // kill times inside the rolling 60 s window
  flags?: { dev: boolean; modded: boolean }; // set by the page at Start Battle; dev sticks once switched on
  earned?: string[]; // 0.59: achievement ids earned in this battle (a snapshot carries them)
  bevents?: BevOutcome[]; // 0.62: Battle Events and how they ended
}
/** 0.62: one Battle Event's outcome as the record keeps it. */
export interface BevOutcome { kind: string; won: boolean; frac: number; score: number; cash: number; xp: number; title: string }

/** tools/statsperf.ts: switch recording off to measure what it costs (never off in the game). */
export let STATS_OFF = false;
export function setStatsOff(v: boolean) { STATS_OFF = v; }

export function newRecorder(battleId: string): Recorder {
  return {
    battleId, nextT: 0,
    cols: Object.fromEntries(COLS.map(c => [c, []])) as unknown as Record<Col, number[]>,
    ev: { t: [], k: [], x: [], y: [], a: [], b: [] },
    units: [], strikes: [],
    other: Object.fromEntries(OTHER_KILLS.map(k => [k, 0])) as Record<OtherKill, number>,
    c: { maxZone: 0, best60: 0, longShot: 0, swimmers: 0, guardKills: 0, crushedByVehicles: 0, grenadierKills: 0, fortifies: 0, topUps: 0, repairs: 0, talkedOut: 0, strikeKinds: {} },
    win: [],
  };
}

export function sample(r: Recorder, row: Record<Col, number>): void {
  if (STATS_OFF) { r.nextT += SAMPLE_S; return; }
  for (const c of COLS) r.cols[c].push(Number.isFinite(row[c]) ? row[c] : 0);
  if (row.inZone > r.c.maxZone) r.c.maxZone = row.inZone;
  r.nextT += SAMPLE_S;
}

export function event(r: Recorder, kind: number, t: number, x: number, y: number, a = 0, b = 0): void {
  r.ev.t.push(t); r.ev.k.push(kind); r.ev.x.push(x); r.ev.y.push(y); r.ev.a.push(a); r.ev.b.push(b);
}

/** The recorder's index for unit u, assigned the first time it is seen (kept on u.sid). */
export function unitIndex(r: Recorder, u: { kind: string; sid?: number; x?: number; y?: number }, t: number): number {
  if (u.sid !== undefined && r.units[u.sid]?.kind === u.kind) return u.sid;
  const n = r.units.filter(x => x.kind === u.kind).length + 1;
  const name = (C.UNITS as Record<string, { name: string }>)[u.kind]?.name ?? u.kind;
  u.sid = r.units.length;
  r.units.push({ kind: u.kind, label: `${name} ${n}`, placedT: t, kills: 0, lostT: -1 });
  event(r, SE_UNIT_PLACED, t, u.x ?? 0, u.y ?? 0, u.sid);
  return u.sid;
}

export function killBy(r: Recorder, t: number, src: { unit?: number; strike?: number; other?: OtherKill }): void {
  if (STATS_OFF) return;
  if (src.unit !== undefined && r.units[src.unit]) r.units[src.unit].kills++;
  else if (src.strike !== undefined && r.strikes[src.strike]) r.strikes[src.strike].kills++;
  else r.other[src.other ?? "env"]++;
  const w = r.win; w.push(t);
  let i = 0; while (i < w.length && w[i] <= t - 60) i++;
  if (i) w.splice(0, i);
  if (w.length > r.c.best60) r.c.best60 = w.length;
}

export function strike(r: Recorder, kind: string, t: number, x: number, y: number): number {
  r.strikes.push({ kind, t, x, y, kills: 0, civ: 0 });
  r.c.strikeKinds[kind] = (r.c.strikeKinds[kind] ?? 0) + 1;
  event(r, SE_STRIKE, t, x, y, r.strikes.length - 1);
  return r.strikes.length - 1;
}

/** 0.59: a paratrooper squad's kill also counts toward its drop (the strike's own kill bucket is unchanged). */
export function dropKill(r: Recorder, strike: number): void {
  if (STATS_OFF) return;
  const s = r.strikes[strike]; if (s) s.dropKills = (s.dropKills ?? 0) + 1;
}

export function killTotal(r: Recorder): number {
  let n = 0;
  for (const u of r.units) n += u.kills;
  for (const s of r.strikes) n += s.kills;
  for (const k of OTHER_KILLS) n += r.other[k];
  return n;
}

/** 0.59: the per-battle numbers the achievements read that the samples and buckets don't keep. Built from the live
 *  recorder (live checks) and kept on the battle record (trimmed records lose their events, not these). */
export interface RecCounters {
  swimmers: number; guardKills: number; crushedByVehicles: number; grenadierKills: number; fortifies: number; topUps: number; repairs: number;
  talkedOut: number; longShot: number; best60: number; maxZone: number;
  gatesToWall: number; demolitions: number; lockdown: number; saved5: number; infectedLeft: number; // lockdown 0/1
  crates: number; supplySpent: number; engineersLost: number; chinooks: number; waveOffs: number; // 0.60
}
export const REC_COUNTER_KEYS: (keyof RecCounters)[] = ["swimmers", "guardKills", "crushedByVehicles", "grenadierKills", "fortifies", "topUps", "repairs",
  "talkedOut", "longShot", "best60", "maxZone", "gatesToWall", "demolitions", "lockdown", "saved5", "infectedLeft", "crates", "supplySpent", "engineersLost", "chinooks", "waveOffs"];
export const LOCKDOWN_MIN_S = 300, QUICK_EXIT_S = 300;

export function recCounters(r: Recorder, roundAt: number | null): RecCounters {
  const e = r.ev, c = r.c;
  let gatesToWall = 0, demolitions = 0, sirensT = -1, lockT = -1, lastBreach = -1, chinooks = 0, waveOffs = 0;
  for (let i = 0; i < e.k.length; i++) {
    const k = e.k[i];
    if (k === SE_GATE_TO_WALL) gatesToWall++;
    else if (k === SE_CHINOOK) chinooks++;
    else if (k === SE_CHINOOK_ABORT) waveOffs++;
    else if (k === SE_DEMOLISH) demolitions++;
    else if (k === SE_SIRENS && sirensT < 0) sirensT = e.t[i];
    else if (k === SE_GATES_LOCKED && e.a[i] > 0 && (roundAt === null || e.t[i] <= roundAt)) lockT = e.t[i];
    else if (k === SE_BREACH && (roundAt === null || e.t[i] <= roundAt)) lastBreach = e.t[i];
  }
  const lockdown = roundAt !== null && lockT >= 0 && lastBreach < lockT && roundAt - lockT >= LOCKDOWN_MIN_S ? 1 : 0;
  const ts = r.cols.t, sv = r.cols.saved, inf = r.cols.infected;
  let saved5 = 0;
  if (sirensT >= 0) for (let i = 0; i < ts.length && ts[i] <= sirensT + QUICK_EXIT_S; i++) saved5 = sv[i];
  return { swimmers: c.swimmers, guardKills: c.guardKills, crushedByVehicles: c.crushedByVehicles, grenadierKills: c.grenadierKills, fortifies: c.fortifies,
    topUps: c.topUps, repairs: c.repairs, talkedOut: c.talkedOut, longShot: Math.round(c.longShot), best60: c.best60, maxZone: c.maxZone,
    gatesToWall, demolitions, lockdown, saved5, infectedLeft: inf.length ? inf[inf.length - 1] : 0,
    crates: c.crates ?? 0, supplySpent: c.supplySpent ?? 0, engineersLost: c.engineersLost ?? 0, chinooks, waveOffs };
}
