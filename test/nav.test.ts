import { expect, test } from "bun:test";
import { Sim } from "../src/sim";
import { navOf } from "../src/nav";
import * as C from "../src/config";
import { BUILDING, walkable } from "../src/map";

const fair = () => new Sim(C.CITIES[0].seed, { recipe: C.CITIES[0].recipe });

/** Walk from (x, y) toward target along nav; returns steps used or -1. Fails the test on stepping into a non-walkable or wall cell. */
function walk(s: Sim, target: number, x: number, y: number, max = 4000): number {
  const nav = navOf(s), tx = (target % s.w) + 0.5, ty = ((target / s.w) | 0) + 0.5;
  for (let i = 0; i < max; i++) {
    if (Math.hypot(x - tx, y - ty) <= 3) return i;
    const d = nav.dirTo(target, x, y);
    if (!d) return -1;
    x += d[0] * 0.5; y += d[1] * 0.5;
    const c = s.idx(x | 0, y | 0);
    expect(walkable(s.map.tile[c])).toBe(true);
    expect(s.inZone[c] === 2 && s.wallHp[c] > 0).toBe(false);
  }
  return -1;
}
function farPair(s: Sim): [number, number] {
  const doors: number[] = [];
  for (let i = 0; i < s.civN; i++) doors.push(s.homeCell[i]);
  const a = doors[0];
  let b = a, bd = 0;
  for (const c of doors) { const d = Math.hypot((c % s.w) - (a % s.w), ((c / s.w) | 0) - ((a / s.w) | 0)); if (d > bd && d < 260) { bd = d; b = c; } }
  expect(bd).toBeGreaterThan(150);
  return [a, b];
}

test("nav: walks across town to a doorstep without touching buildings", () => {
  const s = fair(); const [a, b] = farPair(s);
  expect(walk(s, b, (a % s.w) + 0.5, ((a / s.w) | 0) + 0.5)).toBeGreaterThan(0);
});

test("nav: never holds more district fields than the cap", () => {
  const keep = C.DISTRICT_FIELDS_MAX; C.TUNABLE.DISTRICT_FIELDS_MAX[1](2);
  try {
    const s = fair(), nav = navOf(s);
    const D = C.DISTRICT_CELLS;
    for (let i = 0; i < 5; i++) { const t = s.idx(Math.min(s.w - 1, 5 + i * D), 5); nav.dirTo(t, s.w - 2, s.h - 2); }
    expect(nav.stats().districts).toBeLessThanOrEqual(2);
  } finally { C.TUNABLE.DISTRICT_FIELDS_MAX[1](keep); }
});

test("nav: after a zone wall goes up, stale() reroutes and nobody walks into the wall", () => {
  const s = fair(); const [a, b] = farPair(s);
  const ax = (a % s.w), ay = (a / s.w) | 0, bx = b % s.w, by = (b / s.w) | 0;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  navOf(s).dirTo(b, ax + 0.5, ay + 0.5);
  expect(s.setZone([[mx - 25, my - 25], [mx + 25, my - 25], [mx + 25, my + 25], [mx - 25, my + 25]])).toBeNull();
  navOf(s).stale();
  expect(walk(s, b, ax + 0.5, ay + 0.5)).toBeGreaterThan(0);
});

test("nav: a target boxed in by buildings is reported unreachable", () => {
  const s = fair(); const [a, b] = farPair(s);
  const bx = b % s.w, by = (b / s.w) | 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) s.map.tile[s.idx(bx + dx, by + dy)] = BUILDING;
  expect(walk(s, b, (a % s.w) + 0.5, ((a / s.w) | 0) + 0.5)).toBe(-1);
});

test("nav: is not part of a battle snapshot", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const s = fair(); navOf(s).dirTo(s.homeCell[0], 1, 1);
  const b = (await unpack(await pack("t", "t", s, {}))).sim as Sim;
  expect(navOf(b).stats().districts).toBe(0);
});

test("nav: a dropped field rebuilds identical (replays do not depend on the cache)", () => {
  const s = fair(); const [a, b] = farPair(s), nav = navOf(s);
  const pts: [number, number][] = []; for (let i = 0; i < 200; i++) pts.push([1 + (i * 37) % (s.w - 2), 1 + (i * 53) % (s.h - 2)]);
  const first = pts.map(([x, y]) => JSON.stringify(nav.dirTo(b, x + 0.5, y + 0.5)));
  nav.stale();
  const again = pts.map(([x, y]) => JSON.stringify(nav.dirTo(b, x + 0.5, y + 0.5)));
  expect(again).toEqual(first);
});

test("nav review: short walks between nearby doorsteps never step into a building", () => {
  const s = fair(), doors: number[] = [];
  for (let i = 0; i < s.civN; i += 37) doors.push(s.homeCell[i]);
  let walks = 0;
  for (let i = 0; i < doors.length && walks < 120; i++) for (let j = i + 1; j < doors.length && walks < 120; j++) {
    const a = doors[i], b = doors[j], d = Math.hypot((a % s.w) - (b % s.w), ((a / s.w) | 0) - ((b / s.w) | 0));
    if (d < 14 || d > 40) continue;
    walks++; walk(s, b, (a % s.w) + 0.5, ((a / s.w) | 0) + 0.5, 1500);
  }
  expect(walks).toBeGreaterThan(50);
});
