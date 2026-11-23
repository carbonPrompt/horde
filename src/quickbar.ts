/** The quick bar under the build grid (0.19; removed in 0.51.1, back in 0.54 with 5 slots on 6-0, every key rebindable,
 *  keymap.ts): tool ids the player dragged in from the build panel. Pure, no DOM. */
import { QUICK_SLOTS } from "./keymap";
export { QUICK_SLOTS };
export type Slots = (string | null)[];

/** Any saved value to exactly QUICK_SLOTS slots (an older, longer bar keeps its first ones); non-strings and tools the game does not know become empty. */
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
