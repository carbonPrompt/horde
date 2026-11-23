// 0.49: squads. Garrison 4, Sniper team 2, Paratroopers 5; each soldier a firing point; one Garrison / Sniper team
// per building; street bites and turning (rooftops are safe).
import { expect, test } from "bun:test";
import { Sim, INF } from "../src/sim";
import { BUILDING, ROAD } from "../src/map";
import * as C from "../src/config";
import { squadSize, soldierStats, labelBuildings, roofSlots, makeSquad, SQUAD_KINDS } from "../src/squads";

test("squad sizes", () => {
  expect(squadSize("garrison")).toBe(4);
  expect(squadSize("sniper")).toBe(2);
  expect(squadSize("para")).toBe(5);
  expect(squadSize("apc")).toBe(0);
  expect(SQUAD_KINDS).toEqual(["garrison", "sniper", "para", "police", "militia"]); // 0.52: police and militia
});

test("a full squad fires what the old single unit fired", () => {
  for (const k of ["garrison", "para"] as C.UnitKind[]) {
    const s = soldierStats(k, "rifle");
    expect(squadSize(k) * s.rate * s.damage).toBeCloseTo(C.UNITS[k].rate! * C.UNITS[k].damage!);
  }
  const sn = soldierStats("sniper", "sniper"), sp = soldierStats("sniper", "spotter");
  expect(sn.damage).toBe(C.UNITS.sniper.damage!); expect(sn.rate).toBe(C.UNITS.sniper.rate!);
  expect(sp.damage).toBe(C.SPOTTER_DMG); expect(sp.rate).toBe(C.SPOTTER_RATE);
  expect(soldierStats("para", "rifle").hp).toBeCloseTo(C.UNITS.para.mobile!.hp / 5);
});

test("labelBuildings: connected building cells, big blocks split into compact pieces, roads -1", () => {
  // 10 x 4: two blocks split by a road column at x=4
  const w = 10, h = 4, tile = new Uint8Array(w * h).fill(BUILDING), height = new Uint8Array(w * h).fill(3);
  for (let y = 0; y < h; y++) tile[y * w + 4] = ROAD;
  height[0] = 5; // a taller cell does not split a building
  const ids = labelBuildings(tile, height, w, h, 1000);
  expect(ids[4]).toBe(-1);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[0]).not.toBe(ids[5]);
  expect(new Set([...ids].filter(i => i >= 0)).size).toBe(2);
  // a 30 x 30 block with pieces of at most 100 cells (side 10): 9 pieces, none over 100 cells
  const W = 30, big = new Uint8Array(W * W).fill(BUILDING), bh = new Uint8Array(W * W).fill(2);
  const bids = labelBuildings(big, bh, W, W, 100);
  const count = new Map<number, number>(); for (const i of bids) count.set(i, (count.get(i) ?? 0) + 1);
  expect(count.size).toBe(9);
  expect(Math.max(...count.values())).toBeLessThanOrEqual(100);
});

test("roofSlots: n distinct cells on that building", () => {
  const w = 10, h = 4, tile = new Uint8Array(w * h).fill(BUILDING), height = new Uint8Array(w * h).fill(3);
  for (let y = 0; y < h; y++) tile[y * w + 4] = ROAD;
  const ids = labelBuildings(tile, height, w, h, 1000);
  const slots = roofSlots(ids, w, ids[0], 1, 1, 4);
  expect(slots.length).toBe(4);
  expect(new Set(slots.map(([x, y]) => x + "," + y)).size).toBe(4);
  for (const [x, y] of slots) expect(ids[y * w + x]).toBe(ids[0]);
  // a tiny building with fewer cells than soldiers still gives n slots (they share cells, spread inside them)
  expect(roofSlots(ids, w, ids[0], 1, 1, 40).length).toBe(40);
});

