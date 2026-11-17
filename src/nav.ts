// 0.40: walking to your own front door (or your kid's school) in a city of up to 200k people.
// A flow field per destination would be one per home: far too many, and a cache of them thrashes. Three levels whose
// count does not grow with the number of homes:
//  - district fields (DISTRICT_CELLS squares): one field over the whole map leads anyone into the district.
//  - block fields (BLOCK_CELLS squares): a window BLOCK_R around the block leads into the block. With 650x500 cells
//    there are about 1300 blocks at 20 KB each, so all of them can stay cached.
//  - doorstep fields: a DOOR_R window led straight to the target cell. Tiny (625 cells), cheap to rebuild.
// A walker uses the finest field whose window holds them. Fields are built the moment someone needs one and depend
// only on the map (tiles, zone walls and gates; walls block even when breached), so a rebuilt field is the same field:
// battles replay identically after a snapshot load. Each cell stores a direction code (1 byte).
// Nav lives beside the Sim in a WeakMap, so battle snapshots never carry it.
import * as C from "./config";
import type { Sim } from "./sim";
import { walkable } from "./map";

const FS = 10, DG = 14, RING = DG + 1, UNREACH = 65535;
const ODX = [1, -1, 0, 0, 1, 1, -1, -1], ODY = [0, 0, 1, -1, 1, -1, 1, -1];
// direction codes: 1..8 = step toward ODX/ODY[code - 1]; AT = in the goal; NONE = no route
const AT = 0, NONE = 9, R2 = Math.SQRT1_2;
const VX = [0, 1, -1, 0, 0, R2, R2, -R2, -R2], VY = [0, 0, 0, 1, -1, R2, -R2, R2, -R2];
const BLOCK_CELLS = 16, BLOCK_R = 64, DOOR_R = 16; // DOOR_R >= BLOCK_CELLS: the doorstep window always covers the target's block

/** A field over the window (x0, y0, ww, hh); open: the goal connects to a window edge that isn't the map's edge. */
type Win = { x0: number; y0: number; ww: number; hh: number; f: Uint8Array; open: boolean };

export class Nav {
  private districts = new Map<number, Win>();
  private blocks = new Map<number, Win>();
  private doors = new Map<number, Win>();
  private shut: Uint8Array | null = null; // per target cell: 0 not checked yet, 1 reachable from outside, 2 shut in
  builds = 0; // fields built so far (tests and perf)
  private ver = -1; // the sim's navVersion the fields were built against
  constructor(private sim: Sim) {}

  stats() { return { districts: this.districts.size, blocks: this.blocks.size, doors: this.doors.size }; }
  /** Zones, gates or bridges changed: every field is dropped and rebuilt when next needed. */
  stale() { this.districts.clear(); this.blocks.clear(); this.doors.clear(); this.shut = null; }

  /** Unit direction from (x, y) toward cell `target`; null when there is no route or (x, y) is at the target. */
  dirTo(target: number, x: number, y: number): [number, number] | null {
    const s = this.sim, w = s.w, cx = Math.max(0, Math.min(w - 1, x | 0)), cy = Math.max(0, Math.min(s.h - 1, y | 0));
    if (this.ver !== s.navVersion) { this.stale(); this.ver = s.navVersion; } // walls, gates or bridges changed
    const tx = target % w, ty = (target / w) | 0;
    const inDoor = Math.abs(cx - tx) <= DOOR_R && Math.abs(cy - ty) <= DOOR_R;
    const shut = this.shut ??= new Uint8Array(s.w * s.h);
    if (!inDoor && shut[target] === 0) shut[target] = this.doorField(target).open ? 1 : 2; // checked once per target
    if (!inDoor && shut[target] === 2) return null; // shut in (walled off, boxed in by rubble)
    if (inDoor) { // only people this close need the doorstep field itself
      const door = this.doorField(target);
      const c = this.code(door, cx, cy);
      if (c === AT) return null;
      if (c !== NONE) return [VX[c], VY[c]];
    }
    const bx = ((tx / BLOCK_CELLS) | 0) * BLOCK_CELLS, by = ((ty / BLOCK_CELLS) | 0) * BLOCK_CELLS;
    const block = this.get(this.blocks, this.cellId(target, BLOCK_CELLS), 1 << 30, () => this.buildWindow(bx - BLOCK_R, by - BLOCK_R, BLOCK_CELLS + 2 * BLOCK_R, BLOCK_CELLS + 2 * BLOCK_R, bx, by, BLOCK_CELLS));
    if (this.inWin(block, cx, cy)) {
      const c = this.code(block, cx, cy);
      if (c !== NONE && c !== AT) return [VX[c], VY[c]]; // (in the block means in the doorstep window: handled above)
    }
    const D = C.DISTRICT_CELLS, dx0 = ((tx / D) | 0) * D, dy0 = ((ty / D) | 0) * D;
    const dist = this.get(this.districts, this.cellId(target, D), C.DISTRICT_FIELDS_MAX, () => this.buildWindow(0, 0, s.w, s.h, dx0, dy0, D));
    const c = this.code(dist, cx, cy);
    return c === NONE || c === AT ? null : [VX[c], VY[c]]; // in the district but no block route: cut off (a river, a wall)
  }

