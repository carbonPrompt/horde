// 0.60: the supply rules. Pure (config only): ammo classes, crate sizes and prices, starting stock, the store point,
// engineer job picking, the auto-restock rule and the use rate. The Sim holds the state (sim.supply).
import * as C from "./config";

/** 0.60: an engineer (Task 4 steps them). A plain record on the zone's supply, like a squad's soldiers. */
export interface Engineer { x: number; y: number; alive: boolean; name: string; job: Job; carry: AmmoClass | null; carryN?: number; climbT: number; path: number[]; side: "in" | "out"; workT: number; depot?: boolean; noPathT?: number } // depot: one of the Depot's engineers; noPathT: no search before this time (0.60.1)
/** 0.60: an order in flight: a Chinook to the store point (zone stock) or a sling load to a battery (unit sid). */
export interface SupplyOrder { cls: AmmoClass; crates: number; at: number; auto: boolean; unit?: number; waveOffs: number }
/** 0.60: one safe zone's supply, parallel to sim.zones. small/vehicle in rounds; bought/spent in dollars. */
export interface ZoneSupply { small: number; vehicle: number; auto: boolean; prio: "ammo" | "repair"; bought: number; spent: number;
  crew: Engineer[]; log: [number, number][]; logV: [number, number][]; orders: SupplyOrder[]; store: [number, number]; waitingMoney?: boolean; engineersBought: number; depotGiven?: boolean; // log/logV: [time, rounds] handed out (small arms / vehicle rounds)
  planCrates: { small: number; vehicle: number } } // crates bought in planning (saved with the plan)
/** 0.60: what a saved plan keeps per zone. */
export interface PlanSupply { small: number; vehicle: number; auto: boolean; prio: "ammo" | "repair"; engineers: number }

export type AmmoClass = "small" | "vehicle" | "shells" | "rockets";
export const ZONE_CLASSES: ("small" | "vehicle")[] = ["small", "vehicle"];
const CLASS: Partial<Record<C.UnitKind, AmmoClass>> = {
  garrison: "small", sniper: "small", turret: "small", police: "small", militia: "small", para: "small",
  apc: "vehicle", tank: "vehicle", mortar: "shells", howitzer: "shells", himars: "rockets",
};
/** null: not supplied (aircraft rearm at home, boats carry their own). */
export function ammoClass(kind: C.UnitKind): AmmoClass | null { return CLASS[kind] ?? null; }

/** Rounds in one crate. Shells and rockets are ordered per battery in magazines (see the Sim), so a "crate" there is
 *  one magazine of the unit that orders it; this returns the mortar / HIMARS magazine as the reference size. */
export function crateRounds(cls: AmmoClass): number {
  return cls === "small" ? C.CRATE_SMALL : cls === "vehicle" ? C.CRATE_VEHICLE : cls === "shells" ? C.UNITS.mortar.ammo : C.UNITS.himars.ammo;
}
export function cratePrice(cls: AmmoClass): number {
  return cls === "small" ? C.CRATE_PRICE_SMALL : cls === "vehicle" ? C.CRATE_PRICE_VEHICLE : cls === "shells" ? C.CRATE_PRICE_SHELLS : C.CRATE_PRICE_ROCKETS;
}

/** Free stock for a new zone in rounds (small, vehicle) and the battery reserve in magazines. */
export function startingStock(diff: C.Difficulty, shortage: boolean): { small: number; vehicle: number; reserve: number } {
  const [s, v, r] = C.STOCK_START[diff] ?? C.STOCK_START.medium, m = shortage ? 0.5 : 1;
  return { small: Math.round(s * m) * C.CRATE_SMALL, vehicle: Math.round(v * m) * C.CRATE_VEHICLE, reserve: Math.max(1, Math.round(r * m)) };
}
/** Auto-restock starts on for Easy and Medium. */
export function autoDefault(diff: C.Difficulty): boolean { return diff === "easy" || diff === "medium"; }

/** Seconds until a Chinook ordered now lands: CHINOOK_ETA_MIN at the map edge up to CHINOOK_ETA_MAX (150+ cells in). */
export function chinookEta(distCells: number, shortage: boolean): number {
  const t = C.CHINOOK_ETA_MIN + (C.CHINOOK_ETA_MAX - C.CHINOOK_ETA_MIN) * Math.min(1, Math.max(0, distCells) / 150);
  return t * (shortage ? 1.5 : 1);
}

export interface StoreCandidates { depot: [number, number] | null; evac: [number, number] | null; center: [number, number] }
/** Where a zone keeps its ammo: its Supply Depot, else its first Evac Point, else its center. */
export function storePoint(c: StoreCandidates): [number, number] { return c.depot ?? c.evac ?? c.center; }

export interface JobIn { units: { id: number; x: number; y: number; frac: number; outside: boolean; reach: boolean }[]; walls: { id: number; x: number; y: number; frac: number }[]; prio: "ammo" | "repair" }
export type Job = { kind: "reload"; id: number } | { kind: "repair"; id: number } | null;
/** The next job for an engineer at (ex, ey): the preferred kind first (nearest), then the other. */
export function pickJob(ex: number, ey: number, j: JobIn, taken: Set<string>): Job {
  const d2 = (x: number, y: number) => (x - ex) * (x - ex) + (y - ey) * (y - ey);
  const reload = (): Job => {
    let best: Job = null, bd = Infinity;
    for (const u of j.units) if (u.reach && u.frac < C.ENGINEER_RELOAD_FRAC && !taken.has(`reload:${u.id}`)) { const d = d2(u.x, u.y); if (d < bd) { bd = d; best = { kind: "reload", id: u.id }; } }
    return best;
  };
  const repair = (): Job => {
    let best: Job = null, bd = Infinity;
    for (const w of j.walls) if (w.frac < 1 && !taken.has(`repair:${w.id}`)) { const d = d2(w.x, w.y); if (d < bd) { bd = d; best = { kind: "repair", id: w.id }; } }
    return best;
  };
  return j.prio === "ammo" ? reload() ?? repair() : repair() ?? reload();
}

/** 0.60 lab: spare magazines a unit carries on hand (batteries hold their reserve instead). */
export function basicLoad(cls: AmmoClass | null, kind?: C.UnitKind): number { return (kind && C.BASIC_LOAD_KIND[kind]) ?? (cls === "small" ? C.BASIC_LOAD_SMALL : cls === "vehicle" ? C.BASIC_LOAD_VEHICLE : 0); }
export function wantsAuto(stock: number, cap: number, inFlight: boolean, on: boolean): boolean {
  return on && !inFlight && stock < C.AUTO_RESTOCK_FRAC * cap;
}
/** Rounds per minute over the last 60 s; log entries are [time, rounds]. */
export function useRate(log: [number, number][], now: number): number {
  let n = 0; for (const [t, r] of log) if (t > now - 60) n += r;
  return n;
}
/** n = engineers already bought in this zone; the difficulty's support price line applies. */
export function engineerPrice(n: number, diff: C.Difficulty): number {
  return Math.round(C.ENGINEER_PRICE * Math.pow(C.DIFFICULTY[diff].supportMul, n));
}
