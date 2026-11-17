// 0.39: every white dot is a person. Who they are (name, age, sex, role, job) is worked out on demand from the map
// seed and their index, so it costs nothing per frame, nothing per person in memory, and the same person comes out
// the same on every replay. Also the time-of-day clock and the story log's event codes and wording.
import * as C from "./config";

// ---------- hashing ----------
/** A uint32 from up to three ints (murmur-style mix). All identity rolls come from here, never from the sim's rng. */
export function hash32(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
/** A float in [0, 1) from the same inputs plus a salt picking which roll this is. */
function u(seed: number, k: number, salt: number): number { return hash32(seed, k, salt) / 4294967296; }

// ---------- clock ----------
/** Minutes since midnight on the clock, [0, 1440). sim.time is real battle seconds; the clock runs CLOCK_MUL x that. */
export function clockMin(startMin: number, simTime: number): number {
  const m = startMin + (simTime * C.CLOCK_MUL) / 60;
  return ((m % 1440) + 1440) % 1440;
}
/** "7:42 AM". */
export function formatClock(min: number): string {
  const t = Math.floor(((min % 1440) + 1440) % 1440);
  const h24 = Math.floor(t / 60), mm = t % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
/** The top bar's clock: time of day, with battle time (m:ss) on hover. */
export function clockSpan(startMin: number, simTime: number): string {
  const m = Math.floor(simTime / 60), sec = Math.floor(simTime % 60);
  return `<span class="clock" title="Battle time ${m}:${String(sec).padStart(2, "0")}">${formatClock(clockMin(startMin, simTime))}</span>`;
}
export type StartId = "rush" | "school" | "evening" | "night";
export const START_CHOICES: { id: StartId; label: string; min: number }[] = [
  { id: "rush", label: "Morning rush", min: 450 },
  { id: "school", label: "School day", min: 600 },
  { id: "evening", label: "Evening", min: 1050 },
  { id: "night", label: "Night", min: 1380 },
];
/** The time picker comes up after choosing a city, except in the tutorial and the title screen's attract mode. */
export function needsTimePick(tutorialActive: boolean, attract: boolean): boolean { return !tutorialActive && !attract; }
/** A random start time (whole minute), the same for the same seed. */
export function randomStart(seed: number): number { return hash32(seed, 0x5157, 7) % 1440; }

// ---------- names ----------
// Common US names, most common first (census and SSA frequency order); picks favor the front of each list.
const FEMALE = ("Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra Margaret Ashley " +
  "Kimberly Emily Donna Michelle Carol Amanda Melissa Deborah Stephanie Dorothy Rebecca Sharon Laura Cynthia Amy Kathleen " +
  "Angela Shirley Brenda Emma Anna Pamela Nicole Samantha Katherine Christine Helen Debra Rachel Carolyn Janet Maria " +
  "Catherine Heather Diane Olivia Julie Joyce Victoria Ruth Virginia Lauren Kelly Christina Joan Evelyn Judith Andrea " +
  "Hannah Megan Cheryl Jacqueline Martha Madison Teresa Gloria Sara Janice Ann Kathryn Abigail Sophia Frances Jean Alice " +
  "Judy Isabella Julia Grace Amber Denise Danielle Marilyn Beverly Charlotte Natalie Theresa Diana Brittany Doris Kayla " +
  "Alexis Lori Marie Paige Rosa Ava Mia Chloe Lily Harper Ella Avery Sofia Camila Aria Scarlett Layla Riley Zoey Nora " +
  "Leah Hazel Violet Aurora Savannah Audrey Brooklyn Bella Claire Skylar Lucy Paisley Everly Caroline Naomi Elena Gabriela " +
  "Ariana Alyssa Monica Erin Tiffany Crystal Vanessa Wendy Paula Yolanda Carmen Lucia Alicia Veronica Leslie Dana").split(" ");
const MALE = ("James Robert John Michael David William Richard Joseph Thomas Christopher Charles Daniel Matthew Anthony Mark " +
  "Donald Steven Andrew Paul Joshua Kenneth Kevin Brian George Timothy Ronald Jason Edward Jeffrey Ryan Jacob Gary " +
  "Nicholas Eric Jonathan Stephen Larry Justin Scott Brandon Benjamin Samuel Gregory Alexander Patrick Frank Raymond Jack " +
  "Dennis Jerry Tyler Aaron Jose Adam Nathan Henry Zachary Douglas Peter Kyle Noah Ethan Jeremy Walter Christian Keith " +
  "Roger Terry Austin Sean Gerald Carl Harold Dylan Arthur Lawrence Jordan Jesse Bryan Billy Bruce Gabriel Joe Logan " +
  "Alan Juan Albert Willie Elijah Wayne Randy Vincent Mason Roy Ralph Bobby Russell Bradley Philip Eugene Liam Oliver " +
  "Lucas Aiden Carter Owen Wyatt Luke Grayson Levi Isaac Hudson Lincoln Caleb Hunter Connor Eli Landon Colton Jaxon " +
  "Miles Easton Nolan Cameron Evan Luis Carlos Miguel Diego Marcus Victor Travis Shawn Derek Troy Curtis Dale Craig Todd").split(" ");
const LAST = ("Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Gonzalez Wilson " +
  "Anderson Thomas Taylor Whitaker Jackson Martin Lee Perez Thompson White Harris Sanchez Clark Ramirez Lewis Robinson Walker " +
  "Young Allen King Wright Scott Torres Nguyen Hill Flores Green Adams Nelson Baker Hall Rivera Campbell Mitchell Carter " +
  "Roberts Gomez Phillips Evans Turner Diaz Parker Cruz Edwards Collins Reyes Stewart Morris Morales Murphy Cook Rogers " +
  "Gutierrez Ortiz Morgan Cooper Peterson Bailey Reed Kelly Howard Ramos Kim Cox Ward Richardson Watson Brooks Chavez " +
  "Wood James Bennett Gray Mendoza Ruiz Hughes Price Alvarez Castillo Sanders Patel Myers Long Ross Foster Jimenez Powell " +
  "Jenkins Perry Russell Sullivan Bell Coleman Butler Henderson Barnes Gonzales Fisher Vasquez Simmons Romero Jordan " +
  "Patterson Alexander Hamilton Graham Reynolds Griffin Wallace Moreno West Cole Hayes Bryant Herrera Gibson Ellis Tran " +
  "Medina Aguilar Stevens Murray Ford Castro Marshall Owens Harrison Fernandez McDonald Woods Washington Kennedy Wells " +
  "Vargas Henry Chen Freeman Webb Tucker Guzman Burns Crawford Olson Simpson Porter Hunter Gordon Mendez Silva Shaw Snyder " +
  "Mason Dixon Munoz Hunt Hicks Holmes Palmer Wagner Black Robertson Boyd Rose Stone Salazar Fox Warren Mills Meyer Rice " +
  "Schmidt Garza Daniels Ferguson Nichols Stephens Soto Weaver Ryan Gardner Payne Grant Dunn Kelley Spencer Hawkins Arnold " +
  "Pierce Vazquez Hansen Peters Santos Hart Bradley Knight Elliott Cunningham Duncan Armstrong Hudson Carroll Lane Riley " +
  "Andrews Alvarado Ray Delgado Berry Perkins Hoffman Johnston Matthews Pena Richards Contreras Willis Carpenter Lawrence").split(" ");
const JOBS = ["Nurse", "Teacher", "Cashier", "Truck driver", "Electrician", "Office manager", "Mechanic", "Cook",
  "Warehouse worker", "Accountant", "Plumber", "Retail clerk", "Software developer", "Carpenter", "Server",
  "Mail carrier", "Bank teller", "Dental assistant", "Construction worker", "Hairdresser", "Security guard",
  "Pharmacist", "Janitor", "Sales rep", "Bus driver", "Welder", "Paralegal", "Line worker", "Real estate agent", "Barista"];
/** Index into a frequency-ordered list: squaring a uniform roll favors the common names at the front. */
function pick<T>(list: T[], r: number): T { return list[Math.min(list.length - 1, Math.floor(list.length * r * r))]; }

// ---------- identity ----------
export type Role = "head" | "partner" | "child" | "elder" | "single";
export type Person = { first: string; last: string; sex: "F" | "M"; age: number; role: Role; job: string };

function roleOf(seed: number, k: number, lead: number, size: number): Role {
  if (lead < 0 || size <= 1) return "single";
  const j = k - lead;
  if (j === 0) return "head";
  if (j === 1) return "partner";
  if (size >= 3 && j === size - 1 && u(seed, lead, 11) < 0.15) return "elder";
  return "child";
}
function sexOf(seed: number, k: number, lead: number, role: Role): "F" | "M" {
  if (role === "partner") {
    const headSex = sexOf(seed, lead, lead, "head");
    return u(seed, k, 3) < 0.85 ? (headSex === "F" ? "M" : "F") : headSex;
  }
  return u(seed, k, 2) < 0.5 ? "F" : "M";
}
function headAge(seed: number, lead: number, size: number): number {
  // households with kids get heads old enough for them: at least 18 years older than the oldest possible child
  const lo = size >= 3 ? 36 : 22;
  return lo + Math.floor(u(seed, lead, 4) * (71 - lo));
}
function ageOf(seed: number, k: number, lead: number, size: number, role: Role): number {
  switch (role) {
    case "single": return 18 + Math.floor(u(seed, k, 4) * 68);
    case "head": return headAge(seed, lead, size);
    case "partner": return Math.max(18, Math.min(90, headAge(seed, lead, size) + Math.round((u(seed, k, 5) - 0.5) * 10)));
    case "elder": { // a parent of the head: at least 18 years older, and 65 or more
      const lo = Math.max(65, headAge(seed, lead, size) + 18);
      return Math.min(100, lo + Math.floor(u(seed, k, 4) * Math.max(1, 96 - lo)));
    }
    case "child": {
      const max = Math.min(17, headAge(seed, lead, size) - 18);
      return Math.floor(u(seed, k, 4) * (max + 1));
    }
  }
}
function jobOf(seed: number, k: number, age: number): string {
  if (age < 5) return "Preschool";
  if (age < 18) return "Student";
  if (age >= 65) return "Retired";
  return JOBS[Math.floor(u(seed, k, 6) * JOBS.length)];
}
/** Person k. famLead/famSize are the sim's household (famLead -1 = on their own). */
export function personOf(seed: number, k: number, famLead: number, famSize: number): Person {
  const size = famLead >= 0 ? famSize : 1;
  const lead = famLead >= 0 ? famLead : k;
  const role = roleOf(seed, k, famLead, size);
  const sex = sexOf(seed, k, lead, role);
  const age = ageOf(seed, k, lead, size, role);
  const first = pick(sex === "F" ? FEMALE : MALE, u(seed, k, 1));
  const last = pick(LAST, u(seed, lead, 9)); // the household's name
  return { first, last, sex, age, role, job: jobOf(seed, k, age) };
}

// ---------- 0.42: age ----------
/** Walking pace by age (design: kids keep an adult's pace through the family, elderly about 0.7x, teens a bit faster). */
export function agePace(age: number): number {
  return age < 5 ? 0.8 : age < 13 ? 0.95 : age < 18 ? 1.1 : age < 65 ? 1 : age < 75 ? 0.85 : 0.7;
}
export const AGE_PACE = Float32Array.from({ length: 256 }, (_, a) => agePace(a));

// ---------- story log ----------
export const EV_SAFE = 1, EV_LEFT_ZONE = 2, EV_EVAC = 3, EV_TURNED = 4, EV_CRUSHED = 5, EV_KILLED_BY_US = 6,
  EV_FRIENDLY_FIRE = 7, EV_DIED = 8, EV_SHOT = 9;
// 0.40: family errands after the alert (arg: a person index where the line names someone)
export const EV_HEAD_HOME = 10, EV_HOME_WAIT = 11, EV_FAMILY_TOGETHER = 12, EV_FETCH = 13, EV_PICKED_UP = 14,
  EV_ZONE_WAIT = 15, EV_GAVE_UP = 16, EV_COLLECTED = 17, EV_SCHOOL_WAIT = 18, EV_TO_ZONE = 19, EV_CLASS = 22;
// 0.40: what each person is doing after the alert
export const PLAN_NONE = 0, PLAN_STRAIGHT = 1, PLAN_GATHER = 2, PLAN_MEET = 3, PLAN_FETCH = 4, PLAN_SCHOOL_WAIT = 5,
  PLAN_HOME_WAIT = 6, PLAN_FOLLOW = 7, PLAN_CLASS = 8, // 0.41: PLAN_CLASS: a class lining up with its teachers, then walking to the zone
  PLAN_REFUSE = 9, // 0.42: refusing to leave, sheltering at home
  PLAN_GO_BACK = 10; // 0.43: going back toward a loved one who just turned (goal: that person)
// 0.42: refusers, teens going alone
export const EV_REFUSE = 23, EV_BROKE = 24, EV_TALKED_OUT = 25, EV_SOLO = 26;
// 0.43: loved ones turning (arg: the person who turned)
export const EV_SAW_TURN = 27, EV_FROZE = 28, EV_GO_BACK = 29, EV_GRIEF_STAY = 30;
export const FATE_EVAC = 3, FATE_TURNED = 4, FATE_CRUSHED = 5, FATE_KILLED_BY_US = 6, FATE_FRIENDLY_FIRE = 7, FATE_DIED = 8;
/** True for the events that end a person's part in the round. */
export function isEnding(code: number): boolean { return code >= EV_EVAC && code <= EV_DIED; }
/** One story line. arg: the zone index for EV_SAFE / EV_LEFT_ZONE; for EV_EVAC 1 = by train, 0 = by air; a person
 *  index for the errand lines that name someone (nameOf turns it into a first name). */
export function storyLine(code: number, arg: number, nameOf: (k: number) => string = () => "family"): string {
  switch (code) {
    case EV_HEAD_HOME: return "heading home";
    case EV_HOME_WAIT: return "home, waiting for family";
    case EV_FAMILY_TOGETHER: return "family together, leaving";
    case EV_FETCH: return `heading to ${nameOf(arg)}'s school`;
    case EV_PICKED_UP: return `picked up by ${nameOf(arg)}`;
    case EV_COLLECTED: return `picked up ${nameOf(arg)}`;
    case EV_ZONE_WAIT: return "waiting in the zone for family";
    case EV_GAVE_UP: return arg === 1 ? "turned back, ran for the zone" : "gave up waiting";
    case EV_SCHOOL_WAIT: return "waiting at school for a parent";
    case EV_TO_ZONE: return "heading for the zone";
    case EV_CLASS: return "walking to the zone with the class";
    case EV_REFUSE: return "refused to leave: feels safer at home";
    case EV_BROKE: return "saw the infected and ran for it";
    case EV_TALKED_OUT: return "talked into leaving by the soldiers";
    case EV_SOLO: return "headed for the zone alone";
    case EV_SAW_TURN: return `saw ${nameOf(arg)} turn`;
    case EV_FROZE: return "froze in shock";
    case EV_GO_BACK: return `went back for ${nameOf(arg)}`;
    case EV_GRIEF_STAY: return `won't leave now, not after losing ${nameOf(arg)}`;
    case EV_SAFE: return `reached Zone ${arg + 1}`;
    case EV_LEFT_ZONE: return `left Zone ${arg + 1}`;
    case EV_EVAC: return arg === 1 ? "left on an evacuation train" : "flown out";
    case EV_TURNED: return "bitten, turned";
    case EV_CRUSHED: return "crushed in the crowd";
    case EV_KILLED_BY_US: return "killed by our fire";
    case EV_FRIENDLY_FIRE: return "shot by another civilian";
    case EV_DIED: return "died";
    case EV_SHOT: return "fired on the infected";
    default: return "unknown event";
  }
}

// ---------- 0.40: where everyone is when the sirens go ----------
export type Place = 0 | 1 | 2 | 3 | 4 | 5;
export const PL_HOME = 0, PL_WORK = 1, PL_SCHOOL = 2, PL_STORE = 3, PL_ROAD = 4, PL_VENUE = 5;
export const PLACE_WORDS = ["at home", "at work", "at school", "at a store", "on the road", "out in town"];
/** Normal working hours: 8:00 to 17:00. */
export function workHours(min: number): boolean { const t = ((min % 1440) + 1440) % 1440; return t >= 480 && t < 1020; }
const between = (t: number, a: number, b: number) => t >= a && t < b;
/** Where person k is at clock time `min` (minutes since midnight), from their age and job. */
export function placeFor(seed: number, k: number, p: Person, min: number): Place {
  const t = ((min % 1440) + 1440) % 1440, r = u(seed, k, 20), r2 = u(seed, k, 21);
  if (t >= 1320 || t < 360) return r < 0.97 ? PL_HOME : PL_ROAD; // 22:00 to 6:00
  if (p.age >= 5 && p.age <= 17) {
    if (between(t, 480, 900)) return r < 0.85 ? PL_SCHOOL : PL_HOME;
    if (between(t, 900, 960)) return r < 0.55 ? PL_ROAD : PL_HOME; // school's out: on the way home
    if (between(t, 900, 1200) && r < 0.12) return PL_STORE;
    return PL_HOME;
  }
  if (p.age < 5) return PL_HOME; // with whoever is home (setStartTime makes sure someone is)
  if (p.age >= 65 || p.job === "Retired") {
    if (between(t, 540, 1080)) return r < 0.8 ? PL_HOME : r < 0.95 ? PL_STORE : PL_ROAD;
    return PL_HOME;
  }
  // working age
  const commute = between(t, 420, 510) || between(t, 990, 1080);
  if (commute && r < 0.6) return PL_ROAD;
  if (between(t, 480, 1020) && (commute ? r - 0.6 : r) < (commute ? 0.3 : 0.75)) return PL_WORK;
  if (between(t, 600, 1200) && r2 < 0.08) return PL_STORE;
  return PL_HOME;
}
export type Rally = 0 | 1;
export const RALLY_HOME = 0, RALLY_ZONE = 1;
/** Where a household meets: home (65% in work hours, families are split) or the zone (40% / 60% otherwise). */
export function rallyFor(seed: number, lead: number, min: number): Rally {
  return u(seed, lead, 22) < (workHours(min) ? 0.65 : 0.4) ? RALLY_HOME : RALLY_ZONE;
}
