// 0.45: what a key means for unit commands, kept apart from the DOM so touch controls can reuse it later.
import type { Entity } from "./sim";

export type ArmCmd = "amove" | "patrol" | "escort";
export type Intent =
  | { k: "move" | "amove" | "patrol" | "escort" | "stop" | "standby"; queue: boolean }
  | { k: "arm"; cmd: ArmCmd }
  | { k: "cancel" };

/** The command a key gives the selected units, or null (not a command key, a modifier is held, or nothing orderable
 *  is selected). A/P/E arm a command that the next click aims; S and D act at once. */
export function keyIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }, hasOrderable: boolean): Intent | null {
  if (!hasOrderable || mods.ctrl || mods.alt) return null;
  switch (key.toLowerCase()) {
    case "a": return { k: "arm", cmd: "amove" };
    case "p": return { k: "arm", cmd: "patrol" };
    case "e": return { k: "arm", cmd: "escort" };
    case "s": return { k: "stop", queue: false };
    case "d": return { k: "standby", queue: false };
    case "escape": return { k: "cancel" };
  }
  return null;
}

/** Does this held key move the camera? Arrows always; W/A/S/D only while no orderable unit is selected (then A, S, D
 *  are unit commands). */
export function cameraKeysActive(key: string, hasOrderable: boolean): boolean {
  const k = key.toLowerCase();
  if (k === "arrowleft" || k === "arrowright" || k === "arrowup" || k === "arrowdown") return true;
  return !hasOrderable && (k === "w" || k === "a" || k === "s" || k === "d");
}

/** The selection without what is gone (sold, dead, pulled out, a new battle), in the same order. */
export function pruneSelection(sel: Entity[], alive: (e: Entity) => boolean): Entity[] {
  return sel.filter(alive);
}
