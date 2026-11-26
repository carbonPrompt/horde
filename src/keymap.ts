// 0.55: one action table for every key in the game (design ruling: every hotkey settable in Settings > Controls). Each action has
// an id, a Controls-page group, a context, a default key and a label. The live bindings (defaults + the player's
// overrides) sit in module state: main.ts sets them from the save, everything else asks keyFor / actionFor. Pure
// helpers (clash rules, swap, cleaning) take a Binds map so the tests and the Controls page can try changes first.
// 0.54 history: WASD camera, orders around WASD, tools Z X C V, groups 1-5, quick bar 6-0 (design rulings).

export type Ctx = "always" | "selected" | "idle" | "units" | "actions" | "support";
export type MenuId = "units" | "actions" | "support";
export type Group = "Camera" | "Always" | "With units selected" | "Nothing selected" | "Battle groups" | "Quick bar" | "Build menus";
export interface Action { id: string; group: Group; ctx: Ctx; key: string | null; label: string; tool?: string }
export type Binds = Record<string, string | null>;

export const GROUP_COUNT = 5; // keys 1-5
export const QUICK_SLOTS = 5;
export const MENUS: MenuId[] = ["units", "actions", "support"];
export const MENU_NAME: Record<MenuId, string> = { units: "Units", actions: "Actions", support: "Support" };

// [tool id, label, default letter], in panel order
const ITEMS: Record<MenuId, [string, string, string][]> = {
  units: [["garrison", "Troops", "t"], ["sniper", "Sniper", "n"], ["turret", "Turret", "u"], ["mortar", "Mortar", "r"], ["howitzer", "Howitzer", "h"],
    ["himars", "HIMARS", "i"], ["apc", "APC", "p"], ["tank", "Tank", "k"], ["gunboat", "Gunboat", "o"], ["battleship", "Battleship", "l"],
    ["apache", "Apache", "c"], ["reaper", "Reaper", "e"], ["gunship", "AC-130", "g"]],
  actions: [["airstrike", "Airstrike", "r"], ["a10", "A-10", "h"], ["firebomb", "Firebomb", "f"], ["cluster", "Cluster", "c"], ["barrage", "Barrage", "g"],
    ["tomahawk", "Tomahawk", "t"], ["moab", "MOAB", "o"], ["nuke", "Nuke", "n"], ["para", "Paradrop", "p"], ["c4", "C4", "x"],
    ["supply_drop", "Supply Drop", "u"], ["depot", "Fuel Tank", "l"]],
  support: [["evac", "Evac Point", "e"], ["budget", "Budget", "g"], ["repair", "Repair", "r"], ["radio", "Radio", "i"], ["supply", "Supply", "u"],
    ["command", "Command", "c"], ["police", "Precinct", "p"], ["militia", "Armory", "o"]],
};
export const MENU_ITEMS: Record<MenuId, string[]> = { units: ITEMS.units.map(i => i[0]), actions: ITEMS.actions.map(i => i[0]), support: ITEMS.support.map(i => i[0]) };
export const menuOfTool = (tool: string): MenuId | null => MENUS.find(m => MENU_ITEMS[m].includes(tool)) ?? null;

