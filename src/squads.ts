// 0.49: squads. Garrison, Sniper team and Paratroopers are soldiers, each a firing point that can be bitten and turn.
// Pure helpers (no Sim): squad sizes, per-soldier stats, which rooftop cells make one building, where soldiers stand.
import * as C from "./config";
import { BUILDING } from "./map";
import { soldierName } from "./people";

export interface Soldier {
  x: number; y: number; // map position (cell units, fractional)
  hp: number; ammo: number; cooldown: number; kills: number;
  role: "rifle" | "sniper" | "spotter" | "grenadier"; // 0.53: grenadier = the paratroopers' M320
  grenades?: number; gCool?: number; // 0.53: grenadier rounds left, seconds to the next round
  name: string; alive: boolean;
  shotX: number; shotY: number; shotT: number; // last shot, for tracers and muzzle flash
  lag?: number; // seconds a ground soldier has been left more than 3 cells behind their slot
  to?: [number, number]; // 0.52: a rooftop soldier walking to another firing point (cell) while it is quiet
}

export const SQUAD_KINDS: C.UnitKind[] = ["garrison", "sniper", "para", "police", "militia"]; // 0.52: police and militia too

export function squadSize(kind: C.UnitKind): number {
  return kind === "garrison" ? C.SQUAD_GARRISON : kind === "sniper" ? C.SQUAD_SNIPER : kind === "para" ? C.SQUAD_PARA
    : kind === "police" ? C.SQUAD_POLICE : kind === "militia" ? C.SQUAD_MILITIA : 0;
}

/** One soldier's share of the unit: a full squad fires what the old single unit fired. The spotter carries a rifle. */
export function soldierStats(kind: C.UnitKind, role: Soldier["role"]) {
  const spec = C.UNITS[kind], n = Math.max(1, squadSize(kind));
  const hp = spec.mobile && (kind === "para" || kind === "police" || kind === "militia") ? spec.mobile.hp / n : C.SOLDIER_HP; // 0.50: Troops/Sniper soldiers keep SOLDIER_HP (0.52: police/militia share their unit hp like para)
  if (role === "sniper") return { rate: spec.rate!, damage: spec.damage!, range: spec.range, ammo: spec.ammo, hp };
  if (role === "spotter") return { rate: C.SPOTTER_RATE, damage: C.SPOTTER_DMG, range: Math.min(spec.range, C.UNITS.garrison.range), ammo: spec.ammo * 4, hp };
  const mul = kind === "garrison" ? C.GARRISON_FIRE_MUL : 1;
  return { rate: spec.rate! / n, damage: spec.damage! * mul, range: spec.range, ammo: Math.ceil(spec.ammo / n), hp };
}

/** Building ids: 4-connected BUILDING cells form a building; one bigger than maxCells is cut into square pieces
 *  (side floor(sqrt(maxCells))) so a whole merged city block never counts as one building. -1 elsewhere. */
export function labelBuildings(tile: Uint8Array, height: Uint8Array, w: number, h: number, maxCells: number): Int32Array {
  void height; // heights jitter cell to cell inside one building, so they don't split it
  const comp = new Int32Array(w * h).fill(-1), sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (tile[i] !== BUILDING || comp[i] !== -1) continue;
    const id = sizes.length; let n = 0;
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const c = stack.pop()!; n++;
      const cx = c % w, cy = (c / w) | 0;
      if (cx > 0 && tile[c - 1] === BUILDING && comp[c - 1] === -1) { comp[c - 1] = id; stack.push(c - 1); }
      if (cx < w - 1 && tile[c + 1] === BUILDING && comp[c + 1] === -1) { comp[c + 1] = id; stack.push(c + 1); }
      if (cy > 0 && tile[c - w] === BUILDING && comp[c - w] === -1) { comp[c - w] = id; stack.push(c - w); }
      if (cy < h - 1 && tile[c + w] === BUILDING && comp[c + w] === -1) { comp[c + w] = id; stack.push(c + w); }
    }
    sizes.push(n);
  }
  const side = Math.max(1, Math.floor(Math.sqrt(maxCells)));
  const out = new Int32Array(w * h).fill(-1), key = new Map<string, number>();
  for (let i = 0; i < w * h; i++) {
    const c = comp[i]; if (c < 0) continue;
    const k = sizes[c] <= maxCells ? `${c}` : `${c}:${Math.floor((i % w) / side)}:${Math.floor(i / w / side)}`;
    let id = key.get(k); if (id === undefined) { id = key.size; key.set(k, id); }
    out[i] = id;
  }
  return out;
}

/** n roof cells of building `id` for a squad placed at cx,cy: cells within SQUAD_SPREAD, edge cells first (they see
 *  out), spread evenly around the squad's center. Fewer cells than soldiers: cells are reused. */
