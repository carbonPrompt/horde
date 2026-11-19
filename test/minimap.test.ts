import { expect, test } from "bun:test";
import { miniFit, miniToWorld, worldToMini } from "../src/minimap";

test("0.45: the minimap fits the map with letterboxing, keeping its shape", () => {
  const f = miniFit(220, 160, 400, 200); // a 2:1 map in a 220x160 box
  expect(f.scale).toBeCloseTo(220 / 400, 6);
  expect(f.ox).toBeCloseTo(0, 6);
  expect(f.oy).toBeCloseTo((160 - 200 * f.scale) / 2, 6);
});

test("0.45: minimap and world coordinates round-trip; corners map to corners", () => {
  const W = 220, H = 160, w = 300, h = 240;
  for (const p of [[0, 0], [150, 120], [299, 239], [37.5, 201.25]] as [number, number][]) {
    const [mx, my] = worldToMini(p[0], p[1], W, H, w, h);
    const [x, y] = miniToWorld(mx, my, W, H, w, h);
    expect(x).toBeCloseTo(p[0], 6); expect(y).toBeCloseTo(p[1], 6);
  }
  const f = miniFit(W, H, w, h);
  expect(worldToMini(0, 0, W, H, w, h)).toEqual([f.ox, f.oy]);
  const [ex, ey] = worldToMini(w, h, W, H, w, h);
  expect(ex).toBeCloseTo(f.ox + w * f.scale, 6); expect(ey).toBeCloseTo(f.oy + h * f.scale, 6);
});

test("0.45: a click in the letterbox clamps to the map edge", () => {
  const W = 220, H = 160, w = 400, h = 200;
  const [, y] = miniToWorld(100, 1, W, H, w, h); // above the map strip
  expect(y).toBe(0);
  const [, y2] = miniToWorld(100, 159, W, H, w, h);
  expect(y2).toBe(h);
  const [x3] = miniToWorld(-5, 80, W, H, w, h);
  expect(x3).toBe(0);
});
