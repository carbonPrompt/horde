// 0.51: the RTS bottom panel's rules: what the command card offers, what the selection panel lists, which build tab is
// open and what the info panel shows. Pure (no DOM, no Sim): main.ts draws it.
import { ORDER_KEYS, TOOL_KEYS } from "./keymap";

export interface CardButton { id: string; label: string; key: string; on?: boolean; off?: boolean; tool?: string }

const K = (k: string) => k.toUpperCase();
const TOOLS: [string, string, string, boolean][] = [ // id, label, key, is a map tool (0.54: every one has a key, keymap.ts)
  ["zone", "Safe Zone", K(TOOL_KEYS.zone), true], ["gate", "Gate/Wall", K(TOOL_KEYS.gate), true], ["remove", "Sell/Evac", K(TOOL_KEYS.remove), true], ["order", "Order", K(TOOL_KEYS.order), true],
  ["pan", "Move/Aim", K(TOOL_KEYS.pan), true], ["heatmap", "Heatmap", K(TOOL_KEYS.heatmap), false], ["recall", "Recall", K(TOOL_KEYS.recall), false], ["closegates", "Lock Gates", K(TOOL_KEYS.closegates), false],
  ["clear", "Clear Zone", K(TOOL_KEYS.clear), false],
];

/** 0.51.1: the one line under a command's name in its hover tooltip (the card shows pictures only). */
export const CMD_DESC: Record<string, string> = {
  zone: "Draw your safe zone: click the corners, Enter or the first corner closes it.",
  gate: "Click a wall to make it a gate, click a gate to close it again.",
  remove: "Sell a unit or building for a refund (in battle a helicopter pulls it out first).",
  order: "Send units: select them, then right-click where they should go.",
  pan: "Select and command: click or drag a box, right-click to send.",
  heatmap: "Show where your kills happen.",
  recall: "Pull every mobile unit back into the zone; press again to send them back out.",
  closegates: "Close every open gate in the zone.",
  clear: "Erase the safe zone and start it over (planning only).",
  move: "Right-click on the map. Shift queues the order.",
  amove: "Walk there and fight anything met on the way.",
  patrol: "Walk back and forth between here and a spot you click.",
  escort: "Follow and guard a person you click.",
  stop: "Drop all orders and stay put.",
  standby: "Hold fire and stay put until ordered again.",
  fortify: "C, then click a roof (or right-click a roof): the squad climbs up and digs in.",
  dismount: "Climb down from the roof onto the street.",
  topup: "Fly in replacements for the soldiers this squad lost.",
  target: "Change what this unit shoots first: nearest, closest to the walls, or chasers.",
  buytroops: "Fly a Troops squad into this zone.",
  buysniper: "Fly a Sniper team into this zone.",
};

/** The command card. Nothing selected: the map tools and zone commands. Units selected: their orders. A selection with
 *  nothing that takes orders (a building, an emplacement): targeting and remove/pull out. */
export function commandCard(ctx: { phase: "plan" | "battle" | "over"; orderable: { kind: string; fort?: string; standby?: boolean; damaged?: boolean }[]; anySelected: boolean; armed: string | null; tool: string; zone?: boolean }): CardButton[] {
  if (!ctx.anySelected && ctx.zone && ctx.phase === "battle") return [{ id: "buytroops", label: "Buy Troops here", key: "" }, { id: "buysniper", label: "Buy Sniper team here", key: "" }]; // a selected safe zone
  if (!ctx.anySelected) return TOOLS.map(([id, label, key, isTool]) => ({ id, label, key, ...(isTool ? { tool: id, on: ctx.tool === id } : {}) }));
  const out: CardButton[] = [];
  const us = ctx.orderable;
  if (us.length) {
    out.push({ id: "move", label: "Move", key: "RMB" }, { id: "amove", label: "Attack-move", key: K(ORDER_KEYS.amove), on: ctx.armed === "amove" },
      { id: "patrol", label: "Patrol", key: K(ORDER_KEYS.patrol), on: ctx.armed === "patrol" }, { id: "escort", label: "Escort", key: K(ORDER_KEYS.escort), on: ctx.armed === "escort" },
      { id: "stop", label: "Stop", key: K(ORDER_KEYS.stop) }, { id: "standby", label: "Stand by", key: K(ORDER_KEYS.standby), on: us.every(u => u.standby) });
    const troops = us.filter(u => u.kind === "garrison" || u.kind === "sniper");
    if (troops.length) out.push({ id: "fortify", label: troops.every(u => u.fort === "up") ? "Dismount" : "Fortify", key: K(ORDER_KEYS.fortify), on: ctx.armed === "fortify" });
    if (ctx.phase === "battle" && us.some(u => u.damaged)) out.push({ id: "topup", label: "Top up", key: K(ORDER_KEYS.topup) });
  }
  out.push({ id: "target", label: "Target", key: K(ORDER_KEYS.target) });
  if (ctx.phase !== "over") out.push({ id: "remove", label: ctx.phase === "plan" ? "Remove" : "Pull out", key: K(ORDER_KEYS.remove) });
  return out;
}

