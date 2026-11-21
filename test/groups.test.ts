// 0.50: battle groups on 1-0: a slot holds units or one safe zone; saved with plans (unit indices) and snapshots.
import { expect, test } from "bun:test";
import { assignGroup, groupUnits, pruneGroups, groupsToPlan, groupsFromPlan, groupSummary, GROUPS, type GroupSlot } from "../src/groups";
import type { Unit } from "../src/sim";
import { pack, unpack } from "../src/snapshot";
import { mk, zoneRoof, zoneStreet } from "./troopsFixture";

const U = (n: number) => ({ kind: "apc", x: n, y: 0 }) as unknown as Unit;
const empty = (): GroupSlot[] => Array(GROUPS).fill(null);
const alive = (dead: Unit[] = []) => (u: Unit) => !dead.includes(u);

test("assign replaces; Shift adds without duplicates", () => {
  const [a, b, c] = [U(1), U(2), U(3)];
  let g = assignGroup(empty(), 2, [{ unit: a }, { unit: b }], -1, false);
  expect(groupUnits(g, 2, alive())).toEqual([a, b]);
  g = assignGroup(g, 2, [{ unit: b }, { unit: c }], -1, true);
  expect(groupUnits(g, 2, alive())).toEqual([a, b, c]);
  g = assignGroup(g, 2, [{ unit: c }], -1, false);
  expect(groupUnits(g, 2, alive())).toEqual([c]);
  expect(g.length).toBe(GROUPS);
});

test("RF4: units and a zone selected: the slot holds the units; a zone alone makes a zone slot", () => {
  const a = U(1);
  expect(assignGroup(empty(), 0, [{ unit: a }], 1, false)[0]).toEqual({ units: [a] });
  expect(assignGroup(empty(), 0, [], 1, false)[0]).toEqual({ zone: 1 });
  expect(assignGroup(empty(), 0, [], -1, false)[0]).toBeNull();
});

test("RF1: a group whose units all died selects nothing and prunes to empty", () => {
  const [a, b] = [U(1), U(2)];
  const g = assignGroup(empty(), 4, [{ unit: a }, { unit: b }], -1, false);
  expect(groupUnits(g, 4, alive([a, b]))).toEqual([]);
  expect(pruneGroups(g, alive([a, b]))[4]).toBeNull();
  expect(pruneGroups(g, alive([a]))[4]).toEqual({ units: [b] });
  expect(groupUnits(empty(), 4, alive())).toEqual([]);
});

test("plan round trip by unit index; junk becomes empty", () => {
  const units = [U(1), U(2), U(3)];
  let g = assignGroup(empty(), 0, [{ unit: units[2] }, { unit: units[0] }], -1, false);
  g = assignGroup(g, 9, [], 0, false);
  const saved = groupsToPlan(g, units);
  expect(saved[0]).toEqual([2, 0]); expect(saved[9]).toEqual({ zone: 0 });
  const back = groupsFromPlan(saved, units, 1);
  expect(groupUnits(back, 0, alive())).toEqual([units[2], units[0]]);
  expect(back[9]).toEqual({ zone: 0 });
  const junk = groupsFromPlan([[99], { zone: 7 }, "x", [1.5]], units.slice(0, 2), 1);
  expect(junk.length).toBe(GROUPS);
  expect(junk.every(x => x === null)).toBe(true);
  expect(groupsFromPlan(undefined, units, 1).every(x => x === null)).toBe(true);
  expect(groupsFromPlan(Array(30).fill([0]), units, 1).every(x => x === null)).toBe(true);
});

test("a new Sim has 10 empty groups (RF5: a 0.49 plan has none); groups drop dead units in battle", () => {
  const s = mk();
  expect(s.groups.length).toBe(GROUPS);
  expect(s.groups.every(x => x === null)).toBe(true);
  const [x, y] = zoneStreet(s); expect(s.place("garrison", x, y)).toBeNull();
  const u = s.units[s.units.length - 1];
  s.groups = assignGroup(s.groups, 0, [{ unit: u }], -1, false);
  s.dev.waves = false; s.startBattle();
  u.hp = -1; // lost
  for (let i = 0; i < 11; i++) s.step(); // pruned every 10 ticks
  expect(s.groups[0]).toBeNull();
}, 60000);

test("a battle snapshot keeps groups pointing at the same units", async () => {
  const s = mk(), [x, y] = zoneRoof(s); expect(s.place("garrison", x, y)).toBeNull();
  s.groups = assignGroup(s.groups, 1, [{ unit: s.units[0] }], -1, false);
  s.dev.waves = false; s.startBattle(); s.step();
  const back = (await unpack(await pack("test", "t", s, {}))).sim;
  expect(groupUnits(back.groups, 1, () => true)[0]).toBe(back.units[0]);
}, 60000);

test("groupSummary: most common kind, living count, health share; zone slots; empty", () => {
  const a = { kind: "garrison", hp: 200, x: 0, y: 0 } as unknown as Unit, b = { kind: "garrison", hp: 400, x: 0, y: 0 } as unknown as Unit, c = { kind: "apc", hp: 900, x: 0, y: 0 } as unknown as Unit;
  const g = assignGroup(empty(), 0, [{ unit: a }, { unit: b }, { unit: c }], -1, false);
  const sm = groupSummary(g[0], alive(), u => (u.kind === "apc" ? 1800 : 400));
  expect(sm).toEqual({ kind: "garrison", count: 3, health: (200 + 400 + 900) / (400 + 400 + 1800) });
  expect(groupSummary({ zone: 2 }, alive(), () => 1)).toEqual({ zone: 2 });
  expect(groupSummary(null, alive(), () => 1)).toBeNull();
  expect(groupSummary(g[0], alive([a, b, c]), () => 1)).toBeNull();
});
