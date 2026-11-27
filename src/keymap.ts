// 0.55: one action table for every key in the game (design ruling: every hotkey settable in Settings > Controls). Each action has
// an id, a Controls-page group, a context, a default key and a label. The live bindings (defaults + the player's
// overrides) sit in module state: main.ts sets them from the save, everything else asks keyFor / actionFor. Pure
// helpers (clash rules, swap, cleaning) take a Binds map so the tests and the Controls page can try changes first.
// 0.54 history: WASD camera, orders around WASD, tools Z X C V, groups 1-5, quick bar 6-0 (design rulings).

export type Ctx = "always" | "selected" | "idle" | "units" | "actions" | "support" | "menu"; // 0.63: "menu" = inside any open build menu (Back)
/** 0.63: the two key layouts. grid: Q-T / A-G / Z-B match the command card's places (the default); wasd: the 0.62 keys. */
export type Preset = "grid" | "wasd";
/** 0.63: the card's 15 places, row by row. */
export const GRID_ORDER = "qwertasdfgzxcvb";
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
  A("tool.closegates", "Nothing selected", "idle", "l", "Lock Gates"), // 0.63.1: Clear Zone has no key (pressed by accident too easily); it is in the Esc menu
  ...[1, 2, 3, 4, 5].map(n => A(`group.${n}`, "Battle groups", "always", String(n), `Group ${n}`)),
  ...["6", "7", "8", "9", "0"].map((k, i) => A(`quick.${i + 1}`, "Quick bar", "always", k, `Quick bar slot ${i + 1}`)),
  A("menu.units", "Build menus", "always", "b", "Units menu"), A("menu.actions", "Build menus", "always", "m", "Actions menu"), A("menu.support", "Build menus", "always", "y", "Support menu"),
  A("menu.back", "Build menus", "menu", null, "Back (out of a menu)"), // 0.63
  A("tool.heatmap", "Nothing selected", "idle", null, "Kill heatmap (card button)"), A("tool.inventory", "Nothing selected", "idle", null, "Inventory (card button)"), // 0.63: the grid card's own keys
  ...[1, 2, 3, 4].map(n => A(`cam.spot${n}`, "Camera", "always", `f${n + 5}`, `Camera spot ${n} (Ctrl: save it)`)), // 0.63
  ...MENUS.flatMap(m => ITEMS[m].map(([t, label, k]) => A(`build.${t}`, "Build menus", m, k, label, t))),
];
const BY_ID = new Map(ACTIONS.map(a => [a.id, a]));
/** 0.63: the Grid preset's defaults where they differ from the table's (WASD) key. Positions: design tables. */
const GRID_ROWS: [string, string][] = [
  ["tool.zone", "q"], ["tool.gate", "w"], ["tool.remove", "e"], ["tool.order", "r"], ["tool.pan", "t"], ["tool.recall", "a"], ["tool.closegates", "s"], ["tool.heatmap", "f"], ["tool.inventory", "g"],
  ["menu.units", "z"], ["menu.actions", "x"], ["menu.support", "c"], // 0.63.1: no Back key on Grid (Esc), the other menus' keys switch
  ["order.amove", "q"], ["order.patrol", "w"], ["order.escort", "e"], ["order.target", "r"], ["order.topup", "t"], ["order.stop", "a"], ["order.standby", "s"], ["order.fortify", "d"], ["order.remove", "b"],
];
/** Each menu's items by place (GRID_ORDER index; null = a place left for another menu's key, 0.63.1). */
const GRID_MENU: Record<MenuId, (string | null)[]> = {
  units: ["garrison", "sniper", "turret", "apc", "tank", "mortar", "howitzer", "himars", "gunboat", "battleship", "apache", null, null, "reaper", "gunship"],
  actions: ["airstrike", "a10", "firebomb", "cluster", "barrage", "tomahawk", "moab", "nuke", "para", "c4", null, "supply_drop", null, "depot"],
  support: ["evac", "command", "repair", "radio", "supply", "budget", "police", "militia"],
};
const GRID_KEYS: Record<string, string | null> = Object.fromEntries([
  ...GRID_ROWS, ...["up", "left", "down", "right"].map(d => [`camera.${d}`, null] as [string, null]),
  ...MENUS.flatMap(m => GRID_MENU[m].flatMap((t, i) => t ? [[`build.${t}`, GRID_ORDER[i]] as [string, string]] : [])),
]);
/** 0.63: every action's default key in a preset. */
export function presetDefaults(p: Preset): Binds { const b: Binds = {}; for (const a of ACTIONS) b[a.id] = p === "grid" && a.id in GRID_KEYS ? GRID_KEYS[a.id] : a.key; return b; }
/** 0.63: an action's context in a preset: the Grid card's menu openers live on the idle page only. */
export function ctxOf(id: string, p: Preset): Ctx { const a = BY_ID.get(id)!; return p === "grid" && id.startsWith("menu.") && id !== "menu.back" ? "idle" : a.ctx; }
let livePreset: Preset = "wasd";
export function setPreset(p: Preset) { livePreset = p; }
export function preset(): Preset { return livePreset; }
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
  if (a === "menu" || b === "menu") return MENU_CTX.has(a === "menu" ? b : a); // 0.63: Back is live inside every menu
  if (MENU_CTX.has(a) || MENU_CTX.has(b)) return false;
  return a === "always" || b === "always";
}
/** Can action `id` take `key` under bindings `b`? null if so; otherwise why not, and the action holding it (for Swap). */
export function bindProblem(id: string, key: string, b: Binds, p: Preset = "wasd"): { why: string; other?: string; others?: string[] } | null {
  const me = BY_ID.get(id); if (!me) return { why: "Unknown action." };
  if (FIXED.has(key)) return { why: `${keyName(key)} can't be changed: it always does its own job.` };
  if (!usable(key)) return { why: `${keyName(key)} can't be used for a key.` };
  const mc = ctxOf(id, p), isBuild = MENU_CTX.has(mc), isGlue = id.startsWith("camera."); // 0.63: menu keys no longer guard the letters (inside a menu its item wins)
  const hits: Action[] = [];
  for (const a of ACTIONS) {
    if (a.id === id || b[a.id] !== key) continue;
    const ac = ctxOf(a.id, p), otherBuild = MENU_CTX.has(ac), otherGlue = a.id.startsWith("camera.");
    const otherMenu = (build: string, menuId: string, bc: Ctx) => p === "grid" && menuId.startsWith("menu.") && menuId !== "menu.back" && MENU_CTX.has(bc) && menuId !== `menu.${bc}`; // 0.63.1: Grid: another menu's key always switches
    if (ctxClash(mc, ac) || (isBuild && otherGlue) || (isGlue && otherBuild) || otherMenu(id, a.id, mc) || otherMenu(a.id, id, ac)) hits.push(a);
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
export function cleanKeys(saved: unknown, legacyQuick?: unknown, p: Preset = "wasd"): Binds {
  const def = presetDefaults(p);
  const ov: Record<string, string | null> = {}, legacy: Record<string, string | null> = {};
  if (saved && typeof saved === "object" && !Array.isArray(saved))
    for (const [id, v] of Object.entries(saved as Record<string, unknown>)) if (BY_ID.has(id) && (v === null || typeof v === "string")) ov[id] = typeof v === "string" ? v.toLowerCase() : null;
  if (Array.isArray(legacyQuick)) legacyQuick.slice(0, QUICK_SLOTS).forEach((v, i) => { const id = `quick.${i + 1}`; if (!(id in ov) && (v === null || typeof v === "string")) legacy[id] = typeof v === "string" ? v.toLowerCase() : null; });
  const out: Binds = {};
  for (const a of ACTIONS) out[a.id] = null;
  const put = (a: Action, k: string | null) => { if (k === null) { out[a.id] = null; return true; } if (!bindProblem(a.id, k, out, p)) { out[a.id] = k; return true; } return false; };
  for (const a of ACTIONS) if (a.id in ov && ov[a.id] !== def[a.id]) put(a, ov[a.id]); // the player's 0.55 choices first
  for (const a of ACTIONS) if (!(a.id in legacy) && out[a.id] === null && !(a.id in ov && ov[a.id] === null)) put(a, def[a.id]); // then defaults where still free
  // 0.54 quick keys last (0.55 review): one on a key 0.55 gives a menu or the camera falls back to its slot's default
  for (const a of ACTIONS) if (a.id in legacy) { if (!(legacy[a.id] !== null && put(a, legacy[a.id])) && legacy[a.id] !== null) put(a, def[a.id]); }
  return out;
}
/** What the save stores: only the bindings that differ from the defaults. */
export function overrides(b: Binds, p: Preset = "wasd"): Record<string, string | null> {
  const o: Record<string, string | null> = {}, def = presetDefaults(p);
  for (const a of ACTIONS) if ((b[a.id] ?? null) !== def[a.id]) o[a.id] = b[a.id] ?? null;
  return o;
}

let live: Binds = defaultBinds();
export function setBinds(b: Binds) { live = { ...b }; }
export function binds(): Binds { return live; }
export function keyFor(id: string): string | null { return live[id] ?? null; }
/** The action `key` triggers in `ctx`. "always" actions answer in "selected" and "idle"; a menu context only its letters. */
export function actionFor(key: string, ctx: Ctx, b: Binds = live, p: Preset = livePreset): string | null {
  let always: string | null = null;
  for (const a of ACTIONS) {
    if (b[a.id] !== key) continue;
    const ac = ctxOf(a.id, p);
    if (ac === ctx) return a.id;
    if (ac === "always" && !MENU_CTX.has(ctx) && ctx !== "menu") always = a.id;
  }
  return always;
}
/** "{key:order.amove}" -> "Q" with the live (or given) bindings. */
export function withKeys(text: string, b: Binds = live): string { // 0.63: {key:id|fallback} shows the fallback when unbound
  return text.replace(/\{key:([a-z0-9_.]+)(?:\|([^}]*))?\}/g, (_, id: string, fb?: string) => keyLabel(b[id]) || (fb ?? "(unbound)"));
}
export const actionById = (id: string) => BY_ID.get(id);

/** 0.55: one key while a build menu may be waiting for its letter. 0.63: while a menu is open, Esc closes it, its
 *  item letter picks (Shift keeps the menu open), Back closes, another menu key switches (the same one closes), a
 *  modifier keeps it waiting, anything else closes and passes through. Closed: a menu key opens its menu where its
 *  context allows (Grid: only with nothing selected). */
export function menuStep(armed: MenuId | null, key: string, opts: { selected: boolean; shift: boolean }, b: Binds = live, p: Preset = livePreset): { armed: MenuId | null; pick?: string; passThrough: boolean } {
  if (MODIFIERS.has(key)) return { armed, passThrough: true }; // 0.55 review: Shift (to place several) keeps the menu waiting
  const m = MENUS.find(x => b[`menu.${x}`] === key);
  if (armed) {
    if (key === "escape") return { armed: null, passThrough: false };
    if (p === "grid" && m && m !== armed) return { armed: m, passThrough: false }; // 0.63.1: one press switches menus
    const act = actionFor(key, armed, b, p);
    if (act?.startsWith("build.")) return { armed: opts.shift ? armed : null, pick: act.slice(6), passThrough: false };
    if (b["menu.back"] === key) return { armed: null, passThrough: false };
    if (m) return { armed: armed === m ? null : m, passThrough: false };
    if (p === "grid" && key.length === 1 && GRID_ORDER.includes(key)) return { armed, passThrough: false }; // 0.63 review M1: an empty place in the card does nothing
    return { armed: null, passThrough: true };
  }
  if (m && (ctxOf(`menu.${m}`, p) !== "idle" || !opts.selected)) return { armed: m, passThrough: false };
  return { armed: null, passThrough: true };
}

/** 0.63: a preset switch lets go of any open build menu (the card redraws for the new layout). */
export function presetSwitchResets(_p: Preset, _armed: MenuId | null): { armed: null } { return { armed: null }; }

/** 0.63 review I3: a click on the map lets go of an open menu, unless Shift kept it open (placing several). */
export function menuAfterMapClick(armed: MenuId | null, kept: boolean): MenuId | null { return kept ? armed : null; }

export const GROUPS: Group[] = ["Camera", "Always", "With units selected", "Nothing selected", "Battle groups", "Quick bar", "Build menus"];
/** 0.55: the Controls page: each group's actions with their current key label (build items carry their menu as `sub`). */
export function controlsRows(b: Binds): { group: Group; rows: { id: string; label: string; key: string; sub?: string }[] }[] {
  return GROUPS.map(group => ({ group, rows: ACTIONS.filter(a => a.group === group).map(a => ({ id: a.id, label: a.label, key: keyLabel(b[a.id]), ...(MENU_CTX.has(a.ctx) ? { sub: MENU_NAME[a.ctx as MenuId] } : {}) })) }));
}
/** 0.55: one group back to its defaults; a default another group has taken since comes back unbound (never a clash). */
export function resetGroup(group: Group, b: Binds, p: Preset = "wasd"): Binds {
  const out = { ...b }, def = presetDefaults(p);
  const mine = ACTIONS.filter(a => a.group === group);
  for (const a of mine) out[a.id] = null;
  for (const a of mine) { const k = def[a.id]; if (k && !bindProblem(a.id, k, out, p)) out[a.id] = k; }
  return out;
}
