// 0.36 real cities: baked battle areas decoded on demand (async: the v2 codec uses DecompressionStream) and kept
// for the session. The Sim takes a copy, so one battle's damage never leaks into the next.
import type { CityMap } from "../map";
import { decodeCityMapV2 } from "../osm";
import { REAL_DATA } from "./data";

const cache = new Map<string, CityMap>();

export function realAreaMap(key: string): CityMap | undefined { return cache.get(key); }
/** 0.57: an area's OSM street names (only where the bake added them). */
export function realAreaStreets(key: string): [string, number[]][] | undefined { const [city, area] = key.split("/"); return REAL_DATA[city]?.areas[area]?.streets; }

const pending = new Map<string, Promise<CityMap>>();
/** Decode an area once; concurrent callers share the same promise. */
export function loadRealArea(key: string): Promise<CityMap> {
  const hit = cache.get(key); if (hit) return pending.get(key) ?? Promise.resolve(hit);
  const inflight = pending.get(key); if (inflight) return inflight;
  const [city, area] = key.split("/");
  const s = REAL_DATA[city]?.areas[area]?.map;
  const p = !s ? Promise.reject(new Error(`no baked real area ${key}`)) : decodeCityMapV2(s, 0).then(m => { cache.set(key, m); return m; });
  pending.set(key, p);
  p.catch(() => pending.delete(key));
  return p;
}
