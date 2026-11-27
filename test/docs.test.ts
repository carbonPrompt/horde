import { expect, test } from "bun:test";
import { TIPS } from "../src/tips";
import * as C from "../src/config";

// 0.46.1: the help keeps up with 0.44 (cursor label, select + Delete), 0.45 (orders, box select, minimap) and
// 0.46 (AC-130 flies in, three guns, move / send home).
import { allEntries } from "../src/codex";
import { withKeys } from "../src/keymap"; // 0.55: texts carry {key:id} tokens, read as the player sees them
// 0.47: the help lives in the Codex entries now, not in index.html.
const howto = allEntries().map(e => withKeys(e.title + " " + e.summary + " " + e.body)).join("\n");

test("0.46.1: How to Play covers selection, orders, the minimap, the cursor label and the AC-130", () => {
  for (const s of ["drag a box", "minimap", "Delete", "attack-move", "Stand by".toLowerCase(), "flies in by itself", "Gatling", "next to the cursor"])
    expect(howto.toLowerCase()).toContain(s.toLowerCase());
  const controls = withKeys(allEntries().find(e => e.id === "controls-all")!.body);
  for (const s of ["Q attack-move", "R patrol", "E escort", "F stop", "G stand by", "Delete", "T target"]) expect(controls).toContain(s); // 0.54 key map
  expect(howto).not.toContain("—");
});

test("0.46.1: there's a tip for the AC-130 controls", () => {
  const t = (TIPS as Record<string, string>).gunship;
  expect(t).toMatch(/right-click/i); expect(t).toMatch(/Delete/);
});

test("0.46.1: the gunship hint no longer promises a fixed arrival delay", () => {
  expect(C.ABILITIES.gunship.hint).toMatch(/nearest edge/);
});

test("0.50: the controls name F1-F3 speed and Ctrl+1-5 battle groups (0.54); 1/2/3 are no longer speed", () => {
  const controls = withKeys(allEntries().find(e => e.id === "controls-all")!.body);
  expect(controls).toContain("F1");
  expect(controls).toContain("Ctrl+1 to Ctrl+5"); // 0.55: worded so a rebound group key reads right
  expect(controls).not.toContain("1/2/3 speed");
  const speed = allEntries().find(e => e.id === "speed")!;
  expect(withKeys(speed.body)).toContain("F1"); expect(withKeys(speed.summary)).not.toMatch(/^1, 2 and 3/);
});

test("0.50 review I7: the player never sees the old name Garrison", () => {
  const html = require("fs").readFileSync(import.meta.dir + "/../index.html", "utf8") as string;
  const main = require("fs").readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  expect(html).not.toMatch(/>Garrison</);
  expect(main).not.toMatch(/"[^"\n]*\bGarrisons?\b[^"\n]*"/);
  for (const e of allEntries()) expect(e.title + e.summary + e.body).not.toMatch(/\bGarrisons?\b/);
});

test("0.55: tips and Codex texts follow the key bindings", () => {
  const K = require("../src/keymap");
  const { TIPS } = require("../src/tips");
  const { allEntries } = require("../src/codex");
  const { renderEntry } = require("../src/codexui");
  const C = require("../src/config");
  const texts: string[] = [...Object.values(TIPS) as string[],
    ...allEntries().flatMap((e: any) => [e.title, e.summary, e.body, ...(e.keys ?? [])])];
  const ids = new Set(K.ACTIONS.map((a: any) => a.id));
  for (const t of texts) for (const m of t.matchAll(/\{key:([a-z0-9_.]+)\}/g)) expect(ids.has(m[1])).toBe(true);
  for (const t of texts) expect(K.withKeys(t)).not.toContain("{key:");
  K.setBinds({ ...K.defaultBinds(), "order.amove": "i" });
  try {
    expect(K.withKeys(TIPS.orders)).toContain("I attack-move");
    expect(K.withKeys(TIPS.orders)).not.toContain("Q attack-move");
    const all = allEntries().find((e: any) => e.id === "controls-all");
    const html = renderEntry(all, { seen: undefined, media: {} } as any, true);
    expect(html).toContain("I attack-move"); expect(html).not.toContain("{key:");
  } finally { K.setBinds(K.defaultBinds()); }
});

