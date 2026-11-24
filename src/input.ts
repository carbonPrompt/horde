// 0.45: what a key means for unit commands, kept apart from the DOM so touch controls can reuse it later.
import type { Entity } from "./sim";
import { GROUP_COUNT, actionFor, keyFor, keyOf } from "./keymap";

export type ArmCmd = "amove" | "patrol" | "escort" | "fortify"; // 0.51: fortify is armed from the command card
export type Intent =
  | { k: "move" | "amove" | "patrol" | "escort" | "stop" | "standby"; queue: boolean }
  | { k: "arm"; cmd: ArmCmd }
  | { k: "cancel" };

/** The command a key gives the selected units, or null (not a command key, a modifier is held, or nothing orderable
 *  is selected). Q/R/E/C arm a command that the next click aims; F and G act at once (0.54 key map). */
export function keyIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }, hasOrderable: boolean): Intent | null {
  if (!hasOrderable || mods.ctrl || mods.alt) return null;
  const k = key.toLowerCase();
  if (k === "escape") return { k: "cancel" };
  switch (actionFor(k, "selected")) { // 0.55: the live bindings (keymap.ts)
    case "order.amove": return { k: "arm", cmd: "amove" };
    case "order.patrol": return { k: "arm", cmd: "patrol" };
    case "order.escort": return { k: "arm", cmd: "escort" };
    case "order.fortify": return { k: "arm", cmd: "fortify" };
    case "order.stop": return { k: "stop", queue: false };
    case "order.standby": return { k: "standby", queue: false };
  }
  return null;
}

/** 0.50: battle-group keys. key: a keymap.keyOf key (or an e.code like "Digit3", read by position so Shift+digit still
 *  works). Ctrl assigns the selection to the group, Shift+Ctrl adds to it, the key alone selects it, Shift+key adds it
 *  to the selection. n: 0-4 (0.55: whatever keys group.1-5 are bound to). Null for other keys or with Alt. */
export function groupIntent(key: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }): { k: "assign" | "add" | "select" | "addsel"; n: number } | null {
  if (mods.alt) return null;
  const k = /^(?:Digit|Key)/.test(key) ? keyOf({ key, code: key }) : key.toLowerCase();
  for (let n = 0; n < GROUP_COUNT; n++) if (keyFor(`group.${n + 1}`) === k)
    return { k: mods.ctrl ? (mods.shift ? "add" : "assign") : mods.shift ? "addsel" : "select", n };
  return null;
}

/** Does this held key move the camera? The arrows always; otherwise the four camera bindings (0.54: WASD always moves
 *  the camera; 0.55: settable). hasOrderable is kept for callers; selection no longer matters. */
export function cameraKeysActive(key: string, hasOrderable: boolean): boolean {
  const k = key.toLowerCase(); void hasOrderable;
  if (k === "arrowleft" || k === "arrowright" || k === "arrowup" || k === "arrowdown") return true;
  return ["camera.up", "camera.left", "camera.down", "camera.right"].some(id => keyFor(id) === k);
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
