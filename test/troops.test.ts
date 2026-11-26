// 0.50: Troops (ex-Garrison) and Sniper teams on the ground or fortified on a roof; fortify, dismount, zone deploy.
import { expect, test } from "bun:test";
import { Sim } from "../src/sim";
import { BUILDING, WATER } from "../src/map";
import * as C from "../src/config";

import { zone, mk, zoneRoof, zoneStreet, outsideStreet } from "./troopsFixture";
void zone;

test("placing Troops on a roof in planning starts them fortified", () => {
  const s = mk(), [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  const u = s.units[s.units.length - 1];
  expect(u.fort).toBe("up");
  expect(s.isFortified(u)).toBe(true);
  expect(s.canOrder(u)).toBe(true);
  expect(u.soldiers!.length).toBe(4);
  for (const so of u.soldiers!) expect(s.buildingId[s.idx(so.x | 0, so.y | 0)]).toBe(s.buildingId[s.idx(x, y)]);
});

test("placing Troops on a street inside a zone starts a ground squad that holds", () => {
  const s = mk(), [x, y] = zoneStreet(s);
  expect(s.place("garrison", x, y)).toBeNull();
  const u = s.units[s.units.length - 1];
  expect(u.fort).toBeUndefined();
  expect(s.isFortified(u)).toBe(false);
  expect(u.ai).toBe("hold");
  for (const so of u.soldiers!) expect(s.map.tile[s.idx(so.x | 0, so.y | 0)]).not.toBe(BUILDING);
});

test("Snipers can't go on a street outside a zone in planning; Troops can (0.53: flown in anywhere)", () => {
  const s = mk(), [x, y] = outsideStreet(s);
  expect(s.place("sniper", x, y)).toBe("Snipers go on a roof, or a street inside a safe zone.");
  expect(s.place("garrison", x, y)).toBeNull();
});

test("display name is Troops; one fortified squad per building", () => {
  expect(C.UNITS.garrison.name).toBe("Troops");
  const s = mk(), [x, y] = zoneRoof(s);
  expect(s.place("garrison", x, y)).toBeNull();
  let msg: string | null = null;
  for (let i = 0; i < s.inZone.length && !msg; i++) if (s.map.tile[i] === BUILDING && s.buildingId[i] === s.buildingId[s.idx(x, y)] && (i % s.w !== x || ((i / s.w) | 0) !== y)) msg = s.canPlace("garrison", i % s.w, (i / s.w) | 0);
  expect(msg).toBe("One Troops squad per building.");
});

test("RF5: a 0.49 plan's Garrisons on roofs come back fortified", () => {
  const s0 = mk(), [x, y] = zoneRoof(s0);
  const planUnits: [C.UnitKind, number, number][] = [["garrison", x, y], ["sniper", ...zoneRoof(s0, 400)]];
  const s = mk();
  for (const [k, px, py] of planUnits) expect(s.place(k, px, py)).toBeNull();
  for (const u of s.units) expect(u.fort).toBe("up");
});

// ---- Task 2: ground squads ----
function groundTroops(s: Sim): import("../src/sim").Unit {
  const [x, y] = zoneStreet(s); expect(s.place("garrison", x, y)).toBeNull(); return s.units[s.units.length - 1];
}
function streetCellAway(s: Sim, x0: number, y0: number, dmin: number, inZone: boolean): [number, number] {
  let best: [number, number] = [-1, -1], bd = 1e9;
  for (let i = 0; i < s.inZone.length; i++) {
    if ((s.inZone[i] === 1) !== inZone || s.map.tile[i] === BUILDING || s.map.tile[i] === WATER) continue;
    const x = i % s.w, y = (i / s.w) | 0, d = Math.abs(Math.hypot(x - x0, y - y0) - dmin);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

test("a ground Troops squad moves on a right-click order and holds after", () => {
  const s = mk(), u = groundTroops(s);
  s.dev.bites = false; s.dev.waves = false; s.startBattle(); s.devClearInfected();
  const [tx, ty] = streetCellAway(s, u.x, u.y, 15, true);
  expect(s.issue(u, { k: "move", x: tx, y: ty }, false)).toBeNull();
  for (let t = 0; t < 30 && Math.hypot(u.x + 0.5 - (tx + 0.5), u.y + 0.5 - (ty + 0.5)) > 1.5; t += C.DT) s.step();
  expect(Math.hypot(u.x + 0.5 - (tx + 0.5), u.y + 0.5 - (ty + 0.5))).toBeLessThanOrEqual(1.5);
  const at = [u.x, u.y]; s.devClearInfected();
  for (let t = 0; t < 10; t += C.DT) s.step();
  expect(Math.hypot(u.x - at[0], u.y - at[1])).toBeLessThan(1.5);
  for (const so of u.soldiers!) expect(Math.hypot(so.x - (u.x + 0.5), so.y - (u.y + 0.5))).toBeLessThan(3.5);
}, 120000);

test("an unordered ground squad holds and fires", () => {
  const s = mk(), u = groundTroops(s);
  s.dev.bites = false; s.dev.waves = false; s.startBattle(); s.devClearInfected();
  const at = [u.x, u.y], [ix, iy] = streetCellAway(s, u.x, u.y, 8, true);
  for (let j = 0; j < 5; j++) s.spawnInfected(ix + 0.5, iy + 0.5, 50);
  for (let t = 0; t < 5; t += C.DT) s.step();
  expect(u.kills).toBeGreaterThan(0);
  expect(Math.hypot(u.x - at[0], u.y - at[1])).toBeLessThan(1.5);
}, 120000);

test("ground soldiers can be bitten and turn", () => {
  const s = mk(), u = groundTroops(s);
  s.dev.waves = false; s.startBattle(); s.devClearInfected();
  for (let j = 0; j < 30; j++) s.spawnInfected(u.x + 0.5, u.y + 0.5, 1e9);
  for (let t = 0; t < 20; t += C.DT) s.step();
  expect(s.soldiersTurned).toBeGreaterThan(0);
}, 120000);

test("top-up works on a ground squad", () => {
  const s = mk(), u = groundTroops(s);
  s.dev.bites = false; s.dev.waves = false; s.startBattle();
  u.soldiers![0].alive = false;
  expect(s.topUp(u)).toBeNull();
  expect(u.soldiers!.filter(so => so.alive).length).toBe(4);
  const n = u.soldiers!.find(so => so.alive && so !== u.soldiers![1] && so !== u.soldiers![2] && so !== u.soldiers![3]) ?? u.soldiers![0];
  expect(s.map.tile[s.idx(n.x | 0, n.y | 0)]).not.toBe(BUILDING);
}, 120000);

test("RF3: a squad outside a zone with no ammo holds fire; back in a zone it is not refilled for free (0.60: engineers)", () => {
  const s = mk(), u = groundTroops(s);
  s.dev.bites = false; s.dev.waves = false; s.dev.unitDamage = false; s.startBattle(); s.devClearInfected();
  let ox = -1; const oy = u.y; // due east, past the zone's east wall (34 cells from its middle), on this street
  for (let x = u.x + 40; x < s.w && ox < 0; x++) if (s.inZone[s.idx(x, oy)] === 0 && s.map.tile[s.idx(x, oy)] !== BUILDING && s.map.tile[s.idx(x, oy)] !== WATER) ox = x;
  expect(ox).toBeGreaterThan(0);
  expect(s.issue(u, { k: "move", x: ox, y: oy }, false)).toBeNull();
  for (let t = 0; t < 60 && !(s.inZone[s.idx(u.x | 0, u.y | 0)] === 0 && !s.unitInZone(u)); t += C.DT) s.step();
  expect(s.unitInZone(u)).toBe(false);
  expect(Number.isFinite(u.ammo)).toBe(true);
  u.ammo = 0; u.reserve = 0; const k0 = u.kills; // 0.60: no spares either
  for (let j = 0; j < 5; j++) s.spawnInfected(u.x + 3.5, u.y + 0.5, 50);
  for (let t = 0; t < 3; t += C.DT) s.step();
  expect(u.kills).toBe(k0);
  s.devClearInfected();
  const [bx, by] = zoneStreet(s);
  expect(s.issue(u, { k: "move", x: bx, y: by }, false)).toBeNull();
  for (let t = 0; t < 60 && s.inZone[s.idx(u.x | 0, u.y | 0)] !== 1; t += C.DT) s.step();
  s.step();
  expect(u.ammo).toBe(0); // 0.60: no endless zone ammo; an engineer brings a crate (test/engineers.test.ts)
}, 120000);

// ---- Task 3: fortify and dismount ----
function roofNear(s: Sim, x0: number, y0: number, dmin: number, notBuilding = -2): [number, number] {
  let best: [number, number] = [-1, -1], bd = 1e9;
  for (let i = 0; i < s.inZone.length; i++) {
    if (s.inZone[i] !== 1 || s.map.tile[i] !== BUILDING || s.buildingId[i] < 0 || s.buildingId[i] === notBuilding) continue;
    const x = i % s.w, y = (i / s.w) | 0, d = Math.abs(Math.hypot(x - x0, y - y0) - dmin);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
function battle(s: Sim, bites = false) { s.dev.bites = bites; s.dev.waves = false; s.startBattle(); s.devClearInfected(); }

test("fortify: walk, climb FORTIFY_S without firing, then fortified on the roof", () => {
  const s = mk(), u = groundTroops(s); battle(s);
  const [rx, ry] = roofNear(s, u.x, u.y, 10);
  expect(s.issue(u, { k: "fortify", x: rx, y: ry }, false)).toBeNull();
  for (let t = 0; t < 40 && u.fort !== "climb"; t += C.DT) s.step();
  expect(u.fort).toBe("climb");
  const k0 = u.kills;
  for (let j = 0; j < 5; j++) s.spawnInfected(u.x + 4.5, u.y + 0.5, 50);
  for (let t = 0; t < C.FORTIFY_S - 0.5; t += C.DT) s.step();
  expect(u.kills).toBe(k0);
  expect(u.fort).toBe("climb");
  for (let t = 0; t < 1; t += C.DT) s.step();
  expect(u.fort).toBe("up");
  const id = s.buildingId[s.idx(rx, ry)];
  for (const so of u.soldiers!) expect(s.buildingId[s.idx(so.x | 0, so.y | 0)]).toBe(id);
}, 120000);

test("climbing soldiers can be bitten, fortified ones can't", () => {
  const s = mk(), u = groundTroops(s); battle(s, true);
  const [rx, ry] = roofNear(s, u.x, u.y, 10);
  expect(s.issue(u, { k: "fortify", x: rx, y: ry }, false)).toBeNull();
  for (let t = 0; t < 40 && u.fort !== "climb"; t += C.DT) s.step();
  for (let j = 0; j < 30; j++) s.spawnInfected(u.x + 0.5, u.y + 0.5, 1e9);
  for (let t = 0; t < C.FORTIFY_S - 0.5; t += C.DT) s.step();
  expect(s.soldiersTurned).toBeGreaterThan(0);
  const s2 = mk(), [fx, fy] = zoneRoof(s2); expect(s2.place("garrison", fx, fy)).toBeNull(); battle(s2, true);
  const f = s2.units[s2.units.length - 1];
  for (const so of f.soldiers!) for (let j = 0; j < 6; j++) s2.spawnInfected(so.x, so.y, 1e9);
  for (let t = 0; t < 20; t += C.DT) s2.step();
  expect(s2.soldiersTurned).toBe(0);
}, 120000);

test("RF2: fortifying a building that gets taken drops the order", () => {
  const s = mk(), a = groundTroops(s);
  const [x2, y2] = streetCellAway(s, a.x, a.y, 3, true); expect(s.place("garrison", x2, y2)).toBeNull();
  const b = s.units[s.units.length - 1]; battle(s);
  const [rx, ry] = roofNear(s, a.x, a.y, 8);
  expect(s.issue(a, { k: "fortify", x: rx, y: ry }, false)).toBeNull();
  expect(s.issue(b, { k: "fortify", x: rx, y: ry }, false)).toBeNull();
  for (let t = 0; t < 60 && !(a.fort === "up" || b.fort === "up"); t += C.DT) s.step();
  for (let t = 0; t < 15; t += C.DT) s.step();
  const up = [a, b].filter(u => u.fort === "up"), down = [a, b].filter(u => u.fort === undefined);
  expect(up.length).toBe(1); expect(down.length).toBe(1);
  expect(down[0].orders?.length ?? 0).toBe(0);
  expect(s.orderLog.some(l => l.includes("per building"))).toBe(true);
}, 120000);

test("dismount: DISMOUNT_S on the roof, then a ground squad beside the building", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1]; battle(s);
  expect(s.dismount(u)).toBeNull();
  expect(u.fort).toBe("descend");
  for (let t = 0; t < C.DISMOUNT_S - 0.3; t += C.DT) s.step();
  expect(u.fort).toBe("descend");
  for (let t = 0; t < 0.5; t += C.DT) s.step();
  expect(u.fort).toBeUndefined();
  expect(s.map.tile[s.idx(u.x | 0, u.y | 0)]).not.toBe(BUILDING);
  expect(u.ai).toBe("hold");
  for (const so of u.soldiers!) expect(s.map.tile[s.idx(so.x | 0, so.y | 0)]).not.toBe(BUILDING);
}, 120000);

test("dismount refuses a ground squad; fortify refuses other units and streets", () => {
  const s = mk(), u = groundTroops(s);
  expect(s.dismount(u)).toBe("Already on the ground.");
  const [sx, sy] = zoneStreet(s);
  expect(s.issue(u, { k: "fortify", x: sx, y: sy }, false)).toBe("Click a roof to fortify.");
});

// ---- Task 4: zone deploy, Repair Yard cap ----
test("placeFromZone puts a ground squad in the zone and charges the price line", () => {
  const s = mk(); battle(s);
  const z = s.zoneAt(...zoneStreet(s));
  expect(z).toBe(0);
  const price = s.unitCost("garrison"), left = s.remaining();
  expect(s.placeFromZone("garrison", z)).toBeNull();
  const u = s.units[s.units.length - 1];
  expect(u.kind).toBe("garrison"); expect(u.fort).toBeUndefined();
  expect(s.inZone[s.idx(u.x, u.y)]).toBe(1);
  expect(left - s.remaining()).toBe(price);
  expect(s.unitCost("garrison")).toBeGreaterThanOrEqual(price);
  expect(s.zoneAt(...outsideStreet(s))).toBe(-1);
});

test("placeFromZone refuses in planning", () => {
  const s = mk();
  expect(s.placeFromZone("garrison", 0)).toBe("Buy Troops at a zone during the battle; in planning place them directly.");
});

// ---- 0.50 final review fixes ----
test("C1: a fortified squad sent to another roof comes down, walks and fortifies there", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1]; battle(s);
  const [rx, ry] = roofNear(s, fx, fy, 14, s.buildingId[s.idx(fx, fy)]);
  expect(s.issue(u, { k: "fortify", x: rx, y: ry }, false)).toBeNull();
  for (let t = 0; t < 60 && !(u.fort === "up" && s.buildingId[s.idx(u.x, u.y)] === s.buildingId[s.idx(rx, ry)]); t += C.DT) s.step();
  expect(u.fort).toBe("up");
  expect(s.buildingId[s.idx(u.x, u.y)]).toBe(s.buildingId[s.idx(rx, ry)]);
}, 120000);

test("C1/I4: a move order to a fortified squad brings it down and it goes", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1]; battle(s);
  const [tx, ty] = streetCellAway(s, fx, fy, 15, true);
  expect(s.issue(u, { k: "move", x: tx, y: ty }, false)).toBeNull();
  for (let t = 0; t < 60 && Math.hypot(u.x - tx, u.y - ty) > 1.5; t += C.DT) s.step();
  expect(u.fort).toBeUndefined();
  expect(Math.hypot(u.x - tx, u.y - ty)).toBeLessThanOrEqual(1.5);
}, 120000);

