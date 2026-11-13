import { expect, test } from "bun:test";
import { tutorialSteps, currentStep, type TutState } from "../src/tutorial";
import * as C from "../src/config";

const target = C.CITIES[0].recipe!.stands[0];
const zero: TutState = { zoneCells: 0, zoneOverlap: 0, gates: 0, garrisons: 0, snipers: 0, evacs: 0, phase: "plan", lifts: 0 };

test("tutorial steps advance in order", () => {
  const steps = tutorialSteps(target);
  expect(steps.map(s => s.id)).toEqual(["pan", "zone", "gates", "garrison", "sniper", "evac", "start", "lift", "end"]);
  expect(currentStep(steps, zero, 0)).toBe(0);
  expect(currentStep(steps, { ...zero, zoneOverlap: 0.7, zoneCells: 900 }, 1)).toBe(2);
  expect(currentStep(steps, { ...zero, zoneOverlap: 0.5, zoneCells: 900 }, 1)).toBe(1); // under 60% of the park
  const done: TutState = { zoneCells: 900, zoneOverlap: 1, gates: 3, garrisons: 1, snipers: 1, evacs: 1, phase: "battle", lifts: 1 };
  expect(currentStep(steps, done, 1)).toBe(steps.length - 1);
});

test("the zone step highlights the tutorial park", () => {
  const z = tutorialSteps(target).find(s => s.id === "zone")!;
  const r = z.highlight!.rect!;
  expect(target.x >= r.x && target.x < r.x + r.w && target.y >= r.y && target.y < r.y + r.h).toBe(true);
});

test("no em dash in the tutorial or the city intros", () => {
  for (const s of tutorialSteps(target)) expect(s.text.includes("\u2014")).toBe(false);
  for (const c of C.CITIES) for (const l of c.intro ?? []) expect(l.includes("\u2014")).toBe(false);
});

test("every city after the first has an intro, naming its loaned unit when it lends one", () => {
  for (const c of C.CITIES.slice(1)) {
    expect((c.intro ?? []).length).toBeGreaterThan(0);
    if (!c.trial) continue;
    const t = c.trial!, name = ((C.UNITS as any)[t] ?? (C.ABILITIES as any)[t]).name as string;
    expect(c.intro![0].toLowerCase()).toContain(name.toLowerCase());
  }
});

// ---- Final review #1/#2: when the tutorial runs
import { wantTutorial } from "../src/tutorial";
test("the tutorial runs on City 1 until its first medal, or when asked to replay", () => {
  expect(wantTutorial({ first: true, medal: false, daily: false, replay: false })).toBe(true);   // a saved plan no longer stops it
  expect(wantTutorial({ first: true, medal: true, daily: false, replay: false })).toBe(false);
  expect(wantTutorial({ first: true, medal: true, daily: false, replay: true })).toBe(true);     // Replay tutorial
  expect(wantTutorial({ first: false, medal: false, daily: false, replay: true })).toBe(false);  // other cities never
  expect(wantTutorial({ first: true, medal: false, daily: true, replay: false })).toBe(false);   // not in a daily
});
