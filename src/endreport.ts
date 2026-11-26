// 0.57: the after-action report. Pure render functions from a BattleRecord (HTML and SVG strings), so the same
// report can open from the battle history later. Every string from a record is escaped; numbers are en-US.
import { BY_ID } from "./achievements";
import * as C from "./config";
import { formatClock } from "./people";
import { COLS, type Col, SE_SIRENS, SE_HORDE, SE_BREACH, SE_GATE_TO_WALL, SE_WALL_TO_GATE, SE_GATES_LOCKED, SE_BRIDGE, SE_STRIKE, SE_UNIT_PLACED,
  SE_UNIT_LOST, SE_LIFT, SE_LIFT_ABORT, SE_DEMOLISH, SE_ROUND, SE_KEEP_FIGHTING, SE_EVENT_START, SE_EVENT_WON, SE_EVENT_LOST, type OtherKill } from "./stats";
import { bevReportHtml } from "./eventui";
import type { BattleRecord } from "./battlerecord";

export type Tab = "overview" | "timeline" | "units" | "strikes" | "town" | "money" | "heatmap";
export const TABS: Tab[] = ["overview", "timeline", "units", "strikes", "town", "money", "heatmap"];
export const TAB_NAMES: Record<Tab, string> = { overview: "Overview", timeline: "Timeline", units: "Units", strikes: "Strikes", town: "Town", money: "Money", heatmap: "Kill heatmap" };
export interface TabCtx { broken: { key: string; was: number | null; now: number }[]; live: boolean; timelineCols?: Col[] }

