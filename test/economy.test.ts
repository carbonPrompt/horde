// 0.48: difficulty reaches the wallet. Money by difficulty, the unit price line, Paratroopers price line,
// cost of operations (Insane), saved per $1M and Under Budget, minimap alerts.
import { expect, test } from "bun:test";
import { Sim } from "../src/sim";
import { BUILDING } from "../src/map";
import * as C from "../src/config";
import * as Save from "../src/save";
import { mergeEfficiency } from "../src/scoring";
import { pickPing } from "../src/minimap";

function zone(s: Sim, half = 34): [number, number][] {
  const cx = s.w / 2, cy = s.h / 4;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}
function roofs(s: Sim, n = 60) {
  const out: [number, number][] = [];
  for (let i = 0; i < s.inZone.length && out.length < n; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) out.push([i % s.w, (i / s.w) | 0]);
  return out;
}
function placeOne(s: Sim, kind: C.UnitKind, spots: [number, number][]) {
  for (const [x, y] of spots) if (!s.place(kind, x, y)) return s.units[s.units.length - 1];
  return undefined;
}

test("starting money and income scale with difficulty; Easy and Medium are unchanged", () => {
  const base = C.startBudget(C.START_BUDGET, C.CIVILIANS);
  for (const d of C.DIFFICULTY_IDS) {
    const s = new Sim(7, { difficulty: d });
    expect(s.budget).toBe(Math.round(base * C.DIFFICULTY[d].budgetMul));
    expect(s.incomeMul).toBeCloseTo(C.DIFFICULTY[d].incomeMul);
    expect(s.killBountyMul).toBeCloseTo(C.DIFFICULTY[d].incomeMul);
  }
  expect(C.DIFFICULTY.easy.budgetMul).toBe(1); expect(C.DIFFICULTY.medium.budgetMul).toBe(1);
  expect(C.DIFFICULTY.hard.budgetMul).toBeLessThan(1); expect(C.DIFFICULTY.insane.budgetMul).toBeLessThan(C.DIFFICULTY.hard.budgetMul);
  // mutators stack with it
  const bm = new Sim(7, { difficulty: "insane", mutators: ["blood_money"] });
  expect(bm.budget).toBe(Math.round(Math.round(base * 0.75) * C.DIFFICULTY.insane.budgetMul));
  expect(bm.incomeMul).toBeCloseTo(2 * C.DIFFICULTY.insane.incomeMul);
});

test("price line: each standing unit of a kind raises the next; removing one moves the rest up; refunds exact", () => {
  const s = new Sim(42, { difficulty: "hard", budget: 400_000_000 });
  expect(s.setZone(zone(s))).toBeNull();
  const spots = roofs(s), base = C.UNITS.garrison.cost, step = C.DIFFICULTY.hard.priceStep;
  expect(s.unitCost("garrison")).toBe(base);
  const a = placeOne(s, "garrison", spots)!; expect(a.paid).toBe(base);
  const b = placeOne(s, "garrison", spots)!; expect(b.paid).toBe(Math.round(base * (1 + step)));
  const c = placeOne(s, "garrison", spots)!; expect(c.paid).toBe(Math.round(base * (1 + 2 * step)));
  expect(s.unitCost("garrison")).toBe(Math.round(base * (1 + 3 * step)));
  // another kind has its own line
  expect(s.unitCost("sniper")).toBe(C.UNITS.sniper.cost);
  const spent = s.spent(), bOld = b.paid!, cOld = c.paid!;
  expect(s.removeEntity({ unit: a })).toBe(true);
  expect(s.spent()).toBe(spent - base - (bOld - base) - (cOld - Math.round(base * (1 + step)))); // b, c move up a place
  expect(b.paid).toBe(base); expect(c.paid).toBe(Math.round(base * (1 + step)));
  expect(s.unitCost("garrison")).toBe(Math.round(base * (1 + 2 * step)));
});

test("price line in battle: a lost unit lowers the next price; Easy has none", () => {
  const s = new Sim(42, { difficulty: "insane", budget: 400_000_000 });
  s.setZone(zone(s));
  const spots = roofs(s);
  placeOne(s, "garrison", spots); placeOne(s, "garrison", spots);
  s.startBattle();
  const step = C.DIFFICULTY.insane.priceStep, base = C.UNITS.garrison.cost;
  expect(s.unitCost("garrison")).toBe(Math.round(base * (1 + 2 * step)));
  s.units[0].hp = 0; // as if overrun (garrisons have no hp: give it one at 0)
  expect(s.unitCost("garrison")).toBe(Math.round(base * (1 + step)));
  const e = new Sim(42, { difficulty: "easy", budget: 400_000_000 });
  e.setZone(zone(e));
  const es = roofs(e);
  placeOne(e, "garrison", es); placeOne(e, "garrison", es);
  expect(e.unitCost("garrison")).toBe(base);
});

