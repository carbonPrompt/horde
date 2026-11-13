// Crowd lab (0.30): headless test maps that measure how natural the crowd is, against numbers from real crowds.
//   bun tools/crowdlab.ts [street|gate|horde|evac|perf|all]
// street: a 16 m wide street, 2000 people walking to a zone. Measures wall-hugging (share of people within 30 cm
//         of a building), rows (how much people's positions across the street bunch into lines; 1.0 = random) and
//         walking speed against density (real: about 1.3 m/s free, slower as it packs, Weidmann 1993).
// gate:   the same crowd through a 4 m gate: people per second per meter (real: about 1.3 to 1.9), calm and panicked.
// perf:   ms per tick on a generated city at 15k, 50k and 200k people.
import { Sim } from "../src/sim";
import * as C from "../src/config";
import { ROAD, BUILDING } from "../src/map";

const CIV = 0, INF = 1, DEAD = 2, SAFE = 3;
// CL_SET="NAME=value,NAME=value" overrides tunables for a sweep
for (const kv of (process.env.CL_SET ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); C.TUNABLE[k][1](+v); }
const M = C.CELL_M;

function streetMap(gateW: number) {
  const W = 170, H = 44;
  const tile = new Uint8Array(W * H).fill(BUILDING), height = new Uint8Array(W * H).fill(3);
  const road = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tile[y * W + x] = ROAD; height[y * W + x] = 0; } };
  road(2, 18, 140, 25);                                   // 8 cells = 16 m wide street
  const g0 = 22 - Math.floor(gateW / 2);
  road(141, g0, 146, g0 + gateW - 1);                     // the neck into the zone
  road(147, 4, 167, 39);                                  // plaza (the zone)
  return { w: W, h: H, seed: 1, tile, height };
}

