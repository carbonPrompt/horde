import { expect, test } from "bun:test";
import { keyIntent, cameraKeysActive, pruneSelection } from "../src/input";

const none = { shift: false, ctrl: false, alt: false };

test("0.45: command keys map to orders only when orderable units are selected", () => {
  expect(keyIntent("a", none, true)).toEqual({ k: "arm", cmd: "amove" });
  expect(keyIntent("A", none, true)).toEqual({ k: "arm", cmd: "amove" });
  expect(keyIntent("p", none, true)).toEqual({ k: "arm", cmd: "patrol" });
  expect(keyIntent("e", none, true)).toEqual({ k: "arm", cmd: "escort" });
  expect(keyIntent("s", none, true)).toEqual({ k: "stop", queue: false });
  expect(keyIntent("d", none, true)).toEqual({ k: "standby", queue: false });
  expect(keyIntent("Escape", none, true)).toEqual({ k: "cancel" });
  for (const key of ["a", "p", "e", "s", "d"]) {
    expect(keyIntent(key, none, false)).toBeNull();
    expect(keyIntent(key, { ...none, ctrl: true }, true)).toBeNull();
    expect(keyIntent(key, { ...none, alt: true }, true)).toBeNull();
  }
  expect(keyIntent("x", none, true)).toBeNull();
});

test("0.45: WASD pans only with nothing orderable selected; arrows always", () => {
  for (const k of ["w", "a", "s", "d"]) { expect(cameraKeysActive(k, true)).toBe(false); expect(cameraKeysActive(k, false)).toBe(true); }
  for (const k of ["arrowleft", "arrowright", "arrowup", "arrowdown"]) { expect(cameraKeysActive(k, true)).toBe(true); expect(cameraKeysActive(k, false)).toBe(true); }
  expect(cameraKeysActive("q", false)).toBe(false);
});

test("0.45: pruneSelection drops what's gone and keeps order", () => {
  const a = { unit: { id: 1 } } as any, b = { unit: { id: 2 } } as any, c = { support: { id: 3 } } as any;
  expect(pruneSelection([a, b, c], e => e !== b)).toEqual([a, c]);
  expect(pruneSelection([], () => true)).toEqual([]);
});
