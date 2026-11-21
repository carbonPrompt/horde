// 0.50: battle groups on keys 1-0 (StarCraft style). A slot holds some units or one safe zone, never both.
// Pure helpers: the Sim keeps the slots (so a battle snapshot keeps them by identity); plans save unit indices.
import type { Entity, Unit } from "./sim";

export type GroupSlot = { units: Unit[] } | { zone: number } | null;
export const GROUPS = 10;
export type PlanGroup = number[] | { zone: number } | null;

const fit = (g: GroupSlot[]) => Array.from({ length: GROUPS }, (_, i) => g[i] ?? null);

/** Ctrl+N (add = Shift+Ctrl+N). Units in the selection win over a zone; with no units, the zone (if any) takes the
 *  slot; with neither, the slot is cleared. Add merges units into a units slot (no duplicates). */
export function assignGroup(groups: GroupSlot[], n: number, sel: Entity[], zone: number, add: boolean): GroupSlot[] {
  const out = fit(groups), units = sel.flatMap(e => "unit" in e ? [e.unit] : []);
  if (units.length) {
    const had = add && out[n] && "units" in out[n]! ? (out[n] as { units: Unit[] }).units : [];
    out[n] = { units: [...had, ...units.filter(u => !had.includes(u))] };
  } else if (!add) out[n] = zone >= 0 ? { zone } : null;
  return out;
}

/** The living units of group n (empty for a zone slot or an empty one). */
export function groupUnits(groups: GroupSlot[], n: number, alive: (u: Unit) => boolean): Unit[] {
  const g = groups[n];
  return g && "units" in g ? g.units.filter(alive) : [];
}

/** Drop dead, lost or sold units; a units slot left empty becomes null. */
export function pruneGroups(groups: GroupSlot[], alive: (u: Unit) => boolean): GroupSlot[] {
  return fit(groups).map(g => {
    if (!g || !("units" in g)) return g;
    const units = g.units.filter(alive);
    return units.length ? (units.length === g.units.length ? g : { units }) : null;
  });
}

export function groupsToPlan(groups: GroupSlot[], units: Unit[]): PlanGroup[] {
  return fit(groups).map(g => !g ? null : "zone" in g ? { zone: g.zone } : g.units.map(u => units.indexOf(u)).filter(i => i >= 0));
}

/** From a saved plan (checked: at most 10 slots, whole in-range indices, a zone that exists; anything off is empty). */
export function groupsFromPlan(v: unknown, units: Unit[], zones: number): GroupSlot[] {
  const out: GroupSlot[] = Array(GROUPS).fill(null);
  if (!Array.isArray(v) || v.length > GROUPS) return out;
  v.forEach((g, i) => {
    if (Array.isArray(g)) {
      if (!g.length || !g.every(k => Number.isInteger(k) && k >= 0 && k < units.length)) return;
      out[i] = { units: [...new Set(g as number[])].map(k => units[k]) };
    } else if (g && typeof g === "object" && Number.isInteger((g as { zone: number }).zone)) {
      const z = (g as { zone: number }).zone;
      if (z >= 0 && z < zones) out[i] = { zone: z };
    }
  });
  return out;
}

/** For the group bar: a units slot's main kind (most common), living count and health share (0..1); a zone slot's
 *  zone; null when empty or nobody in it is left. maxHp(u): that unit's full health. */
export function groupSummary(g: GroupSlot, alive: (u: Unit) => boolean, maxHp: (u: Unit) => number): { kind: string; count: number; health: number } | { zone: number } | null {
  if (!g) return null;
  if ("zone" in g) return { zone: g.zone };
  const us = g.units.filter(alive);
  if (!us.length) return null;
  const n = new Map<string, number>(); for (const u of us) n.set(u.kind, (n.get(u.kind) ?? 0) + 1);
  const kind = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let hp = 0, max = 0; for (const u of us) { const m = maxHp(u); max += m; hp += Math.max(0, Math.min(m, u.hp ?? m)); }
  return { kind, count: us.length, health: max ? hp / max : 1 };
}
