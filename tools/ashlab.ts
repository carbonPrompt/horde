// Ashford replay (0.34): a 0.33 playtest battle (log + saved plan). Two zones across the river, the player's units
// and supports, the Evac Points bought during the battle at the times they were bought. Prints every lift with what was around the pad.
//   bun tools/ashlab.ts           (CL_SET="NAME=v,..." overrides tunables; AL_S seconds, default 470)
import { Sim } from "../src/sim";
import * as C from "../src/config";

for (const kv of (process.env.CL_SET ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); C.TUNABLE[k][1](+v); }
const SAFE = 3;
const city = C.CITIES[0];
const s = new Sim(city.seed, { civilians: 15000, difficulty: "medium", budget: city.budget, waveMul: city.waveMul, sites: city.sites, speedMul: city.speedMul } as any);
const a = s as any;
const plan = {
  zones: [[[198, 140], [255, 140], [255, 166], [198, 166]], [[185, 230], [185, 256], [248, 256], [248, 230]]] as [number, number][][],
  units: [["garrison", 202, 232], ["garrison", 202, 246], ["garrison", 187, 246], ["garrison", 248, 246], ["garrison", 247, 229], ["garrison", 222, 221], ["garrison", 196, 161], ["garrison", 198, 140], ["garrison", 249, 140], ["garrison", 250, 162], ["garrison", 229, 162], ["garrison", 229, 142], ["mortar", 226, 153], ["mortar", 208, 241]] as [any, number, number][],
  supports: [["repair", 214, 240], ["repair", 222, 151], ["evac", 214, 153], ["evac", 229, 241], ["budget", 218, 240], ["budget", 218, 152]] as [any, number, number][],
};
s.ignoreFootprint = true;
for (const z of plan.zones) { const e = s.addZone(z); if (e) console.log("zone:", e); }
s.fieldDirty = true;
for (const [k, x, y] of plan.supports) if (k === "budget") s.placeSupport(k, x, y);
for (const [k, x, y] of plan.supports) if (k !== "budget") { const e = s.placeSupport(k, x, y); if (e) console.log("support", k, e); }
for (const [k, x, y] of plan.units) { const e = s.place(k, x, y); if (e) console.log("unit", k, e); }
s.ignoreFootprint = false;
(s as any).budget += 400_000_000; // he had plenty by then; money is not the question here
s.dev.instantDeploy = true;
s.startBattle();
const buys: [number, number, number][] = [[97, 203, 241], [105, 236, 152], [400, 222, 245], [400, 230, 246]];
const S = +(process.env.AL_S ?? 470);
const R = C.SUPPORTS.evac.radius;
const zoneOf = (x: number, y: number) => plan.zones.findIndex(z => x >= z[0][0] && x < z[2][0] + 1 && y >= Math.min(z[0][1], z[1][1], z[2][1]) && y <= Math.max(z[0][1], z[1][1], z[2][1]));
let logged = 0;
// AL_GATE=1: every 30 s, who is in the gateways (inside, within GATE_CLEAR_DEPTH of a gate or wall) and how many
// of them have not moved 0.5 m in 10 s; plus the zone's fill (people per walkable inside cell)
const gx = new Float32Array(s.civN), gy = new Float32Array(s.civN), gst = new Float32Array(s.civN);
function gateStats(t: number) {
  const gw = [0, 0], gws = [0, 0], inside = [0, 0], deep = [0, 0], cellsIn = [0, 0];
  for (let i = 0; i < s.w * s.h; i++) if (a.inZone[i] === 1 && s.map.tile[i] !== 1) { const z = zoneOf(i % s.w, (i / s.w) | 0); if (z >= 0) cellsIn[z]++; }
  for (let k = 0; k < s.civN; k++) {
    if (Math.hypot(s.ax[k] - gx[k], s.ay[k] - gy[k]) > 0.25) { gx[k] = s.ax[k]; gy[k] = s.ay[k]; gst[k] = 0; } else gst[k]++;
    if (s.state[k] !== SAFE) continue;
    const z = zoneOf(s.ax[k], s.ay[k]); if (z < 0) continue;
    inside[z]++;
    const d = a.depth[s.idx(s.ax[k] | 0, s.ay[k] | 0)];
    if (d < C.GATE_CLEAR_DEPTH) { gw[z]++; if (gst[k] >= 10) gws[z]++; } else if (d >= 10) deep[z]++;
  }
  if ((t / C.TICK_HZ) % 30 === 0) { // people per cell by depth band (0-1 at the edge, 2-5 gateway, 6-9, 10+)
    const bands = [[0, 1], [2, 5], [6, 9], [10, 255]], pc = bands.map(() => [0, 0]), cc = bands.map(() => [0, 0]);
    for (let i = 0; i < s.w * s.h; i++) if (a.inZone[i] === 1 && s.map.tile[i] !== 1) { const z = zoneOf(i % s.w, (i / s.w) | 0); if (z < 0) continue; const d = a.depth[i]; cc[bands.findIndex(b => d >= b[0] && d <= b[1])][z]++; }
    for (let k = 0; k < s.civN; k++) if (s.state[k] === SAFE) { const z = zoneOf(s.ax[k], s.ay[k]); if (z < 0) continue; const d = a.depth[s.idx(s.ax[k] | 0, s.ay[k] | 0)]; const b = bands.findIndex(b => d >= b[0] && d <= b[1]); if (b >= 0) pc[b][z]++; }
    for (let z = 0; z < 2; z++) console.log(`  t=${(t / C.TICK_HZ).toFixed(0)} zone ${z} per cell by depth: ` + bands.map((b, j) => `${b[0]}-${b[1] === 255 ? "+" : b[1]}: ${(pc[j][z] / Math.max(1, cc[j][z])).toFixed(1)} (${cc[j][z]} cells)`).join(", "));
  }
  if ((t / C.TICK_HZ) % 30 === 0) for (let z = 0; z < 2; z++) console.log(`t=${(t / C.TICK_HZ).toFixed(0)} zone ${z}: inside ${inside[z]} (${(inside[z] / cellsIn[z]).toFixed(2)}/cell), in gateway ${gw[z]} (stalled ${gws[z]}), 10+ deep ${deep[z]}`);
}
for (let t = 1; t <= S * C.TICK_HZ; t++) {
  for (const b of buys) if (b[0] > 0 && s.time >= b[0]) { const e = s.placeSupport("evac", b[1], b[2]); console.log(`t=${s.time.toFixed(0)} buy evac ${b[1]},${b[2]}: ${e ?? "ok"}`); b[0] = -1; }
  s.step();
  if (process.env.AL_GATE && t % C.TICK_HZ === 0) gateStats(t);
  if (process.env.AL_GATE) { logged = s.liftLog.length; continue; }
  while (logged < s.liftLog.length) {
    const L = s.liftLog[logged++];
    const z = zoneOf(L.x, L.y);
    let inZ = 0, nearR = 0, near2R = 0, noRoute = 0;
    for (let k = 0; k < s.civN; k++) {
      if (s.state[k] !== SAFE || zoneOf(s.ax[k], s.ay[k]) !== z) continue;
      inZ++;
      const d = Math.hypot(s.ax[k] - L.x - 0.5, s.ay[k] - L.y - 0.5);
      if (d <= R) nearR++; else if (d <= 2 * R) near2R++;
      if (a.padField[s.idx(s.ax[k] | 0, s.ay[k] | 0)] === 65535) noRoute++;
    }
    console.log(`t=${s.time.toFixed(0)} ${L.kind} ${L.x},${L.y} n=${L.n} | zone ${z}: ${inZ} inside, ${nearR} left within reach, ${near2R} just beyond, ${noRoute} with no route`);
  }
}
let out = 0, civ = 0; for (let k = 0; k < s.civN; k++) { if (s.state[k] === 0) civ++; }
console.log(`evacuated ${s.evacuated}, outside alive ${civ}`);
