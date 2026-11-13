// Progression (phase 5): XP from every battle unlocks hardware, ranks mark the way, achievements reward play styles.
// Pure functions only (no DOM), so the sim tests can cover them.
import type { Score } from "./sim";
import * as C from "./config";
import { anyMedal } from "./scoring";

/** XP needed to unlock a tool. Anything not listed is available from the start. */
export const UNLOCK_XP: Record<string, number> = { // 0.35.1: spaced so bronze on every campaign city opens it all before Port Royal
  howitzer: 400, radio: 400, supply: 600,
  command: 900, police: 900, militia: 900, barrage: 1200,
  battleship: 1600, tank: 2200,
  himars: 2600, apache: 3200, a10: 3200, reaper: 4000,
  moab: 4800, tomahawk: 6000, cluster: 7200, gunship: 8300, nuke: 9500,
};

export const RANKS: [string, number][] = [
  ["Private", 0], ["Corporal", 400], ["Sergeant", 1200], ["Lieutenant", 2600], ["Captain", 4500],
  ["Major", 7000], ["Colonel", 10000], ["Brigadier General", 15000], ["General", 22000],
];

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1][1]) i++;
  return { name: RANKS[i][0], next: RANKS[i + 1] ?? null };
}

/** Is this tool available? `trial` is the unit a campaign city lends you for that battle. */
export function unlocked(tool: string, xp: number, trial?: string | null, all = false) {
  return all || tool === trial || !(tool in UNLOCK_XP) || xp >= UNLOCK_XP[tool];
}

/** Tools that unlock between two XP totals (for the end screen). */
export function newlyUnlocked(before: number, after: number) {
  return Object.entries(UNLOCK_XP).filter(([, x]) => x > before && x <= after).map(([k]) => k);
}

/** Players from before progression keep their access: XP from their best results. */
export function grandfatherXp(best: Record<string, { pct: number; medal: string | null }>) {
  let xp = 0;
  for (const b of Object.values(best)) xp += Math.round(b.pct * 10) + (b.medal ? 200 : 0);
  return xp;
}

export interface BattleStats { r: Score; kills: number; held: number; lifts: number; nukes: number; unitsLost: number; daily: boolean; usedAbilities: number }
export interface Achievement { id: string; name: string; desc: string; check: (b: BattleStats) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_out", name: "First Lift", desc: "Evacuate your first people.", check: b => b.r.saved > 0 },
  { id: "round_one", name: "Held the Line", desc: "Complete a round: get everyone you can out of the city.", check: b => b.r.round },
  { id: "gold", name: "Gold Standard", desc: "Earn Gold or better.", check: b => b.r.medal === "Gold" || b.r.medal === "Platinum" },
  { id: "platinum", name: "Nobody Left Behind", desc: "Earn Platinum (75 points).", check: b => b.r.medal === "Platinum" },
  { id: "evac_10k", name: "Airlift", desc: "Evacuate 10,000 people in one battle.", check: b => b.r.saved >= 10000 },
  { id: "lifts_100", name: "Shuttle Run", desc: "Fly 100 evac lifts in one battle.", check: b => b.lifts >= 100 },
  { id: "hold_20", name: "Last Stand", desc: "Hold 20 minutes after the outbreak.", check: b => b.held >= 1200 },
  { id: "waves_30", name: "Tide Breaker", desc: "Survive 30 hordes.", check: b => b.r.waves >= 30 },
  { id: "kills_10k", name: "Grinder", desc: "Kill 10,000 infected in one battle.", check: b => b.kills >= 10000 },
  { id: "light_touch", name: "Light Touch", desc: "Finish with the city at least 90% intact.", check: b => b.r.bonus === "Light Touch" && b.r.waves >= 5 },
  { id: "scorched", name: "Scorched Earth", desc: "Finish with at least 35% of the city wrecked.", check: b => b.r.bonus === "Scorched Earth" },
  { id: "no_losses", name: "Everyone Comes Home", desc: "Complete a round without losing a unit.", check: b => b.r.round && b.unitsLost === 0 },
  { id: "ground_game", name: "Boots Only", desc: "Complete a round without calling in any strike.", check: b => b.r.round && b.usedAbilities === 0 },
  { id: "billion", name: "Billion Dollar Bill", desc: "Run up $1 billion in property damage in one battle.", check: b => b.r.damage >= 1e9 },
  { id: "nuclear", name: "Nuclear Option", desc: "Use a tactical nuke. It costs you.", check: b => b.nukes > 0 },
  { id: "daily", name: "Daily Duty", desc: "Complete a round in a Daily Challenge.", check: b => b.daily && b.r.round },
];

/** Achievements earned by this battle that were not already held. */
export function earned(b: BattleStats, have: Record<string, string>) {
  return ACHIEVEMENTS.filter(a => !have[a.id] && a.check(b));
}

/** 0.35: campaign city i is open when it is the first, the previous city has a medal, or the save carries medals on
 *  at least i of the old (0.34) campaign cities. */
export function campaignOpen(best: Record<string, { medal?: string | null }>, i: number): boolean {
  if (i === 0) return true;
  if (C.CITIES[i - 1] && anyMedal(best, C.CITIES[i - 1].id)) return true;
  return i <= C.LEGACY_CAMPAIGN_IDS.filter(id => anyMedal(best, id)).length;
}

/** 0.35: one-time XP for a campaign city's first medal (any difficulty). */
export function clearBonus(city: C.CityDef, hadMedal: boolean, medal: string | null): number {
  return !hadMedal && medal ? city.clearXp ?? 0 : 0;
}
