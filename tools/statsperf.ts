// 0.57: what the battle recorder costs. Runs the same Manhattan (Midtown) battle with recording off and on,
// twice each, and prints the step time difference. Usage: bun tools/statsperf.ts [steps]
import * as C from "../src/config";
import { Sim } from "../src/sim";
import { setStatsOff } from "../src/stats";
import { loadRealArea } from "../src/realcity/load";

const steps = Number(process.argv[2] ?? 3000);
const area = C.REAL_CITIES.find(c => c.id === "manhattan")!.areas!.find(a => a.key.includes("midtown"))!;
await loadRealArea(area.key);
function run(off: boolean): number {
  setStatsOff(off);
  const s = new Sim(area.seed, { realArea: area.key, sites: area.sites, budget: area.budget } as any);
  s.startBattle();
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) s.step();
  return performance.now() - t0;
}
const res: Record<string, number[]> = { off: [], on: [] };
for (let rep = 0; rep < 2; rep++) { res.off.push(run(true)); res.on.push(run(false)); }
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const off = sum(res.off), on = sum(res.on);
console.log(`steps ${steps} x2  off ${off.toFixed(0)} ms  on ${on.toFixed(0)} ms  diff ${((on - off) / off * 100).toFixed(2)}%`);

// 0.57: the town report at the end of a Manhattan battle (budget: 200 ms)
{
  const { buildPlaces } = await import("../src/places");
  const { buildTownReport, townInputFromSim } = await import("../src/townreport");
  const { realAreaStreets } = await import("../src/realcity/load");
  setStatsOff(false);
  const s = new Sim(area.seed, { realArea: area.key, sites: area.sites, budget: area.budget } as any);
  s.setStartTime(600); s.startBattle();
  for (let i = 0; i < steps; i++) s.step();
  const t0 = performance.now();
  const places = buildPlaces(s.map, s.seed, { streets: realAreaStreets(area.key), generate: false, schools: s.schools.length });
  const t1 = performance.now();
  const r = buildTownReport(townInputFromSim(s, places, area.name), 1);
  const t2 = performance.now();
  console.log(`town report: places ${(t1 - t0).toFixed(0)} ms, report ${(t2 - t1).toFixed(0)} ms, ${s.civN} people, ${r.summary.households} households, ${r.stories.length} stories`);
}