function mkSim(gateW: number, n: number, panic = false, x0 = 4, span = 70) {
  const s = new Sim(1, { customMap: streetMap(gateW), civilians: n, budget: 500_000_000 } as any);
  s.dev.bites = false; s.dev.waves = false; s.dev.wallDamage = false;
  const err = s.setZone([[145, 3], [168.9, 3], [168.9, 40.9], [145, 40.9]]);
  if (err) throw new Error(err);
  s.startBattle();
  (s as any).outbreak = true;
  const r = (() => { let a = 7; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
  for (let k = 0; k < s.civN; k++) { s.state[k] = CIV; s.ax[k] = x0 + r() * span; s.ay[k] = 18 + r() * 7.99; }
  if (panic && (s as any).fear) (s as any).fear.fill(1);
  return s;
}

/** Distance (cells) from an agent to the nearest blocked cell edge around it. */
function wallDist(s: Sim, x: number, y: number) {
  const cx = x | 0, cy = y | 0, t = s.map.tile;
  const blocked = (i: number, j: number) => i < 0 || j < 0 || i >= s.w || j >= s.h || t[j * s.w + i] === BUILDING;
  let d = 9;
  if (blocked(cx - 1, cy)) d = Math.min(d, x - cx);
  if (blocked(cx + 1, cy)) d = Math.min(d, cx + 1 - x);
  if (blocked(cx, cy - 1)) d = Math.min(d, y - cy);
  if (blocked(cx, cy + 1)) d = Math.min(d, cy + 1 - y);
  return d;
}

function street() {
  const s = mkSim(8, 2000);
  const px = new Float32Array(s.n), py = new Float32Array(s.n);
  let hug = 0, cnt = 0;
  const bins = new Float64Array(80); // 0.1-cell bins across the 8-cell street
  const spd: [number, number][] = []; // [density p/m2, speed m/s]
  for (let t = 0; t < 40 * C.TICK_HZ; t++) {
    for (let k = 0; k < s.civN; k++) { px[k] = s.ax[k]; py[k] = s.ay[k]; }
    s.step();
    if (t < 8 * C.TICK_HZ || t % 5) continue;
    for (let k = 0; k < s.civN; k++) {
      if (s.state[k] !== CIV) continue;
      const x = s.ax[k], y = s.ay[k];
      if (x < 40 || x > 135 || y < 18 || y >= 26) continue;
      cnt++;
      if (wallDist(s, x, y) < 0.15) hug++;
      bins[Math.min(79, ((y - 18) / 0.1) | 0)]++;
      const ci = (y | 0) * s.w + (x | 0);
      let d = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) d += s.dens[ci + dy * s.w + dx];
      spd.push([d / 9 / (M * M), Math.hypot(x - px[k], y - py[k]) * M * C.TICK_HZ]);
    }
  }
  let sum2 = 0; for (const b of bins) sum2 += (b / cnt) ** 2;
  const rows = sum2 * bins.length; // 1 = flat, bigger = bunched into lines
  // a random crowd of the same size would score about 1 + bins/samples per snapshot; report the ratio to a shuffled baseline
  const per = cnt / Math.max(1, (32 * C.TICK_HZ) / 5);
  const rowsRandom = 1 + bins.length / Math.max(1, per);
  const byD = new Map<number, number[]>();
  for (const [d, v] of spd) { const b = Math.min(6, Math.round(d * 2) / 2); (byD.get(b) ?? byD.set(b, []).get(b)!).push(v); }
  const curve = [...byD.entries()].sort((a, b) => a[0] - b[0]).filter(([, v]) => v.length > 50).map(([d, v]) => `${d.toFixed(1)}:${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`).join(" ");
  console.log(`street: wall-hug ${(100 * hug / cnt).toFixed(1)}% (random about 3.8%), rows ${(rows / rowsRandom).toFixed(2)} (1.00 = random), speed by density [p/m2:m/s] ${curve}`);
}

function gate(panic: boolean) {
  const W = +(process.env.GATE_W ?? 2); // cells: 4 m by default
  const s = mkSim(W, +(process.env.CL_N ?? 2000), panic, 95, 45);
  const times: number[] = [];
  let was = 0;
  let crushed = 0;
  for (let t = 0; t < 240 * C.TICK_HZ; t++) {
    if (panic && (s as any).fearB) (s as any).fearB.fill(1); // everyone terrified the whole time
    s.step();
    let safe = 0, dead = 0; for (let k = 0; k < s.civN; k++) { if (s.state[k] === SAFE) safe++; else if (s.state[k] === DEAD) dead++; }
    crushed = dead;
    for (let i = was; i < safe; i++) times.push(t / C.TICK_HZ);
    was = safe;
    if (safe + dead >= s.civN) break;
  }
  // steady flow: between the 10th and 90th percentile arrivals
  const a = times[Math.floor(times.length * 0.1)], b = times[Math.floor(times.length * 0.9)];
  const flow = (times.length * 0.8) / Math.max(1e-6, b - a) / (W * M);
  console.log(`gate ${panic ? "panicked" : "calm    "}: ${flow.toFixed(2)} people/s/m (real calm about 1.3-1.9), ${times.length}/${s.civN} through in ${times[times.length - 1]?.toFixed(0)}s, crushed ${crushed}`);
}

/** A horde of 800 infected walking the street toward the zone: wall-hugging and rows, as for people. */
function horde() {
  const s = mkSim(8, 10);
  for (let k = 0; k < s.civN; k++) s.state[k] = DEAD;
  const r = (() => { let a = 11; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
  for (let j = 0; j < 800; j++) s.spawnInfected(4 + r() * 40, 18 + r() * 7.99, 1e9, false);
  let hug = 0, cnt = 0; const bins = new Float64Array(80);
  for (let t = 0; t < 50 * C.TICK_HZ; t++) {
    s.step();
    if (t < 10 * C.TICK_HZ || t % 5) continue;
    for (let k = s.civN; k < s.n; k++) {
      if (s.state[k] !== INF) continue;
      const x = s.ax[k], y = s.ay[k];
      if (x < 30 || x > 135 || y < 18 || y >= 26) continue;
      cnt++; if (wallDist(s, x, y) < 0.15) hug++;
      bins[Math.min(79, ((y - 18) / 0.1) | 0)]++;
    }
  }
  let sum2 = 0; for (const b of bins) sum2 += (b / cnt) ** 2;
  const per = cnt / Math.max(1, (40 * C.TICK_HZ) / 5);
  console.log(`horde: wall-hug ${(100 * hug / cnt).toFixed(1)}%, rows ${((sum2 * bins.length) / (1 + bins.length / per)).toFixed(2)} (1.00 = random)`);
}

/** 0.32: a real city round with two Evac Points and a howitzer in the zone. Measures how fast people head for the
 *  zone and the pads (median speed, m/s), how many sit still for 20 s while not yet at a pad ("stuck"), and lifts. */
function evac() {
  const s = new Sim(42, { budget: 80_000_000, civilians: +(process.env.CL_N ?? 15000) } as any);
  const cx = s.w / 2, cy = s.h / 4, half = 34;
  const err = s.setZone([[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]]);
  if (err) throw new Error(err);
  const bld: [number, number][] = [];
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === BUILDING) bld.push([i % s.w, (i / s.w) | 0]);
  let pads = 0;
  for (const [x, y] of bld.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cy) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cy) ** 2)).filter((_, i) => i % 40 === 0)) { if (!s.placeSupport("evac", x, y)) pads++; if (pads >= 2) break; }
  let guns = 0;
  for (let y = 5; y < s.h - 5 && guns < 2; y++) for (let x = 5; x < s.w - 5 && guns < 2; x++) if (s.inZone[s.idx(x, y)] === 1 && s.map.tile[s.idx(x, y)] === ROAD && Math.abs(x - cx) < 15 && !s.place("howitzer", x, y)) guns++;
  s.dev.bites = false; s.dev.waves = false;
  s.startBattle();
  const a = s as any, n = s.civN;
  const lx = new Float32Array(n), ly = new Float32Array(n), still = new Float32Array(n);
  const spOut: number[] = [], spIn: number[] = [];
  let stuckMax = 0;
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let t = 0; t < 300 * C.TICK_HZ; t++) {
    const sample = t % C.TICK_HZ === 0;
    if (sample) for (let k = 0; k < n; k++) { px[k] = s.ax[k]; py[k] = s.ay[k]; }
    s.step();
    if (!sample) continue;
    let stuck = 0;
    for (let k = 0; k < n; k++) {
      const st = s.state[k]; if (st === DEAD || st === INF) continue;
      const v = Math.hypot(s.ax[k] - px[k], s.ay[k] - py[k]) * M * C.TICK_HZ;
      const i = s.idx(s.ax[k] | 0, s.ay[k] | 0), pf = a.padField[i] as number;
      const atPad = st === SAFE && pf <= a.gatherD;
      if (st === CIV && t > 60 * C.TICK_HZ) spOut.push(v);
      if (st === SAFE && !atPad && pf !== 65535) spIn.push(v);
      if (Math.hypot(s.ax[k] - lx[k], s.ay[k] - ly[k]) > 0.5) { lx[k] = s.ax[k]; ly[k] = s.ay[k]; still[k] = 0; } else still[k] += 1;
      if (still[k] >= 20 && !atPad && (st === SAFE || st === CIV)) stuck++;
    }
    stuckMax = Math.max(stuckMax, stuck);
    if (t % (60 * C.TICK_HZ) === 0 && t) {
      let safe = 0, civ = 0; for (let k = 0; k < n; k++) { if (s.state[k] === SAFE) safe++; else if (s.state[k] === CIV) civ++; }
      console.log(`  t=${t / C.TICK_HZ}s: outside ${civ}, in zone ${safe}, flown out ${s.evacuated}, lifts ${s.liftsFlown}, stuck now ${stuck}`);
    }
  }
  const med = (v: number[]) => { v.sort((p, q) => p - q); return v.length ? v[v.length >> 1].toFixed(2) : "-"; };
  const slow = (v: number[]) => (100 * v.filter(x => x < 0.5).length / Math.max(1, v.length)).toFixed(0);
  let noPad = 0, waitFar = 0; const R = C.SUPPORTS.evac.radius;
  for (let k = 0; k < n; k++) if (s.state[k] === SAFE) { const i = s.idx(s.ax[k] | 0, s.ay[k] | 0); if (a.padField[i] === 65535) noPad++; else if (a.padField[i] <= a.gatherD && a.padField[i] > R) waitFar++; }
  console.log(`evac: median speed outside ${med(spOut)} m/s (${slow(spOut)}% under 0.5), in zone to pad ${med(spIn)} m/s (${slow(spIn)}% under 0.5), stuck peak ${stuckMax}, flown out ${s.evacuated}, crushed ${s.crushed}; in zone with no pad route ${noPad}, waiting beyond lift reach ${waitFar}, gatherD ${a.gatherD}, lift reach ${R}`);
}

