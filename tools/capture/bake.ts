// 0.36 capture tool, step 2: bake a city from the cache into src/realcity/data/<city>.ts, with pictures in
// Projects/Horde/captures/<city>/ and a check table. Refuses to bake a city whose fetch isn't complete.
//   bun tools/capture/bake.ts <cityId|all>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE, type CitySpec } from "../../src/realcity/catalogue";
import { parseOverpass, type CityData, type OsmData } from "../../src/realcity/osmtypes";
import { dominantAngle, toCell, type Frame } from "../../src/realcity/geo";
import { rasterizeArea } from "../../src/realcity/raster";
import { checkArea, findStands } from "../../src/realcity/check";
import { AREA_H, AREA_W, areaQuad, buildOverview, encodeOverview } from "../../src/realcity/overview";
import { encodeCityMapV2 } from "../../src/osm";
import { BUILDING, WATER } from "../../src/map";
import { cityDir } from "./plan";
import { drawMap, drawOverview } from "./png";

const DATA = new URL("../../src/realcity/data/", import.meta.url).pathname;
const SHOTS = new URL("../../../captures/", import.meta.url).pathname;
const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

export function missingFiles(c: CitySpec): string[] {
  const dir = cityDir(c), metaF = join(dir, "meta.json");
  if (!existsSync(metaF)) return ["meta.json"];
  const meta = JSON.parse(readFileSync(metaF, "utf8"));
  const need: string[] = [...meta.files];
  for (const a of c.areas) if (!need.includes(`area-${a.id}.json`)) need.push(`area-${a.id}.json`);
  return need.filter(f => !existsSync(join(dir, f)));
}

function merge(parts: OsmData[]): OsmData {
  const seen = new Set<number>(), out: OsmData = { ways: [], nodes: [], coast: [] };
  for (const p of parts) {
    for (const w of p.ways) if (!seen.has(w.id)) { seen.add(w.id); out.ways.push(w); }
    out.nodes.push(...p.nodes); out.coast.push(...p.coast);
  }
  return out;
}

async function bake(c: CitySpec): Promise<boolean> {
  const miss = missingFiles(c);
  if (miss.length) { console.error(`${c.id}: fetch incomplete, not baking. Missing: ${miss.join(", ")}`); return false; }
  const dir = cityDir(c), meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const rings = parseOverpass(JSON.parse(readFileSync(join(dir, "boundary.json"), "utf8"))).ways.filter(w => w.tags._rel).map(w => w.geom);
  const ovData = merge([
    ...meta.tiles.map((_: unknown, i: number) => parseOverpass(JSON.parse(readFileSync(join(dir, `overview-${i}.json`), "utf8")))),
    ...c.areas.map(a => parseOverpass(JSON.parse(readFileSync(join(dir, `area-${a.id}.json`), "utf8")))),
  ]);
  const ov = buildOverview(ovData, rings, c.seaPoints);
  mkdirSync(join(SHOTS, c.id), { recursive: true });
  const data: CityData = { overview: encodeOverview(ov), areas: {} };
  const quads: [number, number][][] = [];
  let pass = true;
  console.log(`\n${c.name}: overview ${ov.w}x${ov.h} @ ${ov.mPerPx} m/px`);
  console.log("area".padEnd(40) + "angle  water  bldg  stands  edges  land  KB    result");
  for (const a of c.areas) {
    const fb = join(dir, `area-${a.id}-b.json`);
    const d = merge([parseOverpass(JSON.parse(readFileSync(join(dir, `area-${a.id}.json`), "utf8"))), ...(existsSync(fb) ? [parseOverpass(JSON.parse(readFileSync(fb, "utf8")))] : [])]);
    const probe: Frame = { lat0: a.at[0], lon0: a.at[1], angle: 0, w: AREA_W, h: AREA_H };
    const roads = d.ways.filter(w => w.tags.highway && w.geom.some(p => { const q = toCell(probe, p); return Math.hypot(q[0] - AREA_W / 2, q[1] - AREA_H / 2) < 350; })).map(w => w.geom);
    const angle = a.angle ?? dominantAngle(roads);
    const frame: Frame = { ...probe, angle };
    const m = rasterizeArea(d, { frame, seed: (c.seed ^ hash(a.id)) >>> 0, diagonals: c.diagonals, seaPoints: c.seaPoints });
    const stands = findStands(m).map((s, i) => ({ ...s, name: a.stands?.[i] ?? s.name }));
    const rep = checkArea(m, stands);
    let water = 0, bld = 0; for (const t of m.tile) { if (t === WATER) water++; else if (t === BUILDING) bld++; }
    const enc = await encodeCityMapV2(m);
    data.areas[a.id] = { map: enc, angle, stands };
    quads.push(areaQuad(ov, a.at, angle));
    writeFileSync(join(SHOTS, c.id, `${a.id}.png`), drawMap(m, stands, rep.stands.map(s => s.ok)));
    const wf = water / (m.w * m.h);
    const warn = a.water ? wf < 0.02 ? " (water expected)" : "" : wf > 0.02 ? " (dry area has water)" : "";
    console.log(a.name.slice(0, 39).padEnd(40) + `${angle.toFixed(1).padStart(5)}  ${(wf * 100).toFixed(1).padStart(4)}%  ${(bld / (m.w * m.h) * 100).toFixed(0).padStart(3)}%  ` +
      `${rep.stands.filter(s => s.ok).length}/${stands.length}`.padEnd(8) + `${rep.entryEdges}`.padEnd(7) + `${rep.landComponents}`.padEnd(6) + `${Math.round(enc.length / 1024)}`.padEnd(6) +
      (rep.ok ? "PASS" : "FAIL " + rep.why.join("; ")) + warn);
    if (!rep.ok) pass = false;
  }
  writeFileSync(join(SHOTS, c.id, "overview.png"), drawOverview(ov, quads));
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, `${c.id}.ts`), `// Generated by tools/capture/bake.ts from OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Do not edit.\n` +
    `import type { CityData } from "../osmtypes";\nexport const data: CityData = ${JSON.stringify(data)};\n`);
  writeIndex();
  return pass;
}

export function writeIndex() {
  const ids = readdirSync(DATA).filter(f => f.endsWith(".ts") && f !== "index.ts").map(f => f.slice(0, -3)).sort();
  const v = (id: string) => "d_" + id.replace(/-/g, "_");
  writeFileSync(join(DATA, "index.ts"), `// Generated by tools/capture/bake.ts. Baked real cities, inlined into the single-file build.\nimport type { CityData } from "../osmtypes";\n` +
    ids.map(id => `import { data as ${v(id)} } from "./${id}";`).join("\n") + `\nexport const REAL_DATA: Record<string, CityData> = { ${ids.map(id => `"${id}": ${v(id)}`).join(", ")} };\n`);
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) { console.error("usage: bun tools/capture/bake.ts <cityId|all>"); process.exit(2); }
  const cities = arg === "all" ? CATALOGUE : CATALOGUE.filter(c => c.id === arg);
  let ok = true;
  for (const c of cities) ok = (await bake(c)) && ok;
  process.exit(ok ? 0 : 1);
}
