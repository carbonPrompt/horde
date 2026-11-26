// Progress and settings, kept in the browser/app's local storage. Every access is guarded:
// storage can be blocked or empty, and the game must still run.
import type * as C from "./config";
import type { PlanGroup } from "./groups";
import { cleanOrders, type Order } from "./orders";
import { SECTIONS } from "./codex";
import { cleanCareer, parseHistoryText, type Career, type History } from "./battlerecord";
const CODEX_SECTIONS: string[] = SECTIONS.map(s => s.id);

// 0.45: Plan.units entries: 5th = the unit's orders (present = commanded), 6th = stand by
export interface Plan { poly: [number, number][]; zones?: [number, number][][]; walls: number[]; units: [C.UnitKind, number, number, C.TargetMode?, Order[]?, boolean?][]; supports?: [C.SupportKind, number, number][]; abilities?: Partial<Record<C.AbilityKind, number>>; c4?: number[]; demo?: number[]; start?: number; groups?: PlanGroup[];
  supply?: { small: number; vehicle: number; auto: boolean; prio: "ammo" | "repair"; engineers: number }[]; reserves?: [number, number][] } // 0.60: supply bought in planning, per zone; battery reserves (plan unit index, magazines) // 0.50: battle groups (unit indices into units, or a zone)
export interface Settings { fullscreen: boolean; edgeScroll: boolean; showRanges: boolean; devMode?: boolean; crowd?: number; quickbar?: (string | null)[]; quickKeys?: (string | null)[]; keys?: Record<string, string | null>; /* 0.55: key overrides (keymap.ts action ids) */ vol?: { master: number; sfx: number; music: number }; difficulty?: C.Difficulty; codexSeen?: string; codexOpen?: string[]; /* 0.47: last version the Codex was opened in, open sections */
  autoUpdate?: boolean; checkUpdates?: boolean; updatePin?: string; speed?: number; tips?: boolean; tipsSeen?: string[] } // 0.26 updater: install by itself / look on start / stay on a picked older version
export interface Best { pct: number; medal: string | null; mayhem?: number; perM?: number; underBudget?: boolean } // 0.48: best people saved per $1M, Under Budget badge // pct: round score 0..100 since 0.20 ("% evacuated" before)
/** 0.33: the battle frozen in this slot (the file itself sits beside the profile). */
export interface BattleInfo { version: string; savedAt: string; label: string; t: number; phase: string; bytes: number }
export interface SaveData { battle?: BattleInfo; settings: Settings; best: Record<string, Best>; plans: Record<string, Plan>; daily?: Record<string, Best>; xp?: number | null; achievements?: Record<string, string>; gameVersion?: string; career?: Career;
  legacyMedals?: Record<string, string> } // 0.59: medals from before achievements (best keys and "daily:<date>"; value a medal or "none"), seeded once, count toward city achievements // 0.57 career: running totals over the battle history // gameVersion: the version that last wrote it (0.26+)

const KEY = "horde.save.v1";
export const desktop: { setFullscreen(on: boolean): void; quit(): void; readSave(): string | null; writeSave(text: string): void; log?(line: string): void; openLogs?(): void; readMods?(): { file: string; text: string }[]; openMods?(): void;
  updatesList?(): Promise<{ versions?: { version: string; notes: string; date: string; size: number }[]; error?: string }>; updatesInstall?(v: string): Promise<{ ok?: boolean; error?: string }>;
  onUpdateProgress?(cb: (pct: number) => void): void;
  historyRead?(n: number): Promise<{ text?: string; missing?: boolean; error?: string } | null>; historyWrite?(n: number, text: string): Promise<boolean>; historyQuarantine?(n: number): Promise<boolean>; onClosing?(cb: () => void): void; // 0.57
  slotsList?(): { active: number | null; slots: { n: number; text: string | null; battle: number }[] }; slotSelect?(n: number): void; slotDelete?(n: number): void;
  battleWrite?(n: number, bytes: Uint8Array): Promise<boolean>; battleRead?(n: number): Promise<Uint8Array | null>; battleDelete?(n: number): void; openSaves?(): void; restoreOffer?(saveVersion: string | undefined): { name: string; version: string; stamp: string } | null; restoreBackup?(name: string): boolean; openReleases?(): void } | undefined =
  (globalThis as any).hordeDesktop;