test("makeSquad: one soldier per slot with stats and names, deterministic", () => {
  const a = makeSquad("sniper", [[1, 1], [2, 1]], 42), b = makeSquad("sniper", [[1, 1], [2, 1]], 42);
  expect(a.map(s => s.role)).toEqual(["sniper", "spotter"]);
  expect(a[0].name).toBe(b[0].name);
  expect(a[0].name.length).toBeGreaterThan(3);
  expect(a.every(s => s.alive && s.hp > 0 && s.ammo > 0)).toBe(true);
  expect(makeSquad("garrison", [[0, 0], [1, 0], [0, 1], [1, 1]], 1).every(s => s.role === "rifle")).toBe(true);
});

test("buildings on real maps stay small enough", () => {
  const s = new Sim(7);
  const count = new Map<number, number>(); for (const i of s.buildingId) if (i >= 0) count.set(i, (count.get(i) ?? 0) + 1);
  expect(count.size).toBeGreaterThan(20);
  expect(Math.max(...count.values())).toBeLessThanOrEqual(C.BUILDING_MAX_CELLS);
});

// ---------- Task 2: placement ----------
function zoneAt(s: Sim, half = 34): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
/** Two different cells of one building inside the zone, at least 3 apart (so footprints don't overlap). */
function sameBuilding(s: Sim): [[number, number], [number, number]] {
  const byId = new Map<number, [number, number][]>();
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) {
    const id = s.buildingId[i]; const l = byId.get(id) ?? []; l.push([i % s.w, (i / s.w) | 0]); byId.set(id, l);
  }
  for (const l of byId.values()) for (const a of l) for (const b of l) if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) >= 4) return [a, b];
  throw new Error("no building big enough");
}

test("one Garrison and one Sniper team per building; a Sniper may share with a Garrison", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  expect(s.setZone(zoneAt(s))).toBeNull();
  const [a, b] = sameBuilding(s);
  expect(s.place("garrison", a[0], a[1])).toBeNull();
  expect(s.canPlace("garrison", b[0], b[1])).toBe("One Troops squad per building.");
  expect(s.place("garrison", b[0], b[1])).toBe("One Troops squad per building.");
  expect(s.place("sniper", b[0], b[1])).toBeNull();
  const g = s.units.find(u => u.kind === "garrison")!;
  expect(g.soldiers!.length).toBe(4);
  for (const so of g.soldiers!) expect(s.buildingId[Math.floor(so.y) * s.w + Math.floor(so.x)]).toBe(s.buildingId[a[1] * s.w + a[0]]);
  const sn = s.units.find(u => u.kind === "sniper")!;
  expect(sn.soldiers!.map(x => x.role)).toEqual(["sniper", "spotter"]);
  // a second sniper team on that building is refused
  const spots: [number, number][] = [];
  const id = s.buildingId[a[1] * s.w + a[0]];
  for (let i = 0; i < s.inZone.length; i++) if (s.buildingId[i] === id) spots.push([i % s.w, (i / s.w) | 0]);
  const msgs = new Set(spots.map(([x, y]) => s.canPlace("sniper", x, y)));
  expect(msgs.has(null)).toBe(false);
  expect(msgs.has("One Sniper team per building.")).toBe(true);
});

test("removing a Garrison frees its building", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  const [a, b] = sameBuilding(s);
  s.place("garrison", a[0], a[1]);
  expect(s.removeEntity({ unit: s.units[0] })).toBe(true);
  expect(s.place("garrison", b[0], b[1])).toBeNull();
});

test("paratroopers land as 5 soldiers on open ground around the drop", () => {
  const s = new Sim(7, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  expect(s.buyAbility("para")).toBeNull();
  s.startBattle();
  let at: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (x > 20 && y > 20 && x < s.w - 20 && y < s.h - 20) at = [x, y]; }
  expect(s.useAbility("para", at![0], at![1])).toBeNull();
  for (let i = 0; i < 20 * 15 && !s.units.some(u => u.kind === "para"); i++) s.step(); // the moment they land
  const p = s.units.find(u => u.kind === "para")!;
  expect(p.soldiers!.length).toBe(5);
  for (const so of p.soldiers!) {
    expect(Math.hypot(so.x - at![0], so.y - at![1])).toBeLessThan(4);
    const t = s.map.tile[Math.floor(so.y) * s.w + Math.floor(so.x)];
    expect(t === BUILDING || t === 3).toBe(false);
  }
}, 60_000);

