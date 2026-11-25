import { expect, test } from "bun:test";
import { TABS, headerHtml, tabHtml, timelineSvg, sampleAt } from "../src/endreport";
import { makeRecord, type BattleRecord } from "../src/battlerecord";
import { newRecorder, sample, COLS, event, SE_HORDE, SE_ROUND, SE_KEEP_FIGHTING, SE_LIFT, unitIndex, killBy, strike } from "../src/stats";

function rec(o: { samples?: number; cityName?: string; keepFighting?: boolean; town?: boolean; empty?: boolean } = {}): BattleRecord {
  const r = newRecorder("x");
  const ns = o.samples ?? 60;
  for (let i = 0; i < ns; i++) sample(r, Object.fromEntries(COLS.map(c => [c, c === "t" ? i * 10 : o.empty ? 0 : i * 37])) as any);
  if (!o.empty) {
    event(r, SE_HORDE, 200, 10, 20, 340, 0); event(r, SE_LIFT, 260, 5, 5, 24, 0);
    const u = { kind: "tank", x: 3, y: 4 } as any, ui = unitIndex(r, u, 0); for (let i = 0; i < 40; i++) killBy(r, 300, { unit: ui });
    const si = strike(r, "airstrike", 310, 50, 60); for (let i = 0; i < 12; i++) killBy(r, 312, { strike: si });
  }
  if (o.keepFighting) { event(r, SE_ROUND, 400, 0, 0); event(r, SE_KEEP_FIGHTING, 401, 0, 0); }
  const score = { saved: o.empty ? 0 : 1234, pct: 50, medal: o.empty ? null : "Gold", reason: "", intact: 90, bonus: null, xp: 10, waves: 3, round: true, damage: 5e6, spent: 3e7,
    score: o.empty ? 0 : 61, parts: { saved: 30, speed: 10, city: 10, kills: 5 }, kills: 52, perM: o.empty ? undefined : 41 } as any;
  const town = o.town === false ? undefined : { paragraph: "Fairhaven, 10:00 AM. 3 households.", refusers: [{ name: "Simmons", size: 1, what: "talked out at 10:37 AM", good: true }],
    stories: [{ title: "The Alvarez family (4)", tag: "all out" as const, text: "Rosa left work at 10:02 AM.", members: [1, 2] }],
    summary: { households: 3, allOut: 1, lostSome: 1, lostAll: 1, refusedHouseholds: 1, talkedOut: 1, ran: 0, lostAtHome: 0, stillHome: 0,
      byPlace: [{ place: "Together at home", households: 2, allOut: 1 }], fetched: 1, classKids: 0, teensAlone: 0, teensMadeIt: 0, wentBack: 0, wentBackMadeIt: 0, killedByUs: 0 } };
  return makeRecord({ id: "x", date: "2026-11-24", version: "0.57.0", cityId: "fairhaven", cityName: o.cityName ?? "Fairhaven", kind: "campaign", difficulty: "hard", sirenMin: 600, flags: { dev: false, modded: false } },
    { medal: score.medal, score: score.score, parts: { saved: 30, speed: 10, city: 10, kills: 5 }, roundComplete: !o.empty, abandoned: !!o.empty, keepFighting: !!o.keepFighting },
    score, r, { roundAt: o.keepFighting ? 400 : null, nukes: 0, bridges: 0, crushed: 0, budget: 5e7, held: 300, people: 1500, town });
}
const all = (r: BattleRecord, live = false) => TABS.map(t => tabHtml(t, r, { broken: [], live })).join("\n") + headerHtml(r, { xpLine: "", news: "" });

test("renders a near-empty record", () => {
  const r = rec({ samples: 1, empty: true, town: false });
  for (const t of TABS) {
    const h = tabHtml(t, r, { broken: [], live: false });
    expect(h, t).not.toContain("NaN"); expect(h, t).not.toContain("undefined"); expect(h, t).not.toContain("Infinity");
  }
});

test("renders a record with no samples at all", () => {
  const r = rec({ samples: 0, empty: true, town: false });
  expect(all(r)).not.toMatch(/NaN|undefined|Infinity/);
});

test("escapes names", () => {
  const r = rec({ cityName: "<b>x</b>" });
  expect(headerHtml(r, { xpLine: "", news: "" })).not.toContain("<b>x</b>");
  r.town!.stories[0].title = "<script>alert(1)</script>";
  expect(tabHtml("town", r, { broken: [], live: false })).not.toContain("<script>");
});

test("timeline marks round end when keep fighting", () => {
  expect(timelineSvg(rec({ keepFighting: true }), ["saved"], 800, 400)).toContain('data-mark="round"');
  expect(timelineSvg(rec({}), ["saved"], 800, 400)).not.toContain('data-mark="round"');
});

test("sampleAt maps pixels to the nearest sample", () => {
  const r = rec({ samples: 11 });
  expect(sampleAt(r, 0, 800)!.t).toBe(0);
  expect(sampleAt(r, 800, 800)!.t).toBe(100);
  expect(sampleAt(rec({ samples: 0, empty: true }), 10, 800)).toBeNull();
});

test("town tab shows stories, refusers and the paragraph", () => {
  const h = tabHtml("town", rec({}), { broken: [], live: false });
  expect(h).toContain("Fairhaven, 10:00 AM. 3 households."); expect(h).toContain("The Alvarez family (4)"); expect(h).toContain("Simmons");
});

test("records broken show on the overview", () => {
  const h = tabHtml("overview", rec({}), { broken: [{ key: "mostSaved", was: 900, now: 1234 }], live: false });
  expect(h).toContain("1,234"); expect(h).toContain("900");
});

test("heatmap tab only when live", () => {
  expect(tabHtml("heatmap", rec({}), { broken: [], live: false })).not.toContain("data-act=\"heatmap\"");
  expect(tabHtml("heatmap", rec({}), { broken: [], live: true })).toContain("data-act=\"heatmap\"");
});

test("units and strikes tables list each entry", () => {
  expect(tabHtml("units", rec({}), { broken: [], live: false })).toContain("M1 Abrams 1");
  expect(tabHtml("strikes", rec({}), { broken: [], live: false })).toContain("Airstrike");
});

test("no em-dash in rendered output", () => {
  expect(all(rec({ keepFighting: true }), true)).not.toContain("—");
});
