import { expect, test } from "bun:test";
import { Sim, CIV, INF, DEAD, SAFE_CIV } from "../src/sim";
import type { Unit } from "../src/sim";
import { BUILDING, WATER } from "../src/map";
import * as C from "../src/config";
import { nextOrder, ARRIVE_R, ESCORT_R } from "../src/orders";
import type { Order } from "../src/orders";

export function zoneAroundCenter(s: Sim, half = 30): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
/** A sim with a zone and one APC on a street inside it. */
export function withApc(seed = 42): { s: Sim; apc: Unit } {
  const s = new Sim(seed, { budget: 500_000_000 } as any);
  expect(s.setZone(zoneAroundCenter(s, 30))).toBeNull();
  for (let i = 0; i < s.w * s.h; i++) {
    const x = i % s.w, y = (i / s.w) | 0;
    if (s.inZone[i] === 1 && s.canPlace("apc", x, y) === null) { expect(s.place("apc", x, y)).toBeNull(); return { s, apc: s.units[s.units.length - 1] }; }
  }
  throw new Error("no APC cell");
}
/** A walkable street cell at least `min` cells from (x, y), searching outward. */
export function streetFrom(s: Sim, x: number, y: number, min: number, max = 60): [number, number] {
  for (let d = min; d < max; d++) for (let a = 0; a < 64; a++) {
    const cx = Math.round(x + Math.cos(a / 64 * 6.283) * d), cy = Math.round(y + Math.sin(a / 64 * 6.283) * d);
    if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) continue;
    if (s.map.tile[s.idx(cx, cy)] === 0 && s.inZone[s.idx(cx, cy)] !== 2 && s.inZone[s.idx(cx, cy)] !== 3) return [cx, cy];
  }
  throw new Error("no street");
}

test("nextOrder: keeps the head until it arrives, patrols swap ends, escorts stay", () => {
  const mv: Order = { k: "move", x: 10, y: 10 }, mv2: Order = { k: "amove", x: 20, y: 10 };
  expect(nextOrder([mv, mv2], 12, 10)).toEqual([mv, mv2]);
  expect(nextOrder([mv, mv2], 11, 10)).toEqual([mv2]);
  expect(ARRIVE_R).toBe(1.5);
  const pt: Order = { k: "patrol", x: 10, y: 10, px: 30, py: 10 };
  expect(nextOrder([pt], 10.5, 10)).toEqual([{ k: "patrol", x: 30, y: 10, px: 10, py: 10 }]);
  const es: Order = { k: "escort", x: 10, y: 10, who: 5 };
  expect(nextOrder([es], 10, 10)).toEqual([es]);
  expect(nextOrder([], 0, 0)).toEqual([]);
});

test("issue / queue / replace / stop / stand by", () => {
  const { s, apc } = withApc();
  const [x1, y1] = streetFrom(s, apc.x, apc.y, 10), [x2, y2] = streetFrom(s, apc.x, apc.y, 20);
  expect(s.issue(apc, { k: "move", x: x1, y: y1 }, false)).toBeNull();
  expect(apc.orders!.length).toBe(1); expect(apc.cmd).toBe(true);
  expect(s.issue(apc, { k: "amove", x: x2, y: y2 }, true)).toBeNull();
  expect(apc.orders!.length).toBe(2);
  expect(s.issue(apc, { k: "move", x: x2, y: y2 }, false)).toBeNull();
  expect(apc.orders!.length).toBe(1);
  let b = -1; for (let i = 0; i < s.w * s.h; i++) if (s.map.tile[i] === BUILDING) { b = i; break; }
  expect(s.issue(apc, { k: "move", x: b % s.w, y: (b / s.w) | 0 }, false)).toBe(s.orderUnit({ ...apc }, b % s.w, (b / s.w) | 0));
  s.stopUnit(apc);
  expect(apc.orders).toEqual([]); expect(apc.holdAt).toEqual([apc.x, apc.y]); expect(apc.standby).toBe(false); expect(apc.cmd).toBe(true);
  s.standBy(apc);
  expect(apc.standby).toBe(true);
  expect(s.issue(apc, { k: "move", x: x1, y: y1 }, false)).toBeNull();
  expect(apc.standby).toBe(false);
});