// ---------- Task 3: every soldier fires ----------
/** A Garrison with a steady supply of infected in range for `sec` seconds; returns shots fired. */
function firing(kill: number, sec = 5, kind: C.UnitKind = "garrison") {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  const [a] = sameBuilding(s);
  expect(s.place(kind, a[0], a[1])).toBeNull();
  s.startBattle();
  const u = s.units[0];
  u.deployT = 0;
  for (let i = 0; i < kill; i++) u.soldiers![i].alive = false;
  (s as any).dev.bites = false;
  let shots = 0;
  const origins = new Set<string>(), classes = new Set<number>();
  const real = (s as any).shoot.bind(s);
  (s as any).shoot = (uu: any, x1: number, y1: number, cls: number, mps: number, delay = 0, ox?: number, oy?: number) => {
    if (uu === u) { shots++; classes.add(cls); origins.add((ox ?? -1).toFixed(1) + "," + (oy ?? -1).toFixed(1)); }
    return real(uu, x1, y1, cls, mps, delay, ox, oy);
  };
  for (let i = 0; i < 20 * sec; i++) {
    // keep infected in range: refill around the unit each second, never on the roof
    if (i % 20 === 0) for (let j = 0; j < 30; j++) s.spawnInfected(a[0] + 0.5 + Math.cos(j) * 8, a[1] + 0.5 + Math.sin(j) * 8, 1e9);
    s.step();
  }
  return { s, u, shots, origins, classes };
}

test("each living soldier fires: losing half the Garrison halves its fire", () => {
  const full = firing(0), half = firing(2);
  expect(full.shots).toBeGreaterThan(0);
  expect(half.shots / full.shots).toBeGreaterThan(0.4);
  expect(half.shots / full.shots).toBeLessThan(0.6);
  // shots leave from the soldiers, not the unit's corner
  expect(full.origins.size).toBeGreaterThan(1);
  expect(full.u.soldiers!.reduce((a, so) => a + so.kills, 0)).toBe(full.u.kills);
}, 120_000);

test("a Sniper team: the sniper fires sniper rounds, the spotter rifle rounds", () => {
  const { classes } = firing(0, 5, "sniper");
  expect(classes.size).toBe(2);
}, 120_000);

test("a Supply Drop refills a paratrooper squad's ammo", () => {
  const s = new Sim(7, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  s.buyAbility("para"); s.buyAbility("supply_drop");
  s.startBattle();
  let at: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (x > 20 && y > 20 && x < s.w - 20 && y < s.h - 20) at = [x, y]; }
  s.useAbility("para", at![0], at![1]);
  for (let i = 0; i < 20 * 15 && !s.units.some(u => u.kind === "para"); i++) s.step();
  const p = s.units.find(u => u.kind === "para")!;
  p.ammo = 0;
  (s as any).applySupplyDrop(p.x + 0.5, p.y + 0.5);
  expect(p.ammo).toBeGreaterThan(0);
}, 60_000);

