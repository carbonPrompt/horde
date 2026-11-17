import { expect, test } from "bun:test";
import { TIPS, TIP_IDS, shouldTip } from "../src/tips";
import { clean } from "../src/save";

test("0.41: every tip has short plain text", () => {
  expect(TIP_IDS.length).toBeGreaterThanOrEqual(10);
  for (const id of TIP_IDS) {
    expect(TIPS[id].length).toBeGreaterThan(10);
    expect(TIPS[id].length).toBeLessThanOrEqual(170); // fits the ticker
    expect(TIPS[id]).not.toMatch(/—/);
  }
});

test("0.41: a tip shows once per save, never under the tutorial, never with tips off", () => {
  expect(shouldTip("horde", [], false, true)).toBe(true);
  expect(shouldTip("horde", ["horde"], false, true)).toBe(false);
  expect(shouldTip("horde", [], true, true)).toBe(false);
  expect(shouldTip("horde", [], false, false)).toBe(false);
});

test("0.41: save keeps the tips switch and the seen list, drops junk", () => {
  const base = { best: {}, plans: {} };
  const ok = clean({ ...base, settings: { fullscreen: true, edgeScroll: false, showRanges: false, tips: false, tipsSeen: ["horde", "sell"] } as any });
  expect(ok.settings.tips).toBe(false);
  expect(ok.settings.tipsSeen).toEqual(["horde", "sell"]);
  const bad = clean({ ...base, settings: { fullscreen: true, edgeScroll: false, showRanges: false, tips: "yes", tipsSeen: ["horde", 5, "<b>"] } as any });
  expect(bad.settings.tips).toBeUndefined();
  expect(bad.settings.tipsSeen).toEqual(["horde"]);
});

test("0.42: there's a tip for refusers", () => {
  expect(TIP_IDS).toContain("refuse" as any);
  expect(TIPS["refuse" as keyof typeof TIPS]).toMatch(/talk them out/);
});
