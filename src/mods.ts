// Mods (0.15): plain JSON files that change any number or name in the game. See MODDING.md.
// A mod is applied once at startup, before any battle exists. Unknown keys are reported, never fatal.
import * as C from "./config";
import { UNLOCK_XP } from "./progress";

export interface ModFile { file: string; text: string }
export interface ModReport { file: string; name: string; changes: number; problems: string[] }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o: object, k: string) => k !== "__proto__" && k !== "constructor" && k !== "prototype" && Object.hasOwn(o, k);
/** Mod text ends up in the page: no markup, and colors must be plain hex. */
function badText(k: string, v: string) {
  // the page puts these strings in markup and double-quoted attributes (never single-quoted), so these are enough
  if (/[<>"`]/.test(v)) return "text may not contain < > \" or `";
  if (k.toLowerCase().includes("color") && !/^#[0-9a-f]{3,8}$/i.test(v)) return "colors must look like #ff8800";
  if (v.length > 400) return "text is longer than 400 characters";
  return null;
}

/** Copy matching fields from `patch` onto `target`: same type only, one level of nesting (e.g. `mobile`, `cannon`). */
function merge(target: Obj, patch: Obj, where: string, rep: ModReport, depth = 0) {
  for (const [k, v] of Object.entries(patch)) {
    const cur = own(target, k) ? target[k] : undefined;
    if (cur === undefined) {
      if (!own(target, k) && (k === "__proto__" || k === "constructor" || k === "prototype")) { rep.problems.push(`${where}.${k}: not allowed`); continue; }
      // optional numeric extras the game understands even when the base unit lacks them
      if (depth === 0 && ["splash", "minRange", "maxHits", "salvo"].includes(k) && typeof v === "number") { target[k] = v; rep.changes++; continue; }
      rep.problems.push(`${where}.${k}: no such field`); continue;
    }
    if (isObj(cur) && isObj(v) && depth < 1) { merge(cur, v, `${where}.${k}`, rep, depth + 1); continue; }
    if (typeof cur === "number" && v === "Infinity") { target[k] = Infinity; rep.changes++; continue; } // JSON has no Infinity
    if (Array.isArray(cur) && Array.isArray(v)) { // lists of text (unit specials): replaced whole
      if (v.every(x => typeof x === "string" && !badText(k, x))) { target[k] = v.slice(0, 20); rep.changes++; } else rep.problems.push(`${where}.${k}: expected a list of text`);
      continue;
    }
    if (typeof cur !== typeof v || isObj(v) || Array.isArray(v)) { rep.problems.push(`${where}.${k}: expected ${typeof cur === "object" ? "an object" : "a " + typeof cur}`); continue; }
    if (typeof v === "number" && !Number.isFinite(v)) { rep.problems.push(`${where}.${k}: not a finite number`); continue; }
    if (typeof v === "string") { const why = badText(k, v); if (why) { rep.problems.push(`${where}.${k}: ${why}`); continue; } }
    target[k] = v; rep.changes++;
  }
}

function table(rec: Obj, patch: unknown, where: string, rep: ModReport) {
  if (!isObj(patch)) { rep.problems.push(`${where}: expected an object`); return; }
  for (const [id, p] of Object.entries(patch)) {
    if (!own(rec, id) || !isObj(rec[id])) { rep.problems.push(`${where}.${id}: no such entry`); continue; }
    if (!isObj(p)) { rep.problems.push(`${where}.${id}: expected an object`); continue; }
    merge(rec[id] as Obj, p, `${where}.${id}`, rep);
  }
}

/** Apply one mod. Returns what it changed and anything it could not apply. */
export function applyMod(mf: ModFile): ModReport {
  const rep: ModReport = { file: mf.file, name: mf.file, changes: 0, problems: [] };
  let m: unknown;
  try { m = JSON.parse(mf.text); } catch (e) { rep.problems.push(`not valid JSON: ${(e as Error).message}`); return rep; }
  if (!isObj(m)) { rep.problems.push("the file must hold one JSON object"); return rep; }
  if (typeof m.name === "string") rep.name = m.name.slice(0, 60);
  for (const [k, v] of Object.entries(m)) {
    switch (k) {
      case "name": case "description": case "author": case "version": break;
      case "constants":
        if (!isObj(v)) { rep.problems.push("constants: expected an object"); break; }
        for (const [n, x] of Object.entries(v)) {
          const t = own(C.TUNABLE, n) ? C.TUNABLE[n] : undefined;
          if (!t) rep.problems.push(`constants.${n}: no such constant`);
          else if (typeof x !== "number" || !Number.isFinite(x)) rep.problems.push(`constants.${n}: expected a number`);
          else { t[1](x); rep.changes++; }
        }
        break;
      case "units": table(C.UNITS as unknown as Obj, v, "units", rep); break;
      case "unitInfo": table(C.UNIT_INFO as unknown as Obj, v, "unitInfo", rep); break;
      case "supports": table(C.SUPPORTS as unknown as Obj, v, "supports", rep); break;
      case "abilities": table(C.ABILITIES as unknown as Obj, v, "abilities", rep); break;
      case "mutators": table(C.MUTATORS as unknown as Obj, v, "mutators", rep); break;
      case "difficulty": table(C.DIFFICULTY as unknown as Obj, v, "difficulty", rep); break;
      case "cities": {
        const byId: Obj = {};
        for (const c of [...C.CITIES, ...C.REAL_CITIES]) byId[c.id] = c;
        table(byId, v, "cities", rep); break;
      }
      case "unlocks":
        if (!isObj(v)) { rep.problems.push("unlocks: expected an object"); break; }
        for (const [n, x] of Object.entries(v)) {
          if (!(own(C.UNITS, n) || own(C.SUPPORTS, n) || own(C.ABILITIES, n))) rep.problems.push(`unlocks.${n}: no such tool`);
          else if (typeof x !== "number" || !Number.isFinite(x) || x < 0) rep.problems.push(`unlocks.${n}: expected an XP number`);
          else { UNLOCK_XP[n] = x; rep.changes++; }
        }
        break;
      case "medals":
        if (!isObj(v)) { rep.problems.push("medals: expected an object"); break; }
        for (const [n, x] of Object.entries(v)) {
          const row = C.MEDALS.find(r => r[0] === n);
          if (!row) rep.problems.push(`medals.${n}: no such medal`);
          else if (typeof x !== "number" || !Number.isFinite(x)) rep.problems.push(`medals.${n}: expected a percentage`);
          else { row[1] = x; rep.changes++; }
        }
        break;
      default: rep.problems.push(`${k}: unknown section`);
    }
  }
  return rep;
}

/** Everything a mod can change, with today's values: the starting template for modders. */
export function defaults(): Obj {
  const constants: Obj = {};
  for (const [n, [get]] of Object.entries(C.TUNABLE)) constants[n] = get();
  const cities: Obj = {};
  for (const c of [...C.CITIES, ...C.REAL_CITIES]) { const { id, recipe: _r, intro: _i, ...rest } = c; cities[id] = rest; } // 0.35: maps (recipe) and intro text are not moddable
  return {
    name: "My mod", description: "Delete everything you do not change; keep the structure.", version: C.VERSION,
    constants, units: C.UNITS, unitInfo: C.UNIT_INFO, supports: C.SUPPORTS, abilities: C.ABILITIES,
    mutators: C.MUTATORS, difficulty: C.DIFFICULTY, cities, unlocks: { ...UNLOCK_XP }, medals: Object.fromEntries(C.MEDALS.map(r => [r[0], r[1]])),
  };
}

/** JSON can't hold Infinity (boats' HP, unlimited ammo): written as the string "Infinity", which mods may use too. */
export const toJson = (o: unknown) => JSON.stringify(o, (_k, v) => (v === Infinity ? "Infinity" : v), 1);
