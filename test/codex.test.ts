import { expect, test } from "bun:test";
import { SECTIONS, ENTRIES, allEntries, renderBody, verCmp } from "../src/codex";

// 0.47: How to Play became the Codex. These tests pin its content rules.
const SEMVER = /^\d+\.\d+\.\d+$/;

test("every section has at least one entry and ids are unique", () => {
  const all = allEntries();
  for (const s of SECTIONS) expect(all.some(e => e.section === s.id)).toBe(true);
  const ids = all.map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ENTRIES.length).toBeGreaterThanOrEqual(20);
});

test("renderBody escapes HTML and supports bold, keys, paragraphs", () => {
  expect(renderBody("a <b> **x** `Q`\n\nb")).toBe("<p>a &lt;b&gt; <b>x</b> <kbd>Q</kbd></p><p>b</p>");
});

test("no em dash, summaries <= 120 chars, versions are semver", () => {
  for (const e of allEntries()) {
    for (const s of [e.title, e.summary, e.body, e.media?.alt ?? ""]) expect(s).not.toContain("—");
    expect(e.summary.length).toBeLessThanOrEqual(120);
    expect(e.summary.length).toBeGreaterThan(0);
    expect(e.since).toMatch(SEMVER);
    expect(e.updated).toMatch(SEMVER);
    expect(verCmp(e.updated, e.since)).toBeGreaterThanOrEqual(0);
  }
});

test("verCmp orders 0.9.0 < 0.10.0 < 0.47.0", () => {
  expect(verCmp("0.9.0", "0.10.0")).toBeLessThan(0);
  expect(verCmp("0.10.0", "0.47.0")).toBeLessThan(0);
  expect(verCmp("0.47.0", "0.47.0")).toBe(0);
  expect(verCmp("1.0.0", "0.47.0")).toBeGreaterThan(0);
});

import * as C from "../src/config";
import { statEntries, statRows } from "../src/codexStats";

test("every unit, ability and support kind has a stat entry", () => {
  const ids = new Set(allEntries().map(e => e.id));
  for (const k of Object.keys(C.UNITS)) expect(ids.has("unit-" + k)).toBe(true);
  for (const k of Object.keys(C.ABILITIES)) expect(ids.has("ability-" + k)).toBe(true);
  for (const k of C.SUPPORT_KINDS) expect(ids.has("support-" + k)).toBe(true);
  for (const s of statEntries()) { expect(s.stats).toBeTruthy(); expect(["units", "strikes", "support"]).toContain(s.section); }
});

test("stat rows follow config", () => {
  const rows = statRows("unit-sniper");
  expect(rows).toContainEqual(["Range", `${22 * C.CELL_M} m (+${2.5 * C.CELL_M} m per floor)`]);
  expect(rows).toContainEqual(["Cost", "$800,000"]);
  const old = C.UNITS.sniper.cost;
  try { C.UNITS.sniper.cost = 1; expect(statRows("unit-sniper")).toContainEqual(["Cost", "$1"]); } finally { C.UNITS.sniper.cost = old; }
  expect(statRows("ability-moab")).toContainEqual(["Per battle", "1"]);
  expect(statRows("support-radio")).toContainEqual(["Radius", `${65 * C.CELL_M} m`]);
  expect(statRows("nope")).toEqual([]);
});

import { filterEntries, badgeFor, type CodexEntry } from "../src/codex";
import { renderEntry, sectionCounts } from "../src/codexui";
import { clean, defaults } from "../src/save";

const opts = (media: Record<string, string> = {}) => ({ media, diagrams: {}, onOpenChange() {}, log() {} });

test("search is literal and never throws", () => {
  expect(filterEntries("(*")).toEqual([]);
  expect(filterEntries("attack-move").map(e => e.id)).toContain("mobile-orders");
  expect(filterEntries("  ").length).toBe(allEntries().length);
  expect(filterEntries("SNIPER").map(e => e.id)).toContain("unit-sniper");
});