test("a patrol starts from where the unit is (or the last queued point)", () => {
  const { s, apc } = withApc();
  const [x1, y1] = streetFrom(s, apc.x, apc.y, 10), [x2, y2] = streetFrom(s, apc.x, apc.y, 20);
  expect(s.issue(apc, { k: "patrol", x: x1, y: y1 }, false)).toBeNull();
  expect(apc.orders![0]).toEqual({ k: "patrol", x: x1, y: y1, px: apc.x, py: apc.y });
  expect(s.issue(apc, { k: "move", x: x1, y: y1 }, false)).toBeNull();
  expect(s.issue(apc, { k: "patrol", x: x2, y: y2 }, true)).toBeNull();
  expect(apc.orders![1]).toEqual({ k: "patrol", x: x2, y: y2, px: x1, py: y1 });
});

test("escort needs a living person; canOrder", () => {
  const { s, apc } = withApc();
  let k = -1; for (let i = 0; i < s.civN; i++) if (s.state[i] === CIV) { k = i; break; }
  expect(s.issue(apc, { k: "escort", x: 0, y: 0, who: k }, false)).toBeNull();
  s.state[k] = DEAD;
  expect(s.issue(apc, { k: "escort", x: 0, y: 0, who: k }, false)).not.toBeNull();
  expect(s.issue(apc, { k: "escort", x: 0, y: 0, who: -1 }, false)).not.toBeNull();
  expect(s.canOrder(apc)).toBe(true);
  for (let i = 0; i < s.w * s.h; i++) { const x = i % s.w, y = (i / s.w) | 0; if (s.inZone[i] === 1 && s.canPlace("turret", x, y) === null) { s.place("turret", x, y); break; } }
  expect(s.canOrder(s.units.find(u => u.kind === "turret")!)).toBe(false);
  const child = { ...apc, kind: "militia", parentUnit: apc } as Unit;
  expect(s.canOrder(child)).toBe(false);
  apc.extractT = 3;
  expect(s.canOrder(apc)).toBe(false);
});

// ---- Task 2: orders drive the unit ----
/** Battle running, no waves, no civilians in the way; infected pinned at fixed spots with huge hp. */
function battle(s: Sim) {
  s.dev.waves = false; s.dev.bites = false; s.dev.unitDamage = false;
  s.devRemoveCivilians(0);
  s.startBattle();
  (s as any).outbreak = true;
  s.devClearInfected();
}
function pinned(s: Sim, pts: [number, number][]) {
  const ks: number[] = [];
  for (const [x, y] of pts) {
    expect(s.spawnInfected(x + 0.5, y + 0.5, 1e9, false)).toBe(true);
    for (let k = s.civN; k < s.n; k++) if (s.state[k] === INF && s.ax[k] === x + 0.5 && s.ay[k] === y + 0.5 && !ks.includes(k)) { ks.push(k); break; }
  }
  expect(ks.length).toBe(pts.length);
  return () => { for (let j = 0; j < ks.length; j++) { s.ax[ks[j]] = pts[j][0] + 0.5; s.ay[ks[j]] = pts[j][1] + 0.5; if (s.state[ks[j]] !== INF) s.state[ks[j]] = INF; } };
}
function run(s: Sim, secs: number, each?: () => void) { for (let t = 0; t < secs * C.TICK_HZ; t++) { s.step(); each?.(); } }
/** Five infected 8 cells to the side of the halfway point between a and b (inside APC range, outside its flee radius). */
function besideRoute(s: Sim, a: [number, number], b: [number, number]): [number, number][] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  const nx = -dy / l, ny = dx / l, out: [number, number][] = [];
  for (const side of [1, -1]) for (let r = 7; r < 12 && out.length < 5; r++) {
    const x = Math.round(mx + nx * r * side), y = Math.round(my + ny * r * side);
    if (x >= 0 && y >= 0 && x < s.w && y < s.h && s.map.tile[s.idx(x, y)] !== WATER && !out.some(p => p[0] === x && p[1] === y)) out.push([x, y]);
  }
  return out;
}

