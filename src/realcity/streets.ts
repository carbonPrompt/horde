// 0.57: OpenStreetMap street names for an area, kept as compact polylines (cells are worked out when a battle
// loads, see places.buildPlaces). Plain math only: the street tool and the browser's live OSM loader both use it.
import type { CityMap } from "../map";
import { toCell, type Frame } from "./geo";
import type { OsmData } from "./osmtypes";

const MAX_NAME = 60;
/** 0.60: an OSM name as the game shows it: trimmed, capped, and no U+2014 (house style; Gemini found one in Paris). */
export function cleanStreetName(n: string): string { return n.replace(/\s*\u2014\s*/g, " - ").trim().slice(0, MAX_NAME); }
/** Named highways as polylines in tenths of a cell: [name, [x, y, x, y, ..., -1, x, y, ...]] (-1 separates ways of
 *  the same name). Only ways that touch the area are kept; places.buildPlaces walks them over the map's road cells. */
export function streetLines(d: OsmData, frame: Frame, m: CityMap): [string, number[]][] {
  const by = new Map<string, number[]>();
  for (const way of d.ways) {
    const name = way.tags.highway ? cleanStreetName(String(way.tags.name ?? "")) : "";
    if (!name || way.geom.length < 2) continue;
    const pts = way.geom.map(p => toCell(frame, p));
    const inside = (q: [number, number]) => q[0] >= -5 && q[1] >= -5 && q[0] < m.w + 5 && q[1] < m.h + 5;
    // keep only the pieces of the way near the area: a point stays when it or a neighbor is inside
    const keep = pts.map((q, i) => inside(q) || (i > 0 && inside(pts[i - 1])) || (i + 1 < pts.length && inside(pts[i + 1])));
    const out = by.get(name) ?? [];
    let open = false;
    pts.forEach(([x, y], i) => {
      if (!keep[i]) { open = false; return; }
      if (!open && out.length) out.push(-1);
      open = true; out.push(Math.round(x * 10), Math.round(y * 10));
    });
    if (out.length) by.set(name, out);
  }
  return [...by].sort((a, b) => a[0] < b[0] ? -1 : 1);
}
