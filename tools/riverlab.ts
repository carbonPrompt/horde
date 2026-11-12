// River lab (0.34): a 0.33 playtest. Ashford, two safe zones on opposite banks of the river, two Evac Points
// in each. Measures, per zone, how many people inside are stalled (no 0.5 m move in 20 s) while not at a pad,
// how many have no route to any pad, how long people sit in the zone before a lift takes them, and what each
// pad flies out.
//   bun tools/riverlab.ts            (CL_SET="NAME=v,..." overrides tunables; RL_N people, RL_S seconds)
import { Sim } from "../src/sim";
import * as C from "../src/config";
import { ROAD, BUILDING, WATER } from "../src/map";

for (const kv of (process.env.CL_SET ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); C.TUNABLE[k][1](+v); }
const CIV = 0, INF = 1, DEAD = 2, SAFE = 3;
const city = C.CITIES[0];
const s = new Sim(city.seed, { budget: 400_000_000, civilians: +(process.env.RL_N ?? C.CIVILIANS), waveMul: city.waveMul, sites: city.sites, speedMul: city.speedMul } as any);
const a = s as any, W = s.w, H = s.h;

// find the river: the column (or row) band with the most water, then a zone on each bank
let colW = new Int32Array(W), rowW = new Int32Array(H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (s.map.tile[y * W + x] === WATER) { colW[x]++; rowW[y]++; }
const maxC = Math.max(...colW), maxR = Math.max(...rowW);
const vertical = maxC / H > maxR / W; // river runs north-south
const half = 22;
function zoneAt(cx: number, cy: number) { return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]] as [number, number][]; }
function waterFrac(cx: number, cy: number) { let n = 0, w = 0; for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; if (s.map.tile[y * W + x] === WATER) w++; } return w / Math.max(1, n); }
// river centre line at the middle of the map
const mid = vertical ? (H / 2) | 0 : (W / 2) | 0;
let rc = -1;
if (vertical) { let best = -1; for (let x = 0; x < W; x++) if (s.map.tile[mid * W + x] === WATER && colW[x] > best) { best = colW[x]; rc = x; } }
else { let best = -1; for (let y = 0; y < H; y++) if (s.map.tile[y * W + mid] === WATER && rowW[y] > best) { best = rowW[y]; rc = y; } }
// walk out from the river until the zone square is dry
function bank(dir: number) { for (let off = half + 2; off < 200; off++) { const c = rc + dir * off; const [cx, cy] = vertical ? [c, mid] : [mid, c]; if (waterFrac(cx, cy) === 0) return [cx, cy]; } throw new Error("no dry bank"); }
const zones = [bank(-1), bank(1)];
for (const [cx, cy] of zones) { const e = s.addZone(zoneAt(cx, cy)); if (e) throw new Error(e); }
const zoneOf = (x: number, y: number) => zones.findIndex(([cx, cy]) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half);
// two pads per zone, on buildings, apart from each other
const padZone: number[] = [];
for (let z = 0; z < 2; z++) {
  const [cx, cy] = zones[z]; let placed = 0;
  for (const [ox, oy] of [[-10, -6], [10, 8], [-6, 10], [8, -10], [0, 0]]) {
    if (placed >= 2) break;
    let done = false;
    for (let r = 0; r < 6 && !done; r++) for (let dy = -r; dy <= r && !done; dy++) for (let dx = -r; dx <= r && !done; dx++) {
      const x = cx + ox + dx, y = cy + oy + dy;
      if (s.map.tile[y * W + x] !== BUILDING) continue;
      if (!s.placeSupport("evac", x, y)) { padZone.push(z); placed++; done = true; }
    }
  }
  if (placed < 2) throw new Error(`zone ${z}: only ${placed} pads`);
}
s.dev.bites = false; s.dev.waves = false;
s.startBattle();
const pads = s.supports.filter(b => b.kind === "evac");
const flown = new Int32Array(pads.length);
const n = s.civN, lx = new Float32Array(n), ly = new Float32Array(n), still = new Float32Array(n), inT = new Float32Array(n).fill(-1);
const waits: number[][] = [[], []];
let lastLog = 0;
const S = +(process.env.RL_S ?? 420);
console.log(`Ashford ${W}x${H}, river ${vertical ? "N-S at x" : "E-W at y"}=${rc}, zones at ${zones.map(z => z.join(",")).join(" / ")}, ${n} people`);
for (let t = 1; t <= S * C.TICK_HZ; t++) {
  const before = s.liftLog.length;
  const prevState = s.state.slice();
  s.step();
  for (let i = before; i < s.liftLog.length; i++) { const L = s.liftLog[i]; const p = pads.findIndex(b => b.x === L.x && b.y === L.y); if (p >= 0 && L.kind === "ok") flown[p] += L.n; }
  for (let k = 0; k < n; k++) {
    if (s.state[k] === SAFE && prevState[k] !== SAFE) inT[k] = s.time;
    if (prevState[k] === SAFE && s.state[k] === DEAD && inT[k] >= 0) { const z = zoneOf(s.ax[k], s.ay[k]); if (z >= 0) waits[z].push(s.time - inT[k]); }
  }
  if (t % C.TICK_HZ) continue;
  const stuck = [0, 0], inside = [0, 0], noPad = [0, 0], queued = [0, 0], atPad = [0, 0], beyond = [0, 0];
  for (let k = 0; k < n; k++) {
    if (Math.hypot(s.ax[k] - lx[k], s.ay[k] - ly[k]) > 0.5) { lx[k] = s.ax[k]; ly[k] = s.ay[k]; still[k] = 0; } else still[k] += 1;
    if (s.state[k] !== SAFE) continue;
    const z = zoneOf(s.ax[k], s.ay[k]); if (z < 0) continue;
    inside[z]++;
    const i = s.idx(s.ax[k] | 0, s.ay[k] | 0), pf = a.padField[i] as number;
    if (pf === 65535) noPad[z]++;
    else if (pf <= C.EVAC_GATHER_D) atPad[z]++;
    else { queued[z]++; if (still[k] >= 20) stuck[z]++; }
    // in reach of a lift?
    let reach = false; for (const b of pads) if (Math.hypot(s.ax[k] - b.x - 0.5, s.ay[k] - b.y - 0.5) <= C.SUPPORTS.evac.radius) { reach = true; break; }
    if (!reach && still[k] >= 20) beyond[z]++;
  }
  if (s.time - lastLog >= 60 || t === S * C.TICK_HZ) {
    lastLog = s.time;
    for (let z = 0; z < 2; z++) console.log(`  t=${s.time.toFixed(0)}s zone ${z}: in ${inside[z]}, at pad ${atPad[z]}, on the way ${queued[z]} (stalled ${stuck[z]}), no route ${noPad[z]}, stalled out of lift reach ${beyond[z]}`);
  }
}
const med = (v: number[]) => { const q = [...v].sort((p, r) => p - r); return q.length ? q[q.length >> 1].toFixed(0) : "-"; };
const p90 = (v: number[]) => { const q = [...v].sort((p, r) => p - r); return q.length ? q[Math.floor(q.length * 0.9)].toFixed(0) : "-"; };
let left = [0, 0]; for (let k = 0; k < n; k++) if (s.state[k] === SAFE) { const z = zoneOf(s.ax[k], s.ay[k]); if (z >= 0) left[z]++; }
for (let z = 0; z < 2; z++) console.log(`zone ${z}: flown ${waits[z].length}, wait in zone median ${med(waits[z])} s, p90 ${p90(waits[z])} s, still inside ${left[z]}; pads ${pads.map((b, i) => padZone[i] === z ? flown[i] : null).filter(v => v !== null).join(" / ")}`);
console.log(`evacuated ${s.evacuated}, lifts ${s.liftsFlown}, aborted ${s.liftsAborted}`);