  private doorField(target: number): Win {
    const tx = target % this.sim.w, ty = (target / this.sim.w) | 0;
    return this.get(this.doors, target, C.HOME_FIELDS_MAX, () => this.buildWindow(tx - DOOR_R, ty - DOOR_R, 2 * DOOR_R + 1, 2 * DOOR_R + 1, tx, ty, 1));
  }
  private cellId(c: number, size: number) { const s = this.sim, n = Math.ceil(s.w / size); return ((((c / s.w) | 0) / size) | 0) * n + (((c % s.w) / size) | 0); }
  private inWin(win: Win, x: number, y: number) { return x >= win.x0 && y >= win.y0 && x < win.x0 + win.ww && y < win.y0 + win.hh; }
  private code(win: Win, x: number, y: number) { return win.f[(y - win.y0) * win.ww + (x - win.x0)]; }
  private get(cache: Map<number, Win>, key: number, cap: number, build: () => Win): Win {
    let v = cache.get(key);
    if (v) { if (cache.size >= cap) { cache.delete(key); cache.set(key, v); } return v; } // keep use order only once it matters
    v = build(); cache.set(key, v);
    while (cache.size > cap) cache.delete(cache.keys().next().value!);
    return v;
  }
  /** Walkable at the battle's start (rubble from collapses doesn't count, blown bridges do), and not a zone wall
   *  (breached or not). Only things a snapshot carries, so a rebuilt field is the same field. */
  private pass(i: number) { const s = this.sim, m = s.walkMask; return (m ? m[i] === 1 : walkable(s.map.tile[i])) && s.inZone[i] !== 2; }

  /** A field over the window at (x0, y0) of size ww x hh (clipped to the map) leading into the goal square
   *  (gx, gy, size): Dial's bucket search, then each cell points at its lowest-cost neighbor. */
  private buildWindow(x0: number, y0: number, ww: number, hh: number, gx: number, gy: number, size: number): Win {
    this.builds++;
    const s = this.sim, W = s.w;
    const ax0 = Math.max(0, x0), ay0 = Math.max(0, y0);
    ww = Math.min(s.w, x0 + ww) - ax0; hh = Math.min(s.h, y0 + hh) - ay0; x0 = ax0; y0 = ay0;
    const n = ww * hh, f = new Uint16Array(n).fill(UNREACH);
    const buckets: number[][] = Array.from({ length: RING }, () => []);
    let pending = 0;
    for (let y = Math.max(gy, y0); y < Math.min(gy + size, y0 + hh); y++) for (let x = Math.max(gx, x0); x < Math.min(gx + size, x0 + ww); x++) {
      if (!this.pass(y * W + x)) continue;
      const c = (y - y0) * ww + (x - x0); f[c] = 0; buckets[0].push(c); pending++;
    }
    for (let d = 0; pending > 0; d++) {
      const b = buckets[d % RING];
      while (b.length) {
        const c = b.pop()!; pending--;
        if (f[c] !== d) continue;
        const lx = c % ww, ly = (c / ww) | 0;
        for (let j = 0; j < 8; j++) {
          const nx = lx + ODX[j], ny = ly + ODY[j];
          if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
          if (!this.pass((y0 + ny) * W + x0 + nx)) continue;
          if (j >= 4 && (!this.pass((y0 + ly) * W + x0 + nx) || !this.pass((y0 + ny) * W + x0 + lx))) continue; // no corner cutting
          const nd = d + (j >= 4 ? DG : FS), m = ny * ww + nx;
          if (nd < f[m] && nd < UNREACH) { f[m] = nd; buckets[nd % RING].push(m); pending++; }
        }
      }
    }
    const out = new Uint8Array(n).fill(NONE);
    for (let c = 0; c < n; c++) {
      const v = f[c];
      if (v === UNREACH) continue;
      if (v === 0) { out[c] = AT; continue; }
      const lx = c % ww, ly = (c / ww) | 0;
      let best = v, code = NONE;
      for (let j = 0; j < 8; j++) {
        const nx = lx + ODX[j], ny = ly + ODY[j];
        if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
        const nv = f[ny * ww + nx];
        if (nv >= best) continue;
        if (j >= 4 && (f[ly * ww + nx] === UNREACH || f[ny * ww + lx] === UNREACH)) continue;
        best = nv; code = j + 1;
      }
      out[c] = code;
    }
    let open = false; // reachable from beyond the window? (an edge on the map's border doesn't count)
    for (let x = 0; x < ww && !open; x++) open = (y0 > 0 && out[x] !== NONE) || (y0 + hh < s.h && out[(hh - 1) * ww + x] !== NONE);
    for (let y = 0; y < hh && !open; y++) open = (x0 > 0 && out[y * ww] !== NONE) || (x0 + ww < s.w && out[y * ww + ww - 1] !== NONE);
    return { x0, y0, ww, hh, f: out, open };
  }
}

const navs = new WeakMap<Sim, Nav>();
/** The Sim's Nav, made on first use (and again after a snapshot load, since snapshots don't carry it). */
export function navOf(sim: Sim): Nav { let n = navs.get(sim); if (!n) { n = new Nav(sim); navs.set(sim, n); } return n; }