test("0.45: a moved APC reaches its point through infected, firing on the way", () => {
  const { s, apc } = withApc();
  const start: [number, number] = [apc.x, apc.y], tgt = streetFrom(s, apc.x, apc.y, 22);
  battle(s);
  const pin = pinned(s, besideRoute(s, start, tgt));
  expect(s.issue(apc, { k: "move", x: tgt[0], y: tgt[1] }, false)).toBeNull();
  run(s, 40, pin);
  expect(Math.hypot(apc.x - tgt[0], apc.y - tgt[1])).toBeLessThanOrEqual(ARRIVE_R + 0.5);
  expect(apc.shotT).toBeGreaterThan(0); // it fired (on the move or once there)
});

test("0.45: the same APC without orders stops to fight (control)", () => {
  const { s, apc } = withApc();
  const start: [number, number] = [apc.x, apc.y], tgt = streetFrom(s, apc.x, apc.y, 22);
  battle(s);
  const pin = pinned(s, besideRoute(s, start, tgt));
  expect(s.orderUnit(apc, tgt[0], tgt[1])).toBeNull();
  run(s, 40, pin);
  expect(Math.hypot(apc.x - tgt[0], apc.y - tgt[1])).toBeGreaterThan(ARRIVE_R + 0.5);
});

test("0.45: stand by holds fire and holds still", () => {
  const { s, apc } = withApc();
  battle(s);
  const near = streetFrom(s, apc.x, apc.y, 6);
  const pin = pinned(s, [near]);
  s.standBy(apc);
  const x0 = apc.x, y0 = apc.y;
  run(s, 10, pin);
  expect(apc.shotT).toBeLessThan(0);
  expect(Math.abs(apc.x - x0) + Math.abs(apc.y - y0)).toBeLessThan(0.01);
});

test("0.45: a unit whose queue ran out holds there and never chases", () => {
  const { s, apc } = withApc();
  const p = streetFrom(s, apc.x, apc.y, 8);
  battle(s);
  expect(s.issue(apc, { k: "move", x: p[0], y: p[1] }, false)).toBeNull();
  run(s, 20);
  expect(apc.orders!.length).toBe(0);
  expect(apc.holdAt).toEqual([p[0], p[1]]);
  const far = streetFrom(s, p[0], p[1], 25, 35); // outside its 13-cell range, inside the old 50-cell leash
  const pin = pinned(s, [far, [far[0] + 1, far[1]], [far[0], far[1] + 1]]);
  run(s, 20, pin);
  expect(Math.hypot(apc.x - p[0], apc.y - p[1])).toBeLessThan(2);
});

test("0.45: a low-ammo unit goes to rearm (0.60: engineers at the wall), then finishes its queue", () => {
  const { s, apc } = withApc();
  const a = streetFrom(s, apc.x, apc.y, 10), b = streetFrom(s, apc.x, apc.y, 18);
  battle(s);
  expect(s.issue(apc, { k: "move", x: a[0], y: a[1] }, false)).toBeNull();
  expect(s.issue(apc, { k: "move", x: b[0], y: b[1] }, true)).toBeNull();
  apc.ammo = 10; apc.reserve = 0; // 0.60: no spares left, so it waits at the wall for an engineer
  let rearmed = false;
  run(s, 240, () => { if (apc.ai === "supply" || apc.ai === "reload") rearmed = true; });
  expect(rearmed).toBe(true);
  expect(apc.ammo).toBeGreaterThan(10);
  expect(Math.hypot(apc.x - b[0], apc.y - b[1])).toBeLessThanOrEqual(ARRIVE_R + 0.5);
  expect(apc.orders!.length).toBe(0);
});

