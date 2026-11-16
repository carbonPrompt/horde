// A 1 km square of street grid turned 29 degrees east of north (like Manhattan), as OsmData:
// residential streets 80 m apart, every 4th one primary, a "Broadway" running due north-northwest across the grid,
// a 12-degree avenue, a 40-degree street, a 60 m river across the middle with one bridge, and a short tunnel.
import type { OsmData, OsmWay } from "../src/realcity/osmtypes";
import type { LatLon } from "../src/realcity/geo";

export const LAT0 = 40.75, LON0 = -73.98, GRID_DEG = 29;
const mLat = 111195, mLon = 111195 * Math.cos(LAT0 * Math.PI / 180);
/** u across the grid, v along it, in meters from the centre. */
export function gpt(u: number, v: number, deg = GRID_DEG): LatLon {
  const a = deg * Math.PI / 180, e = u * Math.cos(a) + v * Math.sin(a), n = -u * Math.sin(a) + v * Math.cos(a);
  return [LAT0 + n / mLat, LON0 + e / mLon];
}
const line = (a: LatLon, b: LatLon, n = 8): LatLon[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] as LatLon);

export function osmFixture(): OsmData {
  const ways: OsmWay[] = []; let id = 1;
  const road = (tags: Record<string, string>, geom: LatLon[]) => ways.push({ id: id++, tags, geom });
  for (let k = -560; k <= 560; k += 80) {
    const cls = k % 320 === 0 ? "primary" : "residential";
    road({ highway: cls, name: `Street ${k}` }, line(gpt(k, -700), gpt(k, -40))); // stops at the river (v -30..30)
    road({ highway: cls, name: `Street ${k}` }, line(gpt(k, 40), gpt(k, 700)));
    if (k !== 0) road({ highway: cls, name: `Avenue ${k}` }, line(gpt(-700, k), gpt(700, k))); // none along the river
  }
  road({ highway: "primary", bridge: "yes", name: "River Bridge" }, line(gpt(0, -40), gpt(0, 40), 2));
  road({ highway: "secondary", name: "Broadway" }, line(gpt(-300, -650), gpt(250, 650), 20)); // about 23 degrees off the grid
  road({ highway: "tertiary", name: "Slant Avenue" }, [gpt(-500, 120), gpt(-500 + 400 * Math.sin(12 * Math.PI / 180), 120 + 400 * Math.cos(12 * Math.PI / 180))]);
  road({ highway: "residential", name: "Forty Street" }, [gpt(280, 280), gpt(280 + 300 * Math.sin(40 * Math.PI / 180), 280 + 300 * Math.cos(40 * Math.PI / 180))]);
  road({ highway: "primary", tunnel: "yes", name: "Tunnel" }, [gpt(-120, -220), gpt(-120, -180)]); // inside a block
  ways.push({ id: id++, tags: { natural: "water", water: "river" }, geom: [gpt(-800, -30), gpt(800, -30), gpt(800, 30), gpt(-800, 30), gpt(-800, -30)] });
  // a park over the block u 160..240, v 160..240; a 40-level tower; footprints in every other block (two per block)
  const poly = (u0: number, v0: number, u1: number, v1: number) => [gpt(u0, v0), gpt(u1, v0), gpt(u1, v1), gpt(u0, v1), gpt(u0, v0)];
  ways.push({ id: id++, tags: { leisure: "park", name: "Fixture Park" }, geom: poly(166, 166, 234, 234) });
  ways.push({ id: id++, tags: { building: "yes", "building:levels": "40", name: "Tower" }, geom: poly(-234, 246, -186, 314) });
  for (let bu = -640; bu < 640; bu += 80) for (let bv = -640; bv < 640; bv += 80) {
    if (Math.abs(bv + 40) < 80 || (bu === 160 && bv === 160) || (bu === -240 && bv === 240)) continue; // river, park, tower blocks
    ways.push({ id: id++, tags: { building: "yes", "building:levels": String(2 + ((bu + bv) / 80 & 3)) }, geom: poly(bu + 8, bv + 8, bu + 38, bv + 72) });
    ways.push({ id: id++, tags: { building: "apartments" }, geom: poly(bu + 42, bv + 8, bu + 72, bv + 72) });
  }
  ways.push({ id: id++, tags: { landuse: "residential" }, geom: poly(-800, -800, 800, 800) });
  return { ways, nodes: [], coast: [] };
}
/** The fixture with every building way removed (thin OSM data). */
export function thinFixture(): OsmData {
  const d = osmFixture();
  return { ...d, ways: d.ways.filter(w => !w.tags.building) };
}
/** Land in the west, sea in the east: a coastline running north-south 200 m east of the centre, one road. */
export function coastFixture(): OsmData {
  const ways: OsmWay[] = [{ id: 1, tags: { highway: "residential" }, geom: [gpt(-600, 0, 0), gpt(150, 0, 0)] }];
  return { ways, nodes: [], coast: [[gpt(200, -900, 0), gpt(200, 900, 0)]] };
}
