// 0.57: one record per battle, the slot's battle history and the career totals built from it. A battle has a
// stable id (carried by snapshots), so a later outcome for the same battle replaces the earlier record and the
// career takes the old numbers back out first: saving, quitting and resuming counts once. Battles played in Dev
// mode or with mods are kept in the history, marked, and stay out of the career and the records.
import * as C from "./config";
import type { Score } from "./sim";
import { COLS, OTHER_KILLS, REC_COUNTER_KEYS, recCounters, type Col, type OtherKill, type RecCounters, type Recorder, type StrikeRec, type UnitRec, type BevOutcome } from "./stats";
import type { TownReport, TownSummary, TownStory, TownRefuser, StoryTag } from "./townreport";

export type BattleKind = "campaign" | "real" | "quick" | "daily" | "osm";
const KINDS: BattleKind[] = ["campaign", "real", "quick", "daily", "osm"];
export interface BattleMeta { id: string; date: string; version: string; cityId: string; cityName: string; kind: BattleKind; difficulty: string; sirenMin: number; flags: { dev: boolean; modded: boolean } }
export interface BattleOutcome { medal: string | null; score: number; parts: { saved: number; speed: number; city: number; kills: number }; roundComplete: boolean; abandoned: boolean; keepFighting: boolean; mayhem?: number;
  underBudget?: boolean; bonus?: string | null; left?: number } // 0.59: for the achievements (left: people still outside the zone, not refusing)
export interface BattleTotals {
  saved: number; byTrain: number; people: number; kills: number; killsAfter: number; damage: number; spent: number; budget: number; perM: number | null;
  held: number; hordes: number; breaches: number; lifts: number; liftsAborted: number; unitsPlaced: number; unitsLost: number; strikes: number; nukes: number; bridges: number;
  civKilledByUs: number; crushed: number; refused: number; talkedOut: number; intact: number; maxZone: number; best60: number; longShot: number; xp: number;
  supplySpent: number; // 0.60
}
export interface BattleRecord {
  meta: BattleMeta; outcome: BattleOutcome; totals: BattleTotals; units: UnitRec[]; strikes: StrikeRec[]; other: Record<OtherKill, number>;
  roundAt: number | null; samples?: Record<Col, number[]>; events?: Recorder["ev"]; town?: TownReport;
  counters?: RecCounters; earned?: string[]; // 0.59: achievement inputs; ids earned in this battle
  bevents?: BevOutcome[]; // 0.62: Battle Events and how they ended
}
export interface RecRef { v: number; id: string; city: string; diff: string }
export interface Records { mostSaved?: RecRef; mostKills?: RecRef; unitKills?: RecRef & { label: string }; damage?: RecRef; held?: RecRef; perM?: RecRef; familiesWhole?: RecRef; city: Record<string, { saved: RecRef }> }
export interface Career {
  battles: number; completed: number; abandoned: number; saved: number; byTrain: number; kills: number; damage: number; spent: number; held: number; hordes: number; breaches: number;
  lifts: number; liftsAborted: number; unitsLost: number; strikes: number; nukes: number; bridges: number; civKilledByUs: number;
  killsByKind: Record<string, number>; strikesByKind: Record<string, number>; medals: Record<string, number>;
  householdsWhole: number; householdsLost: number; talkedOut: number; fetched: number; wentBack: number; records: Records;
  supplySpent: number; // 0.60
}
export interface History { v: 1; battles: BattleRecord[] } // newest last
export const TIMELINES_KEPT = 200;

export function makeRecord(meta: BattleMeta, outcome: BattleOutcome, score: Score, rec: Recorder,
  extras: { roundAt: number | null; nukes: number; bridges: number; crushed: number; budget: number; held?: number; people?: number; town?: TownReport; earned?: string[] }): BattleRecord {
  const last = (c: Col) => { const a = rec.cols[c]; return a.length ? a[a.length - 1] : 0; };
  const totals: BattleTotals = {
    saved: score.saved, byTrain: last("byTrain"), people: extras.people ?? 0, kills: score.kills + (score.killsAfter ?? 0), killsAfter: score.killsAfter ?? 0,
    damage: score.damage, spent: score.spent, budget: extras.budget, perM: score.perM ?? null,
    held: extras.held ?? Math.max(0, last("t") - C.WARNING_S), hordes: score.waves, breaches: last("breaches"), lifts: last("lifts"), liftsAborted: last("liftsAborted"),
    unitsPlaced: rec.units.length, unitsLost: rec.units.filter(u => u.lostT >= 0).length, strikes: rec.strikes.length, nukes: extras.nukes, bridges: extras.bridges,
    civKilledByUs: score.civKilledByUs ?? last("civKilledByUs"), crushed: extras.crushed, refused: score.refused ?? 0, talkedOut: score.talkedOut ?? rec.c.talkedOut,
    intact: score.intact, maxZone: rec.c.maxZone, best60: rec.c.best60, longShot: Math.round(rec.c.longShot), xp: score.xp, supplySpent: rec.c.supplySpent ?? 0,
  };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return { meta: copy(meta), outcome: copy(outcome), totals, units: copy(rec.units), strikes: copy(rec.strikes), other: copy(rec.other),
    roundAt: extras.roundAt, samples: compactSamples(rec.cols), events: compactEvents(rec.ev), ...(extras.town ? { town: copy(extras.town) } : {}),
    counters: recCounters(rec, extras.roundAt), ...(extras.earned ? { earned: [...extras.earned] } : {}), ...(rec.bevents?.length ? { bevents: copy(rec.bevents) } : {}) };
}