test("0.45: an unreachable point: it holds instead of jittering", () => {
  const { s, apc } = withApc();
  // a street cell outside the zone: the zone's walls (gates count as walls for this check: lock them) cut it off
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 3) { s.inZone[i] = 2; s.wallHp[i] = s.wallMaxHp(); }
  s.fieldDirty = true;
  let out: [number, number] | null = null;
  for (let d = 35; d < 80 && !out; d++) { const c = streetFrom(s, apc.x, apc.y, d, d + 1); if (s.inZone[s.idx(c[0], c[1])] === 0) out = c; }
  battle(s);
  expect(s.issue(apc, { k: "move", x: out![0], y: out![1] }, false)).toBeNull();
  run(s, 15);
  const x0 = apc.x, y0 = apc.y;
  run(s, 5);
  expect(Math.hypot(apc.x - x0, apc.y - y0)).toBeLessThan(1);
});

// ---- Task 3: escort ----
function aFamily(s: Sim): number {
  for (let k = 0; k < s.civN; k++) if (s.famLead[k] === k && s.famSize[k] >= 3 && s.state[k] === CIV) return k;
  throw new Error("no family");
}

test("0.45: escortCenter is the middle of the living family", () => {
  const { s } = withApc();
  const lead = aFamily(s), n = s.famSize[lead];
  let x = 0, y = 0; for (let m = lead; m < lead + n; m++) { x += s.ax[m]; y += s.ay[m]; }
  const c = s.escortCenter(lead + 1)!;
  expect(c[0]).toBeCloseTo(x / n, 4); expect(c[1]).toBeCloseTo(y / n, 4);
  s.state[lead] = DEAD;
  let x2 = 0, y2 = 0; for (let m = lead + 1; m < lead + n; m++) { x2 += s.ax[m]; y2 += s.ay[m]; }
  expect(s.escortCenter(lead)![0]).toBeCloseTo(x2 / (n - 1), 4);
  for (let m = lead; m < lead + n; m++) s.state[m] = INF;
  expect(s.escortCenter(lead)).toBeNull();
});

test("0.45: an escort ends (and holds) when its family is safe, or gone", () => {
  for (const end of [SAFE_CIV, DEAD]) {
    const { s, apc } = withApc();
    const lead = aFamily(s);
    s.dev.waves = false; s.dev.bites = false; s.startBattle();
    expect(s.issue(apc, { k: "escort", x: 0, y: 0, who: lead }, false)).toBeNull();
    for (let m = lead; m < lead + s.famSize[lead]; m++) s.state[m] = end;
    run(s, 3);
    expect(apc.orders!.length).toBe(0);
    expect(apc.holdAt).toBeDefined();
  }
}, 60000);

test("0.45: an escort keeps up with its family", () => {
  const { s, apc } = withApc();
  // an Apache (flies over the zone walls) guarding a family walking 20 cells along streets outside the zone
  let heli: Unit | null = null;
  for (let i = 0; i < s.w * s.h && !heli; i++) { const x = i % s.w, y = (i / s.w) | 0; if (s.inZone[i] === 1 && s.canPlace("apache", x, y) === null) { s.place("apache", x, y); heli = s.units[s.units.length - 1]; } }
  const lead = aFamily(s), n = s.famSize[lead];
  s.dev.waves = false; s.dev.bites = false; s.startBattle();
  let a: [number, number] | null = null;
  for (let d = 34; d < 70 && !a; d++) { const c = streetFrom(s, apc.x, apc.y, d, d + 1); if (s.inZone[s.idx(c[0], c[1])] === 0) a = c; }
  let b: [number, number] | null = null;
  for (let d = 20; d < 40 && !b; d++) { const c = streetFrom(s, a![0], a![1], d, d + 1); if (s.inZone[s.idx(c[0], c[1])] === 0) b = c; }
  for (let m = lead; m < lead + n; m++) s.state[m] = CIV;
  expect(s.issue(heli!, { k: "escort", x: 0, y: 0, who: lead }, false)).toBeNull();
  let worst = 0;
  for (let t = 0; t < 40 * C.TICK_HZ; t++) {
    const f = Math.max(0, Math.min(1, (t - 15 * C.TICK_HZ) / (20 * C.TICK_HZ))); // 15 s to get there, then 20 s walking
    for (let m = lead; m < lead + n; m++) { s.ax[m] = a![0] + 0.5 + (b![0] - a![0]) * f + (m - lead) * 0.2; s.ay[m] = a![1] + 0.5 + (b![1] - a![1]) * f; s.state[m] = CIV; }
    s.step();
    if (t > 37 * C.TICK_HZ) { const c = s.escortCenter(lead)!; worst = Math.max(worst, Math.hypot(heli!.x + 0.5 - c[0], heli!.y + 0.5 - c[1])); }
  }
  expect(heli!.orders!.length).toBe(1);
  expect(worst).toBeLessThan(ESCORT_R + 2);
}, 60000);