const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const n0 = (v: number) => Math.round(fin(v)).toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${(fin(a) / b * 100).toFixed(1)}%` : "0%");
const mmss = (t: number) => { const s = Math.max(0, Math.floor(fin(t))); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const money = (v: number) => C.money(fin(v));

export const COL_NAMES: Record<Col, string> = { t: "Time", saved: "Evacuated", byTrain: "By train", inZone: "In the zone", outside: "Outside the zone", infected: "Infected alive",
  kills: "Infected killed", killsStrikes: "Killed by strikes", civKilledByUs: "Civilians killed by us", money: "Money left", spent: "Spent", damage: "Damage bill",
  intact: "City intact %", hordes: "Hordes", breaches: "Breaches", unitsAlive: "Units alive", lifts: "Lifts flown", liftsAborted: "Lifts waved off" };
const COL_COLORS: Record<Col, string> = { t: "#8b95a7", saved: "#4ade80", byTrain: "#22d3ee", inZone: "#60a5fa", outside: "#e2e8f0", infected: "#f87171", kills: "#fb923c",
  killsStrikes: "#facc15", civKilledByUs: "#e879f9", money: "#facc15", spent: "#fbbf24", damage: "#fb923c", intact: "#a3e635", hordes: "#f87171", breaches: "#ef4444",
  unitsAlive: "#94a3b8", lifts: "#60a5fa", liftsAborted: "#c084fc" };
export const DEFAULT_COLS: Col[] = ["saved", "inZone", "infected"];
const OTHER_NAMES: Record<OtherKill, string> = { guard: "Wall guards", civilian: "Armed civilians", train: "Trains", bridge: "Bridges blown", demolition: "Demolitions", env: "Fire, fallout and other" };
const EV_NAMES: Record<number, string> = { [SE_SIRENS]: "Sirens", [SE_HORDE]: "Horde", [SE_BREACH]: "Breach", [SE_GATE_TO_WALL]: "Gate closed to a wall", [SE_WALL_TO_GATE]: "Wall opened to a gate",
  [SE_GATES_LOCKED]: "Gates locked", [SE_BRIDGE]: "Bridge blown", [SE_STRIKE]: "Strike", [SE_UNIT_PLACED]: "Unit placed", [SE_UNIT_LOST]: "Unit lost", [SE_LIFT]: "Lift flown",
  [SE_LIFT_ABORT]: "Lift waved off", [SE_DEMOLISH]: "Building brought down", [SE_ROUND]: "Round complete", [SE_KEEP_FIGHTING]: "Keep fighting", [SE_EVENT_START]: "Battle event", [SE_EVENT_WON]: "Battle event won", [SE_EVENT_LOST]: "Battle event lost" };
const STRIP: Record<number, string> = { [SE_SIRENS]: "#facc15", [SE_HORDE]: "#f87171", [SE_BREACH]: "#ef4444", [SE_STRIKE]: "#fb923c", [SE_BRIDGE]: "#e879f9", [SE_GATES_LOCKED]: "#8b95a7", [SE_UNIT_LOST]: "#94a3b8", [SE_DEMOLISH]: "#c084fc" };
const unitName = (k: string) => (C.UNITS as Record<string, { name: string }>)[k]?.name ?? k;
const strikeName = (k: string) => (C.ABILITIES as Record<string, { name: string }>)[k]?.name ?? k;
const unitPlural = (k: string, n: number) => n > 1 ? `${unitName(k)} ×${n}` : unitName(k);

function evText(r: BattleRecord, i: number): string {
  const e = r.events!, k = e.k[i], a = e.a[i];
  switch (k) {
    case SE_HORDE: return `Horde of ${n0(a)}${e.b[i] ? " (a big one)" : ""}`;
    case SE_STRIKE: { const s = r.strikes[a]; return s ? `${strikeName(s.kind)}: ${n0(s.kills)} killed${s.civ ? `, ${n0(s.civ)} civilians` : ""}` : "Strike"; }
    case SE_UNIT_PLACED: case SE_UNIT_LOST: { const u = r.units[a]; return `${EV_NAMES[k]}${u ? ": " + u.label : ""}`; }
    case SE_LIFT: return `Lift flown: ${n0(a)} people`;
    case SE_GATES_LOCKED: return `Gates locked (${n0(a)} cells)`;
    default: return EV_NAMES[k] ?? "Event";
  }
}

const bar = (label: string, v: number, max: number, color: string, shown = n0(v)) =>
  `<div class="er-row"><span>${esc(label)}</span><div class="er-bar"><i style="width:${max > 0 ? Math.min(100, fin(v) / max * 100).toFixed(1) : 0}%;background:${color}"></i></div><b>${shown}</b></div>`;
function stack(parts: [string, number, string][]): string {
  const tot = parts.reduce((s, p) => s + Math.max(0, fin(p[1])), 0);
  const segs = tot > 0 ? parts.filter(p => p[1] > 0).map(([, v, c]) => `<i style="width:${(v / tot * 100).toFixed(2)}%;background:${c}"></i>`).join("") : "";
  return `<div class="er-stack">${segs}</div><div class="er-legend">${parts.map(([l, v, c]) => `<span><b style="color:${c}">■</b> ${esc(l)} ${n0(v)}</span>`).join("")}</div>`;
}

export function headerHtml(r: BattleRecord, extra: { xpLine: string; news: string }): string {
  const med = C.MEDALS.find(m => m[0] === r.outcome.medal), o = r.outcome, p = o.parts;
  const diff = (C.DIFFICULTY as Record<string, { name: string }>)[r.meta.difficulty]?.name ?? r.meta.difficulty;
  const flags = [r.meta.flags.dev ? "Dev mode: not counted in your career" : "", r.meta.flags.modded ? "Mods loaded: not counted in your career" : "", o.abandoned ? "Left before the round was over" : ""].filter(Boolean);
  const seg = (v: number, c: string) => `<i style="width:${Math.max(0, Math.min(100, fin(v)))}%;background:${c}"></i>`;
  const lines = C.MEDALS.map(([n, pts, c]) => `<span class="er-line" style="left:${pts}%;border-color:${c}" title="${n} ${pts}"></span>`).join("");
  const labels = C.MEDALS.map(([n, pts, c]) => `<span style="left:${pts}%;color:${c}">${n} ${pts}</span>`).join("");
  return `<div class="er-title"><div class="er-kicker">After-action report</div><div class="er-city">${esc(r.meta.cityName)} · ${esc(diff)} · sirens ${formatClock(r.meta.sirenMin)}</div>` +
    (flags.length ? `<div class="er-flag">${flags.map(esc).join(" · ")}</div>` : "") + `</div>` +
    `<div class="er-medal"><div style="color:${med ? med[2] : "#9aa3b2"}">${esc(o.medal ? o.medal.toUpperCase() : "NO MEDAL")}</div><small>${n0(o.score)} / 100 points</small></div>` +
    `<div class="er-score"><div class="er-sub">Round score: saved ${n0(p.saved)} · speed ${n0(p.speed)} · city intact ${n0(p.city)} · infected killed ${n0(p.kills)}${o.mayhem !== undefined ? ` · Mayhem ${n0(o.mayhem)}` : ""}</div>` +
    `<div class="er-scorebar">${seg(p.saved, "#4ade80")}${seg(p.speed, "#60a5fa")}${seg(p.city, "#facc15")}${seg(p.kills, "#f87171")}${lines}</div><div class="er-ticks">${labels}</div></div>` +
    (extra.xpLine || extra.news ? `<div class="er-xpline">${esc(extra.xpLine)}${extra.news ? `<div class="er-news">${esc(extra.news)}</div>` : ""}</div>` : "") +
    (r.earned?.length ? `<div class="er-ach">Achievement${r.earned.length > 1 ? "s" : ""} earned: ${r.earned.map(id => BY_ID[id]).filter(Boolean).map(a => `<b class="t${a.tier}">${esc(a.name)}</b>`).join(" ")}</div>` : ""); // 0.59
}

