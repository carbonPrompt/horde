// 0.55: one action table for every key; bindings, clash rules, swap, save cleaning (design ~/plans 2026-11-23 0.55).
import { expect, test } from "bun:test";
import { ACTIONS, MENU_ITEMS, defaultBinds, bindProblem, swap, actionFor, cleanKeys, overrides, withKeys, keyOf, setBinds, keyFor } from "../src/keymap";

test("0.55: the defaults have no clashes", () => {
  const d = defaultBinds();
  for (const a of ACTIONS) {
    if (!a.key) continue;
    const without = { ...d, [a.id]: null };
    expect([a.id, bindProblem(a.id, a.key, without)]).toEqual([a.id, null]);
  }
});

test("0.55: spec defaults", () => {
  const d = defaultBinds();
  expect(d["order.amove"]).toBe("q"); expect(d["menu.units"]).toBe("b"); expect(d["menu.actions"]).toBe("m"); expect(d["menu.support"]).toBe("y");
  expect(d["build.garrison"]).toBe("t"); expect(d["build.airstrike"]).toBe("r"); expect(d["build.evac"]).toBe("e");
  expect(d["quick.1"]).toBe("6"); expect(d["quick.5"]).toBe("0"); expect(d["group.5"]).toBe("5"); expect(d["camera.up"]).toBe("w"); expect(d["pause"]).toBe(" ");
  expect(MENU_ITEMS.units.length).toBe(13); expect(MENU_ITEMS.actions.length).toBe(12); expect(MENU_ITEMS.support.length).toBe(8);
  for (const m of Object.values(MENU_ITEMS)) for (const t of m) expect(["w", "a", "s", "d", "b", "m", "y"]).not.toContain(d["build." + t]);
});

