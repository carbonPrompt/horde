// 0.47: Codex pages for every unit, ability and support building, built from config so a rebalance updates the
// Codex with no text edit. Keys are prefixed ("unit-police" vs "support-police") because some names are shared.
import * as C from "./config";
import type { CodexEntry } from "./codex";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const m = (cells: number) => `${+(cells * C.CELL_M).toFixed(1)} m`;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(x => x.trim()); // "3.5 s" has no space after the dot
/** The first sentence that says what it does (skips "Click a spot." and "LAST RESORT."). */
const whatItDoes = (s: string) => sentences(s).find(x => !/^(Click|LAST RESORT)/.test(x)) ?? s;
const short = (s: string) => s.length <= 120 ? s : s.slice(0, 117).replace(/\s+\S*$/, "") + "...";
const VER = "0.47.0";

export function statEntries(): CodexEntry[] {
  const out: CodexEntry[] = [];
  for (const k of Object.keys(C.UNITS) as C.UnitKind[]) {
    const s = C.UNITS[k], i = C.UNIT_INFO[k];
    out.push({ id: "unit-" + k, section: "units", title: s.name, summary: short(i.role), body: [i.desc, ...i.specials].join("\n\n"),
      stats: "unit-" + k, since: VER, updated: k === "garrison" || k === "sniper" ? "0.50.0" : k === "para" ? "0.49.0" : VER }); // 0.49: squads; 0.50: Troops, mobile Snipers
  }
  for (const k of Object.keys(C.ABILITIES) as C.AbilityKind[]) {
    const a = C.ABILITIES[k];
    out.push({ id: "ability-" + k, section: "strikes", title: a.name, summary: short(whatItDoes(a.hint)), body: a.hint,
      stats: "ability-" + k, since: VER, updated: VER });
  }
  for (const k of C.SUPPORT_KINDS) {
    const s = C.SUPPORTS[k], i = C.SUPPORT_INFO[k];
    out.push({ id: "support-" + k, section: "support", title: s.name, summary: short(i.role), body: [s.hint, i.effect, ...i.specials].join("\n\n"),
      stats: "support-" + k, since: VER, updated: VER });
  }
  return out;
}

const PLACED: Record<C.UnitSpec["on"], string> = { building: "Rooftop", ground: "Street or park", water: "River or canal", zone: "Inside a safe zone", any: "Anywhere" };

/** Label/value rows for an entry's stats key ("unit-sniper", "ability-moab", "support-radio"); [] when unknown. */
export function statRows(key: string): [string, string][] {
  const [kind, ...rest] = key.split("-"), k = rest.join("-");
  if (kind === "unit" && k in C.UNITS) {
    const s = C.UNITS[k as C.UnitKind];
    const rows: [string, string][] = [["Cost", money(s.cost)], ["Placed on", s.roof ? "Street, park or rooftop" : PLACED[s.on]],
      ["Range", `${s.minRange ? m(s.minRange) + " to " : ""}${m(s.range)}${s.roofBonus ? ` (+${m(s.roofBonus)} per floor)` : ""}`],
      ["Damage", s.damage.toLocaleString("en-US") + (s.splash ? ` (${m(s.splash)} blast)` : "")],
      ["Fire rate", `${s.rate} per s`],
      ["Ammo", s.ammo === Infinity ? "Unlimited" : s.ammo.toLocaleString("en-US") + (s.reloadsInZone ? " (unlimited in the zone)" : "")],
      ["Setup time", `${s.deploy} s`]];
    const squad = k === "garrison" ? "4 soldiers, one fortified squad per building" : k === "sniper" ? "Sniper + spotter, one team per building" : k === "para" ? "5 soldiers" : ""; // 0.49
    if (squad) rows.splice(1, 0, ["Squad", squad]);
    if (s.mobile) rows.push(["Armor", s.mobile.hp === Infinity ? "Can't be hit" : `${s.mobile.hp} HP`], ["Speed", `${+(s.mobile.speed * C.CELL_M).toFixed(1)} m/s`]);
    else if (s.hp) rows.push(["Armor", `${s.hp} HP`]);
    return rows;
  }
  if (kind === "ability" && k in C.ABILITIES) {
    const a = C.ABILITIES[k as C.AbilityKind];
    return [["Cost", money(a.cost)], ["Per battle", String(a.max)], ["Arrives after", `${a.delay} s`]];
  }
  if (kind === "support" && (C.SUPPORT_KINDS as string[]).includes(k)) {
    const s = C.SUPPORTS[k as C.SupportKind];
    return [["Cost", money(s.cost)], ["Radius", m(s.radius)], ["Setup time", `${s.deploy} s`]];
  }
  return [];
}
