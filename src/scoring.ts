/** Round score, medal, evac pad price and Mayhem (0.20). Pure.
 *  Every number comes from config tunables so balance changes are one edit or a mod file. */
import * as C from "./config";

export interface RoundParts { saved: number; speed: number; city: number; kills: number } // each 0..100
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** pct saved 0..100; emptiedAfterS = seconds after the outbreak the city emptied (null if it did not); intact 0..100. */
export function roundParts(i: { pct: number; emptiedAfterS: number | null; intact: number; kills: number; infAlive: number }): RoundParts {
  const par = C.EVAC_PAR_S;
  const speed = i.emptiedAfterS === null ? 0 : clamp((100 * (3 * par - i.emptiedAfterS)) / (2 * par), 0, 100) * clamp(i.pct, 0, 100) / 100;
  const kills = i.kills + i.infAlive > 0 ? (100 * i.kills) / (i.kills + i.infAlive) : 0;
  return { saved: clamp(i.pct, 0, 100), speed, city: clamp(i.intact, 0, 100), kills };
}
/** Weighted 0..100 (weights normalized by their sum, so they need not add up to 1). */
export function roundScore(p: RoundParts): number {
  const w = [C.SCORE_W_SAVED, C.SCORE_W_SPEED, C.SCORE_W_CITY, C.SCORE_W_KILLS];
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return (p.saved * w[0] + p.speed * w[1] + p.city * w[2] + p.kills * w[3]) / sum;
}
/** Points each part adds to the score (for the end screen). */
export function partPoints(p: RoundParts): RoundParts {
  const sum = C.SCORE_W_SAVED + C.SCORE_W_SPEED + C.SCORE_W_CITY + C.SCORE_W_KILLS || 1;
  return { saved: p.saved * C.SCORE_W_SAVED / sum, speed: p.speed * C.SCORE_W_SPEED / sum, city: p.city * C.SCORE_W_CITY / sum, kills: p.kills * C.SCORE_W_KILLS / sum };
}
export function medalFor(score: number, pct: number): string | null {
  if (pct < C.MEDAL_MIN_SAVED_PCT) return null;
  return C.MEDALS.find(([, min]) => score >= min)?.[0] ?? null;
}
/** Price of the next evac pad when `standing` pads are already up. */
export function padCost(base: number, standing: number): number {
  return Math.round(base * Math.pow(C.EVAC_COST_MUL, standing));
}
export function mayhem(killsAfter: number, damageAfter: number): number {
  return killsAfter + Math.floor(Math.max(0, damageAfter) / C.MAYHEM_DAMAGE_PER_POINT);
}

const medalRank = (m: string | null | undefined) => { const i = C.MEDALS.findIndex(x => x[0] === m); return i < 0 ? 0 : C.MEDALS.length - i; };
/** A city's best after a run: the higher score, and never a lower medal than it already had (a medal unlocks the
 *  next city; a high-scoring run with nobody saved has no medal and must not take one away). */
export function mergeBest<T extends { pct: number; medal: string | null }>(prev: T | undefined, score: number, medal: string | null): T | { pct: number; medal: string | null } {
  if (!prev) return { pct: score, medal };
  const better = medalRank(medal) > medalRank(prev.medal) ? medal : prev.medal;
  return { ...prev, pct: Math.max(prev.pct, score), medal: better };
}

/** Key in `save.best` for a city and difficulty (`cityId` for medium so old saves load unchanged). */
export function bestKey(cityId: string, d: C.Difficulty): string {
  return d === "medium" ? cityId : `${cityId}@${d}`;
}

/** True when the player has earned a medal on `cityId` at any difficulty. */
export function anyMedal(best: Record<string, { medal?: string | null }>, cityId: string): boolean {
  return C.DIFFICULTY_IDS.some(d => !!best[bestKey(cityId, d)]?.medal);
}

/** Resolve battle difficulty: Daily Challenge is always Medium; invalid or missing falls back to Medium. */
export function difficultyFor(daily: boolean, chosen: C.Difficulty | undefined): C.Difficulty {
  return !daily && chosen && C.DIFFICULTY_IDS.includes(chosen) ? chosen : "medium";
}

