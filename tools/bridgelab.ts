// 0.33: what infected do when a bridge they're walking toward is blown. bun tools/bridgelab.ts [seed]
// Spawns infected whose route runs over one bridge, blows it, and reports where they are 30/60/90 s later:
// milling at the gap, gone round by another bridge, or elsewhere.
import { Sim } from "../src/sim";
import * as C from "../src/config";
const seed = +(process.argv[2] ?? 1234);
const s = new Sim(seed, { budget: 60_000_000, civilians: 50 });
const H = 25, cx = s.w >> 1, cy = s.h >> 1;
s.setZone([[cx - H, cy - H], [cx + H, cy - H], [cx + H, cy + H], [cx - H, cy + H]]);
for (let b = 0; b < s.bridges.length; b++) s.c4.add(b);
s.startBattle();
s.dev.waves = false; s.dev.bites = false;
s.step();
const a = s as any;
// which bridge does each road cell's route cross?
const cross = (i: number) => {
  let x = (i % s.w) + 0.5, y = ((i / s.w) | 0) + 0.5;
  for (let t = 0; t < 600; t++) {
    const c = s.idx(x | 0, y | 0); const b = s.bridgeAt(x | 0, y | 0); if (b >= 0) return b;
    const dx = a.infDir[2 * c], dy = a.infDir[2 * c + 1]; if (!dx && !dy) return -1;
    x += dx * 0.7; y += dy * 0.7;
  }
  return -1;
};
const tally = new Map<number, number[]>();
for (let i = 0; i < s.w * s.h; i += 7) if (s.map.tile[i] === 0 && s.infField[i] !== 65535 && s.infField[i] > 40 * 10) { const b = cross(i); if (b >= 0) (tally.get(b) ?? tally.set(b, []).get(b)!).push(i); }
const ranked = [...tally.entries()].sort((p, q) => q[1].length - p[1].length);
const [bb, cells] = ranked[Math.min(ranked.length - 1, +(process.argv[3] ?? 0))];
if (process.argv[4] === "list") { console.log(ranked.map(([b, c]) => `#${b}:${c.length}`).join(" ")); process.exit(0); }
a.outbreak = true; a.spreadSites = [];
s.devClearInfected();
const bc0 = s.bridges[bb]; let qx = 0, qy = 0; for (const i of bc0) { qx += i % s.w; qy += (i / s.w) | 0; } qx /= bc0.length; qy /= bc0.length;
const near = cells.filter(i => { const d = Math.hypot((i % s.w) - qx, ((i / s.w) | 0) - qy); return d > 12 && d < 50; });
const pick = near.filter((_, j) => j % Math.max(1, Math.floor(near.length / 300)) === 0).slice(0, 300);
for (const i of pick) s.spawnInfected((i % s.w) + 0.5, ((i / s.w) | 0) + 0.5, 1e6);
const mine: number[] = []; for (let k = s.civN; k < s.n; k++) if (s.state[k] === 1) mine.push(k);
const bc = s.bridges[bb]; let bx = 0, by = 0; for (const i of bc) { bx += i % s.w; by += (i / s.w) | 0; } bx /= bc.length; by /= bc.length;
const d0 = mine.map(k => Math.hypot(s.ax[k] - bx, s.ay[k] - by));
// which side of the river: flood over land without bridges, from the zone
const side = new Uint8Array(s.w * s.h);
const blowCell = bc[0];
s.blowBridge(blowCell % s.w, (blowCell / s.w) | 0);
// zone side = land reachable from the zone now (with every other bridge still up) is meaningless; use cells reachable without ANY bridge
{ const q = [s.idx(cx, cy)]; side[q[0]] = 1; while (q.length) { const c = q.pop()!; for (const n of [c - 1, c + 1, c - s.w, c + s.w]) { if (n < 0 || n >= side.length || side[n]) continue; const t = s.map.tile[n]; if (t === 3 || t === 4 || t === 1) continue; side[n] = 1; q.push(n); } } }
s.step();
if (a.memDir) { let diff = 0; for (const k of mine) { const c = 2 * s.idx(s.ax[k] | 0, s.ay[k] | 0); if (a.memDir[c] * a.infDir[c] + a.memDir[c + 1] * a.infDir[c + 1] < 0.5) diff++; } console.log(`${diff} of ${mine.length} now have a different route than they remember`); }
const watch = mine.filter(k => { const c = 2 * s.idx(s.ax[k] | 0, s.ay[k] | 0); return a.memDir && a.memDir[c] * a.infDir[c] + a.memDir[c + 1] * a.infDir[c + 1] < 0.5; }).slice(0, 2);
for (let sec = 1; sec <= 240; sec++) {
  if (process.env.DBG && sec % 10 === 0) for (const k of watch) { const c = s.idx(s.ax[k] | 0, s.ay[k] | 0); console.log(sec, k, s.ax[k].toFixed(1), s.ay[k].toFixed(1), 'gapD', Math.hypot(s.ax[k] - bx, s.ay[k] - by).toFixed(1), 'mem', a.memDir[2*c].toFixed(2), a.memDir[2*c+1].toFixed(2), 'live', a.infDir[2*c].toFixed(2), a.infDir[2*c+1].toFixed(2), 'chase', a.chase[k], 'noise', a.noiseB[((s.ay[k]/8)|0)*a.bw+((s.ax[k]/8)|0)]?.toFixed(2), 'z', a.zMem[k], 'zc', a.zoneClosed, 'F', s.infField[c]); }
  for (let t = 0; t < C.TICK_HZ; t++) s.step();
  if (sec % 60) continue;
  let alive = 0, gap = 0, closer = 0, zoneD = 0; const mill = [0, 0, 0];
  for (const [j, k] of mine.entries()) {
    if (s.state[k] !== 1) continue; alive++;
    const d = Math.hypot(s.ax[k] - bx, s.ay[k] - by); if (a.zMem) mill[a.zMem[k]]++;
    if (d < 15) gap++;
    if (d < d0[j] - 5) closer++;
    zoneD += s.infField[s.idx(s.ax[k] | 0, s.ay[k] | 0)] / 10;
  }
  console.log(`seed ${seed} bridge ${bb} t+${sec}s: ${alive} of ${mine.length}, ${gap} within 30 m of the gap, ${closer} closer to the gap than at the start, mean route to zone ${(zoneD / Math.max(1, alive)).toFixed(0)} cells, memory states ${mill}`);
}
