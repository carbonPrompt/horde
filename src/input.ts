// 0.45: what a key means for unit commands, kept apart from the DOM so touch controls can reuse it later.
import type { Entity } from "./sim";
import { ORDER_KEYS, GROUP_COUNT } from "./keymap";

export type ArmCmd = "amove" | "patrol" | "escort" | "fortify"; // 0.51: fortify is armed from the command card
export type Intent =
  | { k: "move" | "amove" | "patrol" | "escort" | "stop" | "standby"; queue: boolean }
  | { k: "arm"; cmd: ArmCmd }
  | { k: "cancel" };

/** The command a key gives the selected units, or null (not a command key, a modifier is held, or nothing orderable
 *  is selected). Q/R/E/C arm a command that the next click aims; F and G act at once (0.54 key map). */
export function keyIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }, hasOrderable: boolean): Intent | null {
  if (!hasOrderable || mods.ctrl || mods.alt) return null;
  switch (key.toLowerCase()) { // 0.54: around WASD (keymap.ts)
    case ORDER_KEYS.amove: return { k: "arm", cmd: "amove" };
    case ORDER_KEYS.patrol: return { k: "arm", cmd: "patrol" };
    case ORDER_KEYS.escort: return { k: "arm", cmd: "escort" };
    case ORDER_KEYS.fortify: return { k: "arm", cmd: "fortify" };
    case ORDER_KEYS.stop: return { k: "stop", queue: false };
    case ORDER_KEYS.standby: return { k: "standby", queue: false };
    case "escape": return { k: "cancel" };
  }
  return null;
}

/** 0.50: battle-group keys 1-0. key is e.key or e.code ("Digit3": Shift turns e.key into a symbol). Ctrl assigns the
 *  selection to the group, Shift+Ctrl adds to it, the digit alone selects it, Shift+digit adds it to the selection.
 *  n: 0-9 (key 0 is group 10). Null for other keys or with Alt. */
export function groupIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }): { k: "assign" | "add" | "select" | "addsel"; n: number } | null {
  if (mods.alt) return null;
  const d = /^(?:Digit)?([0-9])$/.exec(key);
  if (!d) return null;
  const n = d[1] === "0" ? 9 : Number(d[1]) - 1;
  if (n >= GROUP_COUNT) return null; // 0.54: groups are 1-5; 6-0 are the quick bar
  return { k: mods.ctrl ? (mods.shift ? "add" : "assign") : mods.shift ? "addsel" : "select", n };
}

/** Does this held key move the camera? Arrows always; W/A/S/D only while no orderable unit is selected (then A, S, D
 *  are unit commands). */
export function cameraKeysActive(key: string, hasOrderable: boolean): boolean {
  const k = key.toLowerCase();
  if (k === "arrowleft" || k === "arrowright" || k === "arrowup" || k === "arrowdown") return true;
  void hasOrderable; return k === "w" || k === "a" || k === "s" || k === "d"; // 0.54: WASD always moves the camera
}

/** The selection without what is gone (sold, dead, pulled out, a new battle), in the same order. */
export function pruneSelection(sel: Entity[], alive: (e: Entity) => boolean): Entity[] {
  return sel.filter(alive);
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);
/** 0.47.1: is this keystroke going into a text field (Codex search, OSM query)? Then it is typing, not a game key. */
export function typingInField(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el?.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "").toLowerCase());
}
