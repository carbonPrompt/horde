import { expect, test } from "bun:test";
import { parseOp, runOps, type ShotApi, type ShotOp } from "../src/shotmode";

test("parseOp reads every op form", () => {
  expect(parseOp("zone 120,80 260,80 260,200")).toEqual({ op: "zone", pts: [[120, 80], [260, 80], [260, 200]] });
  expect(parseOp("place apc 150,120")).toEqual({ op: "place", kind: "apc", x: 150, y: 120 });
  expect(parseOp("gate 10.5,20")).toEqual({ op: "gate", x: 10.5, y: 20 });
  expect(parseOp("battle")).toEqual({ op: "battle" });
  expect(parseOp("advance 25")).toEqual({ op: "advance", s: 25 });
  expect(parseOp("select 3,4")).toEqual({ op: "select", x: 3, y: 4 });
  expect(parseOp("boxselect 1,2 30,40")).toEqual({ op: "boxselect", x0: 1, y0: 2, x1: 30, y1: 40 });
  expect(parseOp("key A")).toEqual({ op: "key", key: "A" });
  expect(parseOp("click 230,150")).toEqual({ op: "click", x: 230, y: 150, button: "left" });
  expect(parseOp("click 230,150 right")).toEqual({ op: "click", x: 230, y: 150, button: "right" });
  expect(parseOp("tool sniper")).toEqual({ op: "tool", tool: "sniper" });
  expect(parseOp("hover 5,6")).toEqual({ op: "hover", x: 5, y: 6 });
  expect(parseOp("camera 190,140 4")).toEqual({ op: "camera", x: 190, y: 140, scale: 4 });
  expect(parseOp("ability airstrike")).toEqual({ op: "ability", kind: "airstrike" });
  expect(parseOp("time 600")).toEqual({ op: "time", min: 600 });
  expect(parseOp("person 178,140")).toEqual({ op: "person", x: 178, y: 140 });
  expect(parseOp("cursor off")).toEqual({ op: "cursor", on: false });
});

test("parseOp refuses junk with a clear message", () => {
  for (const bad of ["cursor maybe", "fly 1,2", "place apc", "zone 1,2", "advance x", "click 1,2 middle", "camera 1,2", ""]) expect(() => parseOp(bad)).toThrow(/bad shot op/);
});

test("runOps applies ops in order and turns advance into a step", () => {
  const seen: (ShotOp | string)[] = [];
  const api: ShotApi = { apply: op => seen.push(op), step: s => seen.push("step " + s) };
  runOps(api, ["battle", "advance 25", "key A"]);
  expect(seen).toEqual([{ op: "battle" }, "step 25", { op: "key", key: "A" }]);
});

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeHash, staleReport, type Recipe, type ManifestRow } from "../tools/shots/stale";
import { runRecipe, type Cdp } from "../tools/shots/run";
import type { CodexEntry } from "../src/codex";

const R = (o: Partial<Recipe> = {}): Recipe => ({ id: "a", kind: "shot", city: "fairhaven", seed: 101, startMin: 600, size: [960, 540],
  setup: ["battle"], camera: { x: 1, y: 2, scale: 3 }, rev: 1, ...o });
const E = (id: string, mediaId: string, updated = "0.47.0"): CodexEntry => ({ id, section: "start", title: id, summary: "s", body: "b",
  since: "0.47.0", updated, media: { kind: "shot", id: mediaId, alt: "x" } });
const row = (r: Recipe, version = "0.47.0"): ManifestRow => ({ version, rev: r.rev, recipeHash: recipeHash(r), bytes: 10, w: 960, h: 540 });

test("recipeHash ignores key order and changes with the setup", () => {
  const a = R(), b = Object.fromEntries(Object.entries(R()).reverse()) as Recipe;
  expect(recipeHash(a)).toBe(recipeHash(b));
  expect(recipeHash(a)).not.toBe(recipeHash(R({ setup: ["battle", "advance 5"] })));
  expect(recipeHash(a)).toMatch(/^[0-9a-f]{12}$/);
});