// ---------- Task 4: bites, turning (design ruling: never on a roof) ----------
/** A Garrison with a crowd of infected packed around its building; returns the sim and unit. */
function crowdAround(crowd: number, standby = true, sec = 40) {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  const [a] = sameBuilding(s);
  s.place("garrison", a[0], a[1]);
  s.startBattle();
  const u = s.units[0]; u.deployT = 0; u.standby = standby; // standby: they hold fire, so the crowd stays
  const so = u.soldiers!;
  const cx = so.reduce((t, x) => t + x.x, 0) / so.length, cy = so.reduce((t, x) => t + x.y, 0) / so.length;
  const pings: string[] = [];
  for (let i = 0; i < 20 * sec; i++) {
    if (i % 20 === 0) { // keep `crowd` infected pressed against the building: on open cells next to it
      let have = 0;
      for (let k = s.civN; k < s.n; k++) if (s.state[k] === INF && Math.hypot(s.ax[k] - cx, s.ay[k] - cy) < C.SQUAD_SPREAD + 2) have++;
      for (let r = 1, added = 0; r < C.SQUAD_SPREAD + 2 && have + added < crowd; r++) for (let dy = -r; dy <= r && have + added < crowd; dy++) for (let dx = -r; dx <= r && have + added < crowd; dx++) {
        const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h || s.map.tile[y * s.w + x] === BUILDING || s.map.tile[y * s.w + x] === 3) continue;
        if (s.spawnInfected(x + 0.5, y + 0.5, 1e9)) added++;
      }
    }
    s.step();
    while (s.pingLog.length) pings.push(s.pingLog.shift()!.kind);
  }
  return { s, u, pings };
}

test("Design ruling: rooftop soldiers can't be bitten, however big the crowd at the walls", () => {
  const { s, u } = crowdAround(200, true, 60);
  expect(u.soldiers!.every(x => x.alive)).toBe(true);
  expect(s.soldiersTurned).toBe(0);
  expect(s.units.includes(u)).toBe(true);
  expect((u as any).storm).toBeUndefined();
}, 300_000);

test("a paratrooper squad bitten to the last soldier is lost once, every soldier turned", () => {
  const s = new Sim(7, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  s.buyAbility("para");
  s.startBattle();
  let at: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (x > 20 && y > 20 && x < s.w - 20 && y < s.h - 20) at = [x, y]; }
  s.useAbility("para", at![0], at![1]);
  for (let i = 0; i < 20 * 15 && !s.units.some(u => u.kind === "para"); i++) s.step();
  const p = s.units.find(u => u.kind === "para")!;
  p.standby = true; p.ammo = 0;
  const lost0 = s.unitsLost;
  for (let i = 0; i < 20 * 120 && s.units.includes(p); i++) {
    for (const so of p.soldiers!) if (so.alive) s.spawnInfected(so.x + 0.3, so.y, 1e9);
    s.step();
  }
  expect(s.units.includes(p)).toBe(false);
  expect(s.unitsLost).toBe(lost0 + 1);
  expect(s.soldiersTurned).toBe(5);
}, 300_000);

test("a paratrooper with infected touching gets bitten", () => {
  const s = new Sim(7, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  s.buyAbility("para");
  s.startBattle();
  let at: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (x > 20 && y > 20 && x < s.w - 20 && y < s.h - 20) at = [x, y]; }
  s.useAbility("para", at![0], at![1]);
  for (let i = 0; i < 20 * 15 && !s.units.some(u => u.kind === "para"); i++) s.step();
  const p = s.units.find(u => u.kind === "para")!;
  p.standby = true; p.ammo = 0;
  const t0 = s.soldiersTurned;
  for (let i = 0; i < 20 * 30 && s.soldiersTurned === t0; i++) {
    for (const so of p.soldiers!) if (so.alive) s.spawnInfected(so.x + 0.3, so.y, 1e9);
    s.step();
  }
  expect(s.soldiersTurned).toBeGreaterThan(t0);
}, 120_000);

