// 0.62: Battle Events (opt-in mutator "battle_events"). The pure parts: types, when alerts come, what a win or a
// loss is worth, and the words on the card. The Sim's director (sim.ts) picks real people and buildings and runs them.
import * as C from "./config";
import { hash32 } from "./people";

export type BevKind = "mayor" | "class" | "research" | "power";
export type BevState = "reserved" | "live" | "won" | "lost";
/** One event. people: civ indices (the Mayor first; the class kids then teachers; the crew); lead: who the card names
 *  and an escort follows; building: squads building id (power) or -1; x, y: where the card and ring point;
 *  alertT / endT: sim time of the alert and of the countdown's end (null: not yet / runs to the round's end);
 *  frac: share of the people who made it (set when it resolves). */
export interface BevEvent {
  kind: BevKind; state: BevState; people: number[]; lead: number; building: number; x: number; y: number;
  alertT: number | null; endT: number | null; reached: boolean; frac: number; title: string; place: string;
  siege?: number; // power station: seconds of siege so far (decays when it eases)
  cells?: number[]; // power station: its building's cells at the start (it stands while most of them do)
  home?: boolean; // the Mayor was at home with family, not at work
}
/** The director's plain-data state (snapshot-safe). nextT: sim seconds after the sirens when the next alert is due. */
export interface Bev { events: BevEvent[]; nextT: number; order: BevKind[]; fired: number }

export const BEV_KINDS: BevKind[] = ["mayor", "class", "research", "power"];
const r01 = (seed: number, a: number, b: number) => hash32(seed, a, b) / 4294967296;

/** Seconds after the sirens of the first alert: seeded in [EVENT_FIRST_S, EVENT_FIRST_MAX_S]. */
export function firstAlertT(seed: number): number {
  return Math.round(C.EVENT_FIRST_S + r01(seed, 9001, 1) * (C.EVENT_FIRST_MAX_S - C.EVENT_FIRST_S));
}
/** The n-th alert after the first (n >= 1), EVENT_GAP_S to EVENT_GAP_MAX_S after the previous one resolved. */
export function nextAlertT(seed: number, n: number, resolvedT: number): number {
  return Math.round(resolvedT + C.EVENT_GAP_S + r01(seed, 9002, n) * (C.EVENT_GAP_MAX_S - C.EVENT_GAP_S));
}
/** The order the director tries the four kinds in (seeded shuffle). */
export function bevOrder(seed: number): BevKind[] {
  const a = [...BEV_KINDS];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r01(seed, 9003, i) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** What it is worth. A win pays EVENT_SCORE points, EVENT_CASH x moneyMul and EVENT_XP x xpMul; a loss costs
 *  EVENT_FAIL_SCORE points and never money or XP. The class scales by frac (share saved): a win pays frac of it, a
 *  loss costs (1 - frac) of the penalty. */
export function bevReward(kind: BevKind, won: boolean, frac: number, moneyMul: number, xpMul: number): { score: number; cash: number; xp: number } {
  const f = kind === "class" ? Math.max(0, Math.min(1, frac)) : 1;
  if (won) return { score: C.EVENT_SCORE * f, cash: Math.round(C.EVENT_CASH * moneyMul * f), xp: Math.round(C.EVENT_XP * xpMul * f) };
  return { score: -C.EVENT_FAIL_SCORE * (kind === "class" ? 1 - f : 1), cash: 0, xp: 0 };
}
/** The card's headline. */
export function bevTitle(kind: BevKind, leadName: string, n: number, home = false): string {
  switch (kind) {
    case "mayor": if (home) return n <= 1 ? `Mayor ${leadName} is sheltering alone at home` : `Mayor ${leadName} is sheltering at home with family (${n})`;
      return n <= 1 ? `Mayor ${leadName} is sheltering alone` : `Mayor ${leadName} is sheltering with ${n - 1 === 1 ? "an aide" : `${n - 1} aides`}`;
    case "class": return leadName ? `A class of ${n} is trapped at school with ${leadName}` : `A class of ${n} children is trapped at school`;
    case "research": return `Dr. ${leadName}'s research team (${n}) needs to get out`;
    case "power": return `The power station must keep running: its crew of ${n} is staying`;
  }
}
/** What counts as a win, for the card. */
export function bevGoal(kind: BevKind): string {
  switch (kind) {
    case "mayor": return "Reach them with a ground unit, then get the Mayor into a safe zone alive.";
    case "class": return "Reach them with a ground unit and get the children into a safe zone. Every child counts.";
    case "research": return "Reach them with a ground unit and get at least 3 of the team into a safe zone.";
    case "power": return "Keep the infected away from it until the round ends: a siege breaks in. Most of the building and at least 3 of the crew must survive.";
  }
}
/** Seconds on the clock from the alert (null: runs until the round ends). */
export function bevCountdown(kind: BevKind): number | null {
  return kind === "mayor" ? C.EVENT_VIP_S : kind === "class" ? C.EVENT_CLASS_S : kind === "research" ? C.EVENT_SCI_S : null;
}