export function defaults(): SaveData {
  return { settings: { fullscreen: true, edgeScroll: !!desktop, showRanges: false }, best: {}, plans: {}, daily: {} };
}

const MEDAL_NAMES = ["Platinum", "Gold", "Silver", "Bronze"];
const ID = /^[a-z0-9:_@-]{1,64}$/i;
/** 0.36: bests and plans are also keyed by real-city area: "<city>/<area>" plus an optional "@difficulty". */
const BEST_KEY = /^(?:[a-z0-9:_@-]{1,64}|[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}(?:@[a-z]{1,12})?)$/i;
const VER = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
/** Saves are hand-editable and importable, so keep only well-formed values (nothing from it reaches the page as markup). */
export function clean(s: SaveData): SaveData {
  const best = (o: unknown) => {
    const out: Record<string, Best> = {};
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, any>)) {
      if (!BEST_KEY.test(k) || !v || typeof v !== "object" || !Number.isFinite(v.pct)) continue;
      out[k] = { pct: Math.max(0, Math.min(100, v.pct)), medal: MEDAL_NAMES.includes(v.medal) ? v.medal : null, ...(Number.isFinite(v.mayhem) && v.mayhem >= 0 ? { mayhem: Math.floor(v.mayhem) } : {}),
        ...(Number.isFinite(v.perM) && v.perM >= 0 ? { perM: Math.min(1e7, v.perM) } : {}), ...(v.underBudget === true ? { underBudget: true } : {}) };
    }
    return out;
  };
  const ach: Record<string, string> = {};
  if (s.achievements && typeof s.achievements === "object") for (const [k, v] of Object.entries(s.achievements)) if (ID.test(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ach[k] = v;
  const plans: Record<string, Plan> = {};
  if (s.plans && typeof s.plans === "object") for (const [k, v] of Object.entries(s.plans)) if (BEST_KEY.test(k) && v && typeof v === "object" && Array.isArray((v as Plan).poly)) {
    const pl = { ...(v as Plan) };
    if (!(Number.isInteger(pl.start) && pl.start! >= 0 && pl.start! < 1440)) delete pl.start; // 0.39: clock start, minutes since midnight
    if (Array.isArray(pl.units)) pl.units = pl.units.map(u => { // 0.45: orders checked; a bad list is dropped, the unit kept
      if (!Array.isArray(u) || u.length <= 4) return u;
      const ord = cleanOrders(u[4]);
      return ord ? [u[0], u[1], u[2], u[3], ord, ...(u[5] === true ? [true] : [])] as Plan["units"][number] : [u[0], u[1], u[2], u[3]] as Plan["units"][number];
    });
    if (pl.supply !== undefined) { // 0.60
      const n = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
      pl.supply = Array.isArray(pl.supply) ? pl.supply.slice(0, 16).filter(x => x && typeof x === "object").map((x: any) => ({ small: n(x.small, 10000), vehicle: n(x.vehicle, 10000), auto: x.auto === false ? false : true, prio: x.prio === "repair" ? "repair" : "ammo", engineers: n(x.engineers, 12) })) : undefined;
      if (!pl.supply) delete pl.supply;
    }
    if (pl.reserves !== undefined) {
      pl.reserves = Array.isArray(pl.reserves) ? pl.reserves.slice(0, 400).filter((r): r is [number, number] => Array.isArray(r) && Number.isInteger(r[0]) && r[0] >= 0 && Number.isFinite(r[1]) && r[1] > 0).map(r => [r[0], Math.min(1000, Math.floor(r[1]))] as [number, number]) : undefined;
      if (!pl.reserves) delete pl.reserves;
    }
    plans[k] = pl;
  }
  const settings = { ...s.settings };
  const qb = settings.quickbar as unknown; // 0.54: the quick bar is back (5 slots) with player-chosen keys
  if (!Array.isArray(qb) || qb.length > 9 || !qb.every(x => x === null || (typeof x === "string" && ID.test(x)))) delete settings.quickbar;
  const qk = settings.quickKeys as unknown;
  if (!Array.isArray(qk) || qk.length > 9 || !qk.every(x => x === null || (typeof x === "string" && x.length >= 1 && x.length <= 3))) delete settings.quickKeys;
  { const ks = settings.keys as unknown; // 0.55: every key settable; only well-formed id -> key|null pairs (keymap.cleanKeys checks the rest)
    if (!ks || typeof ks !== "object" || Array.isArray(ks)) delete settings.keys;
    else settings.keys = Object.fromEntries(Object.entries(ks as Record<string, unknown>).filter(([id, v]) => /^[a-z0-9_.]{1,32}$/.test(id) && (v === null || (typeof v === "string" && v.length >= 1 && v.length <= 12)))) as Record<string, string | null>; }
  if (settings.tips !== undefined && typeof settings.tips !== "boolean") delete settings.tips; // 0.41
  if (settings.tipsSeen !== undefined) { const ts = settings.tipsSeen as unknown; settings.tipsSeen = Array.isArray(ts) ? ts.filter((x): x is string => typeof x === "string" && /^[a-zA-Z]{1,24}$/.test(x)).slice(0, 64) : undefined; if (!settings.tipsSeen) delete settings.tipsSeen; }
  const diff = settings.difficulty as unknown;
  if (diff !== "easy" && diff !== "medium" && diff !== "hard" && diff !== "insane") delete settings.difficulty;
  if (typeof settings.autoUpdate !== "boolean") delete settings.autoUpdate;
  if (typeof settings.checkUpdates !== "boolean") delete settings.checkUpdates;
  if (typeof settings.updatePin !== "string" || !VER.test(settings.updatePin)) delete settings.updatePin;
  if (typeof settings.codexSeen !== "string" || !VER.test(settings.codexSeen)) delete settings.codexSeen; // 0.47
  if (settings.codexOpen !== undefined) { const co = settings.codexOpen as unknown; settings.codexOpen = Array.isArray(co) ? co.filter((x): x is string => typeof x === "string" && CODEX_SECTIONS.includes(x)).slice(0, 16) : []; }
  if (settings.speed !== 0.5 && settings.speed !== 1 && settings.speed !== 2) delete settings.speed; // 0.32: last game speed
  const b = s.battle as any;
  const battle = b && typeof b === "object" && typeof b.version === "string" && VER.test(b.version) && typeof b.savedAt === "string" && typeof b.label === "string"
    && Number.isFinite(b.t) && typeof b.phase === "string" && Number.isFinite(b.bytes)
    ? { battle: { version: b.version, savedAt: b.savedAt.slice(0, 40), label: b.label.slice(0, 120), t: b.t, phase: b.phase.slice(0, 12), bytes: b.bytes } } : {};
  const gv = typeof s.gameVersion === "string" && VER.test(s.gameVersion) ? { gameVersion: s.gameVersion } : {};
  const career = s.career && typeof s.career === "object" && !Array.isArray(s.career) ? { career: cleanCareer(s.career) } : {}; // 0.57
  let legacy = {};
  if (s.legacyMedals && typeof s.legacyMedals === "object" && !Array.isArray(s.legacyMedals)) { // 0.59
    const lm: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.legacyMedals).slice(0, 5000)) if ((BEST_KEY.test(k) || /^daily:\d{4}-\d{2}-\d{2}$/.test(k)) && (MEDAL_NAMES.includes(v as string) || v === "none")) lm[k] = v as string;
    legacy = { legacyMedals: lm };
  }
  return { settings, best: best(s.best), daily: best(s.daily), plans, achievements: ach, xp: Number.isFinite(s.xp) ? Math.max(0, s.xp as number) : null, ...gv, ...battle, ...career, ...legacy };
}

