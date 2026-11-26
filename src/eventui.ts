// 0.62: Battle Events, what the player sees: the card under the top bar and the block in the after-action report.
// Pure: HTML strings only (main.ts places them).
import type { BevEvent } from "./events";
import { bevGoal, bevReward } from "./events";
import type { BevOutcome } from "./stats";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const mss = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const money = (v: number) => `$${(v / 1e6).toFixed(1)}M`;
/** "+4 score, $4.0M, +120 XP" for a win, "-5 score" for a loss (numbers as the event paid them). */
export function bevWorth(o: { won: boolean; score: number; cash: number; xp: number }): string {
  const sc = Math.round(o.score * 10) / 10;
  return o.won ? `+${sc} score, ${money(o.cash)}, +${o.xp} XP` : `${sc} score`;
}

/** The card while an event runs (and for a moment after it ends). place: the street near it ("" when unknown). */
export function bevCardHtml(e: BevEvent, now: number, place: string): string {
  const where = place ? `<div class="bev-where">Near ${esc(place)}</div>` : "";
  let status: string;
  if (e.state === "won" || e.state === "lost") { // (0.62.1: the points come from the config, so mods show right)
    const won = e.state === "won", sc = bevWorth({ won, score: bevReward(e.kind, won, e.frac, 1, 1).score, cash: 0, xp: 0 }).split(",")[0];
    status = `<div class="bev-out ${e.state}">${won ? "Done" : "Failed"}. ${sc}</div>`;
  }
  else if (e.endT === null) status = `<div class="bev-clock">Hold until the round ends</div>`;
  else if (e.reached) status = `<div class="bev-clock">Reached: they are on their way to the zone</div>`;
  else status = `<div class="bev-clock">${mss(e.endT - now)} left to reach them</div>`;
  return `<div class="bev-head">BATTLE EVENT</div><div class="bev-title">${esc(e.title)}</div>${where}<div class="bev-goal">${esc(bevGoal(e.kind))}</div>${status}` +
    (e.state === "live" ? `<button data-bev="go">Go there</button>` : "");
}

/** 0.62: the event the card shows: a live one with a countdown, else one that ended in the last 8 s (endedT: when
 *  the latest one ended), else the live power station. */
export function bevPick(events: BevEvent[], now: number, endedT: number): BevEvent | null {
  const live = events.find(e => e.state === "live" && e.kind !== "power"); if (live) return live;
  let last: BevEvent | null = null;
  for (const e of events) if (e.alertT !== null && (e.state === "won" || e.state === "lost") && (!last || e.alertT > last.alertT!)) last = e;
  if (last && now - endedT < 8) return last;
  return events.find(e => e.state === "live") ?? null;
}

/** The "Battle events" block in the after-action Overview (empty when the battle had none). */
export function bevReportHtml(list: BevOutcome[]): string {
  if (!list.length) return "";
  const rows = list.map(o => `<div class="er-row"><span>${esc(o.title)}</span><b style="color:${o.won ? "#4ade80" : "#f87171"}">${o.won ? "Won" : "Lost"}</b><span class="er-dim">${esc(bevWorth(o))}</span></div>`).join("");
  return `<h3 class="er-mt">Battle events</h3>${rows}`;
}