test("0.55: the Codex explains the build menus and the Controls page", () => {
  const K = require("../src/keymap");
  const { allEntries } = require("../src/codex");
  const es = allEntries();
  const page = es.find((e: any) => e.id === "controls-page"); expect(page?.since).toBe("0.55.0");
  const menus = es.find((e: any) => e.id === "build-menus"); expect(menus?.since).toBe("0.55.0");
  for (const a of K.ACTIONS.filter((x: any) => x.id.startsWith("build."))) expect(menus.body).toContain(`{key:${a.id}} ${a.label}`);
  // nothing still teaches the 0.45 order keys or the old B behavior
  const body = es.map((e: any) => e.body + e.summary).join("\n");
  expect(body).not.toMatch(/A then click|B build \(the Safe Zone|steps through the tabs|R shows unit ranges/);
});


test("0.56: How to Play chapters 1-6 exist in order with 2-4 figures each and keys as tokens", () => {
  const es = allEntries().filter(e => e.section === "howto");
  for (let n = 1; n <= 6; n++) {
    const e = es.find(x => x.id === `howto-${n}`)!;
    expect(e).toBeDefined(); expect(e.title.startsWith(`${n}. `)).toBe(true);
    expect(e.figs!.length).toBeGreaterThanOrEqual(2); expect(e.figs!.length).toBeLessThanOrEqual(4);
    expect(e.body).not.toMatch(/press [A-Z0-9]\b/);
    expect(e.since).toBe("0.56.0");
  }
  expect(es.map(e => e.id).slice(0, 6)).toEqual(["howto-1", "howto-2", "howto-3", "howto-4", "howto-5", "howto-6"]);
});

test("0.56: How to Play chapters 7-12 exist in order with 2-4 figures each and keys as tokens", () => {
  const es = allEntries().filter(e => e.section === "howto");
  expect(es.map(e => e.id)).toEqual(Array.from({ length: 12 }, (_, i) => `howto-${i + 1}`));
  for (let n = 7; n <= 12; n++) {
    const e = es.find(x => x.id === `howto-${n}`)!;
    expect(e.title.startsWith(`${n}. `)).toBe(true);
    expect(e.figs!.length).toBeGreaterThanOrEqual(2); expect(e.figs!.length).toBeLessThanOrEqual(4);
    expect(e.body).not.toMatch(/press [A-Z0-9]\b/);
  }
});

test("0.56: Start Here is a short overview pointing into How to Play", () => {
  const start = allEntries().filter(e => e.section === "start");
  expect(start.map(e => e.id)).toEqual(["intro", "screen", "move-around"]);
  for (const e of start) expect(e.body).toContain("How to Play");
});

test("0.56: no Codex text mentions the tutorial; the Tips entry is just Tips", () => {
  for (const e of allEntries()) expect(e.title + e.summary + e.body).not.toMatch(/tutorial/i);
  const t = allEntries().find(e => e.id === "tips"); expect(t?.title).toBe("Tips");
});

test("0.56: Codex media stays within budget", () => {
  const fs = require("fs"); const dir = import.meta.dir + "/../assets/codex/";
  const total = fs.readdirSync(dir).filter((f: string) => /\.(png|webm)$/.test(f)).reduce((a: number, f: string) => a + fs.statSync(dir + f).size, 0);
  expect(total).toBeLessThanOrEqual(8_000_000);
});

test("0.56 review #2/#7: no fixed key letters in any Codex text, picture caption or callout", () => {
  for (const e of allEntries()) {
    const ms = [...(e.media ? [e.media] : []), ...(e.figs ?? [])];
    const texts = [e.body, ...ms.map(m => m.alt), ...ms.flatMap(m => (m.callouts ?? []).map(c => c.text))];
    for (const t of texts) expect([e.id, /\b[Pp]ress [A-Z0-9]\b|shown with [A-Z]\b|\((?:T|R|J|N|H|L|Q)\)/.test(t) ? t : ""]).toEqual([e.id, ""]);
  }
});

test("0.56 review #5: the manual's facts match the game", () => {
  const C = require("../src/config");
  const body = (id: string) => allEntries().find(e => e.id === id)!.body;
  expect(body("howto-3")).toMatch(/red/); expect(body("howto-3")).not.toMatch(/tall ones yellow-green\./);
  expect(body("howto-8")).not.toMatch(/go on open ground inside the zone/);
  expect(body("howto-12")).toContain("End round"); expect(body("howto-12")).toMatch(/any time/);
  void C;
});

import { presetDefaults } from "../src/keymap";
for (const p of ["grid", "wasd"] as const) test(`0.63: the Codex names both key presets, the grid card and camera spots (${p} keys)`, () => {
  const all = allEntries(), body = (id: string) => withKeys(all.find(e => e.id === id)!.body, presetDefaults(p));
  const ca = body("controls-all"), bm = body("build-menus"), cp = body("controls-page");
  for (const t of [ca, cp]) { expect(t).toContain("Grid (RTS)"); expect(t).toContain("WASD camera"); }
  expect(ca).toContain("F6"); expect(ca).toContain("Ctrl+");
  expect(bm).toContain("Shift"); expect(bm).toContain("[[fig:grid-card-units]]");
  expect(cp).toContain("[[fig:grid-card-idle]]");
  expect(ca).not.toContain("(unbound)"); expect(bm).not.toContain("(unbound)");
});