// ---- Task 4: group orders and Recall ----
function apcs(s: Sim, n: number): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < s.w * s.h && out.length < n; i++) { const x = i % s.w, y = (i / s.w) | 0; if (s.inZone[i] === 1 && s.canPlace("apc", x, y) === null) { s.place("apc", x, y); out.push(s.units[s.units.length - 1]); } }
  expect(out.length).toBe(n);
  return out;
}

test("0.45: a group order spreads the units over distinct cells around the click", () => {
  const { s, apc } = withApc();
  const us = [apc, ...apcs(s, 3)];
  const t = streetFrom(s, apc.x, apc.y, 15);
  expect(s.issueGroup(us, { k: "move", x: t[0], y: t[1] }, false)).toBeNull();
  const cells = us.map(u => `${u.orders![0].x},${u.orders![0].y}`);
  expect(new Set(cells).size).toBe(4);
  expect(us[0].orders![0]).toEqual({ k: "move", x: t[0], y: t[1] });
  for (const u of us) expect(Math.hypot(u.orders![0].x - t[0], u.orders![0].y - t[1])).toBeLessThanOrEqual(4);
  // deterministic: same call, same cells
  const again = us.map(u => ({ ...u, orders: [] as any[] })) as Unit[];
  expect(s.issueGroup(again, { k: "move", x: t[0], y: t[1] }, false)).toBeNull();
  expect(again.map(u => `${u.orders![0].x},${u.orders![0].y}`)).toEqual(cells);
});

test("0.45: Recall keeps each commanded unit's queue and Send back restores it", () => {
  const { s, apc } = withApc();
  const [b] = apcs(s, 1);
  const p1 = streetFrom(s, apc.x, apc.y, 10), p2 = streetFrom(s, apc.x, apc.y, 18);
  expect(s.issue(apc, { k: "move", x: p1[0], y: p1[1] }, false)).toBeNull();
  expect(s.issue(apc, { k: "patrol", x: p2[0], y: p2[1] }, true)).toBeNull();
  s.standBy(b);
  const before = JSON.parse(JSON.stringify({ a: apc.orders, b: b.orders, bs: b.standby, bh: b.holdAt }));
  s.startBattle();
  expect(s.recallAll()).toBeGreaterThan(0);
  expect(apc.orders).toEqual([]);
  expect(s.recallAll()).toBeGreaterThan(0); // send back
  expect(JSON.parse(JSON.stringify({ a: apc.orders, b: b.orders, bs: b.standby, bh: b.holdAt }))).toEqual(before);
});

test("0.45: Recall of a unit without orders works as before", () => {
  const { s, apc } = withApc();
  const post = [...apc.post!];
  s.startBattle();
  s.recallAll();
  expect(apc.recallFrom).toEqual(post);
  s.recallAll();
  expect(apc.post).toEqual(post);
  expect(apc.cmd).toBeUndefined();
});

