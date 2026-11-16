// 0.36 real cities: a local flat projection about an area's centre, turned so the street grid is square to the
// screen, and the dominant street angle that picks the turn. Plain math only: the browser runs it for live captures.
import { CELL_M } from "../config";

export type LatLon = [number, number];
/** An area: centre, turn in degrees (a grid running `angle` degrees east of north becomes vertical), size in cells. */
export interface Frame { lat0: number; lon0: number; angle: number; w: number; h: number }

const R = 6_371_000, RAD = Math.PI / 180;

export function toCell(f: Frame, p: LatLon): [number, number] {
  const e = (p[1] - f.lon0) * RAD * R * Math.cos(f.lat0 * RAD), n = (p[0] - f.lat0) * RAD * R;
  const a = f.angle * RAD, x = e * Math.cos(a) - n * Math.sin(a), y = e * Math.sin(a) + n * Math.cos(a);
  return [f.w / 2 + x / CELL_M, f.h / 2 - y / CELL_M];
}

export function toLatLon(f: Frame, c: [number, number]): LatLon {
  const x = (c[0] - f.w / 2) * CELL_M, y = (f.h / 2 - c[1]) * CELL_M, a = f.angle * RAD;
  const e = x * Math.cos(a) + y * Math.sin(a), n = -x * Math.sin(a) + y * Math.cos(a);
  return [f.lat0 + n / (R * RAD), f.lon0 + e / (R * RAD * Math.cos(f.lat0 * RAD))];
}

/** Bearing of the street grid in [-45, 45): length-weighted 1-degree histogram of segment bearings mod 90, smoothed
 *  over +-3 bins (circular), peak bin. 0 when there is under 2 km of road. */
export function dominantAngle(ways: LatLon[][]): number {
  const bins = new Float64Array(90);
  let total = 0;
  for (const w of ways) for (let i = 1; i < w.length; i++) {
    const k = Math.cos(w[i][0] * RAD);
    const de = (w[i][1] - w[i - 1][1]) * RAD * R * k, dn = (w[i][0] - w[i - 1][0]) * RAD * R;
    const len = Math.hypot(de, dn);
    if (!len) continue;
    const b = ((Math.atan2(de, dn) / RAD) % 90 + 90) % 90; // 0..90
    bins[Math.floor(b) % 90] += len; total += len;
  }
  if (total < 2000) return 0;
  let best = 0, bestV = -1;
  for (let i = 0; i < 90; i++) {
    let v = 0;
    for (let d = -3; d <= 3; d++) v += bins[(i + d + 90) % 90] * (4 - Math.abs(d));
    if (v > bestV) { bestV = v; best = i; }
  }
  const deg = best + 0.5; // bin centre
  return deg >= 45 ? deg - 90 : deg;
}