const A = (id: string, group: Group, ctx: Ctx, key: string | null, label: string, tool?: string): Action => ({ id, group, ctx, key, label, ...(tool ? { tool } : {}) });
export const ACTIONS: readonly Action[] = [
  A("camera.up", "Camera", "always", "w", "Move up"), A("camera.left", "Camera", "always", "a", "Move left"),
  A("camera.down", "Camera", "always", "s", "Move down"), A("camera.right", "Camera", "always", "d", "Move right"),
  A("pause", "Always", "always", " ", "Pause"), A("speed.half", "Always", "always", "f1", "Speed 1/2x"), A("speed.normal", "Always", "always", "f2", "Speed 1x"),
  A("speed.fast", "Always", "always", "f3", "Speed 2x"), A("alert", "Always", "always", "`", "Latest alert"), A("view.heights", "Always", "always", "j", "Building heights"),
  A("view.ranges", "Always", "always", "n", "Unit ranges"), A("view.heatmap", "Always", "always", "h", "Kill heatmap"), A("quicksave", "Always", "always", "f5", "Quick save"), A("inventory", "Always", "always", "i", "Inventory (ammo, engineers)"),
  A("fullscreen", "Always", "always", "f11", "Fullscreen"), A("squad.next", "Always", "always", "tab", "Next squad (Shift: previous)"),
  A("order.amove", "With units selected", "selected", "q", "Attack-move"), A("order.patrol", "With units selected", "selected", "r", "Patrol"),
  A("order.escort", "With units selected", "selected", "e", "Escort"), A("order.stop", "With units selected", "selected", "f", "Stop"),
  A("order.standby", "With units selected", "selected", "g", "Stand by"), A("order.fortify", "With units selected", "selected", "c", "Fortify / Dismount"),
  A("order.target", "With units selected", "selected", "t", "Target"), A("order.topup", "With units selected", "selected", "u", "Top up"),
  A("order.remove", "With units selected", "selected", "x", "Pull out / Remove"),
  A("tool.zone", "Nothing selected", "idle", "z", "Safe Zone"), A("tool.remove", "Nothing selected", "idle", "x", "Sell/Evac"),
  A("tool.order", "Nothing selected", "idle", "c", "Order"), A("tool.pan", "Nothing selected", "idle", "v", "Move/Aim"),
  A("tool.gate", "Nothing selected", "idle", "g", "Gate/Wall"), A("tool.recall", "Nothing selected", "idle", "q", "Recall"),
  A("tool.closegates", "Nothing selected", "idle", "l", "Lock Gates"), A("tool.clear", "Nothing selected", "idle", "k", "Clear Zone"),
  ...[1, 2, 3, 4, 5].map(n => A(`group.${n}`, "Battle groups", "always", String(n), `Group ${n}`)),
  ...["6", "7", "8", "9", "0"].map((k, i) => A(`quick.${i + 1}`, "Quick bar", "always", k, `Quick bar slot ${i + 1}`)),
  A("menu.units", "Build menus", "always", "b", "Units menu"), A("menu.actions", "Build menus", "always", "m", "Actions menu"), A("menu.support", "Build menus", "always", "y", "Support menu"),
  ...MENUS.flatMap(m => ITEMS[m].map(([t, label, k]) => A(`build.${t}`, "Build menus", m, k, label, t))),
];
const BY_ID = new Map(ACTIONS.map(a => [a.id, a]));
export const FIXED: ReadonlySet<string> = new Set(["escape", "arrowup", "arrowdown", "arrowleft", "arrowright", "enter", "delete", "backspace", "shift", "control", "alt", "meta"]);
const MENU_CTX = new Set<Ctx>(["units", "actions", "support"]);
const MODIFIERS = new Set(["shift", "control", "alt", "meta", "capslock"]);

export function defaultBinds(): Binds { const b: Binds = {}; for (const a of ACTIONS) b[a.id] = a.key; return b; }

/** How a key shows on a button ("Q", "F7", "Space", "Tab", "`"); "" for none. */
export function keyLabel(k: string | null | undefined): string {
  if (!k) return "";
  if (k === " ") return "Space";
  if (k === "tab") return "Tab";
  return /^f\d{1,2}$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k;
}
/** The stored form of a key event: digits by position (Shift+5 is still 5), letters lower case, F-keys "f7". */
export function keyOf(e: { key: string; code: string }): string {
  const d = /^Digit([0-9])$/.exec(e.code); if (d) return d[1];
  const l = /^Key([A-Z])$/.exec(e.code); if (l) return l[1].toLowerCase();
  if (e.code === "Space" || e.key === " ") return " ";
  if (e.code === "Backquote") return "`";
  return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
}
const usable = (k: string) => k === " " || k === "tab" || /^f(?:[1-9]|1[0-2])$/.test(k) || (k.length === 1 && k >= "!" && k <= "~");

