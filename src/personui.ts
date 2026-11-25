// 0.39: the person window. Everything about one person, built as HTML from the sim (reads only, never writes).
import * as C from "./config";
import { Sim, CIV, INF, SAFE_CIV } from "./sim";
import { PARK, INFRA_STATION } from "./map";
import type { Places } from "./places";
import { personOf, storyLine, clockMin, formatClock, EV_EVAC, PLACE_WORDS, PL_HOME, PLAN_GATHER, PLAN_HOME_WAIT, PLAN_MEET, PLAN_FOLLOW, PLAN_CLASS, PLAN_REFUSE, PLAN_GO_BACK, FATE_EVAC, FATE_TURNED, FATE_CRUSHED, FATE_KILLED_BY_US, FATE_FRIENDLY_FIRE, type Person } from "./people";

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Who person k is, or null when k isn't one of the starting people. */
export function personAt(sim: Sim, k: number): Person | null {
  if (k < 0 || k >= sim.civN) return null;
  return personOf(sim.seed, k, sim.famLead[k], sim.famSize[k]);
}
export function fullName(p: Person): string { return `${p.first} ${p.last}`; }

/** Their state right now, in words, and a color for it. */
export function personState(sim: Sim, k: number): { text: string; color: string } {
  const f = sim.fate[k], st = sim.state[k];
  if (f === FATE_EVAC) return { text: byTrain(sim, k) ? "Left on a train" : "Flown out", color: "#7dd3fc" };
  if (f === FATE_TURNED || st === INF) return { text: "Infected", color: "#f87171" };
  if (f === FATE_CRUSHED) return { text: "Crushed", color: "#f87171" };
  if (f === FATE_KILLED_BY_US) return { text: "Killed by our fire", color: "#f87171" };
  if (f === FATE_FRIENDLY_FIRE) return { text: "Shot by a civilian", color: "#f87171" };
  if (st === SAFE_CIV && sim.dayLife && sim.plan[k] === PLAN_MEET) return { text: planWords(sim, k), color: "#86efac" }; // 0.40: waiting in the zone
  if (st === SAFE_CIV) return { text: `In Zone ${sim.zoneIndexAt(sim.ax[k], sim.ay[k]) + 1}`, color: "#86efac" };
  if (st === CIV) {
    if (sim.phase === "plan") return { text: "Going about the day", color: "#e2e8f0" };
    const pw = planWords(sim, k); // 0.40: a family errand
    if (pw && sim.fear[k] <= 0.6) return { text: pw, color: "#fde68a" };
    return sim.fear[k] > 0.6 ? { text: "Panicking", color: "#fbbf24" } : { text: "Heading for safety", color: "#e2e8f0" };
  }
  return { text: "Dead", color: "#94a3b8" };
}

/** True while k can still be followed (walking or in a zone, round not over for them). */
export function followable(sim: Sim, k: number): boolean {
  return k >= 0 && k < sim.civN && sim.fate[k] === 0 && (sim.state[k] === CIV || sim.state[k] === SAFE_CIV);
}

/** True when k got out on a train (their EV_EVAC carries arg 1). */
function byTrain(sim: Sim, k: number): boolean { return sim.storyOf(k).some(e => e.code === EV_EVAC && e.arg === 1); }

/** 0.40: what k is doing after the alert, in words ("" when just heading for safety). */
export function planWords(sim: Sim, k: number): string {
  if (!sim.dayLife || k < 0 || k >= sim.civN || sim.phase === "plan") return "";
  const first = (m: number) => personAt(sim, m)?.first ?? "family";
  switch (sim.plan[k]) {
    case PLAN_GATHER: return "Going home to gather the family";
    case PLAN_HOME_WAIT: return "Waiting at home for family";
    case PLAN_CLASS: return "Lining up with the class";
    case PLAN_REFUSE: return "Refusing to leave: feels safer at home";
    case PLAN_GO_BACK: return sim.goal[k] >= 0 ? `Going back for ${first(sim.goal[k])}` : "";
    case PLAN_MEET: return "Waiting in the zone for family";
    case PLAN_FOLLOW: return sim.goal[k] >= 0 ? `With ${first(sim.goal[k])}` : "";
  }
  return "";
}

function whereStarted(sim: Sim, k: number, places?: Places): string {
  if (sim.dayLife) { // 0.40; 0.57: home names its street when the map has one
    const w = PLACE_WORDS[sim.dayPlace[k]] ?? "out", st = sim.dayPlace[k] === PL_HOME ? places?.streetNear(sim.homeCell[k]) : null;
    return st ? `${w} on ${st}` : w;
  }
  const c = sim.startCell[k], hc = sim.homeCell[k];
  if (c < 0) return "out";
  // household members stand around the doorstep, so the cells next to home count as home
  if (hc >= 0 && Math.abs((c % sim.w) - (hc % sim.w)) <= 1 && Math.abs(((c / sim.w) | 0) - ((hc / sim.w) | 0)) <= 1) return "at home";
  const t = sim.map.tile[c];
  if (t === PARK) return "at the park";
  if (sim.map.height[c] === INFRA_STATION) return "at the station";
  return "out in town";
}