export function timelineSvg(r: BattleRecord, cols: Col[], w: number, h: number): string {
  const S = r.samples, n = S?.t.length ?? 0;
  if (!S || n < 2) return `<svg viewBox="0 0 ${w} ${h}" class="er-svg"><text x="${w / 2}" y="${h / 2}" fill="#8b95a7" font-size="13" text-anchor="middle">Nothing to chart yet: the battle was too short.</text></svg>`;
  const pl = 48, pr = 10, pt = 10, pb = 44, T = Math.max(1, S.t[n - 1]);
  const max = Math.max(1, ...cols.flatMap(c => S[c].map(fin)));
  const X = (t: number) => pl + (w - pl - pr) * t / T, Y = (v: number) => pt + (h - pt - pb) * (1 - fin(v) / max);
  let s = "";
  for (let i = 0; i <= 4; i++) { const v = max * i / 4; s += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#262f3f"/><text x="${pl - 6}" y="${(Y(v) + 4).toFixed(1)}" fill="#8b95a7" font-size="10" text-anchor="end">${v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "k" : Math.round(v)}</text>`; }
  const step = Math.max(60, Math.ceil(T / 8 / 60) * 60);
  for (let t = 0; t <= T; t += step) s += `<text x="${X(t).toFixed(1)}" y="${h - pb + 14}" fill="#8b95a7" font-size="10" text-anchor="middle">${mmss(t)}</text>`;
  const ev = r.events, ey = h - pb + 24;
  s += `<line x1="${pl}" x2="${w - pr}" y1="${ey}" y2="${ey}" stroke="#262f3f"/>`;
  if (ev) for (let i = 0; i < ev.t.length; i++) {
    const k = ev.k[i];
    if (k === SE_ROUND) { const rx = X(ev.t[i]), left = rx > w - 110; s += `<line data-mark="round" x1="${rx.toFixed(1)}" x2="${rx.toFixed(1)}" y1="${pt}" y2="${ey}" stroke="#eef2f6" stroke-dasharray="4 3"/><text x="${(left ? rx - 4 : rx + 4).toFixed(1)}" y="${pt + 12}" fill="#eef2f6" font-size="10" text-anchor="${left ? "end" : "start"}">round complete</text>`; continue; }
    const c = STRIP[k]; if (!c) continue;
    s += `<circle cx="${X(ev.t[i]).toFixed(1)}" cy="${ey}" r="3.5" fill="${c}"><title>${mmss(ev.t[i])} ${esc(evText(r, i))}</title></circle>`;
  }
  for (const c of cols) {
    const d = S[c].map((v, i) => `${i ? "L" : "M"}${X(S.t[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    s += `<path d="${d}" stroke="${COL_COLORS[c]}" stroke-width="2" fill="none"/>`;
  }
  s += `<line class="er-cursor" x1="0" x2="0" y1="${pt}" y2="${h - pb}" stroke="#eef2f6" stroke-opacity="0" />`;
  return `<svg viewBox="0 0 ${w} ${h}" class="er-svg" data-w="${w}" data-pl="${pl}" data-pr="${pr}">${s}</svg>` +
    `<div class="er-legend">${cols.map(c => `<span><b style="color:${COL_COLORS[c]}">■</b> ${esc(COL_NAMES[c])}</span>`).join("")}<span class="er-readout"></span></div>`;
}

/** The sample nearest pixel px of a chart w wide (plot area: the whole width), for the hover readout. */
export function sampleAt(r: BattleRecord, px: number, w: number): Record<Col, number> | null {
  const S = r.samples, n = S?.t.length ?? 0;
  if (!S || !n) return null;
  const i = Math.max(0, Math.min(n - 1, Math.round(fin(px) / Math.max(1, w) * (n - 1))));
  return Object.fromEntries(COLS.map(c => [c, S[c][i] ?? 0])) as Record<Col, number>;
}

function killRows(r: BattleRecord): [string, number, string][] {
  const by = new Map<string, [number, number]>();
  for (const u of r.units) { const v = by.get(u.kind) ?? [0, 0]; by.set(u.kind, [v[0] + 1, v[1] + u.kills]); }
  const rows: [string, number, string][] = [...by].map(([k, [n, kl]]) => [unitPlural(k, n), kl, (C.UNITS as Record<string, { color: string }>)[k]?.color ?? "#94a3b8"]);
  const st = new Map<string, number>(); for (const s of r.strikes) st.set(s.kind, (st.get(s.kind) ?? 0) + s.kills);
  for (const [k, v] of st) rows.push([`${strikeName(k)} (strikes)`, v, (C.ABILITIES as Record<string, { color: string }>)[k]?.color ?? "#facc15"]);
  for (const k of Object.keys(OTHER_NAMES) as OtherKill[]) if (r.other[k]) rows.push([OTHER_NAMES[k], r.other[k], "#64748b"]);
  return rows.filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
}
const kpi = (label: string, value: string, color: string, sub: string, best: boolean) =>
  `<div class="er-kpi"><div class="er-k">${esc(label)}</div><div class="er-v" style="color:${color}">${value}</div><div class="er-d">${sub}${best ? ` · <span class="er-up">new record</span>` : ""}</div></div>`;
export const BROKEN_NAMES: Record<string, string> = { mostSaved: "Most people saved in one battle", mostKills: "Most infected killed in one battle", unitKills: "Most kills by one unit",
  damage: "Biggest damage bill", held: "Longest hold", perM: "Most people saved per $1M", familiesWhole: "Most families out together", city: "Most saved on this city at this difficulty" };

function overview(r: BattleRecord, ctx: TabCtx): string {
  const t = r.totals, b = new Set(ctx.broken.map(x => x.key));
  const lost = Math.max(0, t.people - t.saved - t.refused - t.civKilledByUs);
  const kpis = kpi("Saved", n0(t.saved), "#4ade80", `${pct(t.saved, t.people)} of ${n0(t.people)}`, b.has("mostSaved") || b.has("city")) +
    kpi("Infected killed", n0(t.kills), "#f87171", t.killsAfter ? `${n0(t.killsAfter)} after the round` : `${n0(t.best60)} in the best minute`, b.has("mostKills")) +
    kpi("Damage caused", money(t.damage), "#fb923c", `city ${n0(t.intact)}% intact`, b.has("damage")) +
    kpi("Held", mmss(t.held), "#eef2f6", `after the outbreak · ${n0(t.hordes)} hordes`, b.has("held")) +
    kpi("Lifts flown", n0(t.lifts), "#60a5fa", `${n0(t.liftsAborted)} waved off · ${n0(t.byTrain)} by train`, false) +
    kpi("Spent", money(t.spent), "#facc15", t.perM !== null ? `${n0(t.perM)} saved per $1M` : "nothing spent", b.has("perM"));
  const rows = killRows(r), mx = Math.max(1, ...rows.map(x => x[1]));
  const kills = rows.length ? rows.slice(0, 9).map(([l, v, c]) => bar(l, v, mx, c)).join("") : `<div class="er-empty">No infected killed.</div>`;
  const top = [...r.units].sort((a, z) => z.kills - a.kills)[0];
  const people = stack([["flown out", Math.max(0, t.saved - t.byTrain), "#4ade80"], ["by train", t.byTrain, "#22d3ee"], ["refused", t.refused, "#94a3b8"], ["left behind or lost", lost, "#f87171"], ["killed by us", t.civKilledByUs, "#e879f9"]]);
  const broken = ctx.broken.length ? ctx.broken.map(x => `<div>${esc(BROKEN_NAMES[x.key] ?? x.key)}: <b>${x.key === "held" ? mmss(x.now) : x.key === "damage" ? money(x.now) : n0(x.now)}</b>${x.was !== null ? ` <span class="er-dim">was ${x.key === "held" ? mmss(x.was) : x.key === "damage" ? money(x.was) : n0(x.was)}</span>` : ""}</div>`).join("") : `<div class="er-dim">None this time.</div>`;
  return `<div class="er-kpis">${kpis}</div><div class="er-grid2"><div class="er-panel"><h3>The battle, minute by minute <span>hover for exact numbers</span></h3>${timelineSvg(r, DEFAULT_COLS, 880, 360)}</div>` +
    `<div class="er-panel"><h3>Kills by unit <span>${n0(t.kills)} total</span></h3>${kills}${top && top.kills ? `<div class="er-dim er-mt">Top unit: ${esc(top.label)}, ${n0(top.kills)} kills${t.longShot ? ` · longest sniper shot ${n0(t.longShot)} m` : ""}</div>` : ""}` +
    `<h3 class="er-mt">What happened to the ${n0(t.people)} people</h3>${people}${bevReportHtml(r.bevents ?? [])}${ctx.live ? `<h3 class="er-mt">Records broken</h3><div class="er-records">${broken}</div>` : ""}</div></div>`; // 0.58: a past battle's report has no "broken" list
}

function timeline(r: BattleRecord, ctx: TabCtx): string {
  const cols = ctx.timelineCols?.length ? ctx.timelineCols : DEFAULT_COLS;
  const picks = COLS.filter(c => c !== "t").map(c => `<label><input type="checkbox" data-col="${c}"${cols.includes(c) ? " checked" : ""}> ${esc(COL_NAMES[c])}</label>`).join("");
  const ev = r.events;
  const rows = ev && ev.t.length ? ev.t.map((t, i) => `<tr><td>${mmss(t)}</td><td>${esc(evText(r, i))}</td><td class="er-dim">${[SE_SIRENS, SE_ROUND, SE_KEEP_FIGHTING, SE_GATES_LOCKED].includes(ev.k[i]) ? "" : `${n0(ev.x[i])}, ${n0(ev.y[i])}`}</td></tr>`).join("") : `<tr><td colspan="3" class="er-dim">No events recorded.</td></tr>`;
  return `<div class="er-grid2"><div class="er-panel"><div class="er-picks">${picks}</div>${timelineSvg(r, cols, 880, 380)}</div>` +
    `<div class="er-panel er-scroll"><h3>Every event <span>${n0(ev?.t.length ?? 0)}</span></h3><table><tr><th>Time</th><th>What</th><th>Where</th></tr>${rows}</table></div></div>`;
}

function units(r: BattleRecord): string {
  if (!r.units.length) return `<div class="er-panel er-empty">No units this battle.</div>`;
  const rows = [...r.units].sort((a, b) => b.kills - a.kills).map(u => `<tr><td>${esc(u.label)}</td><td class="n">${n0(u.kills)}</td><td>${mmss(u.placedT)}</td><td style="color:${u.lostT >= 0 ? "#f87171" : "#4ade80"}">${u.lostT >= 0 ? `lost at ${mmss(u.lostT)}` : "came through"}${u.dryS && u.dryS >= 1 ? ` <span style="color:#ffd740">· out of ammo ${mmss(u.dryS)}</span>` : ""}</td></tr>`).join(""); // 0.60
  const rowsK = killRows(r), mx = Math.max(1, ...rowsK.map(x => x[1]));
  return `<div class="er-grid2"><div class="er-panel er-scroll"><h3>Every unit <span>${n0(r.units.length)}</span></h3><table><tr><th>Unit</th><th class="n">Kills</th><th>Placed</th><th>Fate</th></tr>${rows}</table></div>` +
    `<div class="er-panel"><h3>Kills by source</h3>${rowsK.map(([l, v, c]) => bar(l, v, mx, c)).join("") || `<div class="er-empty">No kills.</div>`}</div></div>`;
}

function strikes(r: BattleRecord): string {
  if (!r.strikes.length) return `<div class="er-panel er-empty">No strikes called this battle.</div>`;
  const rows = r.strikes.map(s => `<tr><td>${esc(strikeName(s.kind))}</td><td>${mmss(s.t)}</td><td class="n">${n0(s.kills)}</td><td class="n" style="color:${s.civ ? "#e879f9" : "inherit"}">${n0(s.civ)}</td></tr>`).join("");
  const kills = r.strikes.reduce((a, s) => a + s.kills, 0), civ = r.strikes.reduce((a, s) => a + s.civ, 0);
  return `<div class="er-panel er-scroll"><h3>Every strike <span>${n0(r.strikes.length)} called · ${n0(kills)} infected killed · ${n0(civ)} civilians killed</span></h3><table><tr><th>Strike</th><th>Time</th><th class="n">Infected killed</th><th class="n">Civilians killed</th></tr>${rows}</table></div>`;
}

const TAG_COLORS: Record<string, string> = { "all out": "#4ade80", "made it alone": "#4ade80", "refused, talked out": "#94a3b8", "refused, ran": "#facc15", "refused, lost": "#f87171",
  "lost one": "#facc15", "lost some": "#facc15", "none made it": "#f87171", "killed by our fire": "#f87171" };
function town(r: BattleRecord, ctx: TabCtx): string {
  const tw = r.town;
  if (!tw) return `<div class="er-panel er-empty">No town report for this battle.</div>`;
  const s = tw.summary;
  const fam = stack([["all out", s.allOut, "#4ade80"], ["lost someone", s.lostSome, "#facc15"], ["lost everyone", s.lostAll, "#f87171"]]);
  const place = s.byPlace.map(p => bar(p.place, p.households ? p.allOut / p.households * 100 : 0, 100, "#4ade80", p.households ? `${Math.round(p.allOut / p.households * 100)}%` : "0%")).join("");
  const kv = (l: string, v: string) => `<div class="er-kv"><span>${esc(l)}</span><b>${v}</b></div>`;
  const people = kv("Children fetched from school", n0(s.fetched)) + kv("Children walked out with their class", n0(s.classKids)) +
    kv("Teens who went alone", `${n0(s.teensAlone)} <span class="er-dim">(${n0(s.teensMadeIt)} made it)</span>`) +
    kv("Went back for someone", `${n0(s.wentBack)} <span class="er-dim">(${n0(s.wentBackMadeIt)} made it)</span>`) + kv("Killed by our fire", n0(s.killedByUs));
  const stories = tw.stories.length ? tw.stories.map(st => `<div class="er-story"${ctx.live && st.members.length ? ` data-k="${st.members[0]}"` : ""}><div class="er-sh"><b>${esc(st.title)}</b><span class="er-tag" style="color:${TAG_COLORS[st.tag] ?? "#94a3b8"};border-color:${TAG_COLORS[st.tag] ?? "#94a3b8"}">${esc(st.tag)}</span></div><p>${esc(st.text)}</p></div>`).join("")
    : `<div class="er-dim">No stories were recorded this battle.</div>`;
  const rf = tw.refusers, refT = s.talkedOut + s.ran + s.lostAtHome + s.stillHome;
  const refusers = rf.length ? stack([["talked out", s.talkedOut, "#4ade80"], ["ran", s.ran, "#facc15"], ["lost at home", s.lostAtHome, "#f87171"], ["still home", s.stillHome, "#94a3b8"]]) +
    `<table><tr><th>Household</th><th class="n">Size</th><th>What happened</th></tr>${rf.slice(0, 40).map(x => `<tr><td>${esc(x.name)}</td><td class="n">${n0(x.size)}</td><td style="color:${x.good === true ? "#4ade80" : x.good === false ? "#f87171" : "#facc15"}">${esc(x.what)}</td></tr>`).join("")}${rf.length > 40 ? `<tr><td colspan="3" class="er-dim">${n0(rf.length - 40)} more</td></tr>` : ""}</table>`
    : `<div class="er-dim">Nobody refused to leave.</div>`;
  return `<div class="er-para">${esc(tw.paragraph)}</div><div class="er-grid3"><div class="er-panel"><h3>Families <span>${n0(s.households)} households</span></h3>${fam}<h3 class="er-mt">All out, by where they were</h3>${place}<h3 class="er-mt">People</h3>${people}</div>` +
    `<div class="er-panel er-scroll"><h3>Stories <span>from what happened${ctx.live ? " · click for each person's full log" : ""}</span></h3>${stories}</div>` +
    `<div class="er-panel er-scroll"><h3>Refused to leave <span>${n0(refT)} households</span></h3>${refusers}</div></div>`;
}

function moneyTab(r: BattleRecord): string {
  const t = r.totals, kv = (l: string, v: string) => `<div class="er-kv"><span>${esc(l)}</span><b>${v}</b></div>`;
  return `<div class="er-grid2"><div class="er-panel"><h3>Money over the battle</h3>${timelineSvg(r, ["money", "spent"], 880, 340)}</div><div class="er-panel"><h3>The bill</h3>` +
    kv("Starting budget", money(t.budget)) + kv("Spent", money(t.spent)) + kv("People saved per $1M spent", t.perM !== null ? n0(t.perM) : "nothing spent") +
    kv("Damage to the city", money(t.damage)) + kv("City intact", `${n0(t.intact)}%`) + kv("Units placed", n0(t.unitsPlaced)) + kv("Units lost", n0(t.unitsLost)) +
    kv("Strikes called", n0(t.strikes)) + kv("Bridges blown", n0(t.bridges)) + kv("Tactical nukes", n0(t.nukes)) +
    (r.counters && (r.counters.supplySpent || r.counters.crates) ? kv("Supply", `${money(r.counters.supplySpent)} (${n0(r.counters.crates)} crates, ${n0(r.counters.chinooks)} Chinooks, ${n0(r.counters.waveOffs)} waved off)`) : "") + `</div></div>`; // 0.60
}

export function tabHtml(tab: Tab, r: BattleRecord, ctx: TabCtx): string {
  switch (tab) {
    case "overview": return overview(r, ctx);
    case "timeline": return timeline(r, ctx);
    case "units": return units(r);
    case "strikes": return strikes(r);
    case "town": return town(r, ctx);
    case "money": return moneyTab(r);
    case "heatmap": return ctx.live ? `<div class="er-panel"><h3>Kill heatmap</h3><p class="er-dim">Where your units and strikes killed the infected, drawn over the map.</p><button data-act="heatmap">Show the kill heatmap on the map</button></div>`
      : `<div class="er-panel er-empty">The heatmap is shown only right after a battle.</div>`;
  }
}

export function tabsHtml(cur: Tab, live: boolean): string {
  return TABS.filter(t => t !== "heatmap" || live).map(t => `<button data-tab="${t}" class="er-tab${t === cur ? " on" : ""}">${TAB_NAMES[t]}</button>`).join("");
}
