// 0.57: place names for the town's stories and the person card. Real street names where the bake has them
// (OpenStreetMap, Castle Rock and Manhattan) and for live OSM maps; generated US street names for designed, quick
// and daily maps; none for other real cities (a made-up name on a real map would be wrong). Schools are placed by
// the sim, never from OSM, so every school gets a generated name.
import { hash32 } from "./people";
import { BRIDGE, ROAD, type CityMap } from "./map";

export interface Places { streetAt(cell: number): string | null; streetNear(cell: number): string | null; school(i: number): string; area: string | null }

const STREETS = ("Main Oak Maple Pine Cedar Elm Washington Lake Hill Park Walnut Spruce Ridge Church Willow Mill River " +
  "Jefferson Lincoln Jackson Franklin Madison Adams Highland Sunset Center Union Spring Chestnut Locust Market Prospect Grant " +
  "Cherry Birch Valley Forest Meadow Lakeview Railroad Broad Front Water School Liberty Hickory Poplar Magnolia Dogwood Ash " +
  "Laurel Cottage Orchard Spring Garden Grove Summit Pleasant Monroe Wilson Harrison Taylor Clinton Pierce Hamilton Lee " +
  "Fairview Riverside Hillcrest Woodland Brookside Greenwood Kingston Fulton Dewey Lafayette Hawthorne Sycamore Juniper " +
  "Aspen Holly Primrose Clover Beacon Harbor Bay Canal Quarry Depot Station College Academy Bridge Elmwood Oakwood Pinecrest " +
  "Sherman Logan Hayes Garfield Cleveland Mckinley Roosevelt Wright Edison Franklin Morris Carter Dalton Bennett Shelby").split(" ");
const SUFFIX = ["Street", "Street", "Street", "Avenue", "Avenue", "Road", "Drive", "Lane", "Boulevard"];
const NAMESAKES = ("Lincoln Washington Jefferson Roosevelt Kennedy Franklin Madison Adams Jackson Monroe Hamilton Edison " +
  "Riverside Oakwood Hillside Lakeview Westside Eastside Northside Central Valley Ridgeview Parkview Maplewood Pinecrest " +
  "Garfield Grant Wilson Truman Eisenhower Carver Douglass Tubman Keller Whitman Emerson Thoreau Frost Twain Hawthorne " +
  "Longfellow Revere Hale Marshall Sequoyah Clemente Earhart Curie Banneker Mann Dewey Lakeside Brookside Fairview Summit").split(" ");
const LEVEL = ["Elementary", "Elementary", "Middle", "High"];
const MIN_RUN = 12;

export function buildPlaces(map: CityMap, seed: number, opts: { streets?: [string, number[]][]; generate: boolean; area?: string | null; schools: number }): Places {
  const n = map.w * map.h, id = new Int32Array(n).fill(-1), names: string[] = [];
  if (opts.streets?.length) { // OSM polylines (tenths of a cell, -1 between ways): name the road/bridge cells they cross
    for (const [name, pts] of opts.streets) {
      const k = names.push(name) - 1;
      const ways: number[][] = [[]];
      for (const v of pts) if (v === -1) ways.push([]); else ways[ways.length - 1].push(v);
      for (const w of ways) for (let i = 2; i + 1 < w.length; i += 2) {
        const x0 = w[i - 2] / 10, y0 = w[i - 1] / 10, x1 = w[i] / 10, y1 = w[i + 1] / 10;
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
        for (let st = 0; st <= steps; st++) {
          const x = Math.floor(x0 + (x1 - x0) * st / steps), y = Math.floor(y0 + (y1 - y0) * st / steps);
          if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
          const c = y * map.w + x, t = map.tile[c];
          if ((t === ROAD || t === BRIDGE) && id[c] < 0) id[c] = k;
        }
      }
    }
  } else if (opts.generate) generate(map, seed, id, names);
  const school = (i: number) => {
    const h = hash32(seed, i + 1, 0x5c4001);
    return `${NAMESAKES[h % NAMESAKES.length]} ${LEVEL[(h >>> 8) % LEVEL.length]} School`;
  };
  const streetAt = (c: number) => (c >= 0 && c < n && id[c] >= 0 ? names[id[c]] : null);
  const streetNear = (c: number) => { // the named street within 2 cells (a doorstep sits beside its street)
    if (c < 0 || c >= n) return null;
    const x = c % map.w, y = (c / map.w) | 0;
    for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h) { const s = streetAt(ny * map.w + nx); if (s) return s; }
    }
    return null;
  };
  return { streetAt, streetNear, school, area: opts.area ?? null };
}

/** Name every straight road run of at least MIN_RUN cells; where runs cross, the longer one keeps the cell. */
function generate(map: CityMap, seed: number, id: Int32Array, names: string[]) {
  const { w, h, tile } = map, best = new Int32Array(w * h);
  const used = new Set<string>();
  const nameFor = (k: number) => {
    for (let t = 0; t < 40; t++) {
      const hh = hash32(seed, k, 0x57ee7 + t);
      const nm = `${STREETS[hh % STREETS.length]} ${SUFFIX[(hh >>> 10) % SUFFIX.length]}`;
      if (!used.has(nm) || t === 39) { used.add(nm); return nm; }
    }
    return "Main Street";
  };
  // runs along one axis; a wide road is several parallel runs side by side, so a run that mostly overlaps one on the
  // line before it (or two before it) keeps that run's name
  type Run = { a: number; b: number; line: number; nm: number };
  const pass = (horiz: boolean) => {
    const L = horiz ? h : w, M = horiz ? w : h, cell = (line: number, i: number) => horiz ? line * w + i : i * w + line;
    let prev: Run[] = [], prev2: Run[] = [];
    for (let line = 0; line < L; line++) {
      const cur: Run[] = [];
      for (let i = 0; i < M;) {
        if (tile[cell(line, i)] !== ROAD) { i++; continue; }
        const a = i; while (i < M && tile[cell(line, i)] === ROAD) i++;
        const b = i - 1, len = b - a + 1;
        if (len < MIN_RUN) continue;
        const near = [...prev, ...prev2].find(r => Math.min(r.b, b) - Math.max(r.a, a) + 1 >= 0.5 * Math.min(len, r.b - r.a + 1));
        const nm = near ? near.nm : names.push(nameFor(names.length * 2 + (horiz ? 0 : 1))) - 1;
        cur.push({ a, b, line, nm });
        for (let j = a; j <= b; j++) { const c = cell(line, j); if (len > best[c]) { best[c] = len; id[c] = nm; } }
      }
      prev2 = prev; prev = cur;
    }
  };
  pass(true); pass(false);
}
