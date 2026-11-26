// 0.58: the Statistics page (replaces the Service Record). Pure: aggregates the slot's battle history under a
// filter and renders each tab as HTML/SVG strings. Totals and records count only battles that count in the career
// (not Dev mode, not modded); the battle history and the cities list still show those, marked.
import * as C from "./config";
import * as P from "./progress";
import * as A from "./achievements";
import { countsInCareer, recomputeRecords, type BattleRecord, type History, type Records } from "./battlerecord";
import { BROKEN_NAMES } from "./endreport";

export type StatsTab = "career" | "units" | "strikes" | "cities" | "records" | "history" | "achievements";
export const STATS_TABS: StatsTab[] = ["career", "units", "strikes", "cities", "records", "history", "achievements"];
const TAB_NAMES: Record<StatsTab, string> = { career: "Career", units: "Units", strikes: "Strikes", cities: "Cities", records: "Records", history: "Battle history", achievements: "Achievements" };
export interface StatsFilter { diff: "all" | "easy" | "medium" | "hard" | "insane"; city: string }
export type HistorySort = "date" | "score" | "saved" | "kills";
export interface Agg {
  battles: number; completed: number; abandoned: number;
  saved: number; kills: number; damage: number; spent: number; held: number; hordes: number; breaches: number; lifts: number; liftsAborted: number; strikes: number; nukes: number; bridges: number; supplySpent: number;
  people: number; medals: Record<string, number>;
  units: { kind: string; uses: number; kills: number; lost: number; cost: number; perM: number }[];
  strikesBy: { kind: string; uses: number; kills: number; civ: number; cost: number; perM: number }[];
  cities: { cityId: string; name: string; kind: string; battles: number; saved: number; kills: number; best: Record<string, string | null>; flagged: number }[];
  records: Records; trend: { id: string; score: number; medal: string | null; saved: number; kills: number }[];
  recent: BattleRecord[];
}
export interface StatsCtx { history: BattleRecord[]; sort: HistorySort; xp: number; achievements: Record<string, string>; toolName: (k: string) => string; filtered?: boolean; // filtered: a filter is on (changes the empty-state text)
  achProgress?: Record<string, [number, number]>; achGroup?: AchGroupSel; achView?: AchView } // 0.59: the Achievements tab
export type AchGroupSel = "all" | A.AchGroup;
export type AchView = "all" | "earned" | "not" | "closest";
const ACH_VIEWS: [AchView, string][] = [["all", "All"], ["earned", "Earned"], ["not", "Not yet"], ["closest", "Closest first"]];

