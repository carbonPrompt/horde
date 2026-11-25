import { expect, test } from "bun:test";
import { upsert, emptyCareer, makeRecord, trim, cleanHistory, cleanCareer, outcomeFor, countsInCareer, TIMELINES_KEPT,
  type BattleRecord, type History } from "../src/battlerecord";
import { newRecorder, sample, COLS, event, SE_HORDE, unitIndex, killBy } from "../src/stats";

const emptyH = (): History => ({ v: 1, battles: [] });
interface R { id?: string; saved?: number; kills?: number; abandoned?: boolean; roundComplete?: boolean; dev?: boolean; modded?: boolean; city?: string; cityName?: string; medal?: string | null; samples?: number; whole?: number }
let n = 0;
function rec(p: R = {}): BattleRecord {
  const r = newRecorder(p.id ?? "id" + n++);
  for (let i = 0; i < (p.samples ?? 3); i++) sample(r, Object.fromEntries(COLS.map(c => [c, c === "t" ? i * 10 : i])) as any);
  event(r, SE_HORDE, 5, 1, 2, 100, 0);
  const u = { kind: "tank" } as any; const ui = unitIndex(r, u, 0); for (let i = 0; i < (p.kills ?? 10); i++) killBy(r, 6, { unit: ui });
  const score = { saved: p.saved ?? 0, pct: 50, medal: p.medal ?? null, reason: "", intact: 90, bonus: null, xp: 100, waves: 2, round: true, damage: 1e6, spent: 2e6,
    score: 40, parts: { saved: 30, speed: 5, city: 3, kills: 2 }, kills: p.kills ?? 10, perM: 5 } as any;
  return makeRecord(
    { id: r.battleId, date: "2026-11-24", version: "0.57.0", cityId: p.city ?? "fairhaven", cityName: p.cityName ?? "Fairhaven", kind: "campaign", difficulty: "medium", sirenMin: 600, flags: { dev: !!p.dev, modded: !!p.modded } },
    { medal: p.medal ?? null, score: 40, parts: { saved: 30, speed: 5, city: 3, kills: 2 }, roundComplete: p.roundComplete ?? !p.abandoned, abandoned: !!p.abandoned, keepFighting: false },
    score, r, { roundAt: 100, nukes: 0, bridges: 0, crushed: 0, budget: 5e7,
      town: { paragraph: "P.", stories: [{ title: "T", tag: "all out", text: "x", members: [0] }], refusers: [],
        summary: { households: 10, allOut: p.whole ?? 7, lostSome: 2, lostAll: 1, refusedHouseholds: 0, talkedOut: 0, ran: 0, lostAtHome: 0, stillHome: 0, byPlace: [], fetched: 3, classKids: 0, teensAlone: 0, teensMadeIt: 0, wentBack: 1, wentBackMadeIt: 0, killedByUs: 0 } } });
}
const goodRec = () => rec({});

test("makeRecord copies totals from the score and recorder", () => {
  const r = rec({ saved: 123, kills: 7 });
  expect(r.totals.saved).toBe(123); expect(r.totals.kills).toBe(7); expect(r.units[0].kills).toBe(7);
  expect(r.samples!.t.length).toBe(3); expect(r.events!.k).toContain(SE_HORDE);
});

test("first record adds to career", () => {
  const { career } = upsert(emptyH(), emptyCareer(), rec({ saved: 100 }));
  expect(career.saved).toBe(100); expect(career.battles).toBe(1); expect(career.completed).toBe(1);
  expect(career.killsByKind.tank).toBe(10); expect(career.householdsWhole).toBe(7); expect(career.fetched).toBe(3);
});

test("replaces abandoned record on resume", () => {
  let s = upsert(emptyH(), emptyCareer(), rec({ id: "x", saved: 40, abandoned: true }));
  s = upsert(s.history, s.career, rec({ id: "x", saved: 90, roundComplete: true }));
  expect(s.history.battles.length).toBe(1);
  expect(s.career.saved).toBe(90); expect(s.career.completed).toBe(1); expect(s.career.abandoned).toBe(0); expect(s.career.battles).toBe(1);
  expect(s.career.killsByKind.tank).toBe(10);
});

test("dev and modded battles are kept but stay out of career and records", () => {
  let s = upsert(emptyH(), emptyCareer(), rec({ saved: 999, dev: true }));
  s = upsert(s.history, s.career, rec({ saved: 5, modded: true }));
  expect(s.history.battles.length).toBe(2);
  expect(s.career.saved).toBe(0); expect(s.career.battles).toBe(0); expect(s.career.records.mostSaved).toBeUndefined();
  expect(countsInCareer(s.history.battles[0])).toBe(false);
});

test("abandoned counts in career but not completed", () => {
  const s = upsert(emptyH(), emptyCareer(), rec({ saved: 40, abandoned: true }));
  expect(s.career.completed).toBe(0); expect(s.career.abandoned).toBe(1); expect(s.career.saved).toBe(40);
});

test("trim keeps timelines for the newest 200 only", () => {
  const h = emptyH(); for (let i = 0; i < TIMELINES_KEPT + 5; i++) h.battles.push(rec({}));
  trim(h);
  expect(h.battles.slice(0, 5).every(b => !b.samples && !b.events && !b.town?.stories.length)).toBe(true);
  expect(h.battles.slice(5).every(b => !!b.samples && !!b.events)).toBe(true);
  expect(h.battles.every(b => b.totals.kills === 10 && b.town?.summary.households === 10 && b.town.paragraph === "P.")).toBe(true);
});