test("0.45: a new order takes a unit off the recall", () => {
  const { s, apc } = withApc();
  const p1 = streetFrom(s, apc.x, apc.y, 10), p2 = streetFrom(s, apc.x, apc.y, 18);
  expect(s.issue(apc, { k: "move", x: p1[0], y: p1[1] }, false)).toBeNull();
  s.startBattle();
  s.recallAll();
  expect(s.issue(apc, { k: "move", x: p2[0], y: p2[1] }, false)).toBeNull();
  expect(apc.recallOrders).toBeUndefined();
  s.recallAll(); // send back: it keeps its new order
  expect(apc.orders![0]).toEqual({ k: "move", x: p2[0], y: p2[1] });
});

// ---- Task 5: orders in planning, plans and snapshots ----
import { cleanOrders } from "../src/orders";
import * as Save from "../src/save";

test("0.45: cleanOrders keeps good orders and drops junk", () => {
  const good = [{ k: "move", x: 3, y: 4 }, { k: "patrol", x: 1, y: 2, px: 5, py: 6 }, { k: "escort", x: 0, y: 0, who: 12 }];
  expect(cleanOrders(good)).toEqual(good);
  expect(cleanOrders([])).toEqual([]);
  expect(cleanOrders("x")).toBeUndefined();
  expect(cleanOrders([{ k: "fly", x: 1, y: 1 }])).toBeUndefined();
  expect(cleanOrders([{ k: "move", x: "1", y: 1 }])).toBeUndefined();
  expect(cleanOrders([{ k: "patrol", x: 1, y: 1 }])).toBeUndefined(); // a patrol needs its other end
  expect(cleanOrders([{ k: "escort", x: 1, y: 1 }])).toBeUndefined(); // an escort needs a person
  expect(cleanOrders(new Array(65).fill({ k: "move", x: 1, y: 1 }))).toBeUndefined(); // absurd length
});

test("0.45: saved plans keep unit orders; old plans and junk still load", () => {
  const base = { settings: { fullscreen: true, edgeScroll: false, showRanges: false }, best: {}, plans: {} as any };
  base.plans["quick"] = { poly: [[0, 0], [5, 0], [5, 5]], walls: [], units: [["apc", 3, 3, "near", [{ k: "move", x: 9, y: 9 }], true], ["apc", 6, 6, "near", "junk"], ["turret", 1, 1]] };
  const u = Save.clean(base as any).plans["quick"].units;
  expect(u[0]).toEqual(["apc", 3, 3, "near", [{ k: "move", x: 9, y: 9 }], true]);
  expect(u[1]).toEqual(["apc", 6, 6, "near"]);
  expect(u[2]).toEqual(["turret", 1, 1]);
});

test("0.45: an order given in planning starts with the battle", () => {
  const { s, apc } = withApc();
  const t = streetFrom(s, apc.x, apc.y, 15);
  expect(s.phase).toBe("plan");
  expect(s.issue(apc, { k: "move", x: t[0], y: t[1] }, false)).toBeNull();
  s.dev.waves = false; s.dev.bites = false; s.startBattle();
  run(s, 30);
  expect(Math.hypot(apc.x - t[0], apc.y - t[1])).toBeLessThanOrEqual(ARRIVE_R + 0.5);
}, 60000);

test("0.45: a battle saved mid-queue loads back with the same orders and plays on identically", async () => {
  const { pack, unpack } = await import("../src/snapshot");
  const { s, apc } = withApc();
  const [b] = apcs(s, 1);
  const p1 = streetFrom(s, apc.x, apc.y, 12), p2 = streetFrom(s, apc.x, apc.y, 20);
  s.issue(apc, { k: "amove", x: p1[0], y: p1[1] }, false); s.issue(apc, { k: "patrol", x: p2[0], y: p2[1] }, true);
  s.standBy(b);
  s.dev.waves = false; s.startBattle();
  run(s, 3);
  const snap = await unpack(await pack(C.VERSION, "t", s, { cityId: "x", cam: { x: 0, y: 0, scale: 1 } }));
  const c = snap.sim as Sim;
  expect(c.units.map(u => [u.orders, u.cmd, u.standby, u.holdAt])).toEqual(s.units.map(u => [u.orders, u.cmd, u.standby, u.holdAt]));
  for (let i = 0; i < 200; i++) { s.step(); c.step(); }
  expect(c.units.map(u => [u.x, u.y])).toEqual(s.units.map(u => [u.x, u.y]));
}, 120000);

