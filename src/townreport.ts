// 0.57: the town's story for the after-action report: what happened to the households, the refusers, and a dozen
// short stories picked from the people's own logs (people.ts story events). Nothing is invented: a story is told
// only when the events it needs were recorded; counts come from each person's fate, which is always complete.
import type { Sim } from "./sim";
import { SAFE_CIV } from "./sim";
import { hash32, personOf, clockMin, formatClock, EV_EVAC, EV_TURNED, EV_CRUSHED, EV_KILLED_BY_US, EV_FRIENDLY_FIRE, EV_DIED,
  EV_GO_BACK, EV_SAW_TURN, EV_REFUSE, EV_TALKED_OUT, EV_BROKE, EV_FETCH, EV_COLLECTED, EV_SOLO, EV_HOME_WAIT, EV_ZONE_WAIT,
  EV_SAFE, EV_CLASS, FATE_EVAC, FATE_KILLED_BY_US, PL_HOME, PL_WORK, PL_SCHOOL, PLACE_WORDS, isEnding } from "./people";
import type { Places } from "./places";

type Ev = { t: number; code: number; arg: number };
export interface TownInput {
  civN: number; famLead: ArrayLike<number>; famSize: ArrayLike<number>; fate: ArrayLike<number>; refuser: ArrayLike<number>;
  startPlace: ArrayLike<number>; safeAtEnd(k: number): boolean;
  person(k: number): { first: string; last: string; age: number }; story(k: number): Ev[];
  clock(t: number): string; city: string; sirenClock: string;
  streetOf(k: number): string | null; schoolOf(k: number): string | null; zoneName(i: number): string;
}
export type StoryTag = "all out" | "lost one" | "lost some" | "none made it" | "refused, talked out" | "refused, ran" | "refused, lost" | "made it alone" | "killed by our fire";
export interface TownStory { title: string; tag: StoryTag; text: string; members: number[] }
export interface TownSummary {
  households: number; allOut: number; lostSome: number; lostAll: number;
  refusedHouseholds: number; talkedOut: number; ran: number; lostAtHome: number; stillHome: number;
  byPlace: { place: string; households: number; allOut: number }[];
  fetched: number; classKids: number; teensAlone: number; teensMadeIt: number; wentBack: number; wentBackMadeIt: number; killedByUs: number;
}
export interface TownRefuser { name: string; size: number; what: string; good: boolean | null }
export interface TownReport { paragraph: string; summary: TownSummary; stories: TownStory[]; refusers: TownRefuser[] }

const MAX_STORIES = 12, MAX_PER_TAG = 4, MAX_PER_KIND = 3; // kind: what the story is about (went back, fetched, alone...)
const MADE: StoryTag[] = ["all out", "made it alone", "refused, talked out"];
const LOST: StoryTag[] = ["none made it", "lost one", "lost some", "killed by our fire", "refused, lost"];
const n0 = (v: number) => v.toLocaleString("en-US");

export function townInputFromSim(sim: Sim, places: Places, city: string): TownInput {
  const seed = sim.seed, at = (k: number) => Math.floor(sim.ay[k]) * sim.w + Math.floor(sim.ax[k]);
  const schoolIdx = new Map<number, number>(sim.schools.map((c, i) => [c, i]));
  return {
    civN: sim.civN, famLead: sim.famLead, famSize: sim.famSize, fate: sim.fate, refuser: sim.refuser, startPlace: sim.dayPlace,
    safeAtEnd: k => sim.state[k] === SAFE_CIV,
    person: k => personOf(seed, k, sim.famLead[k], sim.famSize[k]), story: k => sim.storyOf(k),
    clock: t => formatClock(clockMin(sim.startMin, t)), city, sirenClock: formatClock(clockMin(sim.startMin, 0)),
    streetOf: k => places.streetNear(at(k)),
    schoolOf: k => { const c = sim.schoolCell[k], i = schoolIdx.get(c); return i === undefined ? null : places.school(i); },
    zoneName: i => `Zone ${i + 1}`,
  };
}

