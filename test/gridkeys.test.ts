// 0.63: the Grid (RTS) and WASD key presets (design ~/plans/2026-11-26-horde-grid-hotkeys-design.md).
import { expect, test } from "bun:test";
import { ACTIONS, presetDefaults, defaultBinds, bindProblem, cleanKeys, overrides, actionFor, type Preset } from "../src/keymap";
import { clean, defaults } from "../src/save";

const G = (): Record<string, string | null> => presetDefaults("grid");

test("grid defaults follow the design tables", () => {
  const g = G();
  const want: Record<string, string | null> = {
    "tool.zone": "q", "tool.gate": "w", "tool.remove": "e", "tool.order": "r", "tool.pan": "t", "tool.recall": "a", "tool.closegates": "s",
    "tool.heatmap": "f", "tool.inventory": "g", "menu.units": "z", "menu.actions": "x", "menu.support": "c",
    "order.amove": "q", "order.patrol": "w", "order.escort": "e", "order.target": "r", "order.topup": "t", "order.stop": "a", "order.standby": "s", "order.fortify": "d", "order.remove": "b",
    "menu.back": null, "camera.up": null, "camera.left": null, "camera.down": null, "camera.right": null,
    "group.1": "1", "group.5": "5", "quick.1": "6", "quick.5": "0", pause: " ", alert: "`", "view.heatmap": "h", inventory: "i", "view.heights": "j", "view.ranges": "n",
    "cam.spot1": "f6", "cam.spot2": "f7", "cam.spot3": "f8", "cam.spot4": "f9",
  };
  const items: [string, string][] = [["garrison", "q"], ["sniper", "w"], ["turret", "e"], ["apc", "r"], ["tank", "t"], ["mortar", "a"], ["howitzer", "s"], ["himars", "d"], ["gunboat", "f"], ["battleship", "g"],
    ["apache", "z"], ["reaper", "v"], ["gunship", "b"], ["airstrike", "q"], ["a10", "w"], ["firebomb", "e"], ["cluster", "r"], ["barrage", "t"], ["tomahawk", "a"], ["moab", "s"], ["nuke", "d"],
    ["para", "f"], ["c4", "g"], ["supply_drop", "x"], ["depot", "v"], ["evac", "q"], ["command", "w"], ["repair", "e"], ["radio", "r"], ["supply", "t"], ["budget", "a"], ["police", "s"], ["militia", "d"]];
  for (const [t, k] of items) want[`build.${t}`] = k;
  for (const [id, k] of Object.entries(want)) expect([id, g[id]]).toEqual([id, k]);
});

for (const p of ["grid", "wasd"] as Preset[]) test(`the ${p} defaults have no clashes`, () => {
  const d = presetDefaults(p);
  for (const a of ACTIONS) { const k = d[a.id]; if (!k) continue; expect([a.id, bindProblem(a.id, k, { ...d, [a.id]: null }, p)]).toEqual([a.id, null]); }
});

test("wasd defaults are the 0.62 keys", () => {
  const w = presetDefaults("wasd");
  expect(w).toEqual(defaultBinds());
  expect(w["order.amove"]).toBe("q"); expect(w["camera.up"]).toBe("w"); expect(w["menu.units"]).toBe("b"); expect(w["menu.back"]).toBeNull();
});

test("overrides are per preset", () => {
  expect(overrides(cleanKeys({ "order.amove": "k" }, undefined, "wasd"), "wasd")).toEqual({ "order.amove": "k" });
  expect(cleanKeys({}, undefined, "grid")).toEqual(G());
  expect(overrides(cleanKeys({ "build.tank": "k" }, undefined, "grid"), "grid")).toEqual({ "build.tank": "k" });
});

test("menu openers live on the idle page only in grid", () => {
  expect(actionFor("z", "selected", G(), "grid")).toBeNull();
  expect(actionFor("z", "idle", G(), "grid")).toBe("menu.units");
  expect(actionFor("b", "selected", presetDefaults("wasd"), "wasd")).toBe("menu.units");
});

test("save keeps both override maps; a bad preset is dropped", () => {
  const d = defaults();
  const s = clean({ ...d, settings: { ...d.settings, keys: { "order.amove": "k" }, keysGrid: { "build.tank": "k" }, keyPreset: "grid" } } as any);
  expect(s.settings.keys).toEqual({ "order.amove": "k" });
  expect(s.settings.keysGrid).toEqual({ "build.tank": "k" });
  expect(s.settings.keyPreset).toBe("grid");
  const bad = clean({ ...d, settings: { ...d.settings, keyPreset: "qwerty" } } as any);
  expect(bad.settings.keyPreset).toBeUndefined();
});

import { menuStep } from "../src/keymap";
const W = () => presetDefaults("wasd");
const no = { selected: false, shift: false };
test("grid: Z then T picks the tank and the card goes back", () => {
  expect(menuStep(null, "z", no, G(), "grid")).toEqual({ armed: "units", passThrough: false });
  expect(menuStep("units", "t", no, G(), "grid")).toEqual({ armed: null, pick: "tank", passThrough: false });
});
test("grid: inside Units, Z is Apache, not the Units menu again", () => {
  expect(menuStep("units", "z", no, G(), "grid").pick).toBe("apache");
});
test("shift keeps the menu open", () => {
  expect(menuStep("actions", "q", { selected: false, shift: true }, G(), "grid")).toEqual({ armed: "actions", pick: "airstrike", passThrough: false });
});
test("0.63.1: Esc closes a menu; B is the AC-130 in Units", () => {
  expect(menuStep("support", "escape", no, G(), "grid")).toEqual({ armed: null, passThrough: false });
  expect(menuStep("units", "b", no, G(), "grid").pick).toBe("gunship");
});
test("grid: openers do nothing with units selected", () => {
  expect(menuStep(null, "z", { selected: true, shift: false }, G(), "grid")).toEqual({ armed: null, passThrough: true });
});
test("wasd unchanged", () => {
  expect(menuStep(null, "b", { selected: true, shift: false }, W(), "wasd").armed).toBe("units");
  expect(menuStep("units", "k", no, W(), "wasd").pick).toBe("tank");
  expect(menuStep("units", "w", no, W(), "wasd")).toEqual({ armed: null, passThrough: true });
});