test("I1: fortifying a perimeter building picks a base on the squad's side of the wall", () => {
  const s = mk(), u = groundTroops(s); s.closeAllGates(); battle(s);
  // a building cell next to the wall whose nearest street is outside the zone
  let pick: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !pick; i++) {
    if (s.inZone[i] !== 1 || s.map.tile[i] !== BUILDING || s.buildingId[i] < 0) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const j = s.idx(x + dx, y + dy); if (s.inZone[j] === 0 && s.map.tile[j] !== BUILDING) pick = [x, y]; }
  }
  expect(pick).not.toBeNull();
  if (s.issue(u, { k: "fortify", x: pick![0], y: pick![1] }, false)) return; // taken etc.: nothing to check
  const o = u.orders![0];
  expect(s.inZone[s.idx(o.x, o.y)]).toBe(1);
}, 120000);

test("I2: topping up a fortified squad puts the soldier on its roof", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1]; battle(s);
  const so = u.soldiers![0]; so.alive = false; so.x = 2.5; so.y = 2.5; // died somewhere else (on the ground, before)
  expect(s.topUp(u)).toBeNull();
  expect(s.buildingId[s.idx(so.x | 0, so.y | 0)]).toBe(s.buildingId[s.idx(fx, fy)]);
}, 60000);

