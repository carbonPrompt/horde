import { expect, test } from "bun:test";
import { TIPS } from "../src/tips";
import { tutorialSteps } from "../src/tutorial";
import * as C from "../src/config";

// 0.46.1: the help keeps up with 0.44 (cursor label, select + Delete), 0.45 (orders, box select, minimap) and
// 0.46 (AC-130 flies in, three guns, move / send home).
import { allEntries } from "../src/codex";
// 0.47: the help lives in the Codex entries now, not in index.html.
const howto = allEntries().map(e => e.title + " " + e.summary + " " + e.body).join("\n");

test("0.46.1: How to Play covers selection, orders, the minimap, the cursor label and the AC-130", () => {
  for (const s of ["drag a box", "minimap", "Delete", "attack-move", "Stand by".toLowerCase(), "flies in by itself", "Gatling", "next to the cursor"])
    expect(howto.toLowerCase()).toContain(s.toLowerCase());
  const controls = allEntries().find(e => e.id === "controls-all")!.body;
  for (const s of ["Q attack-move", "R patrol", "E escort", "F stop", "G stand by", "Delete", "T target"]) expect(controls).toContain(s); // 0.54 key map
  expect(howto).not.toContain("—");
});

test("0.46.1: there's a tip for the AC-130 controls, and the tutorial says how to undo a placement", () => {
  const t = (TIPS as Record<string, string>).gunship;
  expect(t).toMatch(/right-click/i); expect(t).toMatch(/Delete/);
  const steps = tutorialSteps({ x: 100, y: 100, r: 10 } as any);
  expect(steps.find(s => s.id === "garrison")!.text).toMatch(/Delete/);
});

test("0.46.1: the gunship hint no longer promises a fixed arrival delay", () => {
  expect(C.ABILITIES.gunship.hint).toMatch(/nearest edge/);
});

test("0.50: the controls name F1-F3 speed and Ctrl+1-5 battle groups (0.54); 1/2/3 are no longer speed", () => {
  const controls = allEntries().find(e => e.id === "controls-all")!.body;
  expect(controls).toContain("F1");
  expect(controls).toContain("Ctrl+1-5");
  expect(controls).not.toContain("1/2/3 speed");
  const speed = allEntries().find(e => e.id === "speed")!;
  expect(speed.body).toContain("F1"); expect(speed.summary).not.toMatch(/^1, 2 and 3/);
});

test("0.50 review I7: the player never sees the old name Garrison", () => {
  const html = require("fs").readFileSync(import.meta.dir + "/../index.html", "utf8") as string;
  const main = require("fs").readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  expect(html).not.toMatch(/>Garrison</);
  expect(main).not.toMatch(/"[^"\n]*\bGarrisons?\b[^"\n]*"/);
  const steps = tutorialSteps({ x: 100, y: 100, r: 10 } as any);
  expect(steps.find(s => s.id === "garrison")!.text).not.toMatch(/Garrison/);
  for (const e of allEntries()) expect(e.title + e.summary + e.body).not.toMatch(/\bGarrisons?\b/);
});
