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

test("0.54/0.55: the key map: quick bar 6-0, orders and tools keyed, none on WASD", () => {
  const K = require("../src/keymap");
  const d = K.defaultBinds();
  expect([1, 2, 3, 4, 5].map(n => d[`quick.${n}`])).toEqual(["6", "7", "8", "9", "0"]);
  expect(K.keyLabel("f7")).toBe("F7"); expect(K.keyLabel(",")).toBe(","); expect(K.keyLabel(" ")).toBe("Space");
  for (const a of K.ACTIONS) if (a.id.startsWith("order.") || a.id.startsWith("tool.")) { expect(a.key).toBeTruthy(); expect(["w", "a", "s", "d"]).not.toContain(a.key); }
});

test("0.55: keys follow the bindings (orders, camera, groups)", () => {
  const K = require("../src/keymap");
  const none = { shift: false, ctrl: false, alt: false };
  K.setBinds({ ...K.defaultBinds(), "order.amove": "i", "camera.up": "o", "group.1": "z" });
  try {
    expect(keyIntent("i", none, true)).toEqual({ k: "arm", cmd: "amove" });
    expect(keyIntent("q", none, true)).toBeNull();
    expect(cameraKeysActive("o", false)).toBe(true);
    expect(cameraKeysActive("w", false)).toBe(false);
    expect(cameraKeysActive("arrowup", false)).toBe(true);
    expect(groupIntent("z", none)).toEqual({ k: "select", n: 0 });
    expect(groupIntent("z", { ...none, ctrl: true })).toEqual({ k: "assign", n: 0 });
    expect(groupIntent("1", none)).toBeNull();
    expect(groupIntent("2", none)).toEqual({ k: "select", n: 1 });
  } finally { K.setBinds(K.defaultBinds()); }
});
