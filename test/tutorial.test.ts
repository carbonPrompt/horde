import { expect, test } from "bun:test";
import { tutorialSteps, currentStep, type TutState } from "../src/tutorial";
import * as C from "../src/config";

const target = C.CITIES[0].recipe!.stands[0];
const zero: TutState = { zoneCells: 0, zoneOverlap: 0, gates: 0, garrisons: 0, snipers: 0, evacs: 0, phase: "plan", lifts: 0,
  toWall: 0, toGate: 0, gatesOpen: 0, strikes: 0, personOpened: false, speedChanged: false, safeShare: 0, hordeAnnounced: false, stepT: 0 };

test("0.41: the fifteen tutorial steps in order", () => {
  const steps = tutorialSteps(target);
  expect(steps.map(s => s.id)).toEqual(["look", "zone", "wall", "reopen", "garrison", "sniper", "evac", "start", "alert", "speed", "close", "strike", "money", "people", "finish"]);
  expect(currentStep(steps, zero, 0)).toBe(0);
  expect(currentStep(steps, { ...zero, zoneOverlap: 0.7, zoneCells: 900 }, 1)).toBe(2);
  expect(currentStep(steps, { ...zero, zoneOverlap: 0.5, zoneCells: 900 }, 1)).toBe(1); // under 60% of the park
});

test("0.41: the walls step waits for the player to turn a gate into wall (the zone's own gates don't count)", () => {
  const steps = tutorialSteps(target), i = steps.findIndex(s => s.id === "wall");
  const zoned = { ...zero, zoneOverlap: 0.8, zoneCells: 900, gates: 60, gatesOpen: 60 };
  expect(currentStep(steps, zoned, 1)).toBe(i);
  expect(currentStep(steps, { ...zoned, toWall: 1 }, 1)).toBe(i + 1); // now: open it again
  expect(currentStep(steps, { ...zoned, toWall: 1, toGate: 1 }, 1)).toBe(i + 2);
});

test("0.41: battle steps: speed, close gates once most are in, a strike, money times out, people, finish", () => {
  const steps = tutorialSteps(target), id = (n: number) => steps[n].id;
  const planned: TutState = { ...zero, zoneOverlap: 1, zoneCells: 900, gates: 60, gatesOpen: 60, toWall: 1, toGate: 1, garrisons: 1, snipers: 1, evacs: 1, phase: "battle" };
  expect(id(currentStep(steps, planned, 1))).toBe("alert");
  const lifted = { ...planned, lifts: 1 };
  expect(id(currentStep(steps, lifted, 1))).toBe("speed");
  const sped = { ...lifted, speedChanged: true };
  const close = steps.find(s => s.id === "close")!;
  expect(id(currentStep(steps, sped, 1))).toBe("close");
  expect(close.show!({ ...sped, safeShare: 0.3 })).toBe(false); // too early: most people are still outside
  expect(close.show!({ ...sped, safeShare: 0.7 })).toBe(true);
  expect(close.show!({ ...sped, safeShare: 0.3, hordeAnnounced: true })).toBe(true);
  const closed = { ...sped, gatesOpen: 0 };
  expect(id(currentStep(steps, closed, 1))).toBe("strike");
  const struck = { ...closed, strikes: 1 };
  expect(id(currentStep(steps, struck, 1))).toBe("money");
  expect(id(currentStep(steps, { ...struck, stepT: 13 }, 1))).toBe("people");
  expect(id(currentStep(steps, { ...struck, stepT: 13, personOpened: true }, 1))).toBe("finish");
  const fin = steps.find(s => s.id === "finish")!;
  expect(fin.show!({ ...struck, stepT: 5 })).toBe(true);
  expect(fin.show!({ ...struck, stepT: 25 })).toBe(false); // closes itself
});

test("0.41: the look step says right-drag and the zone step says how to close it", () => {
  const steps = tutorialSteps(target);
  expect(steps[0].text).toContain("Right-drag");
  expect(steps[1].text).toMatch(/first corner|Enter/);
  expect(steps.find(s => s.id === "start")!.highlight).toEqual({ kind: "button", button: "startbtn" });
});

test("the zone step highlights the tutorial park and the surrounding building blocks", () => {
  const { buildCity } = require("../src/cities/build");
  const { BUILDING, PARK } = require("../src/map");
  const z = tutorialSteps(target).find(s => s.id === "zone")!;
  const r = z.highlight!.rect!;
  expect(target.x >= r.x && target.x < r.x + r.w && target.y >= r.y && target.y < r.y + r.h).toBe(true);
  // 0.37: grown out one full building block on every side so rooftops around the park are inside the yellow box
  const m = buildCity(C.CITIES[0].recipe!);
  let parkCells = 0, bTop = 0, bBot = 0, bLeft = 0, bRight = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const t = m.tile[y * m.w + x];
    if (t === PARK) parkCells++;
    else if (t === BUILDING) {
      if (y < target.y - 18) bTop++;
      if (y > target.y + 18) bBot++;
      if (x < target.x - 23) bLeft++;
      if (x > target.x + 23) bRight++;
    }
  }
  expect(parkCells).toBeGreaterThan(1000);
  expect(bTop).toBeGreaterThan(150);
  expect(bBot).toBeGreaterThan(150);
  expect(bLeft).toBeGreaterThan(150);
  expect(bRight).toBeGreaterThan(150);
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

test("0.41 review: the alert and people steps heal themselves after a minute", () => {
  const steps = tutorialSteps(target);
  const alert = steps.find(s => s.id === "alert")!, people = steps.find(s => s.id === "people")!;
  expect(alert.done({ ...zero, phase: "battle", stepT: 61 })).toBe(true); // no lift came (pad removed, waved off)
  expect(people.done({ ...zero, phase: "battle", stepT: 61 })).toBe(true); // nobody clickable / skipped by the player
  expect(alert.done({ ...zero, phase: "battle", stepT: 10 })).toBe(false);
});