function ctxClash(a: Ctx, b: Ctx): boolean {
  if (a === b) return true;
  if (MENU_CTX.has(a) || MENU_CTX.has(b)) return false;
  return a === "always" || b === "always";
}
/** Can action `id` take `key` under bindings `b`? null if so; otherwise why not, and the action holding it (for Swap). */
export function bindProblem(id: string, key: string, b: Binds): { why: string; other?: string; others?: string[] } | null {
  const me = BY_ID.get(id); if (!me) return { why: "Unknown action." };
  if (FIXED.has(key)) return { why: `${keyName(key)} can't be changed: it always does its own job.` };
  if (!usable(key)) return { why: `${keyName(key)} can't be used for a key.` };
  const isBuild = MENU_CTX.has(me.ctx), isGlue = id.startsWith("camera.") || id.startsWith("menu.");
  const hits: Action[] = [];
  for (const a of ACTIONS) {
    if (a.id === id || b[a.id] !== key) continue;
    const otherBuild = MENU_CTX.has(a.ctx), otherGlue = a.id.startsWith("camera.") || a.id.startsWith("menu.");
    if (ctxClash(me.ctx, a.ctx) || (isBuild && otherGlue) || (isGlue && otherBuild)) hits.push(a);
  }
  if (hits.length) { // 0.55 review: every holder is named; Swap is only offered for one
    const where = (a: Action) => MENU_CTX.has(a.ctx) ? MENU_NAME[a.ctx as MenuId] + " menu" : a.group;
    const why = hits.length === 1 ? `${keyLabel(key)} is already ${hits[0].label} (${where(hits[0])}).`
      : `${keyLabel(key)} is already used by ${hits.slice(0, -1).map(a => a.label).join(", ")} and ${hits[hits.length - 1].label}.`;
    return { why, other: hits[0].id, others: hits.map(a => a.id) };
  }
  return null;
}
const keyName = (k: string) => k === "escape" ? "Esc" : k.startsWith("arrow") ? "The arrow keys" : k === "enter" ? "Enter" : k === "delete" || k === "backspace" ? "Delete and Backspace" : FIXED.has(k) ? k[0].toUpperCase() + k.slice(1) : keyLabel(k) || "That key";

export function swap(id: string, other: string, b: Binds): Binds { return { ...b, [id]: b[other] ?? null, [other]: b[id] ?? null }; }

/** Bindings from the save: defaults, then every valid override in table order; an override that clashes is dropped,
 *  and a default left clashing by an earlier override becomes unbound. 0.54 quick bar keys fill quick.1-5 when the
 *  new setting doesn't name them. */
export function cleanKeys(saved: unknown, legacyQuick?: unknown): Binds {
  const ov: Record<string, string | null> = {}, legacy: Record<string, string | null> = {};
  if (saved && typeof saved === "object" && !Array.isArray(saved))
    for (const [id, v] of Object.entries(saved as Record<string, unknown>)) if (BY_ID.has(id) && (v === null || typeof v === "string")) ov[id] = typeof v === "string" ? v.toLowerCase() : null;
  if (Array.isArray(legacyQuick)) legacyQuick.slice(0, QUICK_SLOTS).forEach((v, i) => { const id = `quick.${i + 1}`; if (!(id in ov) && (v === null || typeof v === "string")) legacy[id] = typeof v === "string" ? v.toLowerCase() : null; });
  const out: Binds = {};
  for (const a of ACTIONS) out[a.id] = null;
  const put = (a: Action, k: string | null) => { if (k === null) { out[a.id] = null; return true; } if (!bindProblem(a.id, k, out)) { out[a.id] = k; return true; } return false; };
  for (const a of ACTIONS) if (a.id in ov && ov[a.id] !== a.key) put(a, ov[a.id]); // the player's 0.55 choices first
  for (const a of ACTIONS) if (!(a.id in legacy) && out[a.id] === null && !(a.id in ov && ov[a.id] === null)) put(a, a.key); // then defaults where still free
  // 0.54 quick keys last (0.55 review): one on a key 0.55 gives a menu or the camera falls back to its slot's default
  for (const a of ACTIONS) if (a.id in legacy) { if (!(legacy[a.id] !== null && put(a, legacy[a.id])) && legacy[a.id] !== null) put(a, a.key); }
  return out;
}
/** What the save stores: only the bindings that differ from the defaults. */
export function overrides(b: Binds): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  for (const a of ACTIONS) if ((b[a.id] ?? null) !== a.key) o[a.id] = b[a.id] ?? null;
  return o;
}

