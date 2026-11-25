// 0.36 real cities: OpenStreetMap data as the rasterizer sees it, and the baked per-city data shape.
import type { LatLon } from "./geo";
import type { Stand } from "../cities/recipe";

export interface OsmWay { id: number; tags: Record<string, string>; geom: LatLon[] }
export interface OsmNode { id: number; tags: Record<string, string>; at: LatLon }
export interface OsmData { ways: OsmWay[]; nodes: OsmNode[]; coast: LatLon[][] }
/** What the bake writes per city (src/realcity/data/<id>.ts). Maps are v2 strings (osm.ts encodeCityMapV2). */
export interface CityData { overview: string; areas: Record<string, { map: string; angle: number; stands: Stand[]; streets?: [string, number[]][] }> } // 0.57 streets: OSM street names, cells as [start, len, ...] runs (tools/capture/streets.ts)

/** Overpass JSON (`out body geom`) to OsmData. Coastline ways go to `coast` only; relations' outer ways become ways
 *  carrying the relation's tags (multipolygon water and parks). */
export const MAX_REL_MEMBERS = 300, MAX_REL_POINTS = 60_000;
/** `bounded`: untrusted live data; huge multipolygons are skipped (the offline bake keeps them: rivers like the East River are big). */
export function parseOverpass(json: any, bounded = false): OsmData {
  const ways: OsmWay[] = [], nodes: OsmNode[] = [], coast: LatLon[][] = [];
  for (const e of json?.elements ?? []) {
    if (e.type === "node" && e.tags) nodes.push({ id: e.id, tags: e.tags, at: [e.lat, e.lon] });
    else if (e.type === "way" && Array.isArray(e.geometry)) {
      const geom = e.geometry.map((g: any) => [g.lat, g.lon] as LatLon);
      if (e.tags?.natural === "coastline") coast.push(geom);
      else if (e.tags) ways.push({ id: e.id, tags: e.tags, geom });
    } else if (e.type === "relation" && e.tags && Array.isArray(e.members)) {
      const outer = e.members.filter((m: any) => m.type === "way" && m.role !== "inner" && Array.isArray(m.geometry))
        .map((m: any) => m.geometry.map((g: any) => [g.lat, g.lon] as LatLon));
      // a huge multipolygon (a whole river or lake system) costs quadratic joining for nothing: skip it
      if (bounded && (outer.length > MAX_REL_MEMBERS || outer.reduce((n: number, g: LatLon[]) => n + g.length, 0) > MAX_REL_POINTS)) continue;
      joinRings(outer).forEach((g, k) => ways.push({ id: e.id * 1000 + k, tags: { ...e.tags, _rel: "1" }, geom: g }));
      if (e.tags.natural === "water" || e.tags.waterway === "riverbank" || e.tags.water) {
        const inner = e.members.filter((m: any) => m.type === "way" && m.role === "inner" && Array.isArray(m.geometry))
          .map((m: any) => m.geometry.map((g: any) => [g.lat, g.lon] as LatLon));
        joinRings(inner).forEach((g, k) => ways.push({ id: e.id * 1000 + 500 + k, tags: { ...e.tags, _rel: "1", _inner: "1" }, geom: g }));
      }
    }
  }
  return { ways, nodes, coast };
}

const same = (a: LatLon, b: LatLon) => a[0] === b[0] && a[1] === b[1];
/** Multipolygon outer members come as pieces; join pieces that share end points into rings (open leftovers too). */
export function joinRings(parts: LatLon[][]): LatLon[][] {
  const left = parts.map(p => p.slice()), out: LatLon[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    for (let grew = true; grew && !same(ring[0], ring[ring.length - 1]);) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i], end = ring[ring.length - 1];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(ring);
  }
  return out;
}