test("badges compare against the last version the player opened the Codex in", () => {
  const x = (since: string, updated: string) => ({ since, updated } as CodexEntry);
  expect(badgeFor(x("0.47.0", "0.47.0"), "0.46.1")).toBe("new");
  expect(badgeFor(x("0.43.0", "0.47.0"), "0.46.1")).toBe("updated");
  expect(badgeFor(x("0.43.0", "0.43.0"), "0.46.1")).toBe(null);
  expect(badgeFor(x("0.47.0", "0.47.0"), undefined)).toBe(null);
  expect(sectionCounts(allEntries(), "0.46.1").units).toBeGreaterThan(0);
  expect(sectionCounts(allEntries(), undefined).units ?? 0).toBe(0);
});

test("an entry whose media file is missing shows its alt text, never a broken picture", () => {
  const en = { id: "z", section: "start", title: "T", summary: "S", body: "B", since: "0.47.0", updated: "0.47.0",
    media: { kind: "shot", id: "nope", alt: "A zone being drawn" } } as CodexEntry;
  const h = renderEntry(en, opts());
  expect(h).toContain("A zone being drawn");
  expect(h).not.toContain("<img");
  const h2 = renderEntry(en, opts({ nope: "data:image/png;base64,AA" }));
  expect(h2).toContain('data-media="nope"');
});

test("stats tables and keys render; text is escaped", () => {
  const h = renderEntry(allEntries().find(e => e.id === "unit-sniper")!, opts());
  expect(h).toContain("<table"); expect(h).toContain("$800,000");
  const h2 = renderEntry(allEntries().find(e => e.id === "speed")!, opts());
  expect(h2).toContain("<kbd>Space</kbd>");
});

test("save keeps a valid codexSeen and codexOpen, drops junk", () => {
  const ok = clean({ ...defaults(), settings: { ...defaults().settings, codexSeen: "0.46.1", codexOpen: ["start", "bogus", 3] as any } });
  expect(ok.settings.codexSeen).toBe("0.46.1");
  expect(ok.settings.codexOpen).toEqual(["start"]);
  const bad = clean({ ...defaults(), settings: { ...defaults().settings, codexSeen: "x" as any } });
  expect(bad.settings.codexSeen).toBeUndefined();
});

import { seenFor } from "../src/codex";
test("a save from before the Codex badges against the version that last wrote it; a new save badges nothing", () => {
  expect(seenFor(undefined, "0.46.1")).toBe("0.46.1");
  expect(seenFor(undefined, undefined)).toBe(undefined);
  expect(seenFor("0.47.0", "0.46.1")).toBe("0.47.0");
});

import { DIAGRAMS } from "../src/codexDiagrams";
import { padCost } from "../src/scoring";
const balanced = (s: string) => s.startsWith("<svg") && s.trim().endsWith("</svg>") && (s.match(/<svg/g) ?? []).length === 1;

test("every diagram an entry uses exists, and each is one well-formed svg", () => {
  for (const e of allEntries()) if (e.media?.kind === "diagram") expect(DIAGRAMS[e.media.id as keyof typeof DIAGRAMS]).toBeDefined();
  for (const [id, f] of Object.entries(DIAGRAMS)) { const s = f(); expect(balanced(s)).toBe(true); expect(s).not.toContain("—"); expect(id.length).toBeGreaterThan(0); }
  expect(allEntries().filter(e => e.media?.kind === "diagram").length).toBeGreaterThanOrEqual(5);
});

test("diagrams are drawn from config, not hard-coded", () => {
  const med = DIAGRAMS.medals();
  for (const [name, min] of C.MEDALS) { expect(med).toContain(name); expect(med).toContain(`>${min}<`); }
  const evac = DIAGRAMS["evac-cost"]();
  for (const n of [0, 1, 2]) expect(evac).toContain("$" + padCost(C.SUPPORTS.evac.cost, n) / 1e6 + "M");
  const nf = DIAGRAMS["no-fire"]();
  expect(nf).toContain(`${C.NOFIRE_M} m`); expect(nf).toContain(`${C.NOFIRE_BIG_M} m`);
  expect(DIAGRAMS.timeline()).toContain(`${C.WARNING_S} s`);
  const old = C.SUPPORTS.evac.cost;
  try { C.SUPPORTS.evac.cost = 5_000_000; expect(DIAGRAMS["evac-cost"]()).toContain("$5M"); } finally { C.SUPPORTS.evac.cost = old; }
});