test("Paratroopers follow the price line; other abilities stay flat; selling refunds the last", () => {
  const s = new Sim(7, { difficulty: "hard", budget: 400_000_000 });
  s.setZone(zone(s));
  const base = C.ABILITIES.para.cost, step = C.DIFFICULTY.hard.priceStep;
  const m0 = s.remaining();
  expect(s.buyAbility("para")).toBeNull(); expect(s.buyAbility("para")).toBeNull(); expect(s.buyAbility("para")).toBeNull();
  const want = base + Math.round(base * (1 + step)) + Math.round(base * (1 + 2 * step));
  expect(m0 - s.remaining()).toBe(want);
  expect(s.abilityCost("para")).toBe(Math.round(base * (1 + 3 * step)));
  expect(s.sellAbility("para")).toBe(true);
  expect(m0 - s.remaining()).toBe(want - Math.round(base * (1 + 2 * step)));
  expect(s.abilityCost("airstrike")).toBe(C.ABILITIES.airstrike.cost);
  s.buyAbility("airstrike"); expect(s.abilityCost("airstrike")).toBe(C.ABILITIES.airstrike.cost);
  // in battle the ledger charges the stepped price
  s.startBattle();
  const before = s.remaining(), price = s.abilityCost("para");
  expect(s.buyAbility("para")).toBeNull();
  expect(before - s.remaining()).toBe(price);
});

test("cost of operations: Insane only, charged with income, never below zero", () => {
  const run = (d: C.Difficulty, budget?: number) => {
    const s = new Sim(42, { difficulty: d, ...(budget ? { budget } : {}) });
    s.setZone(zone(s));
    const spots = roofs(s);
    for (let i = 0; i < 3; i++) placeOne(s, "garrison", spots);
    s.startBattle();
    return s;
  };
  const m = run("medium");
  expect(m.upkeepDue()).toBe(0);
  const s = run("insane", 400_000_000);
  const paid = s.units.reduce((a, u) => a + (u.paid ?? 0), 0) + s.supports.reduce((a, b) => a + b.paid, 0);
  expect(s.upkeepDue()).toBe(Math.round(paid * C.DIFFICULTY.insane.upkeepPct));
  const spent0 = s.spent();
  for (let i = 0; i < 20 * (C.INCOME_EVERY_S + 0.5); i++) s.step();
  expect(s.upkeepPaid).toBeGreaterThan(0);
  expect(s.lastUpkeep).toBeGreaterThan(0);
  expect(s.spent()).toBeGreaterThanOrEqual(spent0 + s.upkeepPaid);
  // broke: upkeep stops at zero money
  const b = run("insane");
  b.battleSpend += b.remaining() + b.earned; // spend everything
  for (let i = 0; i < 20 * (C.INCOME_EVERY_S * 2 + 0.5); i++) b.step();
  expect(b.remaining()).toBeGreaterThanOrEqual(0);
}, 120_000);

test("no pause / locked speed is Hard and Insane only (config)", () => {
  expect(C.DIFFICULTY.easy.noPause).toBe(false); expect(C.DIFFICULTY.medium.noPause).toBe(false);
  expect(C.DIFFICULTY.hard.noPause).toBe(true); expect(C.DIFFICULTY.insane.noPause).toBe(true);
  expect(C.DIFFICULTY.insane.upkeepPct).toBeGreaterThan(0); expect(C.DIFFICULTY.hard.upkeepPct).toBe(0);
});

test("score: people saved per $1M and Under Budget", () => {
  const s = new Sim(7);
  s.setZone(zone(s));
  s.startBattle();
  s.evacuated = 1000;
  const r = s.scoreNow("test");
  expect(r.perM).toBeCloseTo(1000 / (s.spent() / 1e6));
  expect(r.underBudget).toBe(!!r.medal && s.spent() <= C.UNDER_BUDGET_PCT * (s.budget + s.earned));
  // best record keeps the higher efficiency and the badge once won
  let b: Save.Best = { pct: 50, medal: "Bronze" };
  b = mergeEfficiency(b, 12.5, false); expect(b.perM).toBe(12.5); expect(b.underBudget).toBeUndefined();
  b = mergeEfficiency(b, 9, true); expect(b.perM).toBe(12.5); expect(b.underBudget).toBe(true);
  b = mergeEfficiency(b, 20, false); expect(b.perM).toBe(20); expect(b.underBudget).toBe(true);
  // saves: kept when well formed, dropped when not; old records load unchanged
  const d = Save.clean({ settings: {} as any, best: { a: { pct: 40, medal: null, perM: 33.3, underBudget: true }, b: { pct: 40, medal: null, perM: -1, underBudget: "yes" } as any, c: { pct: 10, medal: null } }, plans: {} });
  expect(d.best.a).toEqual({ pct: 40, medal: null, perM: 33.3, underBudget: true });
  expect(d.best.b).toEqual({ pct: 40, medal: null });
  expect(d.best.c).toEqual({ pct: 10, medal: null });
});

