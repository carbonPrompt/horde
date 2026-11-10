/** The 9-slot quick bar under the map: tool ids the player dragged in from the picker (0.19). Pure, no DOM. */
export const QUICK_SLOTS = 9;
export type Slots = (string | null)[];

/** Any saved value to exactly 9 slots; non-strings and tools the game does not know become empty. */
export function cleanQuickbar(v: unknown, known: (t: string) => boolean): Slots {
  const a = Array.isArray(v) ? v : [];
  return Array.from({ length: QUICK_SLOTS }, (_, i) => (typeof a[i] === "string" && known(a[i]) ? a[i] : null));
}
/** Put t in slot i; if it already sat in another slot, that one empties (no duplicates). */
export function setSlot(s: Slots, i: number, t: string): Slots {
  const out = s.map(x => (x === t ? null : x));
  out[i] = t;
  return out;
}
export function swapSlots(s: Slots, a: number, b: number): Slots {
  const out = s.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}
export function clearSlot(s: Slots, i: number): Slots {
  const out = s.slice();
  out[i] = null;
  return out;
}