const ROLE: Record<Person["role"], string> = { head: "Head of household", partner: "Partner", child: "Child", elder: "Grandparent", single: "Lives alone" };

/** The whole window for person k. Family names carry data-k (click to switch); Follow is data-act="follow". */
export function personHtml(sim: Sim, k: number, following = false, places?: Places): string {
  const p = personAt(sim, k);
  if (!p) return `<div class="pw-head"><span class="pw-name">Nobody there</span><button data-act="close" title="Esc">Close</button></div>`;
  const st = personState(sim, k);
  const lead = sim.famLead[k], size = lead >= 0 ? sim.famSize[k] : 1;
  const fam: string[] = [];
  if (lead >= 0) for (let m = lead; m < Math.min(lead + size, sim.civN); m++) {
    if (m === k) continue;
    const q = personAt(sim, m)!, qs = personState(sim, m);
    fam.push(`<a data-k="${m}" title="${esc(qs.text)}"><i style="background:${qs.color}"></i>${esc(q.first)}, ${q.age} <small>${ROLE[q.role].toLowerCase()}</small></a>`);
  }
  const wid = sim.civWep[k] as C.CivWeaponId;
  const wep = wid ? C.CIV_WEAPONS[wid] : null;
  const clock = (t: number) => formatClock(clockMin(sim.startMin, t));
  const lines = [`<li><b>${clock(0)}</b> ${esc(whereStarted(sim, k, places))} when the sirens went off</li>`];
  const nameOf = (m: number) => personAt(sim, m)?.first ?? "family";
  for (const e of sim.storyOf(k)) lines.push(`<li><b>${clock(e.t)}</b> ${esc(storyLine(e.code, e.arg, nameOf))}</li>`);
  if (st.text === "Dead" && sim.fate[k] === 0) lines.push(`<li>died</li>`);
  const canFollow = followable(sim, k);
  return (
    `<div class="pw-head"><span class="pw-name">${esc(fullName(p))}</span><button data-act="close" title="Esc">Close</button></div>` +
    `<div class="pw-sub" style="color:${st.color}">${esc(st.text)}</div>` +
    `<div class="ip-grid">` +
      `<div><span>Age</span><b>${p.age}</b></div><div><span>Sex</span><b>${p.sex === "F" ? "Female" : "Male"}</b></div>` +
      `<div><span>Job</span><b>${esc(p.job)}</b></div><div><span>Home</span><b><a data-act="home">Show</a></b></div>` +
      `<div><span>Role</span><b>${ROLE[p.role]}</b></div>` +
      (wep ? `<div><span>Armed</span><b>${esc(wep.name)} · ${sim.civAmmo[k]} rds</b></div>` : "") +
    `</div>` +
    (fam.length ? `<div class="pw-fam"><span>Family</span>${fam.join("")}</div>` : "") +
    `<ol class="pw-story">${lines.join("")}</ol>` +
    `<button data-act="follow"${canFollow ? "" : " disabled"}>${following && canFollow ? "Following (click to stop)" : "Follow"}</button>`
  );
}

/** One ticker line when a followed person's part in the round ends. */
export function followEndLine(sim: Sim, k: number): string {
  const p = personAt(sim, k);
  if (!p) return "";
  const what: Record<number, string> = {
    [FATE_EVAC]: byTrain(sim, k) ? "left on an evacuation train" : "was flown out", [FATE_TURNED]: "was bitten and turned", [FATE_CRUSHED]: "was crushed in the crowd",
    [FATE_KILLED_BY_US]: "was killed by our fire", [FATE_FRIENDLY_FIRE]: "was shot by another civilian",
  };
  return `${fullName(p)}, ${p.age}, ${what[sim.fate[k]] ?? (sim.state[k] === INF ? "was bitten and turned" : "died")}.`;
}

/** 0.42: the end screen's refuser and accident lines (only what happened). */
export function endStatsLines(r: { refused?: number; refusedLost?: number; talkedOut?: number; broke?: number; civKilledByUs?: number; civFriendlyFire?: number }): string[] {
  const n = (v?: number) => (v ?? 0).toLocaleString(), out: string[] = [];
  const ref = r.refused ?? 0, lost = r.refusedLost ?? 0, talked = r.talkedOut ?? 0, ran = r.broke ?? 0;
  if (ref || lost || talked || ran) {
    const parts = [`${n(ref)} stayed home${lost ? ` (${n(lost)} died there)` : ""}`];
    if (talked) parts.push(`${n(talked)} talked out`);
    if (ran) parts.push(`${n(ran)} ran when the infected came`);
    out.push(`Refused to leave: ${parts.join(" \u00b7 ")}`);
  }
  const us = r.civKilledByUs ?? 0, civ = r.civFriendlyFire ?? 0;
  if (us || civ) out.push(`Killed by accident: ${[us ? `${n(us)} by our fire` : "", civ ? `${n(civ)} by other civilians` : ""].filter(Boolean).join(" \u00b7 ")}`);
  return out;
}