// stored compactly (history files hold 200 timelines): times to 0.1 s, places to whole cells, counts and money whole
const r1 = (v: number) => Math.round(v * 10) / 10;
function compactSamples(c: Record<Col, number[]>): Record<Col, number[]> {
  return Object.fromEntries(COLS.map(k => [k, c[k].map(v => (k === "t" || k === "intact" ? r1(v) : Math.round(v)))])) as Record<Col, number[]>;
}
function compactEvents(e: Recorder["ev"]): Recorder["ev"] {
  return { t: e.t.map(r1), k: [...e.k], x: e.x.map(Math.round), y: e.y.map(Math.round), a: e.a.map(Math.round), b: e.b.map(Math.round) };
}

export function emptyCareer(): Career {
  return { battles: 0, completed: 0, abandoned: 0, saved: 0, byTrain: 0, kills: 0, damage: 0, spent: 0, held: 0, hordes: 0, breaches: 0, lifts: 0, liftsAborted: 0,
    unitsLost: 0, strikes: 0, nukes: 0, bridges: 0, civKilledByUs: 0, killsByKind: {}, strikesByKind: {}, medals: {},
    householdsWhole: 0, householdsLost: 0, talkedOut: 0, fetched: 0, wentBack: 0, records: { city: {} }, supplySpent: 0 };
}

export function countsInCareer(r: BattleRecord): boolean { return !r.meta.flags.dev && !r.meta.flags.modded; }

const SUMS = ["saved", "byTrain", "kills", "damage", "spent", "held", "hordes", "breaches", "lifts", "liftsAborted", "unitsLost", "strikes", "nukes", "bridges", "civKilledByUs", "supplySpent"] as const;
/** Add (sign 1) or take back (sign -1) one battle's numbers. Records are not touched here (see recomputeRecords). */
export function addToCareer(c: Career, r: BattleRecord, sign: 1 | -1): void {
  const bump = (o: Record<string, number>, k: string, v: number) => { const x = (o[k] ?? 0) + sign * v; if (x) o[k] = x; else delete o[k]; };
  c.battles += sign;
  if (r.outcome.roundComplete) c.completed += sign;
  if (r.outcome.abandoned) c.abandoned += sign;
  for (const k of SUMS) c[k] += sign * r.totals[k];
  for (const u of r.units) bump(c.killsByKind, u.kind, u.kills);
  for (const s of r.strikes) bump(c.strikesByKind, s.kind, 1);
  if (r.outcome.medal) bump(c.medals, r.outcome.medal, 1);
  const t = r.town?.summary;
  if (t) { c.householdsWhole += sign * t.allOut; c.householdsLost += sign * (t.lostSome + t.lostAll); c.talkedOut += sign * t.talkedOut; c.fetched += sign * t.fetched; c.wentBack += sign * t.wentBack; }
}

export function recomputeRecords(h: History): Records {
  const out: Records = { city: {} };
  const ref = (r: BattleRecord, v: number): RecRef => ({ v, id: r.meta.id, city: r.meta.cityName, diff: r.meta.difficulty });
  const better = (cur: RecRef | undefined, v: number) => v > 0 && (!cur || v > cur.v);
  for (const r of h.battles) {
    if (!countsInCareer(r)) continue;
    const t = r.totals;
    if (better(out.mostSaved, t.saved)) out.mostSaved = ref(r, t.saved);
    if (better(out.mostKills, t.kills)) out.mostKills = ref(r, t.kills);
    if (better(out.damage, t.damage)) out.damage = ref(r, t.damage);
    if (better(out.held, t.held)) out.held = ref(r, t.held);
    if (t.perM !== null && better(out.perM, t.perM)) out.perM = ref(r, t.perM);
    const fw = r.town?.summary.allOut ?? 0; if (better(out.familiesWhole, fw)) out.familiesWhole = ref(r, fw);
    for (const u of r.units) if (better(out.unitKills, u.kills)) out.unitKills = { ...ref(r, u.kills), label: u.label };
    const ck = `${r.meta.cityId}@${r.meta.difficulty}`;
    if (better(out.city[ck]?.saved, t.saved)) out.city[ck] = { saved: ref(r, t.saved) };
  }
  return out;
}

