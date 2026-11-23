// 0.54: one key map for the whole game (design ruling): WASD is always the camera, 1-5 are control groups, 6-0 the
// quick bar (any slot can be rebound), orders sit around WASD, map tools on the bottom-left row. Pure: main.ts, the
// command card, input and the Codex read it; the tests pin it.
export const ORDER_KEYS = { amove: "q", escort: "e", patrol: "r", stop: "f", standby: "g", target: "t", fortify: "c", topup: "u", remove: "x" } as const;
export const TOOL_KEYS = { zone: "z", remove: "x", order: "c", pan: "v", gate: "g", build: "b", recall: "q", closegates: "l", clear: "k", heatmap: "h" } as const;
export const VIEW_KEYS = { heatmap: "h", heights: "j", ranges: "n" } as const;
export const ALERT_KEY = "`";
export const GROUP_COUNT = 5; // keys 1-5
export const QUICK_SLOTS = 5;
export const QUICK_DEFAULT_KEYS = ["6", "7", "8", "9", "0"];
/** Keys a quick bar slot may not take (they already do something). Lower case; F-keys by name. */
export const RESERVED = new Set<string>([
  "w", "a", "s", "d", ...Object.values(ORDER_KEYS), ...Object.values(TOOL_KEYS), ...Object.values(VIEW_KEYS), ALERT_KEY,
  "1", "2", "3", "4", "5", " ", "tab", "escape", "enter", "delete", "backspace", "f1", "f2", "f3", "f5", "f10", "f11", "f12",
  "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "control", "alt", "meta",
]);
/** How a key shows on a button ("6", "F7", ","); "" for none. */
export function keyLabel(k: string | null | undefined): string {
  if (!k) return "";
  return /^f\d{1,2}$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k;
}
/** Can slot `i` take key `k` (lower case)? null if so, else why not. */
export function bindProblem(k: string, i: number, keys: (string | null)[]): string | null {
  if (!/^(?:[a-z0-9`\-=[\];',./\\]|f(?:[4-9]))$/.test(k)) return `${keyLabel(k) || "That key"} can't be used for a slot.`;
  if (RESERVED.has(k)) return `${keyLabel(k)} is already used by the game.`;
  const j = keys.findIndex((x, n) => n !== i && x === k);
  if (j >= 0) return `${keyLabel(k)} is already on quick bar slot ${j + 1}.`;
  return null;
}
/** Saved slot keys, cleaned: QUICK_SLOTS entries, each a usable unique key or null; missing -> the defaults. */
export function cleanQuickKeys(v: unknown): (string | null)[] {
  const a = Array.isArray(v) ? v : QUICK_DEFAULT_KEYS;
  const out: (string | null)[] = [];
  for (let i = 0; i < QUICK_SLOTS; i++) { const k = typeof a[i] === "string" ? a[i].toLowerCase() : null; out.push(k && !bindProblem(k, i, out) ? k : null); }
  return out;
}
