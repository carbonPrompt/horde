import { expect, test } from "bun:test";
import { keyIntent, cameraKeysActive, pruneSelection, groupIntent } from "../src/input";

const none = { shift: false, ctrl: false, alt: false };

test("0.54: command keys sit around WASD and map to orders only when orderable units are selected", () => {
  expect(keyIntent("q", none, true)).toEqual({ k: "arm", cmd: "amove" });
  expect(keyIntent("Q", none, true)).toEqual({ k: "arm", cmd: "amove" });
  expect(keyIntent("r", none, true)).toEqual({ k: "arm", cmd: "patrol" });
  expect(keyIntent("e", none, true)).toEqual({ k: "arm", cmd: "escort" });
  expect(keyIntent("c", none, true)).toEqual({ k: "arm", cmd: "fortify" });
  expect(keyIntent("f", none, true)).toEqual({ k: "stop", queue: false });
  expect(keyIntent("g", none, true)).toEqual({ k: "standby", queue: false });
  expect(keyIntent("Escape", none, true)).toEqual({ k: "cancel" });
  for (const key of ["q", "r", "e", "f", "g"]) {
    expect(keyIntent(key, none, false)).toBeNull();
    expect(keyIntent(key, { ...none, ctrl: true }, true)).toBeNull();
    expect(keyIntent(key, { ...none, alt: true }, true)).toBeNull();
  }
  for (const key of ["w", "a", "s", "d"]) expect(keyIntent(key, none, true)).toBeNull(); // WASD is the camera, always
});

test("0.54: WASD and the arrows always move the camera", () => {
  for (const k of ["w", "a", "s", "d", "arrowleft", "arrowright", "arrowup", "arrowdown"]) { expect(cameraKeysActive(k, true)).toBe(true); expect(cameraKeysActive(k, false)).toBe(true); }
  expect(cameraKeysActive("q", false)).toBe(false);
});

test("0.45: pruneSelection drops what's gone and keeps order", () => {
  const a = { unit: { id: 1 } } as any, b = { unit: { id: 2 } } as any, c = { support: { id: 3 } } as any;
  expect(pruneSelection([a, b, c], e => e !== b)).toEqual([a, c]);
  expect(pruneSelection([], () => true)).toEqual([]);
});

test("0.54: groupIntent: groups are 1-5 (Ctrl assigns, Shift+Ctrl adds, plain selects, Shift adds); 6-0 are not groups", () => {
  const m = (shift = false, ctrl = false, alt = false) => ({ shift, ctrl, alt });
  expect(groupIntent("3", m(false, true))).toEqual({ k: "assign", n: 2 });
  expect(groupIntent("5", m(true, true))).toEqual({ k: "add", n: 4 });
  expect(groupIntent("5", m())).toEqual({ k: "select", n: 4 });
  expect(groupIntent("Digit2", m(true))).toEqual({ k: "addsel", n: 1 }); // e.code form (Shift turns e.key into a symbol)
  for (const k of ["6", "7", "8", "9", "0", "Digit7"]) expect(groupIntent(k, m())).toBeNull();
  expect(groupIntent("1", m(false, false, true))).toBeNull();
  expect(groupIntent("a", m())).toBeNull();
});

test("0.54: the key map: quick bar keys 6-0 by default, rebinding refuses taken keys, tools and orders all keyed", () => {
  const K = require("../src/keymap");
  expect(K.QUICK_DEFAULT_KEYS).toEqual(["6", "7", "8", "9", "0"]);
  expect(K.cleanQuickKeys(undefined)).toEqual(["6", "7", "8", "9", "0"]);
  expect(K.cleanQuickKeys(["i", "o", "i", "w", null, "y"])).toEqual(["i", "o", null, null, null]); // dupes and WASD dropped, 5 slots
  expect(K.bindProblem("w", 0, [null])).toMatch(/already used/);
  expect(K.bindProblem("6", 1, ["6", null])).toMatch(/slot 1/);
  expect(K.bindProblem("i", 0, [null])).toBeNull();
  expect(K.bindProblem("f7", 0, [null])).toBeNull();
  expect(K.bindProblem("f1", 0, [null])).not.toBeNull();
  expect(K.keyLabel("f7")).toBe("F7"); expect(K.keyLabel(",")).toBe(",");
  for (const k of [...Object.values(K.ORDER_KEYS), ...Object.values(K.TOOL_KEYS)]) expect(["w", "a", "s", "d"]).not.toContain(k);
  const main = require("fs").readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  expect(main).toContain("else if (kl === TOOL_KEYS.build) buildKey();");
});
