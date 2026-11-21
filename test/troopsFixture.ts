// 0.50: shared helpers for the Troops / groups tests.
import { expect } from "bun:test";
import { Sim } from "../src/sim";
import { BUILDING, WATER } from "../src/map";

export function zone(s: Sim, half = 34): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
export function mk(): Sim { const s = new Sim(42, { budget: 400_000_000 }); expect(s.setZone(zone(s))).toBeNull(); return s; }
export function zoneRoof(s: Sim, skip = 0): [number, number] {
  let n = 0;
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING && n++ >= skip) return [i % s.w, (i / s.w) | 0];
  throw new Error("no roof");
}
export function zoneStreet(s: Sim): [number, number] {
  const cx = s.w / 2, cy = s.h / 4; let best: [number, number] = [-1, -1], bd = 1e9;
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] !== BUILDING && s.map.tile[i] !== WATER) {
    const x = i % s.w, y = (i / s.w) | 0, d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
export function outsideStreet(s: Sim): [number, number] {
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 0 && s.map.tile[i] !== BUILDING && s.map.tile[i] !== WATER) return [i % s.w, (i / s.w) | 0];
  throw new Error("none");
}