/** Put r into the history (replacing the same battle id), fix the career, recompute records, trim old timelines. */
export function upsert(h: History, c: Career, r: BattleRecord): { history: History; career: Career; broken: { key: string; was: number | null; now: number }[] } {
  const history: History = { v: 1, battles: [...h.battles] }, career: Career = JSON.parse(JSON.stringify(c));
  const before = recomputeRecords({ v: 1, battles: h.battles.filter(b => b.meta.id !== r.meta.id) }); // 0.58: records as they stood without this battle (its round record must not hide what the final one broke)
  const i = history.battles.findIndex(b => b.meta.id === r.meta.id);
  if (i >= 0) { const old = history.battles[i]; if (countsInCareer(old)) addToCareer(career, old, -1); history.battles[i] = r; }
  else history.battles.push(r);
  if (countsInCareer(r)) addToCareer(career, r, 1);
  career.records = recomputeRecords(history);
  const broken: { key: string; was: number | null; now: number }[] = [];
  if (countsInCareer(r)) {
    for (const k of ["mostSaved", "mostKills", "unitKills", "damage", "held", "perM", "familiesWhole"] as const) {
      const a = career.records[k], b = before[k];
      if (a && a.id === r.meta.id && (!b || a.v > b.v)) broken.push({ key: k, was: b ? b.v : null, now: a.v });
    }
    const ck = `${r.meta.cityId}@${r.meta.difficulty}`, a = career.records.city[ck]?.saved, b = before.city[ck]?.saved;
    if (a && a.id === r.meta.id && (!b || a.v > b.v)) broken.push({ key: "city", was: b ? b.v : null, now: a.v });
  }
  trim(history);
  return { history, career, broken };
}

export function trim(h: History): void {
  const cut = h.battles.length - TIMELINES_KEPT;
  for (let i = 0; i < cut; i++) {
    const b = h.battles[i];
    delete b.samples; delete b.events;
    if (b.town) b.town = { ...b.town, stories: [], refusers: [] };
  }
}

/** Which record (if any) leaving or finishing now should write. */
export function outcomeFor(s: { phase: string; roundDone: boolean; endNow: boolean; leaving: boolean; keepFighting: boolean }): "none" | "round" | "final" | "abandoned" {
  if (s.phase === "plan") return "none";
  if (s.phase === "over") return "final";
  if (s.leaving) return s.roundDone ? "final" : "abandoned";
  return s.roundDone ? "round" : "none";
}

// ---------- cleaning (history files are hand-editable) ----------
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, max = 1e15) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-max, Math.min(max, v)) : 0);
const pos = (v: unknown, max = 1e15) => Math.max(0, num(v, max));
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");
const nums = (v: unknown, cap: number) => (Array.isArray(v) ? v.slice(0, cap).map(x => num(x)) : []);
const TAGS: StoryTag[] = ["all out", "lost one", "lost some", "none made it", "refused, talked out", "refused, ran", "refused, lost", "made it alone", "killed by our fire"];

function cleanTown(t: unknown): TownReport | undefined {
  if (!isObj(t) || !isObj(t.summary)) return undefined;
  const s = t.summary;
  const summary: TownSummary = { households: pos(s.households), allOut: pos(s.allOut), lostSome: pos(s.lostSome), lostAll: pos(s.lostAll), refusedHouseholds: pos(s.refusedHouseholds),
    talkedOut: pos(s.talkedOut), ran: pos(s.ran), lostAtHome: pos(s.lostAtHome), stillHome: pos(s.stillHome),
    byPlace: (Array.isArray(s.byPlace) ? s.byPlace : []).slice(0, 8).filter(isObj).map((p: any) => ({ place: str(p.place, 40), households: pos(p.households), allOut: pos(p.allOut) })),
    fetched: pos(s.fetched), classKids: pos(s.classKids), teensAlone: pos(s.teensAlone), teensMadeIt: pos(s.teensMadeIt), wentBack: pos(s.wentBack), wentBackMadeIt: pos(s.wentBackMadeIt), killedByUs: pos(s.killedByUs),
    ...(Number.isFinite(s.schoolKids) ? { schoolKids: pos(s.schoolKids), schoolKidsSafe: pos(s.schoolKidsSafe) } : {}) };
  const stories: TownStory[] = (Array.isArray(t.stories) ? t.stories : []).slice(0, 12).filter(isObj).filter((x: any) => TAGS.includes(x.tag))
    .map((x: any) => ({ title: str(x.title, 120), tag: x.tag, text: str(x.text, 800), members: nums(x.members, 16).map(m => Math.max(0, Math.floor(m))) }));
  const refusers: TownRefuser[] = (Array.isArray(t.refusers) ? t.refusers : []).slice(0, 2000).filter(isObj)
    .map((x: any) => ({ name: str(x.name, 60), size: pos(x.size, 99), what: str(x.what, 120), good: x.good === true ? true : x.good === false ? false : null }));
  return { paragraph: str(t.paragraph, 1200), summary, stories, refusers };
}