import { presetSwitchResets } from "../src/keymap";
test("switching preset lets go of an open menu", () => {
  expect(presetSwitchResets("wasd", "units")).toEqual({ armed: null });
  expect(presetSwitchResets("grid", null)).toEqual({ armed: null });
});

// ---- 0.63 final review fix pass ----
import { TIPS } from "../src/tips";
import { allEntries } from "../src/codex";
import { withKeys, menuAfterMapClick } from "../src/keymap";
import { CMD_DESC } from "../src/hud";
for (const p of ["grid", "wasd"] as Preset[]) test(`I1: no tip or Codex text shows "(unbound)" on the ${p} keys`, () => {
  const b = presetDefaults(p), bad: string[] = [];
  for (const [id, t] of Object.entries(TIPS)) if (withKeys(t, b).includes("(unbound)")) bad.push(`tip ${id}`);
  for (const e of allEntries()) for (const t of [e.title, e.summary, e.body, ...(e.keys ?? [])]) if (withKeys(t, b).includes("(unbound)")) bad.push(`codex ${e.id}`);
  for (const [id, t] of Object.entries(CMD_DESC)) if (withKeys(t, b).includes("(unbound)")) bad.push(`card ${id}`);
  expect(bad).toEqual([]);
});
test("I2: player text names order keys through the live bindings, not WASD letters", () => {
  const main = require("fs").readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  for (const s of ["Q attack-move, R patrol", "A: attack-move. P: patrol", "T changes what it shoots first, X or Delete"]) expect(main).not.toContain(s);
  expect(withKeys(CMD_DESC.fortify, presetDefaults("grid"))).toMatch(/^D,/);
});
test("I3: a menu kept open with Shift survives a click on the map; a plain one lets go", () => {
  expect(menuAfterMapClick("units", true)).toBe("units");
  expect(menuAfterMapClick("units", false)).toBeNull();
  const main = require("fs").readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  expect(main).toContain("menuAfterMapClick(armedMenu, menuKept)");
});
test("M1: grid: an empty place in an open menu does nothing and keeps the menu", () => {
  expect(menuStep("support", "f", no, G(), "grid")).toEqual({ armed: "support", passThrough: false });
  expect(menuStep("support", "v", no, G(), "grid")).toEqual({ armed: "support", passThrough: false });
  expect(menuStep("support", "j", no, G(), "grid")).toEqual({ armed: null, passThrough: true }); // off the grid: as before
  expect(menuStep("support", "f", no, presetDefaults("wasd"), "wasd")).toEqual({ armed: null, passThrough: true }); // WASD unchanged
});
test("M2: a brand-new save never gets the 'switch back' note", () => {
  expect(defaults().settings.gridNoteSeen).toBe(true);
});
test("M3: the Codex no longer claims rules 0.63 changed", () => {
  const cp = allEntries().find(e => e.id === "controls-page")!.body, bm = allEntries().find(e => e.id === "build-menus")!.body;
  expect(cp).not.toContain("another menu key");
  expect(bm).not.toContain("Either way, the same menu key again");
});

// ---- 0.63.1 ----
test("0.63.1: one press switches menus; a menu's own key is an item", () => {
  const sw = (a: any, k: string) => menuStep(a, k, no, G(), "grid");
  expect(sw("units", "x")).toEqual({ armed: "actions", passThrough: false });
  expect(sw("units", "c")).toEqual({ armed: "support", passThrough: false });
  expect(sw("actions", "z")).toEqual({ armed: "units", passThrough: false });
  expect(sw("actions", "c")).toEqual({ armed: "support", passThrough: false });
  expect(sw("support", "z")).toEqual({ armed: "units", passThrough: false });
  expect(sw("support", "x")).toEqual({ armed: "actions", passThrough: false });
  expect(sw("actions", "x").pick).toBe("supply_drop");
  expect(sw("units", "v").pick).toBe("reaper");
});
test("0.63.1: grid: an item can't take another menu's key", () => {
  expect(bindProblem("build.tank", "x", G(), "grid")?.other).toBe("menu.actions");
  expect(bindProblem("build.tank", "z", { ...G(), "build.apache": null }, "grid")).toBeNull(); // its own menu's key is fine
});
test("0.63.1: Clear Zone has no key and no card button; it lives in the Esc menu", () => {
  expect(ACTIONS.some(a => a.id === "tool.clear")).toBe(false);
  const html = require("fs").readFileSync(import.meta.dir + "/../index.html", "utf8") as string;
  const tools = /<div id="cmdtools">([\s\S]*?)<\/div>\s*<div id="cmdorders"/.exec(html)![1];
  expect(tools).not.toContain('id="clear"');
  expect(html).toContain('id="p-clearzone"');
});
