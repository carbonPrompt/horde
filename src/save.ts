// Progress and settings, kept in the browser/app's local storage. Every access is guarded:
// storage can be blocked or empty, and the game must still run.
import type * as C from "./config";

export interface Plan { poly: [number, number][]; zones?: [number, number][][]; walls: number[]; units: [C.UnitKind, number, number, C.TargetMode?][]; supports?: [C.SupportKind, number, number][]; abilities?: Partial<Record<C.AbilityKind, number>>; c4?: number[] }
export interface Settings { fullscreen: boolean; edgeScroll: boolean; showRanges: boolean; devMode?: boolean; crowd?: number; vol?: { master: number; sfx: number; music: number }; quickbar?: (string | null)[]; difficulty?: C.Difficulty;
  autoUpdate?: boolean; checkUpdates?: boolean; updatePin?: string; speed?: number } // 0.26 updater: install by itself / look on start / stay on a picked older version
export interface Best { pct: number; medal: string | null; mayhem?: number } // pct: round score 0..100 since 0.20 ("% evacuated" before)
/** 0.33: the battle frozen in this slot (the file itself sits beside the profile). */
export interface BattleInfo { version: string; savedAt: string; label: string; t: number; phase: string; bytes: number }
export interface SaveData { battle?: BattleInfo; settings: Settings; best: Record<string, Best>; plans: Record<string, Plan>; daily?: Record<string, Best>; xp?: number | null; achievements?: Record<string, string>; gameVersion?: string } // gameVersion: the version that last wrote it (0.26+)

const KEY = "horde.save.v1";
export const desktop: { setFullscreen(on: boolean): void; quit(): void; readSave(): string | null; writeSave(text: string): void; log?(line: string): void; openLogs?(): void; readMods?(): { file: string; text: string }[]; openMods?(): void;
  updatesList?(): Promise<{ versions?: { version: string; notes: string; date: string; size: number }[]; error?: string }>; updatesInstall?(v: string): Promise<{ ok?: boolean; error?: string }>;
  onUpdateProgress?(cb: (pct: number) => void): void;
  slotsList?(): { active: number | null; slots: { n: number; text: string | null; battle: number }[] }; slotSelect?(n: number): void; slotDelete?(n: number): void;
  battleWrite?(n: number, bytes: Uint8Array): Promise<boolean>; battleRead?(n: number): Promise<Uint8Array | null>; battleDelete?(n: number): void; openSaves?(): void; restoreOffer?(saveVersion: string | undefined): { name: string; version: string; stamp: string } | null; restoreBackup?(name: string): boolean; openReleases?(): void } | undefined =
  (globalThis as any).hordeDesktop;

function defaults(): SaveData {
  return { settings: { fullscreen: true, edgeScroll: !!desktop, showRanges: false }, best: {}, plans: {}, daily: {} };
}

const MEDAL_NAMES = ["Platinum", "Gold", "Silver", "Bronze"];
const ID = /^[a-z0-9:_@-]{1,64}$/i;
const VER = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
/** Saves are hand-editable and importable, so keep only well-formed values (nothing from it reaches the page as markup). */
export function clean(s: SaveData): SaveData {
  const best = (o: unknown) => {
    const out: Record<string, Best> = {};
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, any>)) {
      if (!ID.test(k) || !v || typeof v !== "object" || !Number.isFinite(v.pct)) continue;
      out[k] = { pct: Math.max(0, Math.min(100, v.pct)), medal: MEDAL_NAMES.includes(v.medal) ? v.medal : null, ...(Number.isFinite(v.mayhem) && v.mayhem >= 0 ? { mayhem: Math.floor(v.mayhem) } : {}) };
    }
    return out;
  };
  const ach: Record<string, string> = {};
  if (s.achievements && typeof s.achievements === "object") for (const [k, v] of Object.entries(s.achievements)) if (ID.test(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ach[k] = v;
  const plans: Record<string, Plan> = {};
  if (s.plans && typeof s.plans === "object") for (const [k, v] of Object.entries(s.plans)) if (ID.test(k) && v && typeof v === "object" && Array.isArray((v as Plan).poly)) plans[k] = v as Plan;
  const settings = { ...s.settings };
  const qb = settings.quickbar as unknown;
  if (!Array.isArray(qb) || qb.length > 9 || !qb.every(x => x === null || (typeof x === "string" && ID.test(x)))) delete settings.quickbar;
  const diff = settings.difficulty as unknown;
  if (diff !== "easy" && diff !== "medium" && diff !== "hard" && diff !== "insane") delete settings.difficulty;
  if (typeof settings.autoUpdate !== "boolean") delete settings.autoUpdate;
  if (typeof settings.checkUpdates !== "boolean") delete settings.checkUpdates;
  if (typeof settings.updatePin !== "string" || !VER.test(settings.updatePin)) delete settings.updatePin;
  if (settings.speed !== 0.5 && settings.speed !== 1 && settings.speed !== 2) delete settings.speed; // 0.32: last game speed
  const b = s.battle as any;
  const battle = b && typeof b === "object" && typeof b.version === "string" && VER.test(b.version) && typeof b.savedAt === "string" && typeof b.label === "string"
    && Number.isFinite(b.t) && typeof b.phase === "string" && Number.isFinite(b.bytes)
    ? { battle: { version: b.version, savedAt: b.savedAt.slice(0, 40), label: b.label.slice(0, 120), t: b.t, phase: b.phase.slice(0, 12), bytes: b.bytes } } : {};
  const gv = typeof s.gameVersion === "string" && VER.test(s.gameVersion) ? { gameVersion: s.gameVersion } : {};
  return { settings, best: best(s.best), daily: best(s.daily), plans, achievements: ach, xp: Number.isFinite(s.xp) ? Math.max(0, s.xp as number) : null, ...gv, ...battle };
}

function parse(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const d = defaults(), s = JSON.parse(raw);
    return clean({ settings: { ...d.settings, ...s.settings }, best: s.best ?? {}, plans: s.plans ?? {}, daily: s.daily ?? {}, xp: s.xp ?? null, achievements: s.achievements ?? {}, gameVersion: s.gameVersion, battle: s.battle });
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
  if (browserActive === n) { browserActive = null; try { localStorage.setItem(META_KEY, JSON.stringify({ active: null })); } catch { /* blocked */ } }
}
export const canOpenFolder = () => !!desktop?.openSaves;
export function openFolder() { desktop?.openSaves?.(); }

function idb<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise(res => {
    try {
      const rq = indexedDB.open("horde", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("battles");
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction("battles", mode), r = fn(tx.objectStore("battles"));
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
