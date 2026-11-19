import { expect, test } from "bun:test";
import { Sim } from "../src/sim";
import { ROAD, BUILDING, PARK, WATER, BRIDGE, INFRA_NONE, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION } from "../src/map";
import * as C from "../src/config";
import { describeCell, estimateAt } from "../src/cursorinfo";

function zoneAroundCenter(s: Sim, half = 30): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
function first(s: Sim, ok: (i: number) => boolean): [number, number] | null {
  for (let i = 0; i < s.w * s.h; i++) if (ok(i)) return [i % s.w, (i / s.w) | 0];
  return null;
}

test("describeCell is null off the map", () => {
  const s = new Sim(42);
  expect(describeCell(s, -1, 0)).toBeNull();
  expect(describeCell(s, s.w, 0)).toBeNull();
  expect(describeCell(s, 0, s.h)).toBeNull();
});

test("describeCell names the terrain, with roof height for buildings", () => {
  const s = new Sim(42);
  const { tile, height } = s.map;
  const b = first(s, i => tile[i] === BUILDING)!;
  const h = height[s.idx(b[0], b[1])];
  expect(describeCell(s, b[0], b[1])![0]).toBe(`Building, ${h} floor${h === 1 ? "" : "s"} (${Math.round(h * C.LEVEL_M)} m roof)`);
  const cases: [number, number | null, string][] = [
    [WATER, null, "Water"], [PARK, null, "Park"], [BRIDGE, null, "Bridge"],
    [ROAD, INFRA_NONE, "Street"], [ROAD, INFRA_HIGHWAY, "Highway"], [ROAD, INFRA_RAIL, "Rail line"], [ROAD, INFRA_STATION, "Station"],
  ];
  for (const [t, inf, name] of cases) {
    const c = first(s, i => tile[i] === t && (inf === null || height[i] === inf));
    if (!c) continue; // not every generated map has every kind
    expect(describeCell(s, c[0], c[1])![0]).toBe(name);
  }
});

test("describeCell reports the safe zone, walls and gates", () => {
  const s = new Sim(42);
  expect(s.setZone(zoneAroundCenter(s, 20))).toBeNull();
  const inside = first(s, i => s.inZone[i] === 1)!, wall = first(s, i => s.inZone[i] === 2), gate = first(s, i => s.inZone[i] === 3);
  expect(describeCell(s, inside[0], inside[1])).toContain("Inside safe zone");
  if (wall) expect(describeCell(s, wall[0], wall[1])).toContain("Wall");
  if (gate) expect(describeCell(s, gate[0], gate[1])).toContain("Gate");
});

test("describeCell names a unit standing there first", () => {
  const s = new Sim(42);
  expect(s.setZone(zoneAroundCenter(s, 20))).toBeNull();
  const c = first(s, i => s.canPlace("turret", i % s.w, (i / s.w) | 0) === null)!;
  expect(s.place("turret", c[0], c[1])).toBeNull();
  expect(describeCell(s, c[0], c[1])![0]).toBe(C.UNITS.turret.name);
});

test("estimateAt: zone price only once there are three corners", () => {
  const s = new Sim(42);
  const z = zoneAroundCenter(s, 20);
  expect(estimateAt(s, "zone", z[0][0], z[0][1], [])!.price).toBeNull();
  expect(estimateAt(s, "zone", z[1][0], z[1][1], [z[0]])!.price).toBeNull();
  expect(estimateAt(s, "zone", z[2][0], z[2][1], [z[0], z[1]])!.price).toBe(s.priceOf([z[0], z[1], z[2]]));
  const e = estimateAt(s, "zone", z[3][0], z[3][1], [z[0], z[1], z[2]])!;
  expect(e.price).toBe(s.priceOf(z));
  expect(e.left).toBe(s.remaining() - e.price!);
});

test("estimateAt: unit and support prices at the spot, and why it can't go there", () => {
  const s = new Sim(42);
  expect(s.setZone(zoneAroundCenter(s, 20))).toBeNull();
  const ok = first(s, i => s.canPlace("turret", i % s.w, (i / s.w) | 0) === null)!;
  const e = estimateAt(s, "turret", ok[0], ok[1], [])!;
  expect(e.price).toBe(s.unitCost("turret", ok[0], ok[1]));
  expect(e.blocked).toBeNull();
  const w = first(s, i => s.map.tile[i] === WATER)!;
  expect(estimateAt(s, "turret", w[0], w[1], [])!.blocked).toBe(s.canPlace("turret", w[0], w[1]));
  expect(estimateAt(s, "turret", w[0], w[1], [])!.blocked).not.toBeNull();
  const b = first(s, i => s.inZone[i] === 1 && s.map.tile[i] === BUILDING)!;
  expect(estimateAt(s, "evac", b[0], b[1], [])!.price).toBe(s.supportCost("evac", b[0], b[1]));
  for (const t of ["pan", "order", "gate", "remove", "c4", "depot", "airstrike"]) expect(estimateAt(s, t, ok[0], ok[1], [])).toBeNull();
});

test("estimateAt: short of money still shows the price, with a negative balance", () => {
  const s = new Sim(42);
  expect(s.setZone(zoneAroundCenter(s, 20))).toBeNull();
  const ok = first(s, i => s.canPlace("turret", i % s.w, (i / s.w) | 0) === null)!;
  s.budget -= s.remaining() - 1000; // leave $1,000
  expect(s.canPlace("turret", ok[0], ok[1])).toBe("Not enough budget.");
  const e = estimateAt(s, "turret", ok[0], ok[1], [])!;
  expect(e.blocked).toBeNull();
  expect(e.price).toBe(s.unitCost("turret", ok[0], ok[1]));
  expect(e.left).toBe(1000 - e.price!);
  expect(e.left!).toBeLessThan(0);
});
