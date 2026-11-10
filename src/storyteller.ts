import * as C from "./config";

/** Storyteller heat from elapsed time since outbreak (minutes) and share of starting crowd gone (0..1). */
export function heat(d: C.DifficultyDef, minutesSinceOutbreak: number, gone: number): number {
  const m = Math.max(0, minutesSinceOutbreak);
  const g = Math.max(0, Math.min(1, gone));
  return d.rampPerMin * m + d.emptyHeat * g;
}

/** Roll seconds until the next horde arrives, clamped at the difficulty's floor. */
export function rollGap(d: C.DifficultyDef, h: number, r: () => number, blitz = false): number {
  const raw = d.gapMin + (d.gapMax - d.gapMin) * r();
  const scaled = (raw / (1 + d.gapHeat * Math.max(0, h))) * (blitz ? 0.65 : 1);
  return Math.max(d.gapFloor, scaled);
}

/** Roll the next horde's size and whether it is a "big one". `base` already includes city waveMul and popMul. */
export function rollSize(d: C.DifficultyDef, h: number, base: number, r: () => number): { count: number; big: boolean } {
  const big = r() < C.HORDE_BIG_CHANCE;
  const jitter = 1 + C.HORDE_SIZE_JITTER * (2 * r() - 1);
  const pow = Math.pow(1 + Math.max(0, h), C.HORDE_SIZE_POW);
  const raw = base * d.sizeMul * pow * jitter * (big ? C.HORDE_BIG_MUL : 1);
  const finite = Number.isFinite(raw) ? raw : 1e9;
  return { count: Math.max(1, Math.round(finite)), big };
}

/** Simultaneous entry routes for a horde at heat `h` (1..4). */
export function routesFor(h: number): number {
  return Math.min(4, 1 + Math.floor(Math.max(0, h) / C.HORDE_ROUTE_HEAT));
}
