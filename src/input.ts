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

/** 0.50: battle-group keys 1-0. key is e.key or e.code ("Digit3": Shift turns e.key into a symbol). Ctrl assigns the
 *  selection to the group, Shift+Ctrl adds to it, the digit alone selects it, Shift+digit adds it to the selection.
 *  n: 0-9 (key 0 is group 10). Null for other keys or with Alt. */
export function groupIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }): { k: "assign" | "add" | "select" | "addsel"; n: number } | null {
  if (mods.alt) return null;
  const d = /^(?:Digit)?([0-9])$/.exec(key);
  if (!d) return null;
  const n = d[1] === "0" ? 9 : Number(d[1]) - 1;
  return { k: mods.ctrl ? (mods.shift ? "add" : "assign") : mods.shift ? "addsel" : "select", n };
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

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);
/** 0.47.1: is this keystroke going into a text field (Codex search, OSM query)? Then it is typing, not a game key. */
export function typingInField(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el?.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "").toLowerCase());
}
