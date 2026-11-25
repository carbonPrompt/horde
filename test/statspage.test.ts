import { expect, test } from "bun:test";
import { aggregate, filterBattles, cityOptions, statsTabHtml, statsTabsHtml, STATS_TABS, type StatsFilter } from "../src/statspage";
import { makeRecord, trim, type BattleRecord, type History } from "../src/battlerecord";
import { newRecorder, sample, COLS, unitIndex, killBy, strike } from "../src/stats";
import { TABS, tabHtml } from "../src/endreport";
import * as C from "../src/config";
import * as P from "../src/progress";
import * as A from "../src/achievements";

interface R { id?: string; saved?: number; kills?: number; dev?: boolean; modded?: boolean; city?: string; cityName?: string; diff?: string; medal?: string | null; score?: number; tanks?: number; airstrikes?: number; abandoned?: boolean; date?: string }
let n = 0;
function rec(p: R = {}): BattleRecord {
  const r = newRecorder(p.id ?? "b" + n++);
  for (let i = 0; i < 4; i++) sample(r, Object.fromEntries(COLS.map(c => [c, c === "t" ? i * 10 : i])) as any);
  const tanks = p.tanks ?? 1, kills = p.kills ?? 10;
  for (let t = 0; t < tanks; t++) { const ui = unitIndex(r, { kind: "tank" } as any, 0); for (let i = 0; i < Math.floor(kills / tanks); i++) killBy(r, 5, { unit: ui }); }
  for (let s = 0; s < (p.airstrikes ?? 0); s++) { const si = strike(r, "airstrike", 9, 1, 1); killBy(r, 10, { strike: si }); }
  const medal = p.medal === undefined ? null : p.medal;
  const score = { saved: p.saved ?? 0, pct: 50, medal, reason: "", intact: 90, bonus: null, xp: 10, waves: 3, round: true, damage: 1e6, spent: 2e7, score: p.score ?? 40,
    parts: { saved: 30, speed: 5, city: 3, kills: 2 }, kills, perM: 5 } as any;
  return makeRecord({ id: r.battleId, date: p.date ?? "2026-11-24", version: "0.58.0", cityId: p.city ?? "fairhaven", cityName: p.cityName ?? "Fairhaven", kind: "campaign", difficulty: p.diff ?? "medium", sirenMin: 600, flags: { dev: !!p.dev, modded: !!p.modded } },
    { medal, score: p.score ?? 40, parts: { saved: 30, speed: 5, city: 3, kills: 2 }, roundComplete: !p.abandoned, abandoned: !!p.abandoned, keepFighting: false }, score, r,
    { roundAt: null, nukes: 0, bridges: 0, crushed: 0, budget: 5e7, held: 300, people: 1000 });
}
const H = (...b: BattleRecord[]): History => ({ v: 1, battles: b });
const ALL: StatsFilter = { diff: "all", city: "all" };
const ctx = (h: History, extra: object = {}) => ({ history: filterBattles(h, ALL), sort: "date" as const, xp: 2500, achievements: {}, toolName: (k: string) => k, ...extra });
const allTabs = (h: History, f = ALL) => STATS_TABS.map(t => statsTabHtml(t, aggregate(h, f), { ...ctx(h), history: filterBattles(h, f) })).join("\n");

test("aggregate sums counting battles only", () => {
  const a = aggregate(H(rec({ saved: 100 }), rec({ saved: 50 }), rec({ saved: 999, dev: true })), ALL);
  expect(a.saved).toBe(150); expect(a.battles).toBe(2);
});

test("flagged battles listed but not counted", () => {
  const d = rec({ dev: true }), m = rec({ modded: true }), h = H(d, m);
  expect(aggregate(h, ALL).battles).toBe(0);
  const html = statsTabHtml("history", aggregate(h, ALL), ctx(h));
  expect(html).toContain("Dev"); expect(html).toContain("Modded");
  expect(html).toContain(`data-open="${d.meta.id}"`); expect(html).toContain(`data-open="${m.meta.id}"`);
});

test("filters by difficulty and city", () => {
  const h = H(rec({ diff: "hard" }), rec({ diff: "medium" }), rec({ diff: "hard", city: "lakemont", cityName: "Lakemont" }));
  expect(aggregate(h, { diff: "hard", city: "all" }).battles).toBe(2);
  expect(aggregate(h, { diff: "all", city: "lakemont" }).battles).toBe(1);
  expect(cityOptions(h).map(c => c.name)).toEqual(["Fairhaven", "Lakemont"]);
});

test("filter with no match", () => {
  const h = H(rec({ diff: "easy" })), f: StatsFilter = { diff: "insane", city: "all" };
  for (const t of STATS_TABS.filter(t => t !== "achievements")) expect(statsTabHtml(t, aggregate(h, f), { ...ctx(h), history: filterBattles(h, f), filtered: true }), t).toContain("No battles match these filters.");
});

test("empty history renders every tab", () => {
  const html = allTabs(H());
  expect(html).not.toMatch(/NaN|undefined|Infinity/);
  const career = statsTabHtml("career", aggregate(H(), ALL), ctx(H()));
  expect(career).toContain(P.rankFor(2500).name);
  expect(career).toContain(Object.keys(P.UNLOCK_XP)[0]);
  expect(career).toContain("No battles yet. Finish a battle and it shows up here.");
});