type SelIn = { kind: string; hp: number; max: number; soldiers?: { name: string; hp: number; max: number; alive: boolean }[] };
export type SelGrid = { mode: "empty" } | { mode: "squad"; soldiers: { name: string; health: number; alive: boolean }[] } | { mode: "units"; items: { kind: string; health: number; index: number }[] };
const share = (hp: number, max: number) => max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;

/** The selection panel: one squad lists its soldiers; anything else lists the selected units (index into the selection). */
export function selectionGrid(sel: SelIn[]): SelGrid {
  if (!sel.length) return { mode: "empty" };
  if (sel.length === 1 && sel[0].soldiers) return { mode: "squad", soldiers: sel[0].soldiers.map(s => ({ name: s.name, health: s.alive ? share(s.hp, s.max) : 0, alive: s.alive })) };
  return { mode: "units", items: sel.map((u, index) => ({ kind: u.kind, health: share(u.hp, u.max), index })) };
}

/** The build panel's tabs (the old categories, in order) and which one is open. */
export function buildTabs(catTools: Record<string, string[]>, open: string | null): { cats: string[]; open: string } {
  const cats = Object.keys(catTools);
  return { cats, open: open && catTools[open] ? open : cats[0] };
}

/** What the info panel shows: a hovered build item, else a hovered map thing, else the selection, else round status. */
export function infoSource(hoverItem: string | null, hoverEntity: boolean, selected: boolean): "hover-item" | "hover-entity" | "selection" | "idle" {
  return hoverItem ? "hover-item" : hoverEntity ? "hover-entity" : selected ? "selection" : "idle";
}

/** 0.52: a squad's state in a word, for the roster: what a player scanning their army needs. */
export type SquadState = "fighting" | "moving" | "fortified" | "low ammo" | "out of ammo" | "idle";
export function squadState(q: { firedAgo: number; moving: boolean; fortified: boolean; ammo: number; maxAmmo: number }): SquadState {
  if (q.ammo < 1) return "out of ammo";
  if (q.firedAgo < 3) return "fighting";
  if (q.ammo !== Infinity && q.ammo < q.maxAmmo * 0.25) return "low ammo";
  if (q.moving) return "moving";
  return q.fortified ? "fortified" : "idle";
}
/** 0.52: Tab order: squads with nothing to do first (idle, low or out of ammo), then the busy ones; stable inside each. */
export function tabOrder(states: SquadState[]): number[] {
  const rank = (s: SquadState) => s === "idle" || s === "out of ammo" || s === "low ammo" ? 0 : 1;
  return states.map((s, i) => [rank(s), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
}
/** 0.52: the next squad for Tab (Shift+Tab: previous) after `current` (an index into the squads, -1 for none). */
export function nextInTab(order: number[], current: number, back: boolean): number {
  if (!order.length) return -1;
  const at = order.indexOf(current);
  if (at < 0) return back ? order[order.length - 1] : order[0];
  return order[(at + (back ? order.length - 1 : 1)) % order.length];
}