// ---------- Task 5: paratroopers move as five soldiers ----------
function landedPara() {
  const s = new Sim(7, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  s.buyAbility("para");
  s.startBattle();
  (s as any).dev.bites = false; (s as any).dev.waves = false;
  let at: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !at; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (x > 30 && y > 30 && x < s.w - 30 && y < s.h - 30) at = [x, y]; }
  s.useAbility("para", at![0], at![1]);
  for (let i = 0; i < 20 * 15 && !s.units.some(u => u.kind === "para"); i++) s.step();
  return { s, p: s.units.find(u => u.kind === "para")!, at: at! };
}
/** A road cell about `d` cells from x,y. */
function roadNear(s: Sim, x: number, y: number, d: number): [number, number] {
  let best: [number, number] = [x, y], bd = Infinity;
  for (let i = 0; i < s.map.tile.length; i++) if (s.map.tile[i] === ROAD && s.inZone[i] === 0) {
    const cx = i % s.w, cy = (i / s.w) | 0, e = Math.abs(Math.hypot(cx - x, cy - y) - d);
    if (e < bd) { bd = e; best = [cx, cy]; }
  }
  return best;
}

test("a moved paratrooper squad arrives together, never on roofs or water", () => {
  const { s, p, at } = landedPara();
  const tgt = roadNear(s, at[0], at[1], 15);
  expect(s.issue(p, { k: "move", x: tgt[0], y: tgt[1] }, false)).toBeNull();
  for (let i = 0; i < 20 * 30; i++) {
    s.step();
    for (const so of p.soldiers!) { const t = s.map.tile[Math.floor(so.y) * s.w + Math.floor(so.x)]; expect(t === BUILDING || t === 3).toBe(false); }
  }
  for (const so of p.soldiers!) expect(Math.hypot(so.x - tgt[0] - 0.5, so.y - tgt[1] - 0.5)).toBeLessThan(3.5);
  const [mx, my] = s.squadCenter(p);
  expect(Math.hypot(mx - tgt[0] - 0.5, my - tgt[1] - 0.5)).toBeLessThan(3);
}, 120_000);

test("two soldiers down, the rest still follow orders", () => {
  const { s, p, at } = landedPara();
  p.soldiers![0].alive = false; p.soldiers![1].alive = false;
  const tgt = roadNear(s, at[0], at[1], 12);
  s.issue(p, { k: "move", x: tgt[0], y: tgt[1] }, false);
  for (let i = 0; i < 20 * 30; i++) s.step();
  for (const so of p.soldiers!.filter(x => x.alive)) expect(Math.hypot(so.x - tgt[0] - 0.5, so.y - tgt[1] - 0.5)).toBeLessThan(3.5);
}, 120_000);

// ---------- Task 6: top-up and refunds ----------
function battleGarrison() {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  const [a] = sameBuilding(s);
  s.place("garrison", a[0], a[1]);
  s.startBattle();
  const u = s.units[0]; u.deployT = 0;
  return { s, u, a };
}

test("top up a half-strength Garrison one soldier at a time for a quarter of its price", () => {
  const { s, u } = battleGarrison();
  u.soldiers![0].alive = false; u.soldiers![1].alive = false;
  const paid0 = u.paid!, m0 = s.remaining(), each = Math.round(paid0 / 4);
  expect(s.topUp(u)).toBeNull();
  expect(u.soldiers!.filter(x => x.alive).length).toBe(3);
  expect(m0 - s.remaining()).toBe(each);
  expect(u.paid).toBe(paid0 + each);
  expect(s.topUp(u)).toBeNull();
  expect(s.topUp(u)).toBe("The squad is at full strength.");
});

test("top up needs money", () => {
  const { s, u } = battleGarrison();
  u.soldiers![0].alive = false;
  s.battleSpend += s.remaining(); // broke
  expect(s.topUp(u)).toBe("Not enough money.");
});

test("selling a half-strength squad refunds what it cost; the next price still counts squads", () => {
  const { s, u, a } = battleGarrison();
  u.soldiers![0].alive = false; u.soldiers![1].alive = false;
  const spent0 = s.spent();
  const t = s.sellAt(a[0] + 0.5, a[1] + 0.5);
  expect(typeof t).toBe("number");
  for (let i = 0; i < 20 * ((t as number) + 1); i++) s.step();
  expect(s.units.includes(u)).toBe(false);
  expect(spent0 - s.spent()).toBe(u.paid!);
  expect(s.unitCost("garrison")).toBe(C.UNITS.garrison.cost); // no squads standing
}, 60_000);