test("staleReport names each kind of problem", () => {
  const ok = R({ id: "ok" }), changed = R({ id: "changed" }), old = R({ id: "old" }), missing = R({ id: "missing" }), unused = R({ id: "unused" });
  const manifest = { ok: row(ok), changed: { ...row(changed), recipeHash: "000000000000" }, old: row(old, "0.46.0"), unused: row(unused), orphanrow: row(R({ id: "orphanrow" })) };
  const entries = [E("e1", "ok"), E("e2", "changed"), E("e3", "old"), E("e4", "missing"), E("e5", "norecipe")];
  const exists = (f: string) => !f.includes("missing");
  const rep = staleReport([ok, changed, old, missing, unused], manifest, entries, exists);
  const why = Object.fromEntries(rep.map(x => [x.id, x.why]));
  expect(why).toEqual({ changed: "recipe-changed", old: "older-than-entry", missing: "missing", norecipe: "no-recipe", unused: "orphan", orphanrow: "orphan" });
});

test("a failing recipe rejects with its id and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  const cdp: Cdp = { send: async () => { throw new Error("chrome hung"); }, eval: async () => { throw new Error("chrome hung"); } };
  await expect(runRecipe(cdp, R({ id: "boom" }), dir)).rejects.toThrow(/boom/);
  expect(readdirSync(dir)).toEqual([]);
});

import { shotsAllowed } from "../src/shotmode";
test("final review #1: shot mode only runs from a local file, never on the web build", () => {
  expect(shotsAllowed("file:///x/dist/horde.html?shots=1")).toBe(true);
  expect(shotsAllowed("https://carbonprompt.github.io/horde/?shots=1")).toBe(false);
  expect(shotsAllowed("http://127.0.0.1:8765/horde.html?shots=1")).toBe(false);
  expect(shotsAllowed("file:///x/dist/horde.html")).toBe(false);
});

// ---------- 0.47.1: final review minor #10 ----------
import { atomicCopy } from "../tools/shots/run";
import { CdpClient } from "../tools/shots/cdp";
import { existsSync as ex2, readFileSync as rf2, writeFileSync as wf2 } from "node:fs";

test("minor #10: atomicCopy replaces the target whole and leaves no temp file", () => {
  const d = mkdtempSync(join(tmpdir(), "atomic-"));
  wf2(join(d, "src"), "new"); wf2(join(d, "dst.png"), "old");
  atomicCopy(join(d, "src"), join(d, "dst.png"));
  expect(rf2(join(d, "dst.png"), "utf8")).toBe("new");
  expect(readdirSync(d).sort()).toEqual(["dst.png", "src"]);
});

test("minor #10: after Chrome's socket closes, calls fail at once instead of waiting 60 s", async () => {
  const srv = Bun.serve({ port: 0, fetch(req, s) { return s.upgrade(req) ? undefined : new Response("no"); },
    websocket: { message() {}, open(ws) { setTimeout(() => ws.close(), 20); } } });
  try {
    const c = await CdpClient.connect(`ws://127.0.0.1:${srv.port}`);
    await Bun.sleep(100);
    expect(c.closed).toBe(true);
    const t0 = performance.now();
    await expect(c.send("Page.enable")).rejects.toThrow(/closed/);
    expect(performance.now() - t0).toBeLessThan(1000);
  } finally { srv.stop(true); }
});

test("minor #10: run.ts builds from the repo root, whatever the current folder", () => {
  const src = rf2(new URL("../tools/shots/run.ts", import.meta.url), "utf8");
  expect(src).toMatch(/spawnSync\(cmd, \{ cwd: ROOT/);
  expect(ex2(new URL("../build.ts", import.meta.url))).toBe(true);
});

test("0.51 review I5/I6: map crops end above the bottom panel; the minimap-alerts crop is the panel's minimap; retired captions", () => {
  const src = require("fs").readFileSync(import.meta.dir + "/../tools/shots/recipes.ts", "utf8") as string;
  const m = /const MAP: \[number, number, number, number\] = \[(\d+), (\d+), (\d+), (\d+)\]/.exec(src)!;
  expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(352);
  expect(src).toMatch(/id: "battle-minimap-alerts"[^\n]*crop: \[0, 35\d, /);
  const codex = require("fs").readFileSync(import.meta.dir + "/../src/codex.ts", "utf8") as string;
  expect(codex).not.toMatch(/selection bar/i);
});