test("0.55: clashes name the holder (for Swap); swap trades the two keys", () => {
  const d = defaultBinds();
  const p = bindProblem("order.amove", "t", d)!; expect(p.other).toBe("order.target"); expect(p.why).toContain("Target");
  expect(bindProblem("tool.zone", "q", d)?.other).toBe("tool.recall");
  expect(bindProblem("order.stop", "x", d)?.other).toBe("order.remove");
  expect(bindProblem("tool.order", "f", d)).toBeNull(); // f is an order: another context
  expect(bindProblem("build.garrison", "r", d)?.other).toBe("build.mortar");
  expect(bindProblem("build.garrison", "q", d)).toBeNull(); // menu letters win while the menu waits
  expect(bindProblem("build.garrison", "m", d)).toBeNull(); // 0.63: inside a menu its item wins over a menu key
  expect(bindProblem("build.garrison", "w", d)?.other).toBe("camera.up");
  expect(bindProblem("menu.units", "t", d)?.other).toBeTruthy(); // a build letter
  expect(bindProblem("order.amove", "w", d)?.other).toBe("camera.up"); // camera is always on
  expect(bindProblem("pause", "escape", d)!.why).toMatch(/can't be changed/);
  expect(bindProblem("pause", "arrowup", d)!.why).toMatch(/can't be changed/);
  expect(bindProblem("pause", "printscreen", d)!.why).toMatch(/can't be used/);
  const s = swap("order.amove", "order.target", d); expect(s["order.amove"]).toBe("t"); expect(s["order.target"]).toBe("q");
});

test("0.55: actionFor picks by context", () => {
  setBinds(defaultBinds());
  expect(actionFor("q", "selected")).toBe("order.amove");
  expect(actionFor("q", "idle")).toBe("tool.recall");
  expect(actionFor("w", "selected")).toBe("camera.up");
  expect(actionFor("6", "idle")).toBe("quick.1");
  expect(actionFor("t", "units")).toBe("build.garrison");
  expect(actionFor("w", "units")).toBeNull();
  expect(actionFor("r", "actions")).toBe("build.airstrike");
  expect(keyFor("order.target")).toBe("t");
});

test("0.55: cleanKeys keeps valid overrides, drops junk, migrates 0.54 quick keys", () => {
  const d = defaultBinds();
  expect(cleanKeys(undefined)).toEqual(d);
  const a = cleanKeys({ "order.amove": "t" }); expect(a["order.amove"]).toBe("t"); expect(a["order.target"]).toBeNull();
  expect(cleanKeys({ bogus: "z", pause: 7, "order.stop": "escape" })).toEqual(d);
  expect(cleanKeys("nope")).toEqual(d);
  const q = cleanKeys(undefined, [";", "o", null, null, null]); expect(q["quick.1"]).toBe(";"); // 0.60: "i" is the Inventory now expect(q["quick.2"]).toBe("o"); expect(q["quick.3"]).toBeNull();
  expect(cleanKeys({ "quick.1": "p" }, ["i"])["quick.1"]).toBe("p"); // the new setting wins
  const u = cleanKeys({ "camera.up": null }); expect(u["camera.up"]).toBeNull(); // cleared on purpose stays cleared
});

test("0.55: overrides, withKeys, keyOf", () => {
  const d = defaultBinds();
  expect(overrides(d)).toEqual({});
  expect(overrides({ ...d, "order.amove": "i" })).toEqual({ "order.amove": "i" });
  setBinds(d);
  expect(withKeys("press {key:order.amove}")).toBe("press Q");
  expect(withKeys("{key:pause} pauses")).toBe("Space pauses");
  expect(withKeys("x {key:order.amove}", { ...d, "order.amove": null })).toBe("x (unbound)");
  expect(keyOf({ key: "%", code: "Digit5" })).toBe("5");
  expect(keyOf({ key: "T", code: "KeyT" })).toBe("t");
  expect(keyOf({ key: "F7", code: "F7" })).toBe("f7");
  expect(keyOf({ key: " ", code: "Space" })).toBe(" ");
  expect(keyOf({ key: "Tab", code: "Tab" })).toBe("tab");
  expect(keyOf({ key: "ArrowUp", code: "ArrowUp" })).toBe("arrowup");
});

test("0.55: the save keeps a well-formed settings.keys and drops junk", () => {
  const Save = require("../src/save");
  const base = Save.defaults();
  const ok = Save.clean({ ...base, settings: { ...base.settings, keys: { "order.amove": "i", "camera.up": null } } });
  expect(ok.settings.keys).toEqual({ "order.amove": "i", "camera.up": null });
  expect(Save.clean({ ...base, settings: { ...base.settings, keys: "x" } }).settings.keys).toBeUndefined();
  expect(Save.clean({ ...base, settings: { ...base.settings, keys: ["q"] } }).settings.keys).toBeUndefined();
  const mixed = Save.clean({ ...base, settings: { ...base.settings, keys: { "order.amove": 5, "pause": "f".repeat(20), "order.stop": "o", "<b>": "q" } } });
  expect(mixed.settings.keys).toEqual({ "order.stop": "o" });
});

test("0.55: menuStep: menu key arms, its letter picks, anything else disarms and passes through", async () => {
  const { menuStep } = await import("../src/keymap");
  const d = defaultBinds();
  expect(menuStep(null, "b", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: "units", passThrough: false });
  expect(menuStep("units", "t", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, pick: "garrison", passThrough: false });
  expect(menuStep("units", "m", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: "actions", passThrough: false });
  expect(menuStep("units", "b", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, passThrough: false });
  expect(menuStep("units", "w", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, passThrough: true });
  expect(menuStep("units", "q", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, passThrough: true });
  expect(menuStep("actions", "r", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, pick: "airstrike", passThrough: false });
  expect(menuStep("support", "e", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, pick: "evac", passThrough: false });
  expect(menuStep(null, "t", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, passThrough: true });
  expect(menuStep("units", "escape", { selected: false, shift: false }, d, "wasd")).toEqual({ armed: null, passThrough: false });
});

test("0.55: controlsRows lists every action in Controls-page groups", async () => {
  const { controlsRows } = await import("../src/keymap");
  const g = controlsRows(defaultBinds());
  expect(g.map(x => x.group)).toEqual(["Camera", "Always", "With units selected", "Nothing selected", "Battle groups", "Quick bar", "Build menus"]);
  const build = g.find(x => x.group === "Build menus")!;
  expect(build.rows.length).toBe(3 + 1 + 33); // 0.63: + Back
  expect(build.rows.slice(0, 3).map(r => r.id)).toEqual(["menu.units", "menu.actions", "menu.support"]);
  expect(build.rows.find(r => r.id === "build.garrison")).toEqual({ id: "build.garrison", label: "Troops", key: "T", sub: "Units" });
  expect(g.find(x => x.group === "Camera")!.rows.map(r => r.key)).toEqual(["W", "A", "S", "D", "F6", "F7", "F8", "F9"]); // 0.63: camera spots
  expect(g.flatMap(x => x.rows).length).toBe(ACTIONS.length);
});

test("0.55: resetGroup restores one group's defaults and keeps the rest", async () => {
  const { resetGroup } = await import("../src/keymap");
  const d = defaultBinds();
  const b = { ...d, "camera.up": "i", "order.stop": "o" };
  const r = resetGroup("Camera", b);
  expect(r["camera.up"]).toBe("w"); expect(r["order.stop"]).toBe("o");
  // a default that is now taken by another group's change comes back unbound, never a clash
  const c = resetGroup("With units selected", { ...d, "order.amove": null, "tool.recall": "y", "menu.support": null, "camera.up": "q" });
  expect(c["order.amove"]).toBeNull();
});

test("0.55 review #1: bindProblem names every clashing action (Swap only makes sense for one)", () => {
  const d = defaultBinds();
  const p = bindProblem("view.heights", "x", d)!;
  expect(p.others!.sort()).toEqual(["order.remove", "tool.remove"]); // C4's X is a menu letter: no clash by design
  expect(bindProblem("order.amove", "t", d)!.others).toEqual(["order.target"]);
});

test("0.55 review #3: 0.54 quick keys never take a default menu or camera key", () => {
  const b = cleanKeys(undefined, ["m", ";", "y", null, "p"]); // 0.60: "i" is the Inventory now
  expect(b["menu.actions"]).toBe("m"); expect(b["menu.support"]).toBe("y");
  expect(b["quick.1"]).toBe("6"); expect(b["quick.3"]).toBe("8"); // fell back to their defaults
  expect(b["quick.2"]).toBe(";"); expect(b["quick.4"]).toBeNull(); expect(b["quick.5"]).toBe("p");
  expect(cleanKeys({ "quick.1": "m", "menu.actions": "k" })["quick.1"]).toBe("m"); // a 0.55 choice is the player's own
});

test("0.55 review #6: a bare modifier or a repeat doesn't disarm a waiting menu", async () => {
  const { menuStep } = await import("../src/keymap");
  const d = defaultBinds();
  for (const k of ["shift", "control", "alt", "meta", "capslock"]) expect(menuStep("units", k, d)).toEqual({ armed: "units", passThrough: true });
});

test("0.60: I opens the Inventory and clashes with nothing", () => {
  const { ACTIONS, defaultBinds } = require("../src/keymap");
  expect(ACTIONS.some((a: any) => a.id === "inventory")).toBe(true);
  expect(defaultBinds().inventory).toBe("i");
});
