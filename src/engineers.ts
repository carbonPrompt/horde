// 0.60: engineers. Each safe zone has a crew (records on sim.supply[z].crew, like a squad's soldiers): they fetch a
// crate from the zone's store point and carry it to a unit low on ammo, or repair walls and gates. They climb closed
// walls (never a gate) to reach units just outside, up to ENGINEER_LEASH cells out. Outside the wall, or with infected
// next to them, they can be bitten and turn. Deterministic: the sim's own rng, no clocks.
import * as C from "./config";
import { INF, type Sim, type Unit } from "./sim";
import { walkable } from "./map";
import { soldierName } from "./people";
import * as Sup from "./supply";
import * as St from "./stats";

const MAX_BFS = 60000;

export function newEngineer(sim: Sim, z: number, i: number): Sup.Engineer {
  const [x, y] = sim.supply[z]?.store ?? [0, 0];
  return { x: x + 0.5, y: y + 0.5, alive: true, name: soldierName(sim.seed * 31 + z * 97 + 7, i), job: null, carry: null, climbT: 0, path: [], side: "in", workT: 0 };
}

/** Per zone: cells outside the zone within ENGINEER_LEASH of one of its wall cells (distance by BFS over walkable
 *  outside cells). Cached on the navVersion. */
const leashCache = new WeakMap<Sim, { v: number; d: Uint8Array }>();
function leashField(sim: Sim): Uint8Array {
  const c = leashCache.get(sim);
  if (c && c.v === sim.navVersion && c.d.length === sim.inZone.length) return c.d;
  const n = sim.inZone.length, d = new Uint8Array(n).fill(255), q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (sim.inZone[i] === 2 || sim.inZone[i] === 3) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = i % sim.w, y = (i / sim.w) | 0;
    if (d[i] >= C.ENGINEER_LEASH) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= sim.w || ny >= sim.h) continue;
      const j = ny * sim.w + nx;
      if (d[j] !== 255 || sim.inZone[j] !== 0 || !walkable(sim.map.tile[j])) continue;
      d[j] = d[i] + 1; q[qt++] = j;
    }
  }
  leashCache.set(sim, { v: sim.navVersion, d });
  return d;
}

/** Can an engineer stand on cell i: in the zone, on a wall (climbing), through an open gate (nothing is opened for
 *  them), or outside within the leash. */
function passable(sim: Sim, i: number, leash: Uint8Array): boolean {
  const z = sim.inZone[i];
  if (z === 1) return walkable(sim.map.tile[i]);
  if (z === 2) return true; // climbed
  if (z === 3) return sim.wallHp[i] > 0 && !sim.isSwitching(i); // an intact gate standing open
  return leash[i] !== 255 && walkable(sim.map.tile[i]);
}

/** BFS path (cell indices, start excluded) from cell a to the nearest cell in goal; [] if none. */
/** 0.60.1: how many path searches ran (a cheap counter for the no-path cooldown's test). */
export const pathStats = { searches: 0 };
/** 0.60.1: auras at (x, y) on an engineer's walking and work: Command Post x COMMAND_RATE_MUL, Radio Tower x ENGINEER_RADIO_MUL. */
export function engineerBoost(sim: Sim, x: number, y: number): number {
  return (sim.hasActiveSupport("command", x, y) ? C.COMMAND_RATE_MUL : 1) * (sim.hasActiveSupport("radio", x, y) ? C.ENGINEER_RADIO_MUL : 1);
}
function pathTo(sim: Sim, a: number, goal: Set<number>, leash: Uint8Array): number[] | null {
  if (goal.has(a)) return [];
  pathStats.searches++;
  const prev = new Map<number, number>([[a, -1]]), q = [a];
  for (let h = 0; h < q.length && q.length < MAX_BFS; h++) {
    const i = q[h], x = i % sim.w, y = (i / sim.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= sim.w || ny >= sim.h) continue;
      const j = ny * sim.w + nx;
      if (prev.has(j) || !passable(sim, j, leash)) continue;
      prev.set(j, i);
      if (goal.has(j)) { const out: number[] = []; for (let k = j; k !== a; k = prev.get(k)!) out.push(k); return out.reverse(); }
      q.push(j);
    }
  }
  return null;
}