test("records broken reported", () => {
  let s = upsert(emptyH(), emptyCareer(), rec({ saved: 100 }));
  expect(s.career.records.mostSaved!.v).toBe(100);
  s = upsert(s.history, s.career, rec({ saved: 250 }));
  const b = s.broken.find(x => x.key === "mostSaved")!;
  expect(b.was).toBe(100); expect(b.now).toBe(250);
  expect(s.career.records.city["fairhaven@medium"].saved.v).toBe(250);
  const s2 = upsert(s.history, s.career, rec({ saved: 10 }));
  expect(s2.broken.find(x => x.key === "mostSaved")).toBeUndefined();
});

test("records are recomputed after a replacement lowers a value", () => {
  let s = upsert(emptyH(), emptyCareer(), rec({ id: "a", saved: 500, abandoned: true }));
  s = upsert(s.history, s.career, rec({ id: "a", saved: 50 }));
  expect(s.career.records.mostSaved!.v).toBe(50);
});

test("cleanHistory drops junk and caps strings", () => {
  const evil = goodRec(); evil.meta.cityName = "<img src=x onerror=1>".repeat(50);
  const h = cleanHistory(JSON.parse(JSON.stringify({ v: 1, battles: [{ junk: 1 }, goodRec(), evil, null, 7] })));
  expect(h.battles.length).toBe(2);
  expect(h.battles[1].meta.cityName.length).toBeLessThanOrEqual(120);
});

test("cleanHistory keeps a good record intact", () => {
  const g = goodRec();
  expect(cleanHistory(JSON.parse(JSON.stringify({ v: 1, battles: [g] }))).battles[0]).toEqual(JSON.parse(JSON.stringify(g)));
});

test("history clean on empty and junk", () => {
  expect(cleanHistory(null)).toEqual({ v: 1, battles: [] });
  expect(cleanHistory("[]")).toEqual({ v: 1, battles: [] });
  expect(cleanHistory({ v: 1, battles: "x" })).toEqual({ v: 1, battles: [] });
});

test("cleanCareer keeps a good career and repairs junk", () => {
  const c = upsert(emptyH(), emptyCareer(), rec({ saved: 3 })).career;
  expect(cleanCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
  expect(cleanCareer("x")).toEqual(emptyCareer());
  expect(cleanCareer({ saved: -5, kills: "a" }).saved).toBe(0);
});

test("200-battle history stays under 6 MB", () => {
  // a heavy 17-minute battle: 102 samples with big money values, 600 events (300 lifts, 60 hordes, units, strikes, breaches)
  const h = emptyH();
  for (let i = 0; i < 200; i++) {
    const r = rec({ samples: 102 });
    for (const c of ["money", "spent", "damage"] as const) r.samples![c] = r.samples![c].map((_, j) => 123_456_789 + j);
    for (let e = 0; e < 600; e++) { r.events!.t.push(e * 1.7); r.events!.k.push(11); r.events!.x.push(312); r.events!.y.push(207); r.events!.a.push(36); r.events!.b.push(0); }
    h.battles.push(r);
  }
  expect(JSON.stringify(h).length).toBeLessThan(6e6);
});

test("outcomeFor", () => {
  const o = (phase: string, roundDone: boolean, endNow: boolean, leaving: boolean) => outcomeFor({ phase, roundDone, endNow, leaving, keepFighting: false });
  expect(o("plan", false, false, true)).toBe("none");
  expect(o("battle", false, false, true)).toBe("abandoned");
  expect(o("battle", true, false, true)).toBe("final");
  expect(o("over", true, true, false)).toBe("final");
  expect(o("battle", true, false, false)).toBe("round");
  expect(o("over", false, true, false)).toBe("final"); // pulled out before the round finished: scored by the game
});

// ---------- final review fixes ----------
import { parseHistoryText, persistRecord } from "../src/battlerecord";

test("parseHistoryText: missing is an empty ok history; empty or broken text is not ok", () => {
  expect(parseHistoryText(null)).toEqual({ ok: true, history: { v: 1, battles: [] } });
  expect(parseHistoryText("").ok).toBe(false);
  expect(parseHistoryText('{"v":1,"battles":[],}').ok).toBe(false); // a trailing comma from a hand edit
  const g = JSON.stringify({ v: 1, battles: [goodRec()] });
  const p = parseHistoryText(g); expect(p.ok).toBe(true); expect(p.history.battles.length).toBe(1);
});

test("persistRecord: an unreadable history is never overwritten and the career is untouched", async () => {
  let wrote = false; const c0 = emptyCareer();
  const res = await persistRecord(async () => ({ ok: false, history: { v: 1, battles: [] } }), async () => { wrote = true; return true; }, c0, rec({ saved: 50 }));
  expect(wrote).toBe(false); expect(res.career).toBeNull();
});

test("persistRecord: a failed write leaves the career as it was (no double count later)", async () => {
  const res = await persistRecord(async () => ({ ok: true, history: { v: 1, battles: [] } }), async () => false, emptyCareer(), rec({ saved: 50 }));
  expect(res.career).toBeNull();
});

test("persistRecord: a good write returns the new career and records broken", async () => {
  let stored: History | null = null;
  const res = await persistRecord(async () => ({ ok: true, history: { v: 1, battles: [] } }), async h => { stored = h; return true; }, emptyCareer(), rec({ saved: 50 }));
  expect(res.career!.saved).toBe(50); expect(stored!.battles.length).toBe(1); expect(res.broken.some(b => b.key === "mostSaved")).toBe(true);
});