test("I3: Recall brings unordered ground Troops into the zone", () => {
  const s = mk(), u = groundTroops(s); battle(s); s.dev.unitDamage = false;
  let ox = -1; for (let x = Math.floor(u.x) + 40; x < s.w && ox < 0; x++) if (s.inZone[s.idx(x, u.y)] === 0 && s.map.tile[s.idx(x, u.y)] !== BUILDING && s.map.tile[s.idx(x, u.y)] !== WATER) ox = x;
  expect(s.issue(u, { k: "move", x: ox, y: u.y }, false)).toBeNull();
  for (let t = 0; t < 60 && s.unitInZone(u); t += C.DT) s.step();
  for (let t = 0; t < 20 && u.orders?.length; t += C.DT) s.step();
  s.stopUnit(u); u.cmd = false; u.orders = []; // an unordered squad out there
  for (let t = 0; t < 2; t += C.DT) s.step();
  expect(s.unitInZone(u)).toBe(false);
  expect(s.recallAll()).toBeGreaterThan(0);
  for (let t = 0; t < 40 && !s.unitInZone(u); t += C.DT) { s.devClearInfected(); s.step(); } // nothing to stop and shoot at
  expect(s.unitInZone(u)).toBe(true);
}, 120000);

test("I5: a ground squad gets no roof bonus (not from rail/highway codes, not from fragile walls)", () => {
  const s = new Sim(42, { budget: 400_000_000, mutators: ["fragile_walls"] }); expect(s.setZone(zone(s))).toBeNull();
  const [x, y] = zoneStreet(s); expect(s.place("sniper", x, y)).toBeNull();
  const u = s.units[s.units.length - 1];
  s.map.height[s.idx(x, y)] = 3; // a station code on a road cell
  s.refreshAuras();
  expect(u.range).toBe(C.UNITS.sniper.range);
});

