// 0.36 capture tool, step 1: fetch a city's OpenStreetMap data into the cache (~/.cache/horde-osm/<city>/).
//   bun tools/capture/fetch.ts <cityId|all>
// One request at a time, 15 s apart; re-runs skip what is cached. meta.json lists every file the bake needs.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE } from "../../src/realcity/catalogue";
import { parseOverpass } from "../../src/realcity/osmtypes";
import { createOverpass } from "./overpass";
import { areaBBox, areaQuery, boundaryQuery, buildingQuery, BUILDING_BUFFER_M, cityDir, overviewQuery, ringsBBox, tiles } from "./plan";

const arg = process.argv[2];
if (!arg) { console.error("usage: bun tools/capture/fetch.ts <cityId|all>"); process.exit(2); }
const cities = arg === "all" ? CATALOGUE : CATALOGUE.filter(c => c.id === arg);
if (!cities.length) { console.error(`no city ${arg}`); process.exit(2); }
const ovp = createOverpass();

// every city's battle areas first (what the game needs), then the overview tiles
const overviews: { dir: string; id: string; ts: ReturnType<typeof tiles> }[] = [];
for (const c of cities) {
  const dir = cityDir(c); mkdirSync(dir, { recursive: true });
  let rel = c.osmRelation;
  if (!rel) {
    const hits = await ovp.getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(c.boundaryQuery)}`, join(dir, "nominatim.json"));
    const hit = (hits as any[]).find(h => h.osm_type === "relation" && (h.class === "boundary" || h.type === "administrative")) ?? (hits as any[]).find(h => h.osm_type === "relation");
    if (!hit) throw new Error(`${c.id}: no boundary relation from Nominatim`);
    rel = Number(hit.osm_id);
  }
  const bj = await ovp.query(boundaryQuery(rel), join(dir, "boundary.json"));
  const rings = parseOverpass(bj).ways.filter(w => w.tags._rel).map(w => w.geom);
  if (!rings.length) throw new Error(`${c.id}: boundary relation ${rel} has no outer ways`);
  const ts = tiles(ringsBBox(rings));
  const files = ["boundary.json", ...ts.map((_, i) => `overview-${i}.json`), ...c.areas.flatMap(a => [`area-${a.id}.json`, `area-${a.id}-b.json`])];
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ city: c.id, relation: rel, tiles: ts, files, fetched: new Date().toISOString() }, null, 1));
  console.log(`${c.id}: relation ${rel}, ${ts.length} overview tiles, ${c.areas.length} areas`);
  for (const a of c.areas) {
    const f = join(dir, `area-${a.id}.json`), fb = join(dir, `area-${a.id}-b.json`);
    if (!existsSync(f)) { await ovp.query(areaQuery(areaBBox(a)), f); console.log(`  area ${a.id}`); }
    if (!existsSync(fb)) {
      const b = areaBBox(a, BUILDING_BUFFER_M);
      try {
        if (existsSync(join(dir, `area-${a.id}-b0.json`))) throw new Error("resume quarters");
        await ovp.query(buildingQuery(b), fb, { tries: 2 });
      }
      catch { // dense: four quarters, merged into the one file
        const mLat = (b.s + b.n) / 2, mLon = (b.w + b.e) / 2, parts: any[] = [];
        for (const [k, q] of [{ s: b.s, w: b.w, n: mLat, e: mLon }, { s: b.s, w: mLon, n: mLat, e: b.e }, { s: mLat, w: b.w, n: b.n, e: mLon }, { s: mLat, w: mLon, n: b.n, e: b.e }].entries())
          parts.push(await ovp.query(buildingQuery(q), join(dir, `area-${a.id}-b${k}.json`)));
        const seen = new Set<string>(), elements = parts.flatMap(p => p.elements ?? []).filter((e: any) => { const key = e.type + e.id; if (seen.has(key)) return false; seen.add(key); return true; });
        writeFileSync(fb + ".part", JSON.stringify({ elements })); renameSync(fb + ".part", fb);
      }
      console.log(`  buildings ${a.id}`);
    }
  }
  overviews.push({ dir, id: c.id, ts });
}
for (const { dir, id, ts } of overviews) for (const [i, t] of ts.entries()) {
  const f = join(dir, `overview-${i}.json`); if (existsSync(f)) continue;
  await ovp.query(overviewQuery(t), f); console.log(`  ${id} overview ${i + 1}/${ts.length}`);
}
console.log("done");