function cleanRecord(b: unknown): BattleRecord | null {
  if (!isObj(b) || !isObj(b.meta) || !isObj(b.outcome) || !isObj(b.totals) || typeof b.meta.id !== "string" || !b.meta.id) return null;
  const m = b.meta, o = b.outcome, t = b.totals;
  const meta: BattleMeta = { id: str(m.id, 64), date: str(m.date, 10), version: str(m.version, 16), cityId: str(m.cityId, 80), cityName: str(m.cityName, 120),
    kind: KINDS.includes(m.kind) ? m.kind : "quick", difficulty: str(m.difficulty, 12), sirenMin: Math.floor(pos(m.sirenMin, 1439)),
    flags: { dev: m.flags?.dev === true, modded: m.flags?.modded === true } };
  const parts = isObj(o.parts) ? o.parts : {};
  const outcome: BattleOutcome = { medal: C.MEDALS.some(x => x[0] === o.medal) ? o.medal : null, score: pos(o.score, 100),
    parts: { saved: pos(parts.saved, 100), speed: pos(parts.speed, 100), city: pos(parts.city, 100), kills: pos(parts.kills, 100) },
    roundComplete: o.roundComplete === true, abandoned: o.abandoned === true, keepFighting: o.keepFighting === true, ...(Number.isFinite(o.mayhem) ? { mayhem: pos(o.mayhem) } : {}),
    ...(typeof o.underBudget === "boolean" ? { underBudget: o.underBudget } : {}), ...(o.bonus === "Light Touch" || o.bonus === "Scorched Earth" || o.bonus === null ? { bonus: o.bonus } : {}),
    ...(Number.isFinite(o.left) ? { left: pos(o.left) } : {}) };
  const totals = {} as BattleTotals;
  for (const k of ["saved", "byTrain", "people", "kills", "killsAfter", "damage", "spent", "budget", "held", "hordes", "breaches", "lifts", "liftsAborted", "unitsPlaced", "unitsLost",
    "strikes", "nukes", "bridges", "civKilledByUs", "crushed", "refused", "talkedOut", "intact", "maxZone", "best60", "longShot", "xp", "supplySpent"] as const) totals[k] = pos(t[k]);
  totals.perM = typeof t.perM === "number" && Number.isFinite(t.perM) ? pos(t.perM) : null;
  const units: UnitRec[] = (Array.isArray(b.units) ? b.units : []).slice(0, 400).filter(isObj)
    .map((u: any) => ({ kind: str(u.kind, 24), label: str(u.label, 60), placedT: pos(u.placedT), kills: pos(u.kills), lostT: typeof u.lostT === "number" && u.lostT >= 0 ? u.lostT : -1, ...(Number.isFinite(u.dryS) && u.dryS > 0 ? { dryS: pos(u.dryS) } : {}) }));
  const strikes: StrikeRec[] = (Array.isArray(b.strikes) ? b.strikes : []).slice(0, 400).filter(isObj)
    .map((s: any) => ({ kind: str(s.kind, 24), t: pos(s.t), x: num(s.x, 1e5), y: num(s.y, 1e5), kills: pos(s.kills), civ: pos(s.civ), ...(Number.isFinite(s.dropKills) ? { dropKills: pos(s.dropKills) } : {}) }));
  const other = Object.fromEntries(OTHER_KILLS.map(k => [k, pos(isObj(b.other) ? b.other[k] : 0)])) as Record<OtherKill, number>;
  const out: BattleRecord = { meta, outcome, totals, units, strikes, other, roundAt: typeof b.roundAt === "number" && Number.isFinite(b.roundAt) ? b.roundAt : null };
  if (isObj(b.samples)) out.samples = Object.fromEntries(COLS.map(c => [c, nums(b.samples[c], 2000)])) as Record<Col, number[]>;
  if (isObj(b.events)) out.events = { t: nums(b.events.t, 20000), k: nums(b.events.k, 20000), x: nums(b.events.x, 20000), y: nums(b.events.y, 20000), a: nums(b.events.a, 20000), b: nums(b.events.b, 20000) };
  const town = cleanTown(b.town); if (town) out.town = town;
  if (isObj(b.counters)) out.counters = Object.fromEntries(REC_COUNTER_KEYS.map(k => [k, pos(b.counters[k])])) as unknown as RecCounters;
  if (Array.isArray(b.earned)) out.earned = b.earned.filter((x: unknown): x is string => typeof x === "string" && /^[a-z0-9_]{1,40}$/.test(x)).slice(0, 200);
  if (Array.isArray(b.bevents)) out.bevents = b.bevents.filter(isObj).slice(0, 10).map((e: any) => ({ kind: ["mayor", "class", "research", "power"].includes(e.kind) ? e.kind : "mayor", won: e.won === true, frac: Math.max(0, Math.min(1, Number(e.frac) || 0)),
    score: Math.max(-10, Math.min(10, Number(e.score) || 0)), cash: Math.max(0, Math.min(1e9, Number(e.cash) || 0)), xp: Math.max(0, Math.min(1e5, Number(e.xp) || 0)), title: typeof e.title === "string" ? e.title.replace(/[<>&"]/g, "").slice(0, 160) : "" })); // 0.62
  return out;
}

export function cleanHistory(x: unknown): History {
  if (!isObj(x) || !Array.isArray(x.battles)) return { v: 1, battles: [] };
  return { v: 1, battles: x.battles.slice(-5000).map(cleanRecord).filter((b): b is BattleRecord => !!b) };
}

export function cleanCareer(x: unknown): Career {
  const c = emptyCareer();
  if (!isObj(x)) return c;
  for (const k of ["battles", "completed", "abandoned", ...SUMS, "householdsWhole", "householdsLost", "talkedOut", "fetched", "wentBack"] as const) (c as any)[k] = pos(x[k]);
  const dict = (o: unknown) => isObj(o) ? Object.fromEntries(Object.entries(o).filter(([k, v]) => /^[A-Za-z0-9_ -]{1,24}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0).slice(0, 100)) : {};
  c.killsByKind = dict(x.killsByKind); c.strikesByKind = dict(x.strikesByKind); c.medals = dict(x.medals);
  const r = x.records, rref = (v: any): RecRef | undefined => isObj(v) && typeof v.id === "string" ? { v: pos(v.v), id: str(v.id, 64), city: str(v.city, 120), diff: str(v.diff, 12) } : undefined;
  if (isObj(r)) {
    for (const k of ["mostSaved", "mostKills", "damage", "held", "perM", "familiesWhole"] as const) { const v = rref(r[k]); if (v) c.records[k] = v; }
    const u = rref(r.unitKills); if (u) c.records.unitKills = { ...u, label: str(r.unitKills.label, 60) };
    if (isObj(r.city)) for (const [k, v] of Object.entries(r.city).slice(0, 500)) { const s = rref((v as any)?.saved); if (s && /^[a-z0-9:_/@-]{1,120}$/i.test(k)) c.records.city[k] = { saved: s }; }
  }
  return c;
}

// ---------- 0.57 review: never lose a history to a bad read, never count a battle the history didn't keep ----------
/** null = no file yet (an empty history, fine to write). Empty or unparseable text = damaged: not ok. */
export function parseHistoryText(text: string | null): { ok: boolean; history: History } {
  if (text === null) return { ok: true, history: { v: 1, battles: [] } };
  try { return { ok: true, history: cleanHistory(JSON.parse(text)) }; } catch { return { ok: false, history: { v: 1, battles: [] } }; }
}
/** Read, upsert, write. The career comes back only when the write succeeded (otherwise null: keep the old one). */
export async function persistRecord(read: () => Promise<{ ok: boolean; history: History }>, write: (h: History) => Promise<boolean>, career: Career, r: BattleRecord):
  Promise<{ career: Career | null; broken: { key: string; was: number | null; now: number }[]; why?: string; history?: History }> {
  const got = await read();
  if (!got.ok) return { career: null, broken: [], why: "history unreadable" };
  const res = upsert(got.history, career, r);
  if (!(await write(res.history))) return { career: null, broken: [], why: "history write failed" };
  return { career: res.career, broken: res.broken, history: res.history };
}