test("I6: mid-battle, the Troops tool on a roof deploys from the nearest zone and sends them to fortify it", () => {
  const s = mk(); battle(s);
  const [rx, ry] = zoneRoof(s);
  expect(s.placeTroopsAt("garrison", rx, ry)).toBeNull();
  const u = s.units[s.units.length - 1];
  expect(u.fort).toBeUndefined();
  expect(s.map.tile[s.idx(u.x, u.y)]).not.toBe(BUILDING);
  expect(u.orders?.[0]?.k).toBe("fortify");
});

test("M3: in planning, fortify and dismount happen at once", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1];
  expect(s.dismount(u)).toBeNull();
  expect(u.fort).toBeUndefined();
  expect(s.map.tile[s.idx(u.x, u.y)]).not.toBe(BUILDING);
  expect(s.issue(u, { k: "fortify", x: fx, y: fy }, false)).toBeNull();
  expect(u.fort).toBe("up");
});

test("M6: Retry keeps squads where they were planned, not where they ended up", () => {
  const s = mk(), [fx, fy] = zoneRoof(s); expect(s.place("garrison", fx, fy)).toBeNull();
  const u = s.units[s.units.length - 1]; battle(s);
  expect(s.dismount(u)).toBeNull();
  for (let t = 0; t < 6; t += C.DT) s.step();
  expect(u.planPos).toEqual([fx, fy]);
});

test("0.52: climbing soldiers walk to the foot of the building, never into it", () => {
  const { Sim } = require("../src/sim"); const C2 = require("../src/config");
  const city = C2.CITIES.find((c: any) => c.id === "fairhaven");
  const s = new Sim(101, { city });
  s.setZone([[165, 82], [217, 82], [217, 130], [165, 130]]);
  expect(s.place("garrison", 191, 119)).toBeNull();
  s.startBattle(); for (let i = 0; i < 60; i++) s.step();
  const u = s.units[0], d0 = u.soldiers.map((so: any) => Math.hypot(so.x - 192.5, so.y - 126.5));
  expect(s.issue(u, { k: "fortify", x: 192, y: 126 }, false)).toBeNull();
  for (let i = 0; i < 20 * 4; i++) { s.step(); for (const so of u.soldiers) expect(s.map.tile[s.idx(Math.floor(so.x), Math.floor(so.y))]).not.toBe(1); }
  expect(u.fort).toBe("climb");
  u.soldiers.forEach((so: any, k: number) => expect(Math.hypot(so.x - 192.5, so.y - 126.5)).toBeLessThan(d0[k]));
}, 120_000);