function parse(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const d = defaults(), s = JSON.parse(raw);
    return clean({ settings: { ...d.settings, ...s.settings }, best: s.best ?? {}, plans: s.plans ?? {}, daily: s.daily ?? {}, xp: s.xp ?? null, achievements: s.achievements ?? {}, gameVersion: s.gameVersion, battle: s.battle, career: s.career, legacyMedals: s.legacyMedals });
  } catch { return null; }
}

// ---------- 0.33: three save slots ----------
// Desktop: %APPDATA%\Horde\saves\slotN.json (profile) + slotN.battle (snapshot); the main process redirects the
// old save calls to the active slot. Browser: localStorage horde.slotN + IndexedDB for the snapshots.
// The old single save becomes Slot 1 the first time (the old file is left where it was).
export const SLOTS = 3;
const SLOT_KEY = (n: number) => `horde.slot${n}`, META_KEY = "horde.slots";
function browserMeta(): { active: number | null } {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null");
    if (m && typeof m === "object") return { active: Number.isInteger(m.active) && m.active >= 1 && m.active <= SLOTS ? m.active : null };
    const old = localStorage.getItem(KEY); // first run of 0.33: the old save becomes Slot 1
    if (old && !localStorage.getItem(SLOT_KEY(1))) localStorage.setItem(SLOT_KEY(1), old);
    localStorage.setItem(META_KEY, JSON.stringify({ active: null }));
  } catch { /* storage blocked */ }
  return { active: null };
}
let browserActive: number | null = desktop ? null : browserMeta().active;
export function activeSlot(): number | null {
  if (desktop?.slotsList) { try { return desktop.slotsList().active; } catch { return null; } }
  return browserActive;
}
export interface SlotInfo { n: number; data: SaveData | null; battleBytes: number }
export function listSlots(): SlotInfo[] {
  if (desktop?.slotsList) {
    try { return desktop.slotsList().slots.map(s => ({ n: s.n, data: parse(s.text), battleBytes: s.battle })); } catch { /* fall through */ }
  }
  const out: SlotInfo[] = [];
  for (let n = 1; n <= SLOTS; n++) { let t: string | null = null; try { t = localStorage.getItem(SLOT_KEY(n)); } catch { /* blocked */ } const d = parse(t); out.push({ n, data: d, battleBytes: d?.battle?.bytes ?? 0 }); }
  return out;
}
/** Make slot n the one the game plays from; returns its profile (a fresh one for an empty slot, written at once). */
export function selectSlot(n: number): SaveData {
  if (desktop?.slotSelect) desktop.slotSelect(n);
  else { browserActive = n; try { localStorage.setItem(META_KEY, JSON.stringify({ active: n })); } catch { /* blocked */ } }
  const d = load();
  store(d);
  return d;
}
/** Delete slot n (profile and battle). Desktop moves the files to saves\deleted rather than erasing them. */
export function deleteSlot(n: number) {
  if (desktop?.slotDelete) { desktop.slotDelete(n); return; }
  try { localStorage.removeItem(SLOT_KEY(n)); } catch { /* blocked */ }
  void idb("readwrite", st => st.delete(n));
  void idb("readwrite", st => st.delete(n), "history"); // 0.57
  if (browserActive === n) { browserActive = null; try { localStorage.setItem(META_KEY, JSON.stringify({ active: null })); } catch { /* blocked */ } }
}
export const canOpenFolder = () => !!desktop?.openSaves;
export function openFolder() { desktop?.openSaves?.(); }