/** How far from a target an engineer may stand to work on it: the foot of a building (8), else right beside it (2). */
function reachR(sim: Sim, x: number, y: number): number { return walkable(sim.map.tile[sim.idx(Math.floor(x), Math.floor(y))]) ? 2 : 8; }
/** Cells next to (x, y) an engineer can stand on to work there (the cell itself first, else the nearest ring out to 8:
 *  the street at the foot of a rooftop squad's building). */
function workCells(sim: Sim, x: number, y: number, leash: Uint8Array, maxR = reachR(sim, x, y)): Set<number> {
  const out = new Set<number>(), cx = Math.floor(x), cy = Math.floor(y);
  for (let r = 0; r <= maxR && !out.size; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= sim.w || ny >= sim.h) continue;
      const j = ny * sim.w + nx;
      if (sim.inZone[j] !== 2 && sim.inZone[j] !== 3 && passable(sim, j, leash)) out.add(j);
    }
  return out;
}

/** 0.60: can an engineer reach a unit standing at (x, y) (the placement label warns when not: Supply Drop only). */
export function inEngineerReach(sim: Sim, x: number, y: number): boolean {
  if (!sim.supply.length) return true; // no zone yet: nothing to warn about
  return workCells(sim, x, y, leashField(sim)).size > 0;
}

/** 0.60 lab: what a unit holds (magazine plus spares) and what it can hold. */
const onHand = (u: Unit) => u.ammo + (u.reserve ?? 0);
const fullLoad = (u: Unit) => C.UNITS[u.kind].ammo * (1 + Sup.basicLoad(Sup.ammoClass(u.kind), u.kind));
/** A unit waiting at the wall that only needs repairs (its ammo is full or the store is empty). */
const needsRepairOnly = (u: Unit) => { const mhp = C.UNITS[u.kind].mobile?.hp; return !!u.waitingSupply && mhp !== undefined && mhp !== Infinity && (u.hp ?? mhp) < mhp; };
const WALKS_TO_WALL = new Set<string>(["apc", "tank", "police", "militia"]);
const zoneClass = (u: Unit): "small" | "vehicle" | null => { const c = Sup.ammoClass(u.kind); return c === "small" || c === "vehicle" ? c : null; };