test("units cost and kills per $1M", () => {
  const a = aggregate(H(rec({ tanks: 2, kills: 100 })), ALL), u = a.units.find(x => x.kind === "tank")!;
  expect(u.uses).toBe(2); expect(u.kills).toBe(100); expect(u.cost).toBe(2 * C.UNITS.tank.cost);
  expect(u.perM).toBeCloseTo(100 / (u.cost / 1e6), 6);
  const s = aggregate(H(rec({ airstrikes: 3 })), ALL).strikesBy.find(x => x.kind === "airstrike")!;
  expect(s.uses).toBe(3); expect(s.kills).toBe(3); expect(s.cost).toBe(3 * C.ABILITIES.airstrike.cost);
});

test("cities best medal per difficulty", () => {
  const a = aggregate(H(rec({ diff: "hard", medal: "Gold" }), rec({ diff: "medium", medal: "Silver" }), rec({ diff: "medium", medal: "Platinum" })), ALL);
  const c = a.cities.find(x => x.cityId === "fairhaven")!;
  expect(c.best.hard).toBe("Gold"); expect(c.best.medium).toBe("Platinum"); expect(c.battles).toBe(3);
});

test("history sort", () => {
  const a = rec({ saved: 10, date: "2026-11-01" }), b = rec({ saved: 900, date: "2026-11-02" }), c = rec({ saved: 50, date: "2026-11-03" }), h = H(a, b, c);
  const bySaved = statsTabHtml("history", aggregate(h, ALL), ctx(h, { sort: "saved" }));
  expect(bySaved.indexOf(b.meta.id)).toBeLessThan(bySaved.indexOf(c.meta.id));
  const byDate = statsTabHtml("history", aggregate(h, ALL), ctx(h));
  expect(byDate.indexOf(c.meta.id)).toBeLessThan(byDate.indexOf(a.meta.id));
});

test("records link to their battle", () => {
  const best = rec({ saved: 5000 }), h = H(rec({ saved: 10 }), best);
  expect(statsTabHtml("records", aggregate(h, ALL), ctx(h))).toContain(`data-open="${best.meta.id}"`);
});

test("trimmed record renders in the viewer", () => {
  const h = H(rec({ saved: 10 })); for (let i = 0; i < 205; i++) h.battles.push(rec({}));
  trim(h); const old = h.battles[0];
  expect(old.samples).toBeUndefined();
  const html = TABS.map(t => tabHtml(t, old, { broken: [], live: false })).join("");
  expect(html).not.toMatch(/NaN|undefined|Infinity/); expect(html).toContain("Nothing to chart yet");
});

test("achievements tab shows earned dates and grays the rest", () => {
  const html = statsTabHtml("achievements", aggregate(H(), ALL), ctx(H(), { achievements: { gold: "2026-11-20" } }));
  expect(html).toContain("Earned 2026-11-20");
  expect(html).toContain(A.BY_ID.nuclear.how.split(".")[0]);
  expect(html).toContain(`1 of ${A.ACHIEVEMENTS.length} earned`);
  expect((html.match(/class="st-a off"/g) ?? []).length).toBe(A.ACHIEVEMENTS.length - 1);
  expect(html).not.toMatch(/NaN|undefined|Infinity/);
  expect(statsTabsHtml("career", 1)).toContain(`Achievements 1/${A.ACHIEVEMENTS.length}`);
});

test("achievements tab: groups, views and progress bars", () => {
  const prog = { evac_14k: [12418, 14000] as [number, number], lifts_200: [186, 200] as [number, number], career_kills_1m: [5000, 1e6] as [number, number] };
  const base = { achievements: { first_out: "2026-11-08" }, achProgress: prog };
  const g = statsTabHtml("achievements", aggregate(H(), ALL), ctx(H(), { ...base, achGroup: "Evacuation" }));
  expect((g.match(/class="st-a[" ]/g) ?? []).length).toBe(13);
  expect(g).toContain("12,418 of 14,000 (best battle)");
  expect(g).toContain("next up: Shuttle Run III (93% there)");
  const career = statsTabHtml("achievements", aggregate(H(), ALL), ctx(H(), { ...base, achGroup: "Career" }));
  expect(career).toContain("5,000 of 1,000,000<"); // career totals: no "best battle"
  const closest = statsTabHtml("achievements", aggregate(H(), ALL), ctx(H(), { ...base, achView: "closest" }));
  expect(closest.indexOf("Shuttle Run III")).toBeLessThan(closest.indexOf("Airlift III"));
  expect(closest).not.toContain("First Lift<");
  const earned = statsTabHtml("achievements", aggregate(H(), ALL), ctx(H(), { ...base, achView: "earned", achGroup: "Combat" }));
  expect(earned).toContain("None earned here yet.");
});

test("escapes city names", () => {
  const h = H(rec({ cityName: "<b>x</b>", city: "evil" }));
  for (const t of ["history", "cities"] as const) expect(statsTabHtml(t, aggregate(h, ALL), ctx(h))).not.toContain("<b>x</b>");
});

test("1000 battles aggregate fast", () => {
  const h = H(); for (let i = 0; i < 1000; i++) h.battles.push(rec({ saved: i }));
  for (const b of h.battles) { delete b.samples; delete b.events; }
  const t0 = performance.now(); aggregate(h, ALL); expect(performance.now() - t0).toBeLessThan(50);
});

test("no em-dash", () => { expect(allTabs(H(rec({ saved: 3, medal: "Gold" })))).not.toContain("—"); });
