// Plays a "sensible player" plan headless on a few cities and prints % saved. `bun tools/balance.ts`
import { Sim } from "../src/sim";
import * as C from "../src/config";
import { loadRealArea } from "../src/realcity/load";
// `bun tools/balance.ts campaign` plays every campaign city with its own budget and horde size.
const runs: [string, number, import("../src/sim").SimOpts][] = process.argv[2] === "campaign"
  ? C.CITIES.map(c => [c.name, c.seed, { budget: c.budget, waveMul: c.waveMul, sites: c.sites, speedMul: c.speedMul, recipe: c.recipe }])
  : process.argv[2] === "real" // 0.36: every baked battle area (REAL_ONLY=<city> for one city)
  ? C.REAL_CITIES.filter(c => !process.env.REAL_ONLY || c.id === process.env.REAL_ONLY).flatMap(c => (c.areas ?? []).filter(a => !process.env.REAL_AREA || a.id === process.env.REAL_AREA).map(a => [a.key, a.seed, { budget: a.budget, waveMul: a.waveMul, sites: a.sites, speedMul: a.speedMul, realArea: a.key, stand: a.stands[0] }] as [string, number, any]))
  : (process.argv[2] ?? "7,42,1234").split(",").map(n => [`seed ${n}`, Number(n), {}]);