test("ability summaries say what it does, not where to click", () => {
  for (const e of statEntries().filter(x => x.section === "strikes")) expect(e.summary).not.toMatch(/^Click/);
});
test("summaries don't split numbers like 3.5 s", () => {
  expect(statEntries().find(e => e.id === "ability-supply_drop")!.summary).toMatch(/^A C-130J drops 4 GPS-guided supply crates 3\.5 s later/);
});

// ---------- 0.47: the honesty rules (media must exist, match its recipe and be at least as new as its entry) ----------
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { RECIPES } from "../tools/shots/recipes";
import { staleReport, mediaFile } from "../tools/shots/stale";
const ROOT = new URL("..", import.meta.url).pathname;
const MDIR = ROOT + "assets/codex/";
const manifest = existsSync(MDIR + "manifest.json") ? JSON.parse(readFileSync(MDIR + "manifest.json", "utf8")) : {};

test("Codex pictures and clips are present and up to date (run bun tools/shots/run.ts --list)", () => {
  const rep = staleReport(RECIPES, manifest, allEntries(), f => existsSync(ROOT + f));
  expect(rep).toEqual([]);
  expect(allEntries().some(e => e.media && e.media.kind !== "diagram")).toBe(true);
});

test("no stray files in assets/codex", () => {
  const want = new Set(["manifest.json", ...RECIPES.map(r => mediaFile(r).replace("assets/codex/", ""))]);
  for (const f of existsSync(MDIR) ? readdirSync(MDIR) : []) expect(want.has(f) ? f : `stray: ${f}`).toBe(f);
});

test("callouts sit on the picture and every picture has alt text", () => {
  for (const e of allEntries()) {
    if (!e.media) continue;
    expect(e.media.alt.trim().length).toBeGreaterThan(5);
    for (const c of e.media.callouts ?? []) {
      expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(1);
      expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(1);
      expect(c.text.length).toBeGreaterThan(2); expect(c.text).not.toContain("—");
    }
  }
});

test("media stays inside the size budget (7 MB total, clips under 400 KB)", () => {
  let total = 0;
  for (const f of existsSync(MDIR) ? readdirSync(MDIR) : []) {
    const b = statSync(MDIR + f).size; total += b;
    if (f.endsWith(".webm")) expect(b).toBeLessThan(400 * 1024);
  }
  expect(total).toBeLessThanOrEqual(7 * 1024 * 1024);
});

test("build.ts embeds the Codex media", () => {
  expect(readFileSync(ROOT + "build.ts", "utf8")).toContain("HORDE_CODEX");
});

import { STAT_MEDIA } from "../src/codex";
test("stat pages can carry a picture, clip or diagram", () => {
  for (const [id, m] of Object.entries(STAT_MEDIA)) {
    const e = allEntries().find(x => x.id === id);
    expect(e ? e.id : `no stat entry ${id}`).toBe(id);
    expect(e!.media).toEqual(m);
  }
  expect(Object.keys(STAT_MEDIA).length).toBeGreaterThan(0);
});

import { stripCodexLinks } from "../src/codexui";
test("final review #2: entry HTML names the media instead of carrying its data URL", () => {
  const en = { id: "z", section: "start", title: "T", summary: "S", body: "B", since: "0.47.0", updated: "0.47.0",
    media: { kind: "clip", id: "clipx", alt: "A clip" } } as CodexEntry;
  const h = renderEntry(en, opts({ clipx: "data:video/webm;base64,AAAA" }));
  expect(h).toContain('data-media="clipx"'); expect(h).not.toContain("base64");
});
test("final review #5: the toolbar hover panel gets no Codex link (it can't be clicked)", () => {
  expect(stripCodexLinks('<span class="ip-title">Sniper<a class="cx-link" data-cx="unit-sniper" title="Open in the Codex">?</a></span>')).toBe('<span class="ip-title">Sniper</span>');
});