let live: Binds = defaultBinds();
export function setBinds(b: Binds) { live = { ...b }; }
export function binds(): Binds { return live; }
export function keyFor(id: string): string | null { return live[id] ?? null; }
/** The action `key` triggers in `ctx`. "always" actions answer in "selected" and "idle"; a menu context only its letters. */
export function actionFor(key: string, ctx: Ctx, b: Binds = live): string | null {
  let always: string | null = null;
  for (const a of ACTIONS) {
    if (b[a.id] !== key) continue;
    if (a.ctx === ctx) return a.id;
    if (a.ctx === "always" && !MENU_CTX.has(ctx)) always = a.id;
  }
  return always;
}
/** "{key:order.amove}" -> "Q" with the live (or given) bindings. */
export function withKeys(text: string, b: Binds = live): string {
  return text.replace(/\{key:([a-z0-9_.]+)\}/g, (_, id: string) => keyLabel(b[id]) || "(unbound)");
}
export const actionById = (id: string) => BY_ID.get(id);

/** 0.55: one key while a build menu may be waiting for its letter. A menu key arms its menu (the same one again
 *  disarms, another switches); while armed, a letter of that menu picks its item; Esc only disarms; any other key
 *  disarms and passes through to its normal job (so the camera keys still move the map). */
export function menuStep(armed: MenuId | null, key: string, b: Binds = live): { armed: MenuId | null; pick?: string; passThrough: boolean } {
  const m = MENUS.find(x => b[`menu.${x}`] === key);
  if (m) return { armed: armed === m ? null : m, passThrough: false };
  if (MODIFIERS.has(key)) return { armed, passThrough: true }; // 0.55 review: Shift (to place several) keeps the menu waiting
  if (!armed) return { armed: null, passThrough: true };
  if (key === "escape") return { armed: null, passThrough: false };
  const act = actionFor(key, armed, b);
  if (act?.startsWith("build.")) return { armed: null, pick: act.slice(6), passThrough: false };
  return { armed: null, passThrough: true };
}

export const GROUPS: Group[] = ["Camera", "Always", "With units selected", "Nothing selected", "Battle groups", "Quick bar", "Build menus"];
/** 0.55: the Controls page: each group's actions with their current key label (build items carry their menu as `sub`). */
export function controlsRows(b: Binds): { group: Group; rows: { id: string; label: string; key: string; sub?: string }[] }[] {
  return GROUPS.map(group => ({ group, rows: ACTIONS.filter(a => a.group === group).map(a => ({ id: a.id, label: a.label, key: keyLabel(b[a.id]), ...(MENU_CTX.has(a.ctx) ? { sub: MENU_NAME[a.ctx as MenuId] } : {}) })) }));
}
/** 0.55: one group back to its defaults; a default another group has taken since comes back unbound (never a clash). */
export function resetGroup(group: Group, b: Binds): Binds {
  const out = { ...b };
  const mine = ACTIONS.filter(a => a.group === group);
  for (const a of mine) out[a.id] = null;
  for (const a of mine) if (a.key && !bindProblem(a.id, a.key, out)) out[a.id] = a.key;
  return out;
}
