// Plays a "sensible player" plan headless on a few cities and prints % saved. `bun tools/balance.ts`
import { Sim } from "../src/sim";
import * as C from "../src/config";
// `bun tools/balance.ts campaign` plays every campaign city with its own budget and horde size.
const runs: [string, number, import("../src/sim").SimOpts][] = process.argv[2] === "campaign"
  ? C.CITIES.map(c => [c.name, c.seed, { budget: c.budget, waveMul: c.waveMul, sites: c.sites, speedMul: c.speedMul }])
  : process.argv[2] === "real"
  ? C.REAL_CITIES.map(c => [c.name, c.seed, { budget: c.budget, waveMul: c.waveMul, sites: c.sites, speedMul: c.speedMul, realCityId: c.id }])
  : (process.argv[2] ?? "7,42,1234").split(",").map(n => [`seed ${n}`, Number(n), {}]);
const spend = process.argv.includes("--spend");
const useSupport = process.argv.includes("--support");
const SPEND_EVERY = Number(process.env.SPEND_EVERY ?? 200); // the bot reinvests battle income
const diffEnv = process.env.DIFF as C.Difficulty | undefined;
const difficulty: C.Difficulty = diffEnv && C.DIFFICULTY[diffEnv] ? diffEnv : "medium";
const res: string[] = [];
for (const [name, seed, opts] of runs) {
  const s = new Sim(seed, { ...opts, difficulty });
  const cx = s.w / 2, cy = s.h / 3;
  const err = s.setZone([[cx - 40, cy - 28], [cx + 40, cy - 28], [cx + 46, cy + 24], [cx - 36, cy + 30]]);
  if (err) { console.log(seed, err); continue; }
  const gates: number[][] = [];
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 3) gates.push([i % s.w, (i / s.w) | 0]);
  const cand: number[][] = [];
  const inner: number[][] = [];
  for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 1) {
    const x = i % s.w, y = (i / s.w) | 0; let d = 1e9;
    for (const [gx, gy] of gates) d = Math.min(d, Math.hypot(gx - x, gy - y));
    cand.push([d, x, y]);
    inner.push([Math.hypot(x - cx, y - cy), x, y]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  inner.sort((a, b) => a[0] - b[0]);
  if (useSupport) {
    for (const kind of ["budget", "radio", "repair"] as C.SupportKind[]) {
      for (const [, x, y] of inner) if (!s.placeSupport(kind, x, y)) break;
    }
  }
  // 0.33: a sensible player picks roofs that see the approaches: score each building near a gate by how many
  // street cells outside the zone it has a sight line to (buildings block shots since 0.33)
  const view = new Map<string, number>();
  const sees = (x: number, y: number) => {
    const key = x + "," + y; let v = view.get(key);
    if (v !== undefined) return v;
    const eye = s.map.height[s.idx(x, y)] * C.LEVEL_M + 1.7, R = 18;
    v = 0;
    for (let ty = y - R; ty <= y + R; ty += 2) for (let tx = x - R; tx <= x + R; tx += 2) {
      if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h || (tx - x) ** 2 + (ty - y) ** 2 > R * R) continue;
      const i = s.idx(tx, ty);
      if (s.inZone[i] !== 0 || s.map.tile[i] !== 0) continue;
      if (s.sightClear(x + 0.5, y + 0.5, eye, tx + 0.5, ty + 0.5)) v++;
    }
    view.set(key, v); return v;
  };
  const near = cand.filter(c => c[0] <= 8).sort((a, b) => sees(b[1], b[2]) - sees(a[1], a[2]));
  const order: C.UnitKind[] = ["garrison", "sniper", "garrison", "sniper", "garrison", "garrison", "garrison", "sniper"];
  for (let k = 0; k < 24 && s.remaining() >= 1_200_000; k++) { const kind = order[k % order.length];
    for (const [, x, y] of near) { // only buildings close to a gate, best view first
      if (s.units.some(u => Math.hypot(u.x - x, u.y - y) < 18)) continue; // spread out
      if (!s.place(kind, x, y)) break;
    }
  }
  // Evac Points (0.10 scoring): on buildings inside the zone, spread out from the center.
  const pads = Number(process.env.PADS ?? 2);
  for (let p = 0, tries = 0; p < pads && tries < inner.length; tries++) {
    const [, x, y] = inner[Math.min(inner.length - 1, tries * 7)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!s.placeSupport("evac", x + dx, y + dy)) { p++; break; }
  }
  s.startBattle();
  let peakInf = 0, peakSafe = 0; const firstBreach = { t: -1 };
  let closed = false;
  const MAX_T = Number(process.env.MAX_T ?? 900);
  let round = "";
  const sizes5m: number[] = [], gaps5m: number[] = [];
  let lastW = 0, prevWaveT = C.WARNING_S;
  while (s.phase === "battle") {
    if (s.time > MAX_T) { s.withdraw(); break; }
    if (s.roundResult && !round) round = `round@${Math.round(s.time)}s ${s.roundResult.score.toFixed(1)} pts ${s.roundResult.pct.toFixed(1)}% ${s.roundResult.medal ?? "-"}`;
    if (!closed && s.time > C.WARNING_S + 100) { closed = true; for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 3 && s.wallHp[i] > 0) s.toggleGate(i % s.w, (i / s.w) | 0); }
    if (spend && s.tick % SPEND_EVERY === 0) // reinvest income: more garrisons by the gates
      for (const [d, x, y] of cand) { if (s.remaining() < 1_200_000) break; if (d > 10 || s.units.some(u => Math.hypot(u.x - x, u.y - y) < 10)) continue; s.place("garrison", x, y); }
    s.step(C.DT * 2);
    if (s.wave !== lastW) {
      if (s.time <= C.WARNING_S + 300) {
        sizes5m.push(s.lastWaveCount);
        gaps5m.push(Math.round(s.waveT - prevWaveT));
      }
      prevWaveT = s.waveT;
      lastW = s.wave;
    }
    if (s.tick % 50 === 0) { const c = s.counts(); peakInf = Math.max(peakInf, c.inf); peakSafe = Math.max(peakSafe, c.safe); } if (s.breaches && firstBreach.t < 0) firstBreach.t = Math.round(s.time);
  }
  const r = s.result!;
  res.push(`${name} [${difficulty}]: ${r.pct.toFixed(1)}% evac ${r.medal ?? "-"} | ${round || "round not reached"} | ${r.reason} t=${s.time.toFixed(0)} waves=${s.wave} sizes=[${sizes5m.join(",")}] gaps=[${gaps5m.join(",")}] pads=${s.supports.filter(b => b.kind === "evac").length} lifts=${s.liftsFlown}/${s.liftsAborted}ab train=${s.trainsEvacuated} intact=${r.intact.toFixed(0)}% xp=${r.xp} kills=${s.kills} breaches=${s.breaches} peakInf=${peakInf} peakSafe=${peakSafe} firstBreach=${firstBreach.t}s units=${s.units.length} left=$${s.remaining()} earned=$${s.earned}`);
}
console.log(res.join("\n"));
