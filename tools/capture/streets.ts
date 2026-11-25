// 0.57: add OpenStreetMap street names to already-baked real cities, without touching their maps. Reads the
// cached Overpass data (~/.cache/horde-osm/<city>/area-<id>.json), decodes each baked map, and writes `streets`
// into src/realcity/data/<city>.ts next to the untouched map string. Usage: bun tools/capture/streets.ts <city>...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE } from "../../src/realcity/catalogue";
import { parseOverpass, type CityData } from "../../src/realcity/osmtypes";
import { decodeCityMapV2 } from "../../src/osm";
import { AREA_H, AREA_W } from "../../src/realcity/overview";
import { streetLines } from "../../src/realcity/streets";
import { cityDir } from "./plan";

const DATA = new URL("../../src/realcity/data/", import.meta.url).pathname;
for (const id of process.argv.slice(2)) {
  const c = CATALOGUE.find(x => x.id === id); if (!c) throw new Error(`unknown city ${id}`);
  const file = join(DATA, `${id}.ts`), src = readFileSync(file, "utf8");
  const head = src.slice(0, src.indexOf("export const data: CityData = ") + "export const data: CityData = ".length);
  const data: CityData = JSON.parse(src.slice(head.length).replace(/;\s*$/, ""));
  for (const a of c.areas) {
    const f = join(cityDir(c), `area-${a.id}.json`), fb = join(cityDir(c), `area-${a.id}-b.json`);
    if (!existsSync(f) || !data.areas[a.id]) { console.log(`${id}/${a.id}: no cached OSM, skipped`); continue; }
    const d = parseOverpass(JSON.parse(readFileSync(f, "utf8")));
    if (existsSync(fb)) d.ways.push(...parseOverpass(JSON.parse(readFileSync(fb, "utf8"))).ways);
    const m = await decodeCityMapV2(data.areas[a.id].map, 0);
    const st = streetLines(d, { lat0: a.at[0], lon0: a.at[1], angle: data.areas[a.id].angle, w: AREA_W, h: AREA_H }, m);
    data.areas[a.id].streets = st;
    console.log(`${id}/${a.id}: ${st.length} named streets`);
  }
  writeFileSync(file, head + JSON.stringify(data) + ";\n");
}