// ---------- Task 7: selection and the soldier card ----------
test("clicking a soldier picks their squad, even away from the squad's point", () => {
  const { s, p } = landedPara();
  const so = p.soldiers![4];
  so.x = p.x + 0.5 + 2.6; so.y = p.y + 0.5; // a soldier off to the side
  const e = s.entityAt(so.x, so.y);
  expect(e && "unit" in e ? e.unit : null).toBe(p);
  const hit = s.soldierAt(so.x + 0.2, so.y);
  expect(hit?.unit).toBe(p); expect(hit?.soldier).toBe(so);
  so.alive = false;
  expect(s.soldierAt(so.x, so.y)?.soldier ?? null).not.toBe(so);
}, 60_000);

test("soldier card lines", async () => {
  const { soldierCardLines } = await import("../src/squads");
  const sq = makeSquad("sniper", [[1, 1], [2, 1]], 7);
  sq[1].kills = 3; sq[1].hp = 60;
  const lines = soldierCardLines("sniper", sq, sq[1]);
  expect(lines[0]).toBe(`Pvt. ${sq[1].name}`);
  expect(lines.slice(1)).toEqual(["Spotter", "Kills 3", `HP 60/${sq[1].hp > 0 ? soldierStats("sniper", "spotter").hp : 0}`, "Squad 2/2"]);
  expect(soldierCardLines("sniper", sq, sq[0])[1]).toBe("Sniper");
  expect(soldierCardLines("garrison", makeSquad("garrison", [[0, 0], [1, 0], [0, 1], [1, 1]], 1), makeSquad("garrison", [[0, 0]], 1)[0])[1]).toBe("Rifleman");
});

test("Design ruling: GARRISON_FIRE_MUL scales a Garrison rifleman's damage, nobody else's", () => {
  const was = C.GARRISON_FIRE_MUL;
  try {
    C.TUNABLE.GARRISON_FIRE_MUL[1](0.5);
    expect(soldierStats("garrison", "rifle").damage).toBe(C.UNITS.garrison.damage! * 0.5);
    expect(soldierStats("para", "rifle").damage).toBe(C.UNITS.para.damage!);
    expect(soldierStats("sniper", "sniper").damage).toBe(C.UNITS.sniper.damage!);
  } finally { C.TUNABLE.GARRISON_FIRE_MUL[1](was); }
});

// ---------- 0.52: soldiers are dots ----------
import { fireTeamForm, roofShuffle, squadSize as sz052, soldierStats as st052, SQUAD_KINDS as SK052 } from "../src/squads";