/** Advance every crew by dt (called every 2nd tick in battle with dt*2). */
export function stepEngineers(sim: Sim, dt: number, rnd: () => number) {
  const leash = leashField(sim);
  sim.supply.forEach((zs, z) => {
    const crew = zs.crew.filter(e => e.alive);
    if (!crew.length) return;
    // the jobs on offer this step
    const units: Sup.JobIn["units"] = [], byId = new Map<number, Unit>();
    sim.units.forEach((u, id) => {
      const cls = zoneClass(u), spec = C.UNITS[u.kind];
      if (!cls || u.deployT || u.extractT !== undefined || u.hp === -1 || spec.ammo === Infinity || sim.zoneOfUnit(u) !== z) return; // review C1: the stock check belongs to empty-handed engineers only (below)
      if (WALKS_TO_WALL.has(u.kind) && sim.zoneAt(u.x, u.y) !== z && !u.waitingSupply) return; // vehicles and police/militia outside come to the wall first; Troops and Snipers hold where they are and are served there when in reach
      const reach = workCells(sim, u.x, u.y, leash).size > 0;
      const mhp = spec.mobile?.hp, hurt = u.waitingSupply && mhp !== undefined && mhp !== Infinity && u.hp !== undefined ? u.hp / mhp : 1; // a unit waiting at the wall is also repaired
      units.push({ id, x: u.x, y: u.y, frac: Math.min(onHand(u) / fullLoad(u), hurt), outside: sim.zoneAt(u.x, u.y) !== z, reach }); byId.set(id, u);
    });
    const walls: Sup.JobIn["walls"] = [];
    for (const i of sim.zoneWallCells(z)) {
      const max = sim.inZone[i] === 3 ? sim.gateMaxHp() : sim.wallMaxHp();
      if (sim.wallHp[i] > 0 && sim.wallHp[i] < max) walls.push({ id: i, x: i % sim.w, y: (i / sim.w) | 0, frac: sim.wallHp[i] / max });
      if (walls.length >= 300) break;
    }
    const taken = new Set<string>();
    for (const e of crew) if (e.job) taken.add(`${e.job.kind}:${e.job.id}`);
    const fromDepot = sim.supports.some(b => b.kind === "supply" && b.extractT === undefined && b.x === zs.store[0] && b.y === zs.store[1]);
    for (const e of crew) {
      // bites: outside the wall, or with infected right next to them
      if (sim.dev.bites && sim.nearest(e.x, e.y, C.BITE_RANGE, INF, 255, 20) >= 0 && rnd() < 1 - Math.pow(1 - C.BITE_CHANCE, 2)) { lose(sim, zs, e); continue; }
      const boost = engineerBoost(sim, e.x, e.y), speed = C.ENGINEER_SPEED * boost; // 0.60.1: auras where the engineer stands
      if (e.climbT > 0) { e.climbT -= dt * boost; continue; }
      if (e.workT > 0) { e.workT -= dt * boost; if (e.workT > 0) continue; }
      // a job, or keep the one held if it still makes sense
      if (e.job && !jobValid(sim, zs, e, byId)) { if (e.carry === "small" || e.carry === "vehicle") zs[e.carry] += e.carryN ?? Sup.crateRounds(e.carry); e.carry = null; e.carryN = 0; dropJob(e); } // the crate goes back to the store
      if (!e.job) {
        const offer = e.carry ? units.filter(x => zoneClass(byId.get(x.id)!) === e.carry) // carrying: only units that take these rounds
          : units.filter(x => { const v = byId.get(x.id)!; return zs[zoneClass(v)!] > 0 || needsRepairOnly(v); }); // empty-handed: only what the store can fill (or a repair)
        const j = Sup.pickJob(e.x, e.y, { units: offer, walls: e.carry ? [] : walls, prio: zs.prio }, taken);
        if (!j) { goHome(sim, zs, e, leash, speed, dt); continue; }
        e.job = j; taken.add(`${j.kind}:${j.id}`); e.path = [];
      }
      const job = e.job!;
      if (job.kind === "reload") {
        const u = byId.get(job.id) ?? sim.units[job.id], cls = zoneClass(u)!;
        if (!e.carry && !(needsRepairOnly(u) && (zs[cls] <= 0 || onHand(u) >= fullLoad(u)))) { // fetch (review I4: a repair needs no crate)
          if (atCells(sim, e, storeCells(sim, zs, leash))) {
            if (zs[cls] <= 0) { dropJob(e); continue; }
            const take = Math.min(zs[cls], C.ENGINEER_CRATES * Sup.crateRounds(cls)); e.carry = cls; e.carryN = take; zs[cls] -= take; e.path = [];
          } else { walk(sim, e, storeCells(sim, zs, leash), leash, speed, dt); continue; }
        }
        const cells = workCells(sim, u.x, u.y, leash);
        if (atCells(sim, e, cells)) {
          const spec = C.UNITS[u.kind], need = Math.max(0, fullLoad(u) - onHand(u)), crate = e.carry ? e.carryN ?? 0 : 0; // what it really carries (nothing for a repair-only visit)
          const used = Math.min(need, crate), toMag = Math.min(used, Math.max(0, spec.ammo - u.ammo));
          u.ammo += toMag; u.reserve = (u.reserve ?? 0) + used - toMag; // the magazine first, then the spares
          if (u.waitingSupply && spec.mobile && spec.mobile.hp !== Infinity) u.hp = spec.mobile.hp; // repaired at the wall
          { const lg = cls === "small" ? zs.log : zs.logV; lg.push([sim.time, used]); if (lg.length > 200) lg.splice(0, lg.length - 200); }
          if (used > 0) sim.stats.c.crates = (sim.stats.c.crates ?? 0) + 1;
          e.carryN = crate - used; e.workT = sim.isFortified(u) ? C.ENGINEER_STAIRS_S : 0.5; e.path = [];
          if (e.carryN < 1) { e.carry = null; e.carryN = 0; }
          // multi-drop: rounds left go on to the next unit that needs them; an empty engineer keeps this job for another trip
          if (onHand(u) >= fullLoad(u) || (!e.carry && zs[cls] <= 0) || e.carry) dropJob(e);
        } else walk(sim, e, cells, leash, speed * (fromDepot ? 1 / C.DEPOT_TRIP_MUL : 1), dt);
      } else {
        const i = job.id, cells = workCells(sim, i % sim.w, (i / sim.w) | 0, leash, 1);
        if (atCells(sim, e, cells)) {
          const max = sim.inZone[i] === 3 ? sim.gateMaxHp() : sim.wallMaxHp();
          sim.wallHp[i] = Math.min(max, sim.wallHp[i] + C.ENGINEER_REPAIR_HPS * boost * dt);
          if (sim.wallHp[i] >= max) dropJob(e);
        } else walk(sim, e, cells, leash, speed, dt);
      }
    }
  });
}

