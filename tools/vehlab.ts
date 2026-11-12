// 0.32: how often people end up under a moving tank or APC (they should step aside). bun tools/vehlab.ts [VEH_A]
import { Sim } from "../src/sim";
import * as C from "../src/config";
if (process.argv[2]) C.TUNABLE.VEH_A[1](+process.argv[2]);
const s = new Sim(42, { budget: 80_000_000 });
const cx = s.w / 2, cy = s.h / 4, H = 34;
s.setZone([[cx - H, cy - H], [cx + H, cy - H], [cx + H, cy + H], [cx - H, cy + H]]);
let n = 0;
for (let y = cy - 25; y < cy + 25 && n < 4; y++) for (let x = cx - 25; x < cx + 25 && n < 4; x++) if (s.inZone[s.idx(x, y)] === 1 && s.map.tile[s.idx(x, y)] === 0 && !s.place(n % 2 ? "apc" : "tank", x, y)) n++;
s.dev.bites = false;
s.startBattle();
let under = 0, samples = 0, moved = 0, dist = 0;
const a = s as any;
for (let t = 0; t < 200 * C.TICK_HZ; t++) {
  if (t % (20 * C.TICK_HZ) === 0) for (const u of s.units) { // keep sending them across the crowds outside
    const r = (t / 20 / C.TICK_HZ + s.units.indexOf(u)) % 4, d = 40;
    s.orderUnit?.(u, Math.round(cx + [d, -d, 0, 0][r]), Math.round(cy + [0, 0, d, -d][r]));
  }
  const before = s.units.map(u => [u.x, u.y]);
  s.step();
  if (t % 5) continue;
  for (const [i, u] of s.units.entries()) {
    if (!C.UNITS[u.kind].crushSlow) continue;
    const st = Math.hypot(u.x - before[i][0], u.y - before[i][1]); if (st > 1e-4) moved++; dist += st;
    const [x0, y0, x1, y1] = s.footRect(C.UNITS[u.kind].foot, Math.floor(u.x), Math.floor(u.y));
    for (let k = 0; k < s.civN; k++) { const st = s.state[k]; if (st !== 0 && st !== 3) continue; const x = s.ax[k], y = s.ay[k]; if (x >= x0 && x < x1 + 1 && y >= y0 && y < y1 + 1) under++; }
    samples++;
  }
}
console.log(`VEH_A ${C.VEH_A}: people under a vehicle per sample ${(under / Math.max(1, samples)).toFixed(2)}, vehicle moving ${(100 * moved / Math.max(1, samples)).toFixed(0)}% of samples, driven ${(dist / Math.max(1, samples) * C.TICK_HZ).toFixed(2)} cells/s`);