export function buildTownReport(inp: TownInput, seed: number): TownReport {
  const { civN, famLead, famSize, fate, refuser } = inp;
  const made = (k: number) => fate[k] === FATE_EVAC || (fate[k] === 0 && inp.safeAtEnd(k));
  const storyCache = new Map<number, Ev[]>();
  const story = (k: number) => { let s = storyCache.get(k); if (!s) storyCache.set(k, s = inp.story(k)); return s; };
  const has = (k: number, code: number) => story(k).find(e => e.code === code);
  const name = (k: number) => inp.person(k).first;
  const ending = (k: number) => story(k).find(e => isEnding(e.code));
  /** What became of k, as a sentence ending (no subject). null when the log cannot say and the state cannot either. */
  const fateOf = (k: number): string | null => {
    const e = ending(k);
    if (e) {
      const t = inp.clock(e.t);
      switch (e.code) {
        case EV_EVAC: return e.arg === 1 ? `left on an evacuation train at ${t}` : `was flown out at ${t}`;
        case EV_TURNED: return `was bitten and turned at ${t}`;
        case EV_CRUSHED: return `was crushed in the crowd at ${t}`;
        case EV_KILLED_BY_US: return `was killed by our fire at ${t}`;
        case EV_FRIENDLY_FIRE: return `was shot by another civilian at ${t}`;
        case EV_DIED: return `died at ${t}`;
      }
    }
    if (fate[k] === 0) return inp.safeAtEnd(k) ? "was safe in the zone when it ended" : "was still in the city when it ended";
    return null;
  };

  const sum: TownSummary = { households: 0, allOut: 0, lostSome: 0, lostAll: 0, refusedHouseholds: 0, talkedOut: 0, ran: 0, lostAtHome: 0, stillHome: 0,
    byPlace: [], fetched: 0, classKids: 0, teensAlone: 0, teensMadeIt: 0, wentBack: 0, wentBackMadeIt: 0, killedByUs: 0 };
  const place = { together: [0, 0], split: [0, 0], away: [0, 0] };
  const cands: { score: number; jitter: number; kind: string; story: TownStory }[] = [];
  const refusers: TownRefuser[] = [];
  let home = 0, adults = 0, atWork = 0, kids = 0, atSchool = 0;

  for (let a = 0; a < civN;) {
    const lead = famLead[a], b = lead >= 0 ? Math.min(civN, lead + famSize[lead]) : a + 1;
    const mem: number[] = []; for (let k = a; k < b; k++) mem.push(k);
    a = b;
    sum.households++;
    const nMade = mem.filter(made).length, size = mem.length, last = inp.person(mem[0]).last;
    const hTag: StoryTag = nMade === size ? "all out" : nMade === 0 ? "none made it" : size - nMade === 1 ? "lost one" : "lost some";
    if (nMade === size) sum.allOut++; else if (nMade === 0) sum.lostAll++; else sum.lostSome++;
    const places = new Set(mem.map(k => inp.startPlace[k]));
    const pk = places.size > 1 ? "split" : places.has(PL_HOME) ? "together" : "away";
    place[pk][0]++; if (nMade === size) place[pk][1]++;
    for (const k of mem) {
      const p = inp.person(k), sp = inp.startPlace[k];
      if (sp === PL_HOME) home++;
      if (p.age >= 18 && p.age < 65) { adults++; if (sp === PL_WORK) atWork++; }
      if (p.age >= 5 && p.age <= 17) { kids++; if (sp === PL_SCHOOL) atSchool++; }
      if (fate[k] === FATE_KILLED_BY_US) sum.killedByUs++;
    }
    const title = size > 1 ? `The ${last} family (${size})` : `${name(mem[0])} ${last}, ${inp.person(mem[0]).age}`;
    const jitter = hash32(seed, mem[0], 0x70e1);
    const add = (score: number, tag: StoryTag, text: string, kind: string) => cands.push({ score, jitter, kind, story: { title, tag, text, members: mem } });
    const allLine = () => { // the household's ending in one sentence, or null when someone's fate is unknown
      const parts = mem.map(k => ({ k, f: fateOf(k) }));
      if (parts.some(p => !p.f)) return null;
      if (size === 1) return `${name(mem[0])} ${parts[0].f}.`;
      if (parts.every(p => p.f === parts[0].f)) return `All ${size} ${parts[0].f!.replace(/^was /, "were ")}.`;
      return parts.map(p => `${name(p.k)} ${p.f}.`).join(" ");
    };

    // refusers
    const ref = mem.filter(k => refuser[k] > 0);
    if (ref.length) {
      sum.refusedHouseholds++;
      const r0 = ref[0], code = refuser[r0];
      let what: string, good: boolean | null;
      if (code === 2) { sum.talkedOut++; const e = has(r0, EV_TALKED_OUT); what = `talked out${e ? " at " + inp.clock(e.t) : ""}`; good = true; }
      else if (code === 3) { sum.ran++; const e = has(r0, EV_BROKE); what = `ran${e ? " at " + inp.clock(e.t) : ""}, ${nMade === 0 ? (size === 1 ? "did not make it" : "none made it") : nMade === size ? (size === 1 ? "made it" : "all made it") : `${nMade} made it`}`; good = nMade === size ? true : nMade === 0 ? false : null; }
      else if (ref.every(k => fate[k] === 0 && !made(k))) { sum.stillHome++; what = "still home when it ended"; good = null; }
      else { sum.lostAtHome++; const e = ending(r0); what = `lost at home${e ? " at " + inp.clock(e.t) : ""}`; good = false; }
      refusers.push({ name: last, size, what, good });
      const refE = has(r0, EV_REFUSE), talk = has(r0, EV_TALKED_OUT), ran = has(r0, EV_BROKE), line = allLine();
      const who = size > 1 ? `The ${last} family` : name(r0);
      if (refE && talk && line) add(8, "refused, talked out", `${who} refused to leave: home felt safer. Soldiers talked ${size > 1 ? "them" : name(r0)} out at ${inp.clock(talk.t)}. ${line}`, "talked");
      else if (refE && ran && line) add(6, nMade ? "refused, ran" : "refused, lost", `${who} refused to leave. At ${inp.clock(ran.t)} ${size > 1 ? "they" : name(r0)} saw the infected and ran. ${line}`, "ran");
      else if (refE && code === 1 && nMade === 0 && line && mem.every(k => ending(k))) add(7, "refused, lost", `${who} refused to leave and stayed home. ${line}`, "stayed");
      continue; // one story per household: a refusing household's story is about refusing
    }

    // went back for someone who turned
    for (const k of mem) {
      const g = has(k, EV_GO_BACK); if (!g) continue;
      sum.wentBack++; if (made(k)) sum.wentBackMadeIt++;
      const saw = story(k).find(e => e.code === EV_SAW_TURN && e.arg === g.arg) ?? g, f = fateOf(k);
      if (f && g.arg >= 0 && g.arg < civN) {
        const st = inp.streetOf(g.arg);
        add(9, hTag, `${name(k)} saw ${name(g.arg)} turn${st ? " on " + st : ""} at ${inp.clock(saw.t)} and went back for ${name(g.arg)}. ${name(k)} ${f}.`, "wentBack");
      }
    }
    // fetched a child from school
    for (const k of mem) {
      const fe = has(k, EV_FETCH), co = fe && story(k).find(e => e.code === EV_COLLECTED && e.arg === fe.arg);
      if (!fe || !co) continue;
      sum.fetched++;
      const line = allLine(); if (!line || fe.arg < 0 || fe.arg >= civN) continue;
      const school = inp.schoolOf(fe.arg), from = PLACE_WORDS[inp.startPlace[k]]?.replace(/^at |^on |^out in /, "") ?? "work";
      const safe = has(k, EV_SAFE);
      add(7, hTag, `${name(k)} left ${from === "home" ? "home" : from} at ${inp.clock(fe.t)} to fetch ${name(fe.arg)} from ${school ?? "school"}. ${name(k)} picked up ${name(fe.arg)} at ${inp.clock(co.t)}${safe ? ` and reached ${inp.zoneName(safe.arg)} at ${inp.clock(safe.t)}` : ""}. ${line}`, "fetch");
    }
    for (const k of mem) if (has(k, EV_CLASS)) sum.classKids++;
    // a teen who went alone
    for (const k of mem) {
      const so = has(k, EV_SOLO); if (!so) continue;
      sum.teensAlone++; if (made(k)) sum.teensMadeIt++;
      const f = fateOf(k); if (!f) continue;
      const p = inp.person(k), safe = has(k, EV_SAFE);
      cands.push({ score: 6, jitter, kind: "alone", story: { title: `${p.first} ${p.last}, ${p.age}`, tag: made(k) ? "made it alone" : hTag, members: [k],
        text: `${p.first} headed for the zone alone at ${inp.clock(so.t)}.${safe ? ` ${p.first} reached ${inp.zoneName(safe.arg)} at ${inp.clock(safe.t)}.` : ""} ${p.first} ${f}.` } });
    }
    // killed by our own fire
    for (const k of mem) {
      const e = has(k, EV_KILLED_BY_US); if (!e) continue;
      const p = inp.person(k), st = inp.streetOf(k);
      cands.push({ score: 5, jitter, kind: "ourFire", story: { title: `${p.first} ${p.last}, ${p.age}`, tag: "killed by our fire", members: [k],
        text: `${p.first} was killed by our fire${st ? " on " + st : ""} at ${inp.clock(e.t)}.` } });
    }
    if (size >= 2) {
      const line = allLine();
      if (nMade === 0 && line && mem.every(k => ending(k))) add(8, "none made it", `${line} None of the family made it out.`, "lostAll");
      else if (hTag === "lost one" && line) add(6, "lost one", line, "lostOne");
      else if (nMade === size && line && mem.some(k => has(k, EV_HOME_WAIT) || has(k, EV_ZONE_WAIT)))
        add(4, "all out", `The family was split up when the sirens went and met ${mem.some(k => has(k, EV_HOME_WAIT)) ? "at home" : "in the zone"}. ${line}`, "split");
    }
  }

  sum.byPlace = [["Together at home", place.together], ["Split up", place.split], ["All away from home", place.away]]
    .map(([p, v]) => ({ place: p as string, households: (v as number[])[0], allOut: (v as number[])[1] }));

  // pick: one story per household, at most MAX_PER_TAG per tag, at least 2 each of made it / lost / refused when they exist
  cands.sort((x, y) => y.score - x.score || x.jitter - y.jitter);
  const picked: typeof cands = [], seen = new Set<number>(), perTag = new Map<StoryTag, number>(), perKind = new Map<string, number>();
  const take = (c: (typeof cands)[number]) => {
    const h = c.story.members[0], first = famLead[h] >= 0 ? famLead[h] : h;
    if (picked.length >= MAX_STORIES || seen.has(first) || (perTag.get(c.story.tag) ?? 0) >= MAX_PER_TAG || (perKind.get(c.kind) ?? 0) >= MAX_PER_KIND) return false;
    seen.add(first); perTag.set(c.story.tag, (perTag.get(c.story.tag) ?? 0) + 1); perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1); picked.push(c); return true;
  };
  for (const group of [MADE, LOST, ["refused, talked out", "refused, ran", "refused, lost"] as StoryTag[]]) {
    let n = 0; for (const c of cands) if (n < 2 && group.includes(c.story.tag) && take(c)) n++;
  }
  for (const c of cands) take(c);
  picked.sort((x, y) => y.score - x.score || x.jitter - y.jitter);

  // the paragraph
  const placeLine = adults && kids && atWork / adults > 0.5 && atSchool / kids > 0.5 ? "Most adults were at work and most children at school when the sirens went."
    : home / Math.max(1, civN) > 0.5 ? "Most people were at home when the sirens went." : "People were spread across town when the sirens went.";
  let paragraph = `${inp.city}, ${inp.sirenClock}. ${placeLine} ${n0(sum.households)} households. ${n0(sum.allOut)} got out together. ${n0(sum.lostSome)} lost someone. ${n0(sum.lostAll)} lost everyone.`;
  if (sum.refusedHouseholds) {
    paragraph += ` ${n0(sum.refusedHouseholds)} households refused to leave: soldiers talked ${n0(sum.talkedOut)} of them out, ${n0(sum.ran)} ran when the infected came, ${n0(sum.lostAtHome)} were lost at home.`;
    if (sum.stillHome) paragraph += ` ${n0(sum.stillHome)} ${sum.stillHome === 1 ? "was" : "were"} still home when it ended.`;
  }
  return { paragraph, summary: sum, stories: picked.map(c => c.story), refusers };
}