const DIFFS = ["easy", "medium", "hard", "insane"];
const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const n0 = (v: number) => Math.round(fin(v)).toLocaleString("en-US");
const money = (v: number) => C.money(fin(v));
const hms = (s: number) => { const t = Math.max(0, Math.floor(fin(s))), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m ${t % 60}s`; };
const mmss = (s: number) => { const t = Math.max(0, Math.floor(fin(s))); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const medalRank = (m: string | null) => (m ? C.MEDALS.length - C.MEDALS.findIndex(x => x[0] === m) : 0);
const medalColor = (m: string | null) => C.MEDALS.find(x => x[0] === m)?.[2] ?? "#4b5563";
const diffName = (d: string) => (C.DIFFICULTY as Record<string, { name: string }>)[d]?.name ?? d;
const unitName = (k: string) => (C.UNITS as Record<string, { name: string }>)[k]?.name ?? k;
const strikeName = (k: string) => (C.ABILITIES as Record<string, { name: string }>)[k]?.name ?? k;

export function filterBattles(h: History, f: StatsFilter): BattleRecord[] {
  return h.battles.filter(b => (f.diff === "all" || b.meta.difficulty === f.diff) && (f.city === "all" || b.meta.cityId === f.city));
}

export function cityOptions(h: History): { id: string; name: string }[] {
  const m = new Map<string, string>(); for (const b of h.battles) if (!m.has(b.meta.cityId)) m.set(b.meta.cityId, b.meta.cityName);
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function aggregate(h: History, f: StatsFilter): Agg {
  const all = filterBattles(h, f), counted = all.filter(countsInCareer);
  const a: Agg = { battles: counted.length, completed: 0, abandoned: 0, saved: 0, kills: 0, damage: 0, spent: 0, held: 0, hordes: 0, breaches: 0, lifts: 0, liftsAborted: 0,
    strikes: 0, nukes: 0, bridges: 0, supplySpent: 0, people: 0, medals: {}, units: [], strikesBy: [], cities: [], records: recomputeRecords({ v: 1, battles: counted }), trend: [], recent: all.slice(-8).reverse() };
  const units = new Map<string, { uses: number; kills: number; lost: number }>(), strikes = new Map<string, { uses: number; kills: number; civ: number }>();
  for (const b of counted) {
    const t = b.totals;
    a.supplySpent += t.supplySpent ?? 0; // 0.60
    if (b.outcome.roundComplete) a.completed++; if (b.outcome.abandoned) a.abandoned++;
    a.saved += t.saved; a.kills += t.kills; a.damage += t.damage; a.spent += t.spent; a.held += t.held; a.hordes += t.hordes; a.breaches += t.breaches;
    a.lifts += t.lifts; a.liftsAborted += t.liftsAborted; a.strikes += t.strikes; a.nukes += t.nukes; a.bridges += t.bridges; a.people += t.people;
    if (b.outcome.medal) a.medals[b.outcome.medal] = (a.medals[b.outcome.medal] ?? 0) + 1;
    for (const u of b.units) { const v = units.get(u.kind) ?? { uses: 0, kills: 0, lost: 0 }; v.uses++; v.kills += u.kills; if (u.lostT >= 0) v.lost++; units.set(u.kind, v); }
    for (const s of b.strikes) { const v = strikes.get(s.kind) ?? { uses: 0, kills: 0, civ: 0 }; v.uses++; v.kills += s.kills; v.civ += s.civ; strikes.set(s.kind, v); }
  }
  const perM = (kills: number, cost: number) => (cost > 0 ? kills / (cost / 1e6) : 0);
  a.units = [...units].map(([kind, v]) => { const cost = v.uses * ((C.UNITS as Record<string, { cost: number }>)[kind]?.cost ?? 0); return { kind, ...v, cost, perM: perM(v.kills, cost) }; }).sort((x, y) => y.kills - x.kills);
  a.strikesBy = [...strikes].map(([kind, v]) => { const cost = v.uses * ((C.ABILITIES as Record<string, { cost: number }>)[kind]?.cost ?? 0); return { kind, ...v, cost, perM: perM(v.kills, cost) }; }).sort((x, y) => y.uses - x.uses);
  const cities = new Map<string, Agg["cities"][number]>();
  for (const b of all) {
    const c = cities.get(b.meta.cityId) ?? { cityId: b.meta.cityId, name: b.meta.cityName, kind: b.meta.kind, battles: 0, saved: 0, kills: 0, best: Object.fromEntries(DIFFS.map(d => [d, null])), flagged: 0 };
    if (!countsInCareer(b)) c.flagged++;
    else {
      c.battles++; c.saved += b.totals.saved; c.kills += b.totals.kills;
      const d = b.meta.difficulty; if (medalRank(b.outcome.medal) > medalRank(c.best[d] ?? null)) c.best[d] = b.outcome.medal;
    }
    cities.set(b.meta.cityId, c);
  }
  a.cities = [...cities.values()].sort((x, y) => y.battles - x.battles || x.name.localeCompare(y.name));
  a.trend = counted.slice(-60).map(b => ({ id: b.meta.id, score: b.outcome.score, medal: b.outcome.medal, saved: b.totals.saved, kills: b.totals.kills }));
  return a;
}

// ---------- rendering ----------
const empty = (filtered: boolean) => `<div class="er-panel er-empty">${filtered ? "No battles match these filters." : "No battles yet. Finish a battle and it shows up here."}</div>`;
const bar = (label: string, v: number, max: number, color: string, shown = n0(v)) =>
  `<div class="er-row"><span>${esc(label)}</span><div class="er-bar"><i style="width:${max > 0 ? Math.min(100, fin(v) / max * 100).toFixed(1) : 0}%;background:${color}"></i></div><b>${shown}</b></div>`;
const kpi = (l: string, v: string, color: string, d: string) => `<div class="er-kpi"><div class="er-k">${esc(l)}</div><div class="er-v" style="color:${color}">${v}</div><div class="er-d">${d}</div></div>`;
const flagOf = (b: BattleRecord) => [b.meta.flags.dev ? "Dev" : "", b.meta.flags.modded ? "Modded" : "", b.outcome.abandoned ? "Left early" : ""].filter(Boolean).join(", ");
const PALETTE = ["#a3e635", "#fb923c", "#4ade80", "#f472b6", "#60a5fa", "#94a3b8", "#c084fc", "#22d3ee", "#facc15", "#f87171"];

function trendSvg(a: Agg): string {
  const T = a.trend, W = 600, H = 220, pl = 30, pb = 20, pt = 10;
  if (!T.length) return "";
  const bw = (W - pl) / Math.max(T.length, 10);
  let s = "";
  for (const v of [0, 30, 50, 75, 100]) { const y = pt + (H - pb - pt) * (1 - v / 100); s += `<line x1="${pl}" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#262f3f"${v ? ' stroke-dasharray="3 3"' : ""}/><text x="${pl - 5}" y="${(y + 4).toFixed(1)}" font-size="10" fill="#8b95a7" text-anchor="end">${v}</text>`; }
  T.forEach((b, i) => { const h = (H - pb - pt) * Math.min(100, fin(b.score)) / 100; s += `<rect x="${(pl + i * bw + 1).toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${medalColor(b.medal)}" opacity=".85" data-open="${esc(b.id)}"><title>${n0(b.score)} points</title></rect>`; });
  const d = T.map((_, i) => { const w = T.slice(Math.max(0, i - 9), i + 1), m = w.reduce((x, y) => x + fin(y.score), 0) / w.length; return `${i ? "L" : "M"}${(pl + i * bw + bw / 2).toFixed(1)},${(pt + (H - pb - pt) * (1 - m / 100)).toFixed(1)}`; }).join("");
  if (T.length > 1) s += `<path d="${d}" stroke="#eef2f6" stroke-width="2" fill="none"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="er-svg">${s}</svg>`;
}
function dualSvg(a: Agg): string {
  const T = a.trend, W = 600, H = 200, pl = 30, mid = (H - 14) / 2;
  if (!T.length) return "";
  const bw = (W - pl) / Math.max(T.length, 10), ms = Math.max(1, ...T.map(b => fin(b.saved))), mk = Math.max(1, ...T.map(b => fin(b.kills)));
  let s = `<line x1="${pl}" x2="${W}" y1="${mid}" y2="${mid}" stroke="#3b4963"/><text x="${pl - 5}" y="12" font-size="10" fill="#4ade80" text-anchor="end">saved</text><text x="${pl - 5}" y="${H - 4}" font-size="10" fill="#f87171" text-anchor="end">kills</text>`;
  T.forEach((b, i) => { const x = (pl + i * bw + 1).toFixed(1), w = Math.max(1, bw - 2).toFixed(1), hs = mid * fin(b.saved) / ms, hk = mid * fin(b.kills) / mk;
    s += `<rect x="${x}" y="${(mid - hs).toFixed(1)}" width="${w}" height="${hs.toFixed(1)}" fill="#4ade80" opacity=".8"/><rect x="${x}" y="${mid}" width="${w}" height="${hk.toFixed(1)}" fill="#f87171" opacity=".8"/>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="er-svg">${s}</svg>`;
}

function rankBlock(ctx: StatsCtx): string {
  const rk = P.rankFor(ctx.xp);
  const unlocks = Object.entries(P.UNLOCK_XP).sort((x, y) => x[1] - y[1])
    .map(([k, x]) => `<div class="${ctx.xp >= x ? "got" : ""}"><b>${esc(ctx.toolName(k))}</b><span>${ctx.xp >= x ? "Unlocked" : `${n0(x)} XP`}</span></div>`).join("");
  return `<div class="er-panel"><h3>Rank <span>${esc(rk.name)} · ${n0(ctx.xp)} XP${rk.next ? ` · ${esc(rk.next[0])} at ${n0(rk.next[1])} XP` : " · top rank"}</span></h3>` +
    `<div class="er-dim">Hardware unlocks (campaign cities lend you one locked item each as a field trial)</div><div class="reclist">${unlocks}</div></div>`;
}
function recordRows(r: Records): string {
  const rows: string[] = [];
  for (const k of ["mostSaved", "mostKills", "unitKills", "damage", "held", "perM", "familiesWhole"] as const) {
    const v = r[k]; if (!v) continue;
    const shown = k === "damage" ? money(v.v) : k === "held" ? mmss(v.v) : n0(v.v);
    rows.push(`<div class="er-kv st-link" data-open="${esc(v.id)}"><span>${esc(BROKEN_NAMES[k])}</span><b>${shown} <span class="er-dim">${k === "unitKills" ? esc((v as { label: string }).label) + " · " : ""}${esc(v.city)} · ${esc(diffName(v.diff))}</span></b></div>`);
  }
  return rows.join("") || `<div class="er-dim">None yet.</div>`;
}
function battleRow(b: BattleRecord): string {
  const f = flagOf(b);
  return `<tr class="st-link" data-open="${esc(b.meta.id)}"><td>${esc(b.meta.date)}</td><td>${esc(b.meta.cityName)}</td><td>${esc(diffName(b.meta.difficulty))}</td><td style="color:${medalColor(b.outcome.medal)}">${esc(b.outcome.medal ?? "None")}</td>` +
    `<td class="n">${n0(b.outcome.score)}</td><td class="n">${n0(b.totals.saved)}</td><td class="n">${n0(b.totals.kills)}</td><td class="er-dim">${esc(f)}</td></tr>`;
}
const HIST_HEAD = `<tr><th>Date</th><th>City</th><th>Difficulty</th><th>Medal</th><th class="n">Score</th><th class="n">Saved</th><th class="n">Kills</th><th></th></tr>`;

function career(a: Agg, ctx: StatsCtx, filtered: boolean): string {
  if (!a.battles && !ctx.history.length) return rankBlock(ctx) + empty(filtered);
  const med = C.MEDALS.map(([m, , c]) => `<span style="color:${c}">${n0(a.medals[m] ?? 0)}</span>`).join(" ");
  const kpis = kpi("Infected killed", n0(a.kills), "#f87171", `${n0(a.battles ? a.kills / a.battles : 0)} a battle`) +
    kpi("People saved", n0(a.saved), "#4ade80", `${a.people ? (a.saved / a.people * 100).toFixed(1) : "0"}% of all at risk`) +
    kpi("Damage caused", money(a.damage), "#fb923c", `${n0(a.nukes)} nukes · ${n0(a.bridges)} bridges`) +
    kpi("Lifts flown", n0(a.lifts), "#60a5fa", `${n0(a.liftsAborted)} waved off`) +
    kpi("Hordes survived", n0(a.hordes), "#eef2f6", `${n0(a.breaches)} breaches`) +
    kpi("Time held", hms(a.held), "#eef2f6", "after outbreaks") +
    kpi("Money spent", money(a.spent), "#facc15", `${n0(a.spent > 0 ? a.saved / (a.spent / 1e6) : 0)} saved per $1M`) +
    kpi("Medals", med, "#eef2f6", C.MEDALS.map(m => m[0].toLowerCase()).join(" · "));
  const ub = a.units.slice(0, 8), um = Math.max(1, ...ub.map(u => u.kills));
  const sb = a.strikesBy.slice(0, 8), sm = Math.max(1, ...sb.map(s => s.uses));
  return `<div class="er-kpis st-kpis">${kpis}</div><div class="er-meta er-dim">${n0(a.battles)} battles · ${n0(a.completed)} completed · ${n0(a.abandoned)} left early · ${money(a.supplySpent)} on supply</div>` +
    `<div class="st-grid"><div class="er-panel"><h3>Every battle <span>score per battle, last ${n0(a.trend.length)} · medal color · line = 10-battle average</span></h3>${trendSvg(a) || `<div class="er-dim">No battles counted yet.</div>`}` +
    `<h3 class="er-mt">Saved vs killed per battle</h3>${dualSvg(a)}</div>` +
    `<div class="er-panel"><h3>Career kills by unit <span>${n0(a.units.reduce((s, u) => s + u.kills, 0))}</span></h3>${ub.map((u, i) => bar(unitName(u.kind), u.kills, um, PALETTE[i % PALETTE.length])).join("") || `<div class="er-dim">None yet.</div>`}` +
    `<h3 class="er-mt">Strikes called <span>${n0(a.strikes)}</span></h3>${sb.map((s, i) => bar(strikeName(s.kind), s.uses, sm, PALETTE[(i + 3) % PALETTE.length])).join("") || `<div class="er-dim">None yet.</div>`}</div>` +
    `<div class="er-panel"><h3>Personal records</h3>${recordRows(a.records)}<h3 class="er-mt">Recent battles <span>click to open the report</span></h3><table>${HIST_HEAD}${a.recent.slice(0, 5).map(battleRow).join("")}</table></div></div>` + rankBlock(ctx);
}

function unitsTab(a: Agg, filtered: boolean): string {
  if (!a.units.length) return a.battles ? `<div class="er-panel er-empty">No units used.</div>` : empty(filtered);
  const m = Math.max(1, ...a.units.map(u => u.kills));
  return `<div class="er-grid2"><div class="er-panel er-scroll"><h3>Units, career</h3><table><tr><th>Unit</th><th class="n">Kills</th><th class="n">Placed</th><th class="n">Lost</th><th class="n">Cost</th><th class="n">Kills per $1M</th></tr>` +
    a.units.map(u => `<tr><td>${esc(unitName(u.kind))}</td><td class="n">${n0(u.kills)}</td><td class="n">${n0(u.uses)}</td><td class="n">${n0(u.lost)}</td><td class="n">${money(u.cost)}</td><td class="n">${n0(u.perM)}</td></tr>`).join("") +
    `</table></div><div class="er-panel"><h3>Kills by unit</h3>${a.units.map((u, i) => bar(unitName(u.kind), u.kills, m, PALETTE[i % PALETTE.length])).join("")}</div></div>`;
}
function strikesTab(a: Agg, filtered: boolean): string {
  if (!a.strikesBy.length) return a.battles ? `<div class="er-panel er-empty">No strikes called.</div>` : empty(filtered);
  const m = Math.max(1, ...a.strikesBy.map(s => s.kills));
  return `<div class="er-grid2"><div class="er-panel er-scroll"><h3>Strikes, career</h3><table><tr><th>Strike</th><th class="n">Called</th><th class="n">Infected killed</th><th class="n">Civilians killed</th><th class="n">Cost</th><th class="n">Kills per $1M</th></tr>` +
    a.strikesBy.map(s => `<tr><td>${esc(strikeName(s.kind))}</td><td class="n">${n0(s.uses)}</td><td class="n">${n0(s.kills)}</td><td class="n">${n0(s.civ)}</td><td class="n">${money(s.cost)}</td><td class="n">${n0(s.perM)}</td></tr>`).join("") +
    `</table></div><div class="er-panel"><h3>Kills by strike</h3>${a.strikesBy.map((s, i) => bar(strikeName(s.kind), s.kills, m, PALETTE[(i + 3) % PALETTE.length])).join("")}</div></div>`;
}
function citiesTab(a: Agg, filtered: boolean): string {
  if (!a.cities.length) return empty(filtered);
  const KIND: Record<string, string> = { campaign: "Campaign", real: "Real city", quick: "Quick", daily: "Daily", osm: "Live map" };
  return `<div class="er-panel er-scroll"><h3>Cities <span>best medal on each difficulty</span></h3><table><tr><th>City</th><th>Kind</th><th class="n">Battles</th><th class="n">Saved</th><th class="n">Kills</th>${DIFFS.map(d => `<th>${diffName(d)}</th>`).join("")}<th></th></tr>` +
    a.cities.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(KIND[c.kind] ?? c.kind)}</td><td class="n">${n0(c.battles)}</td><td class="n">${n0(c.saved)}</td><td class="n">${n0(c.kills)}</td>` +
      DIFFS.map(d => `<td style="color:${medalColor(c.best[d] ?? null)}">${esc(c.best[d] ?? "·")}</td>`).join("") +
      `<td class="er-dim">${c.flagged ? `${n0(c.flagged)} Dev or modded battles here are not counted` : ""}</td></tr>`).join("") + `</table></div>`;
}
function recordsTab(a: Agg, filtered: boolean): string {
  if (!a.battles) return empty(filtered);
  const city = Object.entries(a.records.city).sort((x, y) => y[1].saved.v - x[1].saved.v)
    .map(([k, v]) => `<div class="er-kv st-link" data-open="${esc(v.saved.id)}"><span>${esc(v.saved.city)} · ${esc(diffName(k.split("@")[1] ?? ""))}</span><b>${n0(v.saved.v)} saved</b></div>`).join("");
  return `<div class="er-grid2"><div class="er-panel"><h3>Personal records <span>click one to open the battle</span></h3>${recordRows(a.records)}</div><div class="er-panel er-scroll"><h3>Most saved on each city</h3>${city || `<div class="er-dim">None yet.</div>`}</div></div>`;
}
function historyTab(ctx: StatsCtx, filtered: boolean): string {
  if (!ctx.history.length) return empty(filtered);
  const key = (b: BattleRecord) => ctx.sort === "score" ? b.outcome.score : ctx.sort === "saved" ? b.totals.saved : ctx.sort === "kills" ? b.totals.kills : 0;
  const rows = ctx.sort === "date" ? [...ctx.history].reverse() : [...ctx.history].sort((x, y) => key(y) - key(x));
  const sorts = (["date", "score", "saved", "kills"] as const).map(s => `<button data-sort="${s}" class="er-tab${s === ctx.sort ? " on" : ""}">${s === "date" ? "Newest" : s[0].toUpperCase() + s.slice(1)}</button>`).join("");
  return `<div class="er-panel er-scroll"><h3>Battle history <span>${n0(ctx.history.length)} battles · click one to open its report</span></h3><div class="st-sorts">Sort: ${sorts}</div><table>${HIST_HEAD}${rows.map(battleRow).join("")}</table></div>`;
}
// 0.59: groups down the left with earned/total, cards in a grid; earned cards in tier color with the date, the rest
// grayed with their "how" text and, where it fits, a progress bar (best battle for battle ones, the running total for career ones)
const TIER_COLOR: Record<A.Tier, string> = { 1: "#cd7f32", 2: "#cfd8dc", 3: "#ffd54f", 4: "#b3e5fc" };
const ROMAN = /\s(I{1,3})$/;
const ratio = (p: [number, number] | undefined) => (p && p[1] > 0 ? Math.min(1, fin(p[0]) / p[1]) : 0);
export function achCard(a: A.AchDef, date: string | undefined, p: [number, number] | undefined): string {
  const m = ROMAN.exec(a.name), mark = m ? m[1] : A.TIER_NAMES[a.tier][0];
  const prog = !date && p && p[0] > 0, pct = ratio(p) * 100;
  const label = a.scope === "battle" ? " (best battle)" : "";
  const fmt = (v: number) => a.unit === "$" ? money(v) : a.unit === "%" ? `${n0(v)}%` : a.unit === "min" ? `${n0(v)} min` : a.unit === "m" ? `${n0(v)} m` : n0(v);
  return `<div class="st-a${date ? "" : prog ? " prog" : " off"}" title="${esc(A.TIER_NAMES[a.tier])}"><div class="st-am" style="background:${TIER_COLOR[a.tier]}">${mark}</div>` +
    `<div class="st-ab"><b>${esc(a.name)}</b><div class="st-ah">${esc(a.how)}</div>` +
    (date ? `<div class="st-ad">Earned ${esc(date)}</div>` : "") +
    (prog ? `<div class="st-pb"><i style="width:${pct.toFixed(1)}%"></i></div><div class="st-pt">${fmt(Math.min(p![0], p![1]))} of ${fmt(p![1])}${label}</div>` : "") + `</div></div>`;
}
function achievementsTab(ctx: StatsCtx): string {
  const have = ctx.achievements, prog = ctx.achProgress ?? {}, group = ctx.achGroup ?? "all", view = ctx.achView ?? "all";
  const all = A.ACHIEVEMENTS, got = all.filter(a => have[a.id]);
  const byTier = ([1, 2, 3, 4] as A.Tier[]).map(t => `${A.TIER_NAMES[t]} ${got.filter(a => a.tier === t).length}`).join(" · ");
  const next = all.filter(a => !have[a.id] && ratio(prog[a.id]) > 0 && ratio(prog[a.id]) < 1).sort((x, y) => ratio(prog[y.id]) - ratio(prog[x.id]))[0];
  const head = `<div class="st-ahead"><div><b>${got.length} of ${all.length} earned</b><div class="st-pb big"><i style="width:${(100 * got.length / all.length).toFixed(1)}%"></i></div>` +
    `<small>${byTier}${next ? ` · next up: ${esc(next.name)} (${Math.floor(ratio(prog[next.id]) * 100)}% there)` : ""}</small></div>` +
    `<div class="st-aviews">${ACH_VIEWS.map(([v, t]) => `<button data-aview="${v}" class="${v === view ? "on" : ""}">${t}</button>`).join("")}</div></div>`;
  const groups = [["all", "All", got.length, all.length] as const, ...A.GROUPS.map(g => [g, g, all.filter(a => a.group === g && have[a.id]).length, all.filter(a => a.group === g).length] as const)]
    .map(([id, name, a, b]) => `<button data-agroup="${id}" class="${id === group ? "on" : ""}"><span>${esc(name)}<i class="st-mini"><i style="width:${(100 * a / Math.max(1, b)).toFixed(0)}%"></i></i></span><small>${a}/${b}</small></button>`).join("");
  let list = all.filter(a => group === "all" || a.group === group);
  if (view === "earned") list = list.filter(a => have[a.id]);
  else if (view === "not") list = list.filter(a => !have[a.id]);
  else if (view === "closest") list = list.filter(a => !have[a.id]).sort((x, y) => ratio(prog[y.id]) - ratio(prog[x.id]));
  const grid = list.length ? list.map(a => achCard(a, have[a.id], prog[a.id])).join("") : `<p class="st-empty">${view === "earned" ? "None earned here yet." : "All earned here."}</p>`;
  return head + `<div class="st-ach2"><div class="st-agroups">${groups}</div><div class="st-agrid">${grid}</div></div>`;
}

export function statsTabHtml(tab: StatsTab, agg: Agg, ctx: StatsCtx): string {
  const f = !!ctx.filtered;
  switch (tab) {
    case "career": return career(agg, ctx, f);
    case "units": return unitsTab(agg, f);
    case "strikes": return strikesTab(agg, f);
    case "cities": return citiesTab(agg, f);
    case "records": return recordsTab(agg, f);
    case "history": return historyTab(ctx, f);
    case "achievements": return achievementsTab(ctx);
  }
}
export function statsTabsHtml(cur: StatsTab, achievedCount: number): string {
  return STATS_TABS.map(t => `<button data-stab="${t}" class="er-tab${t === cur ? " on" : ""}">${TAB_NAMES[t]}${t === "achievements" ? ` ${achievedCount}/${A.ACHIEVEMENTS.length}` : ""}</button>`).join("");
}