const spend = process.argv.includes("--spend");
// 0.48: `--spam garrison|apc|sniper`: the playtester's strategy: one unit kind, as many as money allows, stacked by
// the gates from the first second, and every dollar of income goes into more of the same.
const spamAt = process.argv.indexOf("--spam"), spam = spamAt > 0 ? process.argv[spamAt + 1] as C.UnitKind : null;
// 0.48: `--mix`: the efficient player the price line rewards: a mixed army (Garrisons and Snipers on the roofs that
// see the approaches, Turrets and Mortars on the streets by the gates), always buying the kind whose next one is
// cheapest for its base price, with spacing, and reinvesting income the same way.
const mix = process.argv.includes("--mix");
// 0.49: `--bare`: pads only, no army at all. The control: what the units add over doing nothing.
const bare = process.argv.includes("--bare");
const MIX: C.UnitKind[] = ["garrison", "sniper", "turret", "mortar"];
const useSupport = process.argv.includes("--support");
// 0.49: `--defend`: what a real player does for the gates on top of any mode: a Repair Yard (it covers the zone's
// walls and gates) bought before the army, and every unit set to Wall targeting (shoot what claws the wall first).
const defend = process.argv.includes("--defend");
// 0.50: `--micro`: a player who works the Troops: when a gate drops below 30% (or breaks), the nearest fortified Troops
// squad comes down and attack-moves to just inside it; once the gate is back above 60% (or after 30 s) it re-fortifies
// its old roof.
const micro = process.argv.includes("--micro");
const SPEND_EVERY = Number(process.env.SPEND_EVERY ?? 200); // the bot reinvests battle income
const diffEnv = process.env.DIFF as C.Difficulty | undefined;
const difficulty: C.Difficulty = diffEnv && C.DIFFICULTY[diffEnv] ? diffEnv : "medium";
// 0.48: DIFF_SET="budgetMul=1,priceStep=0" overrides the difficulty's economy for this run (tuning)
for (const kv of (process.env.DIFF_SET ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); (C.DIFFICULTY[difficulty] as any)[k] = k === "noPause" ? v === "true" : +v; }
// 0.49: TUNE="GARRISON_FIRE_MUL=0.75,..." sets any config tunable for this run
for (const kv of (process.env.TUNE ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); if (!C.TUNABLE[k]) throw new Error("no tunable " + k); C.TUNABLE[k][1](+v); }
const res: string[] = [];
for (const [name, seed, opts] of runs) {
  if ((opts as any).realArea) await loadRealArea((opts as any).realArea);
  const s = new Sim(seed, { ...opts, difficulty });
  const st0 = opts.recipe?.stands[0] ?? (opts as any).stand; // 0.35: designed cities (0.36: and real areas): the bot defends the first stand point
  const cx = st0 ? st0.x : s.w / 2, cy = st0 ? st0.y : s.h / 3;
  const err = s.setZone([[cx - 40, cy - 28], [cx + 40, cy - 28], [cx + 46, cy + 24], [cx - 36, cy + 30]]);
  if (err) { console.log(seed, err); continue; }
  if (process.argv.includes("--restock")) s.supply.forEach((_, z) => s.buySupply(z, "small", 10)); // 0.60: the planner buys stock before the army
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
  // REPAIRS=n (default 1): n Repair Yards; past the first they go toward the zone's corners (a common way to play)
  if (defend) {
    const want = Number(process.env.REPAIRS ?? 1), corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let r = 0; r < want; r++) {
      const [sx, sy] = r === 0 && want === 1 ? [0, 0] : corners[r % 4];
      const spots = inner.slice().sort((a, b) => (b[1] - cx) * sx + (b[2] - cy) * sy - ((a[1] - cx) * sx + (a[2] - cy) * sy));
      for (const [, x, y] of spots) if (!s.placeSupport("repair", x, y)) break;
    }
  }
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
  // spam: ground units go on streets inside the zone, nearest the gates first
  const street: number[][] = [];
  if (spam && C.UNITS[spam].on === "ground") for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 0) {
    const x = i % s.w, y = (i / s.w) | 0; let d = 1e9; for (const [gx, gy] of gates) d = Math.min(d, Math.hypot(gx - x, gy - y)); street.push([d, x, y]);
  }
  street.sort((a, b) => a[0] - b[0]);
  const spamSpots = spam ? (C.UNITS[spam].on === "ground" ? street : cand) : [];
  const spamBuy = () => { if (!spam) return; for (const [, x, y] of spamSpots) { if (s.remaining() < s.unitCost(spam)) break; s.place(spam, x, y); } };
  const order: C.UnitKind[] = ["garrison", "sniper", "garrison", "sniper", "garrison", "garrison", "garrison", "sniper"];
  if (!spam) spamBuy();
  // --mix: roofs near the gates by view, streets near the gates by distance
  const mixRoofs = cand.filter(c => c[0] <= 12).sort((a, b) => sees(b[1], b[2]) - sees(a[1], a[2]));
  const mixStreets: number[][] = [];
  if (mix) for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1 && s.map.tile[i] === 0) {
    const x = i % s.w, y = (i / s.w) | 0; let d = 1e9; for (const [gx, gy] of gates) d = Math.min(d, Math.hypot(gx - x, gy - y)); if (d <= 8) mixStreets.push([d, x, y]);
  }
  mixStreets.sort((a, b) => a[0] - b[0]);
  const mixBuy = (maxN = 99) => {
    for (let n = 0; n < maxN; n++) {
      const kinds = MIX.slice().sort((a, b) => s.unitCost(a) / C.UNITS[a].cost - s.unitCost(b) / C.UNITS[b].cost);
      let bought = false;
      for (const kind of kinds) {
        if (s.remaining() < s.unitCost(kind)) continue;
        const spots = C.UNITS[kind].on === "building" ? mixRoofs : mixStreets, gap = C.UNITS[kind].on === "building" ? 9 : 6;
        for (const [, x, y] of spots) {
          if (s.units.some(u => u.kind === kind && Math.hypot(u.x - x, u.y - y) < gap)) continue;
          if (!s.place(kind, x, y)) { bought = true; break; }
        }
        if (bought) break;
      }
      if (!bought) return;
    }
  };
  for (let k = 0; k < (spam || mix || bare ? 0 : 24) && s.remaining() >= 1_200_000; k++) { const kind = order[k % order.length];
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
  // 0.35.1: pads may go on streets and parks too; a zone with no roofs (a park stand) still gets its pads
  const zoneCells: number[] = []; for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 1) zoneCells.push(i);
  for (let k = 0; k < zoneCells.length && s.supports.filter(b => b.kind === "evac").length < pads; k += 37)
    s.placeSupport("evac", zoneCells[k] % s.w, (zoneCells[k] / s.w) | 0);
  spamBuy(); // spam: after the pads
  if (mix) mixBuy(Number(process.env.MIX_START ?? 30)); // a mixed opening, money kept back for the battle
  // --micro state: squad -> its roof, what it is doing, since when, which gate
  let microSorties = 0;
  const sent = new Map<import("../src/sim").Unit, { home: [number, number]; phase: "down" | "out" | "back"; t: number; gate: number }>();
  const gateMax = s.gateMaxHp();
  const insideOf = (g: number) => { const gx = g % s.w, gy = (g / s.w) | 0; let best = -1, bd = 1e9;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue; const i = s.idx(x, y);
      if (s.inZone[i] === 1 && s.map.tile[i] !== 1 && s.map.tile[i] !== 3) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } }
    return best; };
  const microStep = () => {
    for (const [u, st] of sent) {
      if (!s.units.includes(u) || (u.hp !== undefined && u.hp <= 0)) { sent.delete(u); continue; }
      if (st.phase === "down" && u.fort === undefined) { const t = insideOf(st.gate); if (t >= 0) s.issue(u, { k: "amove", x: t % s.w, y: (t / s.w) | 0 }, false); st.phase = "out"; }
      else if (st.phase === "out" && (s.wallHp[st.gate] > gateMax * 0.6 || s.time - st.t > 30)) { if (s.issue(u, { k: "fortify", x: st.home[0], y: st.home[1] }, false)) sent.delete(u); else st.phase = "back"; }
      else if (st.phase === "back" && u.fort === "up") sent.delete(u);
      else if (st.phase === "back" && !u.fort && !u.orders?.length) sent.delete(u); // its roof got taken: it stays down
    }
    if (sent.size >= 3) return;
    for (let i = 0; i < s.inZone.length && sent.size < 3; i++) {
      if (s.inZone[i] !== 3 || s.wallHp[i] > gateMax * 0.3) continue;
      if ([...sent.values()].some(v => Math.hypot((v.gate % s.w) - (i % s.w), ((v.gate / s.w) | 0) - ((i / s.w) | 0)) < 8)) continue;
      let best: import("../src/sim").Unit | null = null, bd = 1e9;
      for (const u of s.units) if (u.kind === "garrison" && u.fort === "up" && !sent.has(u)) { const d = Math.hypot(u.x - (i % s.w), u.y - ((i / s.w) | 0)); if (d < bd && d < 30) { bd = d; best = u; } }
      if (!best) continue;
      const home: [number, number] = [best.x, best.y];
      if (!s.dismount(best, i % s.w, (i / s.w) | 0)) { sent.set(best, { home, phase: "down", t: s.time, gate: i }); microSorties++; }
    }
  };
  // 0.60: --norestock: auto-restock off everywhere and nothing bought (a player who never opens the Inventory on Hard);
  // --restock: auto-restock on and 10 extra small-arms crates per zone bought in planning
  if (process.argv.includes("--norestock")) s.supply.forEach((_, z) => s.setAuto(z, false));
  if (process.argv.includes("--restock")) s.supply.forEach((_, z) => s.setAuto(z, true));
  s.startBattle();
  let peakInf = 0, peakSafe = 0; const firstBreach = { t: -1 };
  let closed = false;
  const MAX_T = Number(process.env.MAX_T ?? 900);
  let round = "";
  const sizes5m: number[] = [], gaps5m: number[] = [];
  let lastW = 0, prevWaveT = C.WARNING_S;
  while (s.phase === "battle") {
    if (s.time > MAX_T) { s.withdraw(); break; }
    if (process.env.STOP_AT_ROUND && s.roundResult) break; // 0.35: measure XP for a player who stops when the round is won
    if (s.roundResult && !round) round = `round@${Math.round(s.time)}s ${s.roundResult.score.toFixed(1)} pts ${s.roundResult.pct.toFixed(1)}% ${s.roundResult.medal ?? "-"}`;
    if (!closed && s.time > C.WARNING_S + 100) { closed = true; for (let i = 0; i < s.inZone.length; i++) if (s.inZone[i] === 3 && s.wallHp[i] > 0) s.toggleGate(i % s.w, (i / s.w) | 0); }
    if (spam && s.tick % SPEND_EVERY === 0) spamBuy();
    if (mix && s.tick % SPEND_EVERY === 0) mixBuy(3);
    if (spend && !spam && s.tick % SPEND_EVERY === 0) // reinvest income: more garrisons by the gates
      for (const [d, x, y] of cand) { if (s.remaining() < 1_200_000) break; if (d > 10 || s.units.some(u => Math.hypot(u.x - x, u.y - y) < 10)) continue; s.place("garrison", x, y); }
    // REPAIRS_LATE=n: keep buying Repair Yards from battle income (corners, up the price line) until there are n
    if (defend && process.env.REPAIRS_LATE && s.tick % SPEND_EVERY === 0 && s.supports.filter(b => b.kind === "repair").length < +process.env.REPAIRS_LATE && s.remaining() >= s.supportCost("repair")) {
      const r = s.supports.filter(b => b.kind === "repair").length, [sx, sy] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][r % 4];
      const spots = inner.slice().sort((a, b) => (b[1] - cx) * sx + (b[2] - cy) * sy - ((a[1] - cx) * sx + (a[2] - cy) * sy));
      for (const [, x, y] of spots) if (!s.placeSupport("repair", x, y)) break;
    }
    if (micro && s.tick % 25 === 0) microStep();
    if (defend && s.tick % 25 === 0) for (const u of s.units) if (u.mode !== "wall" && !u.parentSupport) u.mode = "wall";
    s.step(C.DT * 2);
    if (process.env.ENG_DEBUG && s.tick % 1500 === 0) { // every 30 s of sim: what the crews and the low units are doing
      const zs = s.supply[0], low = s.units.filter(u => Number.isFinite(u.ammo) && u.ammo + (u.reserve ?? 0) < C.UNITS[u.kind].ammo * 1.6 && u.kind !== "para");
      console.log(`t=${s.time.toFixed(0)} stock=${zs.small} crew=${zs.crew.map(e => `${e.alive ? "" : "X"}${e.job ? e.job.kind[0] + e.job.id : "-"}${e.carry ? "c" : ""}@${e.x.toFixed(0)},${e.y.toFixed(0)}${e.climbT > 0 ? "^" : ""}`).join(" ")} low=${low.map(u => `${u.kind}#${s.units.indexOf(u)}:${Math.round(u.ammo)}+${Math.round(u.reserve ?? 0)}@${u.x | 0},${u.y | 0}z${s.zoneAt(u.x, u.y)}${s.isFortified(u) ? "F" : ""}`).join(" ")}`);
    }
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
  if (process.env.ENG_DEBUG) { const e = s.stats.ev; for (let i = 0; i < e.k.length; i++) if (e.k[i] === 18) console.log(`engineer lost t=${e.t[i].toFixed(0)} at ${e.x[i].toFixed(1)},${e.y[i].toFixed(1)} cell=${s.inZone[s.idx(e.x[i] | 0, e.y[i] | 0)]} zoneAt=${s.zoneAt(e.x[i], e.y[i])} store=${s.supply[0]?.store}`); }
  const r = (s.result ?? s.roundResult)!;
  res.push(`${name} [${difficulty}${spam ? " spam " + spam : mix ? " mix" : bare ? " bare" : spend ? " spend" : ""}${micro ? " micro" : ""}${defend ? " defend" + (process.env.REPAIRS ? " x" + process.env.REPAIRS : "") : ""}]: spent=$${(s.spent() / 1e6).toFixed(1)}M perM=${(r.perM ?? 0).toFixed(1)} upkeep=$${(s.upkeepPaid / 1e6).toFixed(1)}M ${r.pct.toFixed(1)}% evac ${r.medal ?? "-"} | ${round || "round not reached"} | ${r.reason} t=${s.time.toFixed(0)} waves=${s.wave} sizes=[${sizes5m.join(",")}] gaps=[${gaps5m.join(",")}] pads=${s.supports.filter(b => b.kind === "evac").length} repairs=${s.supports.filter(b => b.kind === "repair").length} lifts=${s.liftsFlown}/${s.liftsAborted}ab train=${s.trainsEvacuated} intact=${r.intact.toFixed(0)}% xp=${r.xp} kills=${s.kills} breaches=${s.breaches} peakInf=${peakInf} peakSafe=${peakSafe} firstBreach=${firstBreach.t}s units=${s.units.length}${micro ? ` sorties=${microSorties}` : ""} left=$${s.remaining()} earned=$${s.earned}${s.supply ? ` supply=$${((s.stats.c.supplySpent ?? 0) / 1e6).toFixed(1)}M crates=${s.stats.c.crates ?? 0} chinooks=${s.stats.ev.k.filter(k => k === 16).length} engLost=${s.stats.c.engineersLost ?? 0} dryS=${Math.round(s.stats.units.reduce((a, u) => a + (u.dryS ?? 0), 0))} stock=${s.supply.map(z => z.small).join("/")}` : ""}`);
}
console.log(res.join("\n"));