export function roofSlots(ids: Int32Array, w: number, id: number, cx: number, cy: number, n: number): [number, number][] {
  const h = ids.length / w, R = C.SQUAD_SPREAD, cells: [number, number, boolean][] = [];
  for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
    if (ids[y * w + x] !== id) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= w || ny >= h || ids[ny * w + nx] !== id; });
    cells.push([x, y, edge]);
  }
  if (!cells.length) return Array.from({ length: n }, () => [cx, cy] as [number, number]);
  const pool = cells.some(c => c[2]) ? cells.filter(c => c[2]) : cells;
  const mx = pool.reduce((a, c) => a + c[0], 0) / pool.length, my = pool.reduce((a, c) => a + c[1], 0) / pool.length;
  pool.sort((a, b) => Math.atan2(a[1] - my, a[0] - mx) - Math.atan2(b[1] - my, b[0] - mx) || a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  if (pool.length >= n) for (let i = 0; i < n; i++) { const c = pool[Math.floor((i * pool.length) / n)]; out.push([c[0], c[1]]); }
  else for (let i = 0; i < n; i++) { const c = (i < pool.length ? pool : cells)[i % (i < pool.length ? pool.length : cells.length)]; out.push([c[0], c[1]]); }
  return out;
}

/** One soldier per slot, standing in the middle of the slot's cell (a reused cell gets a small offset). */
export function makeSquad(kind: C.UnitKind, slots: [number, number][], nameSeed: number): Soldier[] {
  const seen = new Map<string, number>();
  return slots.map(([x, y], i) => {
    const role: Soldier["role"] = kind === "sniper" ? (i === 0 ? "sniper" : "spotter") : kind === "para" && i === 1 ? "grenadier" : "rifle";
    const st = soldierStats(kind, role), k = x + "," + y, dup = seen.get(k) ?? 0; seen.set(k, dup + 1);
    const ox = dup ? ((dup % 2) ? 0.3 : -0.3) : 0, oy = dup ? (dup > 1 ? 0.3 : -0.3) : 0;
    return { ...(role === "grenadier" ? { grenades: C.GREN_AMMO } : {}), x: x + 0.5 + ox, y: y + 0.5 + oy, hp: st.hp, ammo: st.ammo, cooldown: (i * 0.13) % (1 / st.rate), kills: 0, role, name: soldierName(nameSeed, i), alive: true, shotX: 0, shotY: 0, shotT: -1 };
  });
}

/** 0.49: the soldier card (clicked soldier): name, job, kills, health, how much of the squad is left. */
export function soldierCardLines(kind: C.UnitKind, squad: Soldier[], so: Soldier): string[] {
  const role = so.role === "sniper" ? "Sniper" : so.role === "spotter" ? "Spotter" : so.role === "grenadier" ? `Grenadier (M320, ${so.grenades ?? 0} rounds)` : "Rifleman";
  const max = soldierStats(kind, so.role).hp;
  return [`Pvt. ${so.name}`, role, `Kills ${so.kills}`, `HP ${Math.max(0, Math.round(so.hp))}/${Math.round(max)}`, `Squad ${squad.filter(x => x.alive).length}/${squad.length}`];
}

/** 0.52: a fire team's slots behind its point, turned to face the way it walks. Wedge in the open (leader in front,
 *  the rest fanned out behind), file in a narrow or crowded street (one behind the other). Cells; [0,0] is the point. */
export function fireTeamForm(dx: number, dy: number, n: number, narrow: boolean): [number, number][] {
  const d = Math.hypot(dx, dy), fx = d > 1e-6 ? dx / d : 0, fy = d > 1e-6 ? dy / d : 1, sx = -fy, sy = fx; // forward, side
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const back = narrow ? i * 0.9 : Math.ceil(i / 2) * 0.9, side = narrow ? 0 : i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.9;
    out.push([-fx * back + sx * side, -fy * back + sy * side]);
  }
  return out;
}

/** 0.52: an idle rooftop soldier's next firing point: a slot no other soldier stands on, picked by roll in [0,1). */
export function roofShuffle(slots: [number, number][], taken: [number, number][], roll: number): [number, number] | null {
  const free = slots.filter(([x, y]) => !taken.some(([tx, ty]) => Math.floor(tx) === x && Math.floor(ty) === y));
  return free.length ? free[Math.min(free.length - 1, Math.floor(roll * free.length))] : null;
}

/** 0.52.1: one sandbag fortification per rooftop squad (design ruling): the 2x2 block of building `id` nearest (cx,cy) whose four
 *  cells are all that roof; soldiers stand one per cell. A roof too small for a block: the one cell, shared.
 *  Returns the block's top-left cell and size (2, or 1 for the fallback) and n slots (cells) inside it. */
export function fortBlock(ids: Int32Array, w: number, id: number, cx: number, cy: number, n: number): { x: number; y: number; size: number; slots: [number, number][] } {
  const h = ids.length / w, R = C.SQUAD_SPREAD, at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ids[y * w + x] === id;
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    if (!at(x, y) || !at(x + 1, y) || !at(x, y + 1) || !at(x + 1, y + 1)) continue;
    const d = Math.hypot(x + 1 - (cx + 0.5), y + 1 - (cy + 0.5));
    if (d < bd - 1e-9) { bd = d; best = [x, y]; }
  }
  if (!best) return { x: cx, y: cy, size: 1, slots: Array.from({ length: n }, () => [cx, cy] as [number, number]) };
  const cells: [number, number][] = [[best[0], best[1]], [best[0] + 1, best[1]], [best[0], best[1] + 1], [best[0] + 1, best[1] + 1]];
  return { x: best[0], y: best[1], size: 2, slots: Array.from({ length: n }, (_, i) => cells[i % 4]) };
}
