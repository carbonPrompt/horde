// Progress and settings, kept in the browser/app's local storage. Every access is guarded:
// storage can be blocked or empty, and the game must still run.
import type * as C from "./config";

export interface Plan { poly: [number, number][]; zones?: [number, number][][]; walls: number[]; units: [C.UnitKind, number, number, C.TargetMode?][]; supports?: [C.SupportKind, number, number][]; abilities?: Partial<Record<C.AbilityKind, number>>; c4?: number[] }
export interface Settings { fullscreen: boolean; edgeScroll: boolean; showRanges: boolean; devMode?: boolean; crowd?: number; vol?: { master: number; sfx: number; music: number }; quickbar?: (string | null)[]; difficulty?: C.Difficulty;
  autoUpdate?: boolean; checkUpdates?: boolean; updatePin?: string } // 0.26 updater: install by itself / look on start / stay on a picked older version
export interface Best { pct: number; medal: string | null; mayhem?: number } // pct: round score 0..100 since 0.20 ("% evacuated" before)
export interface SaveData { settings: Settings; best: Record<string, Best>; plans: Record<string, Plan>; daily?: Record<string, Best>; xp?: number | null; achievements?: Record<string, string>; gameVersion?: string } // gameVersion: the version that last wrote it (0.26+)

const KEY = "horde.save.v1";
export const desktop: { setFullscreen(on: boolean): void; quit(): void; readSave(): string | null; writeSave(text: string): void; log?(line: string): void; openLogs?(): void; readMods?(): { file: string; text: string }[]; openMods?(): void;
  updatesList?(): Promise<{ versions?: { version: string; notes: string; date: string; size: number }[]; error?: string }>; updatesInstall?(v: string): Promise<{ ok?: boolean; error?: string }>;
  onUpdateProgress?(cb: (pct: number) => void): void; restoreOffer?(saveVersion: string | undefined): { name: string; version: string; stamp: string } | null; restoreBackup?(name: string): boolean; openReleases?(): void } | undefined =
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
  const gv = typeof s.gameVersion === "string" && VER.test(s.gameVersion) ? { gameVersion: s.gameVersion } : {};
  return { settings, best: best(s.best), daily: best(s.daily), plans, achievements: ach, xp: Number.isFinite(s.xp) ? Math.max(0, s.xp as number) : null, ...gv };
}

export function load(): SaveData {
  const d = defaults();
  try {
    const raw = desktop ? desktop.readSave() : localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return clean({ settings: { ...d.settings, ...s.settings }, best: s.best ?? {}, plans: s.plans ?? {}, daily: s.daily ?? {}, xp: s.xp ?? null, achievements: s.achievements ?? {}, gameVersion: s.gameVersion });
  } catch { return d; }
}

export function store(s: SaveData) {
  // indented so players can read and edit their save in any text editor
  try { const t = JSON.stringify(s, null, 1); if (desktop) desktop.writeSave(t); else localStorage.setItem(KEY, t); } catch { /* storage blocked: progress lasts this session only */ }
}

export function reset(): SaveData {
  const d = defaults();
  store(d);
  return d;
}
