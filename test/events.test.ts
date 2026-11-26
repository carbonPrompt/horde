// 0.62: Battle Events, the pure parts (timing, rewards, copy) and the mutator.
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { firstAlertT, nextAlertT, bevOrder, bevReward, bevTitle, bevGoal } from "../src/events";

test("mutator exists", () => {
  expect(C.MUTATOR_IDS).toContain("battle_events");
  expect(C.MUTATORS.battle_events.name).toBe("Battle Events");
});

test("first alert in [150,240], seeded", () => {
  for (const s of [1, 7, 42, 999]) {
    const t = firstAlertT(s);
    expect(t).toBeGreaterThanOrEqual(150); expect(t).toBeLessThanOrEqual(240);
    expect(firstAlertT(s)).toBe(t);
  }
});

test("gap in [150,270] after resolution", () => {
  for (const s of [1, 7, 42]) for (const n of [1, 2]) {
    const t = nextAlertT(s, n, 400);
    expect(t - 400).toBeGreaterThanOrEqual(150); expect(t - 400).toBeLessThanOrEqual(270);
  }
});

test("order is a permutation of the four, seeded", () => {
  expect([...bevOrder(42)].sort()).toEqual(["class", "mayor", "power", "research"]);
  expect(bevOrder(42)).toEqual(bevOrder(42));
});

test("rewards", () => {
  expect(bevReward("mayor", true, 1, 1, 1)).toEqual({ score: 4, cash: 4_000_000, xp: 120 });
  expect(bevReward("mayor", false, 0, 1, 1)).toEqual({ score: -5, cash: 0, xp: 0 });
  expect(bevReward("class", true, 0.5, 2, 1.5)).toEqual({ score: 2, cash: 4_000_000, xp: 90 });
  expect(bevReward("class", false, 0.25, 1, 1).score).toBeCloseTo(-3.75);
});

test("copy has no em dash and says what counts", () => {
  for (const k of ["mayor", "class", "research", "power"] as const) {
    expect(bevTitle(k, "Ann Lee", 4)).not.toContain("\u2014");
    expect(bevGoal(k)).not.toContain("\u2014");
    expect(bevGoal(k).length).toBeGreaterThan(10);
  }
  expect(bevTitle("mayor", "Ann Lee", 3)).toContain("Ann Lee");
});

test("mayor title never says 0 aides", () => {
  expect(bevTitle("mayor", "Ann Lee", 1)).toBe("Mayor Ann Lee is sheltering alone");
  expect(bevTitle("mayor", "Ann Lee", 2)).toBe("Mayor Ann Lee is sheltering with an aide");
  expect(bevTitle("mayor", "Ann Lee", 3)).toBe("Mayor Ann Lee is sheltering with 2 aides");
});