// 0.57: version 2 adds the "history" store next to "battles" (each created only if missing)
function idb<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>, store: "battles" | "history" = "battles"): Promise<T | null> {
  return new Promise(res => {
    try {
      const rq = indexedDB.open("horde", 2);
      rq.onupgradeneeded = () => { for (const n of ["battles", "history"]) if (!rq.result.objectStoreNames.contains(n)) rq.result.createObjectStore(n); };
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null); // 0.57 review: an old tab holding version 1 must not hang every save
      rq.onsuccess = () => {
        rq.result.onversionchange = () => rq.result.close();
        try {
          const tx = rq.result.transaction(store, mode), r = fn(tx.objectStore(store));
          r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null);
        } catch { res(null); }
      };
    } catch { res(null); }
  });
}
export async function writeBattle(n: number, bytes: Uint8Array): Promise<boolean> {
  if (desktop?.battleWrite) return desktop.battleWrite(n, bytes);
  return (await idb("readwrite", st => st.put(bytes, n))) !== null;
}
export async function readBattle(n: number): Promise<Uint8Array | null> {
  if (desktop?.battleRead) return desktop.battleRead(n);
  const r = await idb<Uint8Array>("readonly", st => st.get(n));
  return r instanceof Uint8Array ? r : null;
}
// ---------- 0.57: the slot's battle history (desktop: saves/slotN.history.json; browser: IndexedDB "history") ----------
/** ok false: the history could not be read safely (a read error, or damaged text that could not be set aside):
 *  the caller must not write over it. A damaged file is renamed aside (kept) and a fresh history starts. */