function perf() {
  for (const n of [15000, 50000, 200000]) {
    // CL_CITY=<campaign id>: time a designed city (zone on its first stand point) instead of the seed-7 map
    const rc = process.env.CL_CITY ? C.CITIES.find(c => c.id === process.env.CL_CITY)?.recipe : undefined;
    const s = new Sim(7, { civilians: n, budget: 500_000_000, recipe: rc } as any);
    s.dev.waves = false;
    const cx = rc ? rc.stands[0].x : s.w / 2, cy = rc ? rc.stands[0].y : s.h / 2;
    let err: string | null = "x";
    for (let r = 20; r < 60 && err; r += 4) err = s.setZone([[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]);
    s.startBattle();
    for (let t = 0; t < 40; t++) s.step();
    const t0 = performance.now();
    for (let t = 0; t < 100; t++) s.step();
    console.log(`perf ${n}: ${((performance.now() - t0) / 100).toFixed(2)} ms/tick${err ? " (no zone)" : ""}`);
  }
}

const what = process.argv[2] ?? "all";
if (what === "street" || what === "all") street();
if (what === "gate" || what === "all") { gate(false); gate(true); }
if (what === "horde" || what === "all") horde();
if (what === "evac" || what === "all") evac();
if (what === "perf" || what === "all") perf();