// ---- final review fixes ----
test("review: Shift-queued patrol points make one loop through every point and the start", () => {
  const S = [0, 0], A = [10, 0], B = [10, 10];
  let q: Order[] = [{ k: "patrol", x: A[0], y: A[1], px: S[0], py: S[1] }, { k: "patrol", x: B[0], y: B[1], px: A[0], py: A[1] }];
  const visits: string[] = [];
  for (let i = 0; i < 7; i++) { const h = q[0]; visits.push(`${h.x},${h.y}`); q = nextOrder(q, h.x + 0.5, h.y + 0.5); }
  expect(visits).toEqual(["10,0", "10,10", "0,0", "10,0", "10,10", "0,0", "10,0"]);
});

test("review: arrival is measured to the cell center everywhere", () => {
  const o: Order = { k: "move", x: 10, y: 10 };
  // 1.4 cells from the center (10.5, 10.5) but 1.9 from the corner: that counts as there
  expect(nextOrder([o], 10.5 + 1.4, 10.5)).toEqual([]);
  expect(nextOrder([o], 10.5 + 1.6, 10.5)).toEqual([o]);
});

test("review: an order to a spot the unit can't reach is dropped with a message; the queue goes on", () => {
  const { s, apc } = withApc();
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 3) { s.inZone[i] = 2; s.wallHp[i] = s.wallMaxHp(); }
  s.fieldDirty = true;
  let out: [number, number] | null = null;
  for (let d = 35; d < 80 && !out; d++) { const c = streetFrom(s, apc.x, apc.y, d, d + 1); if (s.inZone[s.idx(c[0], c[1])] === 0) out = c; }
  const inside = streetFrom(s, apc.x, apc.y, 10);
  s.dev.waves = false; s.dev.bites = false; s.startBattle();
  expect(s.issue(apc, { k: "move", x: out![0], y: out![1] }, false)).toBeNull();
  expect(s.issue(apc, { k: "move", x: inside[0], y: inside[1] }, true)).toBeNull();
  run(s, 20);
  expect(s.orderLog.some(m => /can't get there/i.test(m))).toBe(true);
  expect(Math.hypot(apc.x - inside[0], apc.y - inside[1])).toBeLessThanOrEqual(ARRIVE_R + 0.5);
}, 60000);

test("review: the battle keeps each unit's planning orders for Retry", () => {
  const { s, apc } = withApc();
  const [b] = apcs(s, 1);
  const t = streetFrom(s, apc.x, apc.y, 12);
  expect(s.issue(apc, { k: "move", x: t[0], y: t[1] }, false)).toBeNull();
  s.dev.waves = false; s.startBattle();
  expect(apc.planOrders).toEqual({ orders: [{ k: "move", x: t[0], y: t[1] }], standby: false });
  expect(b.planOrders).toBeUndefined(); // never ordered in planning
  s.stopUnit(b); run(s, 2);
  expect(b.planOrders).toBeUndefined(); // ordered only in battle: Retry brings it back uncommanded
  expect(apc.planOrders!.orders.length).toBe(1); // a copy: the live queue running out doesn't touch it
});

test("0.50: cleanOrders keeps fortify orders (street cell + roof cell)", () => {
  expect(cleanOrders([{ k: "fortify", x: 3, y: 4, px: 5, py: 6 }])).toEqual([{ k: "fortify", x: 3, y: 4, px: 5, py: 6 }]);
  expect(cleanOrders([{ k: "fortify", x: 3, y: 4 }])).toBeUndefined();
});
