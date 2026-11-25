import { expect, test } from "bun:test";
import { buildTownReport, type TownInput } from "../src/townreport";
import { EV_GO_BACK, EV_SAW_TURN, EV_TURNED, EV_EVAC, EV_REFUSE, EV_TALKED_OUT, EV_FETCH, EV_COLLECTED, EV_SOLO, EV_SAFE,
  FATE_EVAC, FATE_TURNED, FATE_KILLED_BY_US, EV_KILLED_BY_US, PL_HOME, PL_WORK, PL_SCHOOL } from "../src/people";

type Ev = { t: number; code: number; arg: number };
interface P { first: string; last: string; age: number; fate?: number; refuser?: number; place?: number; safe?: boolean; story?: Ev[] }
/** households: each an array of people; the first is the lead (a household of one has lead -1). */
function input(households: P[][], over: Partial<TownInput> = {}): TownInput {
  const ps: P[] = [], lead: number[] = [];
  for (const h of households) { const l = h.length > 1 ? ps.length : -1; for (const p of h) { lead.push(l); ps.push(p); } }
  const size = ps.map((_, k) => lead[k] >= 0 ? households.find(h => h.includes(ps[k]))!.length : 1);
  return {
    civN: ps.length, famLead: lead, famSize: size, fate: ps.map(p => p.fate ?? 0), refuser: ps.map(p => p.refuser ?? 0),
    startPlace: ps.map(p => p.place ?? PL_HOME), safeAtEnd: (k: number) => !!ps[k].safe,
    person: (k: number) => ps[k], story: (k: number) => ps[k].story ?? [],
    clock: (t: number) => { const m = 600 + Math.floor(t / 60); return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} AM`; },
    city: "Fairhaven", sirenClock: "10:00 AM", streetOf: () => null, schoolOf: () => null, zoneName: (i: number) => `Zone ${i + 1}`,
    ...over,
  };
}
const evac = (t: number): Ev => ({ t, code: EV_EVAC, arg: 0 });
const turned = (t: number): Ev => ({ t, code: EV_TURNED, arg: 0 });
const three = () => input([
  [{ first: "Rosa", last: "Alvarez", age: 41, fate: FATE_EVAC, story: [evac(1860)] }, { first: "Mateo", last: "Alvarez", age: 9, fate: FATE_EVAC, story: [evac(1860)] }],
  [{ first: "Linh", last: "Nguyen", age: 80, fate: FATE_TURNED, story: [turned(1740)] }, { first: "Tam", last: "Nguyen", age: 50, fate: FATE_EVAC, story: [evac(2640)] }],
  [{ first: "Karen", last: "Brooks", age: 44, fate: FATE_TURNED, story: [turned(2400)] }, { first: "Emma", last: "Brooks", age: 12, fate: FATE_TURNED, story: [turned(1440)] }],
]);

test("household outcomes from fates", () => {
  const r = buildTownReport(three(), 7);
  expect(r.summary.households).toBe(3);
  expect(r.summary.allOut).toBe(1); expect(r.summary.lostSome).toBe(1); expect(r.summary.lostAll).toBe(1);
});

test("people safe in a zone at the end count as made it", () => {
  const r = buildTownReport(input([[{ first: "A", last: "B", age: 30, safe: true }]]), 1);
  expect(r.summary.allOut).toBe(1);
});

test("refuser outcomes", () => {
  const r = buildTownReport(input([
    [{ first: "Harold", last: "Simmons", age: 81, refuser: 2, fate: FATE_EVAC, story: [{ t: 0, code: EV_REFUSE, arg: 0 }, { t: 2220, code: EV_TALKED_OUT, arg: 0 }, evac(3120)] }],
    [{ first: "Ann", last: "Patel", age: 60, refuser: 3, fate: FATE_EVAC }],
    [{ first: "Joe", last: "Kowalski", age: 70, refuser: 1, fate: FATE_TURNED }],
    [{ first: "Sue", last: "Hughes", age: 75, refuser: 1 }],
  ]), 3);
  expect(r.summary.refusedHouseholds).toBe(4);
  expect([r.summary.talkedOut, r.summary.ran, r.summary.lostAtHome, r.summary.stillHome]).toEqual([1, 1, 1, 1]);
  expect(r.refusers.map(x => x.name).sort()).toEqual(["Hughes", "Kowalski", "Patel", "Simmons"]);
  expect(r.refusers.find(x => x.name === "Simmons")!.what).toContain("talked out");
});

test("went-back story uses real names and times", () => {
  const r = buildTownReport(input([[
    { first: "David", last: "Brooks", age: 45, fate: FATE_TURNED, story: [{ t: 1440, code: EV_SAW_TURN, arg: 1 }, { t: 1445, code: EV_GO_BACK, arg: 1 }, turned(1500)] },
    { first: "Emma", last: "Brooks", age: 12, fate: FATE_TURNED, story: [turned(1440)] },
  ]]), 7);
  const s = r.stories.find(x => x.text.includes("went back"))!;
  expect(s).toBeDefined();
  expect(s.text).toContain("David"); expect(s.text).toContain("Emma"); expect(s.text).toContain("10:24 AM");
  expect(s.tag).toBe("none made it");
});

test("fetch-from-school story names the school when known", () => {
  const r = buildTownReport(input([[
    { first: "Rosa", last: "Alvarez", age: 41, place: PL_WORK, fate: FATE_EVAC, story: [{ t: 120, code: EV_FETCH, arg: 1 }, { t: 600, code: EV_COLLECTED, arg: 1 }, { t: 1140, code: EV_SAFE, arg: 1 }, evac(1860)] },
    { first: "Mateo", last: "Alvarez", age: 9, place: PL_SCHOOL, fate: FATE_EVAC, story: [evac(1860)] },
  ]], { schoolOf: () => "Lincoln Elementary School" }), 7);
  const s = r.stories.find(x => x.text.includes("Lincoln Elementary School"))!;
  expect(s.text).toContain("Mateo"); expect(s.tag).toBe("all out");
});

test("same seed, same stories; mix rule holds", () => {
  const hs: P[][] = [];
  for (let i = 0; i < 30; i++) hs.push([{ first: "T" + i, last: "Solo" + i, age: 16, fate: i % 3 ? FATE_EVAC : FATE_TURNED, story: [{ t: 10, code: EV_SOLO, arg: 0 }, i % 3 ? evac(900) : turned(800)] }]);
  for (let i = 0; i < 10; i++) hs.push([{ first: "R" + i, last: "Ref" + i, age: 70, refuser: 2, fate: FATE_EVAC, story: [{ t: 0, code: EV_REFUSE, arg: 0 }, { t: 600, code: EV_TALKED_OUT, arg: 0 }, evac(1200)] }]);
  const a = buildTownReport(input(hs), 11), b = buildTownReport(input(hs), 11);
  expect(a).toEqual(b);
  expect(a.stories.length).toBeLessThanOrEqual(12);
  const tags = a.stories.map(s => s.tag);
  for (const t of new Set(tags)) expect(tags.filter(x => x === t).length).toBeLessThanOrEqual(4);
  expect(tags.some(t => t.startsWith("refused"))).toBe(true);
  expect(tags.some(t => t === "made it alone")).toBe(true);
});

test("capped log still reports counts and skips untold stories", () => {
  const inp = three(); inp.story = () => [];
  const r = buildTownReport(inp, 7);
  expect(r.summary.allOut).toBe(1); expect(r.summary.lostAll).toBe(1);
  expect(r.stories.length).toBe(0);
  expect(r.paragraph).toContain("3 households");
});

test("killed-by-our-fire story, no street clause and no undefined when there is no street", () => {
  const r = buildTownReport(input([[{ first: "Marcus", last: "Reed", age: 34, fate: FATE_KILLED_BY_US, story: [{ t: 1980, code: EV_KILLED_BY_US, arg: 0 }] }]]), 1);
  const s = r.stories.find(x => x.tag === "killed by our fire")!;
  expect(s.text).toContain("10:33 AM");
  expect(s.text).not.toContain(" on null"); expect(JSON.stringify(r)).not.toContain("undefined");
});

test("street clause appears when the street is known", () => {
  const r = buildTownReport(input([[{ first: "Marcus", last: "Reed", age: 34, fate: FATE_KILLED_BY_US, story: [{ t: 1980, code: EV_KILLED_BY_US, arg: 0 }] }]], { streetOf: () => "Elm Avenue" }), 1);
  expect(r.stories[0].text).toContain("on Elm Avenue");
});

test("paragraph exact text", () => {
  expect(buildTownReport(three(), 7).paragraph).toBe("Fairhaven, 10:00 AM. Most people were at home when the sirens went. 3 households. 1 got out together. 1 lost someone. 1 lost everyone.");
});

test("paragraph adds the refusers sentence", () => {
  const r = buildTownReport(input([[{ first: "S", last: "H", age: 75, refuser: 1 }], [{ first: "J", last: "K", age: 70, refuser: 2, fate: FATE_EVAC }]]), 1);
  expect(r.paragraph).toContain("2 households refused to leave: soldiers talked 1 of them out, 0 ran when the infected came, 0 were lost at home. 1 was still home when it ended.");
});

test("no em-dash in any output", () => {
  expect(JSON.stringify(buildTownReport(three(), 7))).not.toContain("—");
});

test("no more than 3 stories of one kind (variety)", () => {
  const hs: P[][] = [];
  for (let i = 0; i < 10; i++) hs.push([
    { first: "A" + i, last: "Fam" + i, age: 40, fate: FATE_TURNED, story: [{ t: 100, code: EV_SAW_TURN, arg: 0 }, { t: 101, code: EV_GO_BACK, arg: 0 }, turned(200)] },
    { first: "B" + i, last: "Fam" + i, age: 10, fate: FATE_TURNED, story: [turned(90)] }]);
  // fix the arg to point at each household's child
  let k = 0; for (const h of hs) { h[0].story![0].arg = k + 1; h[0].story![1].arg = k + 1; k += 2; }
  for (let i = 0; i < 6; i++) hs.push([{ first: "T" + i, last: "Solo" + i, age: 16, fate: FATE_EVAC, story: [{ t: 10, code: EV_SOLO, arg: 0 }, evac(900)] }]);
  const r = buildTownReport(input(hs), 5);
  expect(r.stories.filter(s => s.text.includes("went back")).length).toBe(3);
});

test("a lone refuser who ran and died reads 'did not make it'", () => {
  const r = buildTownReport(input([[{ first: "Joe", last: "Smith", age: 70, refuser: 3, fate: FATE_TURNED }]]), 1);
  expect(r.refusers[0].what).toContain("did not make it");
});