function jobValid(sim: Sim, zs: Sup.ZoneSupply, e: Sup.Engineer, byId: Map<number, Unit>): boolean {
  const j = e.job!;
  if (j.kind === "repair") { const max = sim.inZone[j.id] === 3 ? sim.gateMaxHp() : sim.wallMaxHp(); return (sim.inZone[j.id] === 2 || sim.inZone[j.id] === 3) && sim.wallHp[j.id] > 0 && sim.wallHp[j.id] < max; }
  const u = byId.get(j.id); if (!u) return false;
  const cls = zoneClass(u)!;
  const mhp = C.UNITS[u.kind].mobile?.hp, hurt = !!u.waitingSupply && mhp !== undefined && mhp !== Infinity && (u.hp ?? mhp) < mhp;
  return (onHand(u) < fullLoad(u) && (!!e.carry || zs[cls] > 0)) || hurt;
}
function dropJob(e: Sup.Engineer) { e.job = null; e.path = []; }

function storeCells(sim: Sim, zs: Sup.ZoneSupply, leash: Uint8Array) { return workCells(sim, zs.store[0], zs.store[1], leash); }
function atCells(sim: Sim, e: Sup.Engineer, cells: Set<number>) { return cells.has(sim.idx(Math.floor(e.x), Math.floor(e.y))); }

function goHome(sim: Sim, zs: Sup.ZoneSupply, e: Sup.Engineer, leash: Uint8Array, speed: number, dt: number) {
  const cells = storeCells(sim, zs, leash);
  if (!atCells(sim, e, cells)) { walk(sim, e, cells, leash, speed, dt); return; }
  if (e.carry === "small" || e.carry === "vehicle") { zs[e.carry] += e.carryN ?? 0; e.carry = null; e.carryN = 0; } // rounds nobody needed go back on the pile
}

/** Step along a BFS path toward the goal cells; entering or leaving a wall cell costs a climb. */
function walk(sim: Sim, e: Sup.Engineer, goal: Set<number>, leash: Uint8Array, speed: number, dt: number) {
  const here = sim.idx(Math.floor(e.x), Math.floor(e.y));
  if (!e.path.length || !goal.has(e.path[e.path.length - 1])) {
    if (sim.time < (e.noPathT ?? 0)) { dropJob(e); return; } // 0.60.1: searched in vain a moment ago
    const p = pathTo(sim, here, goal, leash);
    if (!p) { e.noPathT = sim.time + C.ENGINEER_NOPATH_S; dropJob(e); return; }
    e.path = p;
  }
  let left = speed * dt;
  while (left > 0 && e.path.length) {
    const next = e.path[0], tx = (next % sim.w) + 0.5, ty = ((next / sim.w) | 0) + 0.5;
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d <= left) {
      const from = sim.inZone[sim.idx(Math.floor(e.x), Math.floor(e.y))];
      e.x = tx; e.y = ty; left -= d; e.path.shift();
      const to = sim.inZone[next];
      e.side = to === 0 ? "out" : "in";
      if (to === 2 || from === 2) { e.climbT = C.ENGINEER_CLIMB_S; return; } // up onto the wall, or down off it
    } else { e.x += dx / d * left; e.y += dy / d * left; left = 0; }
  }
}

function lose(sim: Sim, zs: Sup.ZoneSupply, e: Sup.Engineer) {
  e.alive = false; e.carry = null; e.job = null; e.path = [];
  sim.spawnInfected(e.x, e.y, C.INF_HP * sim.infHpMul);
  sim.stats.c.engineersLost = (sim.stats.c.engineersLost ?? 0) + 1;
  St.event(sim.stats, St.SE_ENGINEER_LOST, sim.time, e.x, e.y);
  sim.ping("crew", e.x, e.y); // 0.60.1: its own alert
}