test("0.52: police and militia are squads with a ring color each; every people kind has a ring", () => {
  expect(sz052("police")).toBe(3); expect(sz052("militia")).toBe(4);
  for (const k of SK052) expect(C.RING_COLOR[k]).toMatch(/^#[0-9a-f]{6}$/);
  expect(new Set(SK052.map(k => C.RING_COLOR[k])).size).toBe(SK052.length); // all different
  expect(st052("police", "rifle").hp).toBeCloseTo(C.UNITS.police.mobile!.hp / 3, 6); // the unit's hp shared out
  expect(st052("militia", "rifle").rate * 4).toBeCloseTo(C.UNITS.militia.rate!, 6); // the squad fires what the unit fired
});

test("0.52: fire team: the leader at the point, file lines up behind the heading, wedge fans out", () => {
  const file = fireTeamForm(1, 0, 4, true);
  expect(Math.hypot(file[0][0], file[0][1])).toBe(0);
  for (let i = 1; i < 4; i++) { expect(file[i][0]).toBeLessThan(file[i - 1][0]); expect(Math.abs(file[i][1])).toBeLessThan(1e-9); }
  const wedge = fireTeamForm(0, 1, 5, false); // walking south: the rest are north of the leader, spread east-west
  for (let i = 1; i < 5; i++) expect(wedge[i][1]).toBeLessThan(0);
  expect(Math.sign(wedge[1][0])).toBe(-Math.sign(wedge[2][0]));
  expect(fireTeamForm(0, 0, 3, false).length).toBe(3); // standing still: still a shape
});

test("0.52: an idle rooftop soldier moves only to a free firing point", () => {
  const slots: [number, number][] = [[1, 1], [2, 1], [3, 1]];
  expect(roofShuffle(slots, [[1.5, 1.5], [2.5, 1.5]], 0.99)).toEqual([3, 1]);
  expect(roofShuffle(slots, [[1.5, 1.5], [2.5, 1.5], [3.4, 1.2]], 0.5)).toBeNull();
});

test("0.52: street width and the lean toward the nearer building front", () => {
  const w = 120, h = 60, tile = new Uint8Array(w * h).fill(BUILDING), height = new Uint8Array(w * h).fill(3);
  for (let y = 20; y < 32; y++) for (let x = 0; x < w; x++) { tile[y * w + x] = ROAD; height[y * w + x] = 0; } // a 12-cell avenue
  for (let y = 0; y < h; y++) for (let x = 50; x < 53; x++) { tile[y * w + x] = ROAD; height[y * w + x] = 0; } // a 3-cell alley
  const s = new Sim(1, { customMap: { w, h, seed: 1, tile, height } } as any) as any;
  expect(s.streetWidth(80.5, 26.5, [1, 0])).toBeGreaterThanOrEqual(12);
  expect(s.streetWidth(51.5, 10.5, [0, 1])).toBeLessThan(4); // the alley: file
  const lean = s.hugWall(80.5, 23.5, [1, 0]); // 3 cells off the north front, 8 off the south one: lean north
  expect(lean[1]).toBeLessThan(0); expect(lean[0]).toBeGreaterThan(0.8);
  expect(s.hugWall(80.5, 21.5, [1, 0])).toEqual([1, 0]); // one cell off the front: walk straight
  expect(s.hugWall(51.5, 10.5, [0, 1])).toEqual([0, 1]); // narrow: no lean
});

test("0.52: a rooftop squad jostles inside its sandbags: wanders when quiet, leans toward its targets in a fight", () => {
  const { s, u } = battleGarrison();
  const ids = new Set(u.soldiers!.map(so => (s as any).buildingId[s.idx(Math.floor(so.x), Math.floor(so.y))]));
  expect(ids.size).toBe(1);
  const start = u.soldiers!.map(so => [so.x, so.y]);
  u.shotT = -1e9; // nothing to shoot
  let moved = false;
  for (let i = 0; i < 20 * 20; i++) {
    u.shotT = -1e9; s.step();
    u.soldiers!.forEach((so, k) => { if (Math.hypot(so.x - start[k][0], so.y - start[k][1]) > 0.5) moved = true; });
    for (const so of u.soldiers!) expect(ids.has((s as any).buildingId[s.idx(Math.floor(so.x), Math.floor(so.y))])).toBe(true);
  }
  expect(moved).toBe(true);
  // 0.52.1: in a fight they keep jostling, shifting toward the side facing their targets, and never leave the sandbags
  const fb = u.fortBox!; const east = fb[0] + 40;
  for (let i = 0; i < 20 * 12; i++) { u.shotT = s.time; for (const so of u.soldiers!) { so.shotT = s.time; so.shotX = east; so.shotY = fb[1] + 1; } s.step();
    for (const so of u.soldiers!) { expect(so.x).toBeGreaterThanOrEqual(fb[0]); expect(so.x).toBeLessThanOrEqual(fb[0] + fb[2]); expect(so.y).toBeGreaterThanOrEqual(fb[1]); expect(so.y).toBeLessThanOrEqual(fb[1] + fb[2]); } }
  const meanX = u.soldiers!.reduce((a, so) => a + so.x, 0) / u.soldiers!.length;
  expect(meanX).toBeGreaterThan(fb[0] + fb[2] / 2); // leaning to the east side, where the targets are
}, 120_000);

test("0.52.1: a rooftop squad holds one 2x2 sandbag block of its own roof, one soldier per cell", () => {
  const { fortBlock } = require("../src/squads");
  const w = 10, ids = new Int32Array(w * 6).fill(-1);
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 6; x++) ids[y * w + x] = 7; // a 5x4 roof
  const fb = fortBlock(ids, w, 7, 6, 1, 4); // placed on the corner
  expect(fb.size).toBe(2);
  for (const [x, y] of fb.slots) expect(ids[y * w + x]).toBe(7); // all on the roof
  expect(new Set(fb.slots.map(([x, y]: number[]) => x + "," + y)).size).toBe(4);
  expect(fb.x).toBe(5); expect(fb.y).toBe(1); // nearest block that fits, not hanging off the corner
  const tiny = new Int32Array(w * 6).fill(-1); tiny[2 * w + 3] = 9;
  expect(fortBlock(tiny, w, 9, 3, 2, 2)).toEqual({ x: 3, y: 2, size: 1, slots: [[3, 2], [3, 2]] });
});