test("minimap alerts: throttled per area and kind, battle only, F picks the most urgent", () => {
  const s = new Sim(7);
  s.setZone(zone(s));
  s.ping("unit", 10, 10); expect(s.pingLog.length).toBe(0); // planning: nothing
  s.startBattle();
  s.ping("unit", 10, 10); s.ping("unit", 12, 11); expect(s.pingLog.length).toBe(1); // same square, inside the gap
  s.ping("bite", 12, 11); expect(s.pingLog.length).toBe(2); // another kind
  s.ping("unit", 10 + C.PING_CELL, 10); expect(s.pingLog.length).toBe(3); // another square
  s.time += C.PING_GAP_S + 0.1;
  s.ping("unit", 10, 10); expect(s.pingLog.length).toBe(4);
  const now = s.time;
  const pick = pickPing([{ kind: "bite", x: 1, y: 1, t: now }, { kind: "unit", x: 2, y: 2, t: now - 1 }, { kind: "breach", x: 3, y: 3, t: now - 3.9 }], now, 4);
  expect(pick?.kind).toBe("breach");
  expect(pickPing([{ kind: "breach", x: 3, y: 3, t: now - 5 }], now, 4)).toBeNull();
});

test("a real battle raises alerts", () => {
  const s = new Sim(7);
  s.setZone(zone(s));
  s.startBattle();
  const seen = new Set<string>();
  for (let i = 0; i < 20 * 150 && seen.size < 2; i++) { s.step(); while (s.pingLog.length) seen.add(s.pingLog.shift()!.kind); }
  expect(seen.has("bite")).toBe(true);
}, 180_000);

test("0.49: support price line: each standing support of a kind multiplies the next by supportMul; removal reprices; Easy flat; pads keep their own line", () => {
  const putSupport = (s: Sim, kind: C.SupportKind) => { for (const [x, y] of roofs(s, 400)) if (!s.placeSupport(kind, x, y)) return s.supports[s.supports.length - 1]; return undefined; };
  const s = new Sim(42, { difficulty: "hard", budget: 400_000_000 });
  expect(s.setZone(zone(s))).toBeNull();
  const base = C.SUPPORTS.repair.cost, mul = C.DIFFICULTY.hard.supportMul;
  expect(mul).toBeGreaterThan(1);
  const yards = [];
  for (let n = 0; n < 3; n++) {
    expect(s.supportCost("repair")).toBe(Math.round(base * Math.pow(mul, n)));
    const b = putSupport(s, "repair"); expect(b).toBeDefined(); yards.push(b!);
    expect(b!.paid).toBe(Math.round(base * Math.pow(mul, n)));
  }
  // other kinds have their own line
  expect(s.supportCost("radio")).toBe(C.SUPPORTS.radio.cost);
  // remove the first yard in planning: the rest move up, spend drops by exactly the top price
  const spent = s.spent();
  expect(s.removeEntity({ support: yards[0] })).toBe(true);
  expect(yards[1].paid).toBe(base); expect(yards[2].paid).toBe(Math.round(base * mul));
  expect(spent - s.spent()).toBe(Math.round(base * mul * mul));
  // Easy: flat
  const e = new Sim(42, { difficulty: "easy", budget: 400_000_000 });
  expect(e.setZone(zone(e))).toBeNull();
  putSupport(e, "repair"); putSupport(e, "repair");
  expect(e.supportCost("repair")).toBe(base);
  // pads: their own doubling line, not supportMul
  const p = new Sim(42, { difficulty: "insane", budget: 400_000_000 });
  expect(p.setZone(zone(p))).toBeNull();
  putSupport(p, "evac");
  expect(p.supportCost("evac")).toBe(Math.round(C.SUPPORTS.evac.cost * C.EVAC_COST_MUL));
});

test("0.50: a 4th Repair Yard is refused (stopgap cap)", () => {
  const s = new Sim(42, { difficulty: "easy", budget: 400_000_000 });
  expect(s.setZone(zone(s))).toBeNull();
  let placed = 0, last: string | null = null;
  for (const [x, y] of roofs(s, 400)) { const e = s.placeSupport("repair", x, y); if (!e) placed++; else if (placed >= C.REPAIR_MAX) { last = e; break; } }
  expect(placed).toBe(C.REPAIR_MAX);
  expect(last).toBe(`Only ${C.REPAIR_MAX} Repair Yards per battle.`);
});