export async function readHistory(n: number): Promise<{ ok: boolean; history: History }> {
  const bad = { ok: false, history: { v: 1 as const, battles: [] } };
  try {
    if (desktop?.historyRead) {
      const r = await desktop.historyRead(n);
      if (!r || r.error) return bad;
      if (r.missing) return parseHistoryText(null);
      const p = parseHistoryText(r.text ?? "");
      if (!p.ok && desktop.historyQuarantine && await desktop.historyQuarantine(n)) return parseHistoryText(null);
      return p;
    }
    const r = await idbGet(n, "history");
    if (!r.ok) return bad;
    return parseHistoryText(typeof r.value === "string" ? r.value : null);
  } catch { return bad; }
}
/** An IndexedDB read that tells "not there" (ok, undefined) apart from "could not read" (not ok). */
function idbGet(key: number, store: "battles" | "history"): Promise<{ ok: boolean; value?: unknown }> {
  return new Promise(res => {
    try {
      const rq = indexedDB.open("horde", 2);
      rq.onupgradeneeded = () => { for (const nm of ["battles", "history"]) if (!rq.result.objectStoreNames.contains(nm)) rq.result.createObjectStore(nm); };
      rq.onerror = () => res({ ok: false }); rq.onblocked = () => res({ ok: false });
      rq.onsuccess = () => {
        const db = rq.result; db.onversionchange = () => db.close();
        try { const g = db.transaction(store, "readonly").objectStore(store).get(key); g.onsuccess = () => { res({ ok: true, value: g.result }); db.close(); }; g.onerror = () => { res({ ok: false }); db.close(); }; }
        catch { res({ ok: false }); db.close(); }
      };
    } catch { res({ ok: false }); }
  });
}
export async function writeHistory(n: number, h: History): Promise<boolean> {
  try {
    const t = JSON.stringify(h);
    if (desktop?.historyWrite) return await desktop.historyWrite(n, t);
    return (await idb("readwrite", st => st.put(t, n), "history")) !== null;
  } catch { return false; }
}
export function deleteBattle(n: number) {
  if (desktop?.battleDelete) desktop.battleDelete(n); else void idb("readwrite", st => st.delete(n));
}

/** The active slot's profile (defaults when no slot is picked yet). */
export function load(): SaveData {
  const raw = (() => { try { return desktop ? desktop.readSave() : browserActive ? localStorage.getItem(SLOT_KEY(browserActive)) : null; } catch { return null; } })();
  return parse(raw) ?? defaults();
}

export function store(s: SaveData) {
  // indented so players can read and edit their save in any text editor
  try {
    const t = JSON.stringify(s, null, 1);
    if (desktop) desktop.writeSave(t); // the main process writes the active slot (nothing before one is picked)
    else if (browserActive) localStorage.setItem(SLOT_KEY(browserActive), t);
  } catch { /* storage blocked: progress lasts this session only */ }
}

export function reset(): SaveData {
  const d = defaults();
  store(d);
  return d;
}