// ---------- 0.53: Troops anywhere by helicopter, elite Paratroopers with a grenadier ----------
test("0.53: Troops go on any roof, street or park (inside or outside a zone); Snipers keep the zone rule", () => {
  const s = new Sim(42, { budget: 400_000_000 });
  s.setZone(zoneAt(s));
  let out: [number, number] | null = null;
  for (let i = 0; i < s.inZone.length && !out; i++) if (s.inZone[i] === 0 && s.map.tile[i] === ROAD) { const x = i % s.w, y = (i / s.w) | 0; if (!s.canPlace("garrison", x, y)) out = [x, y]; }
  expect(out).not.toBeNull();
  expect(s.canPlace("sniper", out![0], out![1])).toMatch(/inside a safe zone/);
  expect(s.place("garrison", out![0], out![1])).toBeNull();
  expect(C.UNITS.garrison.deploy).toBe(20);
  expect(C.ABILITIES.para.delay).toBe(3);
  expect(C.UNITS.para.mobile!.hp).toBe(500); expect(C.UNITS.para.damage).toBe(130);
  expect(C.ABILITIES.para.cost).toBe(2_400_000);
});

test("0.53: the paratroopers' grenadier lobs M320 rounds into a pack, kills several at once, then runs out", () => {
  const { s, p } = landedPara();
  const g = p.soldiers!.find(so => so.role === "grenadier")!;
  expect(g).toBeTruthy(); expect(g.grenades).toBe(C.GREN_AMMO);
  expect(p.soldiers!.filter(so => so.role === "grenadier").length).toBe(1);
  const before = g.grenades!;
  // a tight pack 10 cells off
  let at: [number, number] | null = null;
  for (let d = 9; d <= 12 && !at; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const x = Math.floor(g.x + dx), y = Math.floor(g.y + dy); if (!at && s.map.tile[s.idx(x, y)] === ROAD && s.inZone[s.idx(x, y)] === 0) at = [x + 0.5, y + 0.5]; }
  expect(at).not.toBeNull();
  for (let k = 0; k < 8; k++) s.spawnInfected(at![0] + (k % 3) * 0.3 - 0.3, at![1] + Math.floor(k / 3) * 0.3 - 0.3, 100);
  let blasts = 0;
  for (let i = 0; i < 20 * 3; i++) { s.step(); blasts += (s as any).blasts.filter((b: any) => b.color === "#ffb74d" && b.t === s.time).length; }
  expect(g.grenades!).toBeLessThan(before);
  expect(blasts).toBeGreaterThan(0);
  g.grenades = 0; const left = g.grenades; s.step(); expect(g.grenades).toBe(left); // out: rifle only
}, 120_000);
