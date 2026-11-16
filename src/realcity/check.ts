// 0.36 real cities: a battle area against the campaign's city rules (one land mass, ways in on two sides, stand
// points with open ground, rooftops and a wide street), and where its stand points are.
import { BUILDING, CityMap, PARK, ROAD } from "../map";
import { Sim } from "../sim";
import type { Stand } from "../cities/recipe";
import { components, diagonalRuns, measureStand, wideCells, STAND_OPEN, type CityReport } from "../cities/check";

export interface AreaReport extends CityReport { ok: boolean; why: string[] }
export const STAND_R = 34, STAND_EDGE = 60, STAND_GAP = 80, STAND_STEP = 6;

/** Candidate safe-zone centres: a lattice search for spots meeting the stand rules, best first (park cells count
 *  double, then rooftops), at least STAND_GAP apart and STAND_EDGE from the map edge. */
export function findStands(m: CityMap, n = 4): Stand[] {
  const comp = components(m), wide = wideCells(m), { w, tile, height } = m;
  const cand: { st: Stand; score: number }[] = [];
  for (let y = STAND_EDGE; y <= m.h - STAND_EDGE; y += STAND_STEP) for (let x = STAND_EDGE; x <= m.w - STAND_EDGE; x += STAND_STEP) {
    // quick pre-filter before the full measure
    let park = 0, open = 0, roofs = 0;
    for (let dy = -STAND_R; dy <= STAND_R; dy += 2) for (let dx = -STAND_R; dx <= STAND_R; dx += 2) {
      if (dx * dx + dy * dy > STAND_R * STAND_R) continue;
      const t = tile[(y + dy) * w + x + dx];
      if (t === PARK) { park++; open++; } else if (t === ROAD) open++;
      else if (t === BUILDING && height[(y + dy) * w + x + dx] >= 3) roofs++;
    }
    if (open * 4 < STAND_OPEN * 0.8) continue;
    const st: Stand = { name: "", x, y, r: STAND_R };
    if (!measureStand(m, comp, wide, st).ok) continue;
    cand.push({ st, score: park * 8 + roofs * 4 });
  }
  cand.sort((a, b) => b.score - a.score || a.st.y - b.st.y || a.st.x - b.st.x);
  const out: Stand[] = [];
  for (const c of cand) {
    if (out.length >= n) break;
    if (out.some(o => Math.hypot(o.x - c.st.x, o.y - c.st.y) < STAND_GAP)) continue;
    out.push({ ...c.st, name: `Stand ${out.length + 1}` });
  }
  return out;
}

export function checkArea(m: CityMap, stands: Stand[]): AreaReport {
  let water = 0; for (const t of m.tile) if (t === 3) water++;
  const comp = components(m), wide = wideCells(m);
  const s = new Sim(m.seed, { customMap: m } as any);
  s.startBattle();
  const land = s.entries.filter(e => e.kind !== "river");
  const rep = stands.map(st => measureStand(m, comp, wide, st));
  const r: CityReport = { waterFrac: water / (m.w * m.h), diagonalRuns: diagonalRuns(m), landComponents: comp.count, entryEdges: new Set(land.map(e => e.edge)).size, entries: land.length, stands: rep };
  const why: string[] = [];
  if (r.landComponents !== 1) why.push(`land components ${r.landComponents}`);
  if (r.entryEdges < 2) why.push(`entries on ${r.entryEdges} edge(s)`);
  if (rep.filter(x => x.ok).length < 2) why.push(`stands ${rep.filter(x => x.ok).length} ok`);
  return { ...r, ok: why.length === 0, why };
}
