import { BRIDGE, BUILDING, CityMap, INFRA_HIGHWAY, INFRA_NONE, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER, rng } from "./map";
import { REAL_MAP_H, REAL_MAP_W } from "./config";

export interface OsmBbox { s: number; w: number; n: number; e: number }

/** Run-length encode a CityMap (tile in low 3 bits, height/infra in high 5 bits) to base64. */
export function encodeCityMap(m: CityMap): string {
  const n = m.w * m.h;
  const out: number[] = [];
  let prev = (m.tile[0] & 7) | ((m.height[0] & 15) << 3);
  let run = 1;
  for (let i = 1; i < n; i++) {
    const v = (m.tile[i] & 7) | ((m.height[i] & 15) << 3);
    if (v === prev && run < 255) run++;
    else { out.push(run, prev); prev = v; run = 1; }
  }
  out.push(run, prev);
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(out).toString("base64");
}

/** Decode an RLE base64 string into a CityMap synchronously (< 0.5 ms). */
export function decodeCityMap(b64: string, seed: number, w = REAL_MAP_W, h = REAL_MAP_H): CityMap {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const tile = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  let k = 0;
  for (let i = 0; i + 1 < bin.length && k < w * h; i += 2) {
    const run = bin.charCodeAt(i), v = bin.charCodeAt(i + 1);
    const t = v & 7, lv = (v >> 3) & 15;
    for (let j = 0; j < run && k < w * h; j++, k++) {
      tile[k] = t;
      height[k] = lv;
    }
  }
  return { w, h, seed, tile, height };
}

/** Convert an Overpass JSON response into a playable 560x420 Horde CityMap with real buildings, highways, and mass transit. */
export function rasterizeOsm(elements: any[], bbox: OsmBbox, seed: number, w = REAL_MAP_W, h = REAL_MAP_H): CityMap {
  const r = rng(seed);
  const tile = new Uint8Array(w * h).fill(BUILDING);
  const height = new Uint8Array(w * h);

  // Initialize urban fabric with segmented individual building footprints separated by courtyard lanes and alleys
  for (let by = 0; by < h; by += 12) {
    for (let bx = 0; bx < w; bx += 16) {
      const lv = 1 + Math.floor(r() * r() * 7);
      const alleyX = bx + 7 + Math.floor(r() * 3);
      const alleyY = by + 5 + Math.floor(r() * 3);
      const court = r() < 0.35;
      for (let y = by; y < Math.min(h, by + 12); y++) {
        for (let x = bx; x < Math.min(w, bx + 16); x++) {
          const i = y * w + x;
          if (x === alleyX && y % 3 !== 0) {
            tile[i] = ROAD; height[i] = INFRA_NONE;
          } else if (court && Math.abs(x - alleyX) <= 1 && Math.abs(y - alleyY) <= 1) {
            tile[i] = PARK; height[i] = 0;
          } else {
            height[i] = Math.max(1, Math.min(14, lv + ((x < alleyX ? 1 : 0) ^ (y < alleyY ? 1 : 0))));
          }
        }
      }
    }
  }

  const toXY = (lat: number, lon: number): [number, number] => [
    ((lon - bbox.w) / (bbox.e - bbox.w)) * w,
    ((bbox.n - lat) / (bbox.n - bbox.s)) * h,
  ];

  const drawSegment = (x0: number, y0: number, x1: number, y1: number, rad: number, fn: (x: number, y: number, i: number) => void) => {
    const dx = x1 - x0, dy = y1 - y0, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
    const r0 = Math.floor(-rad), r1 = Math.ceil(rad), r2 = rad * rad + 0.25;
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(x0 + (dx * s) / steps), cy = Math.round(y0 + (dy * s) / steps);
      for (let oy = r0; oy <= r1; oy++) for (let ox = r0; ox <= r1; ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const x = cx + ox, y = cy + oy;
        if (x >= 0 && y >= 0 && x < w && y < h) fn(x, y, y * w + x);
      }
    }
  };

  const fillPoly = (pts: [number, number][], fn: (x: number, y: number, i: number) => void) => {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, py1] = pts[i], [x2, py2] = pts[(i + 1) % pts.length];
        if ((py1 <= cy && py2 > cy) || (py2 <= cy && py1 > cy)) xs.push(x1 + ((cy - py1) / (py2 - py1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xStart = Math.max(0, Math.ceil(xs[k] - 0.5)), xEnd = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xStart; x <= xEnd; x++) fn(x, y, y * w + x);
      }
    }
  };

  // 1. Parks, green spaces, plazas, and open parking lots.
  for (const el of elements) {
    if (!el.geometry || !el.tags) continue;
    const t = el.tags;
    if (t.leisure === "park" || t.landuse === "grass" || t.landuse === "recreation_ground" || t.leisure === "garden" || t.leisure === "pitch" || t.landuse === "meadow") {
      const pts = el.geometry.map((g: any) => toXY(g.lat, g.lon));
      fillPoly(pts, (_x, _y, i) => { tile[i] = PARK; height[i] = 0; });
    } else if (t.amenity === "parking" || t.highway === "pedestrian") {
      const pts = el.geometry.map((g: any) => toXY(g.lat, g.lon));
      fillPoly(pts, (_x, _y, i) => { tile[i] = ROAD; height[i] = INFRA_NONE; });
    }
  }

  // 2. Real OSM building footprints & heights (stamp individual building polygons with a 1-cell courtyard/alley outline so footprints are crisp).
  for (const el of elements) {
    if (!el.geometry || !el.tags || !el.tags.building) continue;
    const t = el.tags;
    let lv = parseInt(t["building:levels"] ?? "", 10);
    if (!Number.isFinite(lv) && t.height) lv = Math.round(parseFloat(t.height) / 3.5);
    if (!Number.isFinite(lv)) {
      const b = t.building;
      lv = b === "skyscraper" || b === "tower" ? 11 + Math.floor(r() * 4)
        : b === "commercial" || b === "office" || b === "hotel" || b === "hospital" || b === "university" ? 5 + Math.floor(r() * 6)
        : b === "apartments" || b === "public" || b === "civic" || b === "train_station" ? 4 + Math.floor(r() * 4)
        : b === "retail" || b === "industrial" || b === "warehouse" || b === "school" ? 2 + Math.floor(r() * 3)
        : 1 + Math.floor(r() * 3);
    }
    lv = Math.max(1, Math.min(14, lv));
    const pts: [number, number][] = el.geometry.map((g: any) => toXY(g.lat, g.lon));
    // Outline setback so adjacent mapped buildings have distinct footprints
    for (let i = 0; i + 1 < pts.length; i++) {
      drawSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.75, (_x, _y, idx) => {
        if (tile[idx] === BUILDING) { tile[idx] = ROAD; height[idx] = INFRA_NONE; }
      });
    }
    fillPoly(pts, (_x, _y, idx) => {
      if (tile[idx] !== WATER && tile[idx] !== PARK) {
        tile[idx] = BUILDING;
        height[idx] = lv;
      }
    });
  }

  // 3. Water polygons and waterways.
  for (const el of elements) {
    if (!el.geometry || !el.tags) continue;
    const t = el.tags;
    const pts: [number, number][] = el.geometry.map((g: any) => toXY(g.lat, g.lon));
    if (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.water) {
      fillPoly(pts, (_x, _y, i) => { tile[i] = WATER; height[i] = 0; });
    } else if (t.waterway === "river" || t.waterway === "canal" || t.waterway === "stream") {
      const rad = t.waterway === "river" ? 6.5 : t.waterway === "canal" ? 4.0 : 2.5;
      for (let i = 0; i + 1 < pts.length; i++) {
        drawSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rad, (_x, _y, idx) => {
          tile[idx] = WATER; height[idx] = 0;
        });
      }
    }
  }

  // 4. Roads, Highways & Interstates (non-bridges first, then bridges/overpasses over water).
  let hasHighway = false;
  for (const pass of [0, 1]) {
    for (const el of elements) {
      if (!el.geometry || !el.tags || !el.tags.highway) continue;
      const t = el.tags;
      const hw = t.highway;
      if (hw === "steps" || hw === "corridor" || hw === "proposed" || hw === "construction") continue;
      const isBridge = t.bridge && t.bridge !== "no";
      if ((pass === 1) !== !!isBridge) continue;
      const isInterstate = hw === "motorway" || hw === "trunk" || hw === "motorway_link" || hw === "trunk_link";
      const isPrimary = hw === "primary" || hw === "primary_link";
      const major = isInterstate || isPrimary || hw === "secondary" || hw === "secondary_link";
      const minor = hw === "footway" || hw === "path" || hw === "cycleway" || hw === "service" || hw === "track";
      const rad = isInterstate ? 2.7 : isPrimary ? 2.1 : major ? 1.7 : minor ? 1.0 : 1.35;
      const infra = isInterstate || isPrimary ? INFRA_HIGHWAY : INFRA_NONE;
      if (infra === INFRA_HIGHWAY) hasHighway = true;
      const pts: [number, number][] = el.geometry.map((g: any) => toXY(g.lat, g.lon));
      for (let i = 0; i + 1 < pts.length; i++) {
        drawSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rad, (_x, _y, idx) => {
          if (tile[idx] === WATER) {
            if (isBridge || major) { tile[idx] = BRIDGE; height[idx] = infra; }
          } else if (tile[idx] !== BRIDGE) {
            tile[idx] = ROAD;
            if (infra === INFRA_HIGHWAY || height[idx] !== INFRA_HIGHWAY) height[idx] = infra;
          }
        });
      }
    }
  }

  // 5. Mass Transit: Railways, Subways, Light Rail, Trams & Transit Stations.
  let hasRail = false;
  const stationPts: [number, number][] = [];
  for (const el of elements) {
    if (!el.tags) continue;
    const t = el.tags;
    if (el.lat !== undefined && el.lon !== undefined && (t.railway === "station" || t.railway === "halt" || t.railway === "tram_stop" || t.public_transport === "station")) {
      stationPts.push(toXY(el.lat, el.lon));
      continue;
    }
    if (!el.geometry) continue;
    const rw = t.railway;
    if (rw === "rail" || rw === "light_rail" || rw === "subway" || rw === "tram" || rw === "monorail" || rw === "narrow_gauge") {
      hasRail = true;
      const pts: [number, number][] = el.geometry.map((g: any) => toXY(g.lat, g.lon));
      for (let i = 0; i + 1 < pts.length; i++) {
        drawSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.25, (_x, _y, idx) => {
          if (tile[idx] === WATER) {
            tile[idx] = BRIDGE; height[idx] = INFRA_RAIL;
          } else if (tile[idx] !== BRIDGE) {
            tile[idx] = ROAD; height[idx] = INFRA_RAIL;
          }
        });
      }
      if (pts.length >= 4) {
        stationPts.push(pts[Math.floor(pts.length * 0.25)], pts[Math.floor(pts.length * 0.75)]);
      }
    } else if (t.railway === "station" || t.public_transport === "station" || t.public_transport === "platform") {
      const pts: [number, number][] = el.geometry.map((g: any) => toXY(g.lat, g.lon));
      if (pts.length) stationPts.push(pts[0]);
    }
  }
  for (const [sx, sy] of stationPts) {
    const cx = Math.round(sx), cy = Math.round(sy);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 2 && x < w - 2 && y >= 2 && y < h - 2) {
        const i = y * w + x;
        if (tile[i] !== WATER && tile[i] !== BRIDGE) {
          tile[i] = ROAD;
          if (height[i] !== INFRA_RAIL) height[i] = INFRA_STATION;
        }
      }
    }
  }

  // 6. Ensure playability: water/bridges, Interstate highway artery, and Mass Transit rail line with stations.
  let waterCnt = 0, bridgeCnt = 0, parkCnt = 0;
  for (let i = 0; i < w * h; i++) {
    if (tile[i] === WATER) waterCnt++;
    else if (tile[i] === BRIDGE) bridgeCnt++;
    else if (tile[i] === PARK) parkCnt++;
  }
  if (waterCnt < 2000) {
    const mid = h * (0.55 + (r() - 0.5) * 0.15);
    const amp = 10 + r() * 14, freq = (1.5 * Math.PI * 2) / w, ph = r() * 6.28;
    for (let x = 0; x < w; x++) {
      const cy = mid + amp * Math.sin(x * freq + ph);
      for (let y = Math.floor(cy - 6); y <= Math.ceil(cy + 6); y++) {
        if (y < 0 || y >= h) continue;
        const i = y * w + x;
        if (tile[i] === ROAD && (Math.abs(x - w * 0.2) < 14 || Math.abs(x - w * 0.5) < 14 || Math.abs(x - w * 0.8) < 14)) {
          const sub = height[i];
          tile[i] = BRIDGE; height[i] = sub; bridgeCnt++;
        } else if (tile[i] !== BRIDGE) {
          tile[i] = WATER; height[i] = 0;
        }
      }
    }
  } else if (bridgeCnt < 40) {
    for (const frac of [0.22, 0.5, 0.78]) {
      const x0 = Math.floor(w * frac);
      for (let x = x0; x < x0 + 4; x++) for (let y = 2; y < h - 2; y++) {
        const i = y * w + x;
        if (tile[i] === WATER) { tile[i] = BRIDGE; height[i] = frac === 0.5 ? INFRA_HIGHWAY : INFRA_NONE; }
        else if (tile[i] === BUILDING) { tile[i] = ROAD; height[i] = frac === 0.5 ? INFRA_HIGHWAY : INFRA_NONE; }
      }
    }
  }

  // Ensure every real map has a continuous Interstate Highway corridor and Mass Transit Rail corridor with stations.
  if (!hasHighway) {
    const hwyY = Math.floor(h * (0.76 + (r() - 0.5) * 0.08));
    for (let y = hwyY - 2; y <= hwyY + 2; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tile[i] = tile[i] === WATER || tile[i] === BRIDGE ? BRIDGE : ROAD;
      height[i] = INFRA_HIGHWAY;
    }
  }
  if (!hasRail) {
    const railY = Math.floor(h * (0.26 + (r() - 0.5) * 0.06));
    for (let x = 0; x < w; x++) {
      for (let dy = 0; dy < 2; dy++) {
        const y = railY + dy, i = y * w + x;
        tile[i] = tile[i] === WATER || tile[i] === BRIDGE ? BRIDGE : ROAD;
        height[i] = INFRA_RAIL;
      }
    }
    for (const stFrac of [0.22, 0.50, 0.78]) {
      const sx = Math.floor(w * stFrac);
      for (let dy = -1; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
        const i = (railY + dy) * w + (sx + dx);
        if (tile[i] !== WATER && tile[i] !== BRIDGE) {
          tile[i] = ROAD;
          height[i] = dy === 0 || dy === 1 ? INFRA_RAIL : INFRA_STATION;
        }
      }
    }
  }

  if (parkCnt < 800) {
    for (let p = 0; p < 8; p++) {
      const px = 30 + Math.floor(r() * (w - 60)), py = 30 + Math.floor(r() * (h - 60));
      for (let dy = -7; dy <= 7; dy++) for (let dx = -10; dx <= 10; dx++) {
        const i = (py + dy) * w + (px + dx);
        if (tile[i] === BUILDING) { tile[i] = PARK; height[i] = 0; }
      }
    }
  }
  // Ensure outer border is walkable so edge horde waves can always enter.
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) {
    const i = y * w + x;
    if (tile[i] === BUILDING) { tile[i] = ROAD; height[i] = 0; }
  }
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) {
    const i = y * w + x;
    if (tile[i] === BUILDING) { tile[i] = ROAD; height[i] = 0; }
  }
  // Connect any large building blocks > 36 cells wide with cross-streets so agents never get trapped.
  for (let y = 24; y < h - 24; y += 34) {
    let run = 0;
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (tile[i] === BUILDING) run++; else run = 0;
      if (run > 30) {
        for (let yy = 2; yy < h - 2; yy++) {
          const ii = yy * w + x;
          if (tile[ii] === BUILDING) { tile[ii] = ROAD; height[ii] = 0; tile[ii + 1] = ROAD; height[ii + 1] = 0; }
        }
        run = 0;
      }
    }
  }
  return { w, h, seed, tile, height };
}

/** Live geocoding + Overpass fetch for any real place name (when online in browser/Electron). */
export async function fetchLiveOsmCity(query: string, seed = 777): Promise<{ name: string; map: CityMap }> {
  const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const gRes = await fetch(geoUrl, { headers: { Accept: "application/json" } });
  if (!gRes.ok) throw new Error("Could not look up that place on OpenStreetMap.");
  const places = await gRes.json();
  if (!places || !places.length) throw new Error(`No place found for "${query}".`);
  const lat = parseFloat(places[0].lat), lon = parseFloat(places[0].lon);
  const name = String(places[0].display_name ?? query).split(",").slice(0, 2).join(",");
  // Wide metropolitan bounding box (~2.0 km x 2.3 km) mapped onto 560x420 cells
  const spanLat = 0.018, spanLon = 0.026;
  const bbox: OsmBbox = {
    s: +(lat - spanLat / 2).toFixed(5),
    n: +(lat + spanLat / 2).toFixed(5),
    w: +(lon - spanLon / 2).toFixed(5),
    e: +(lon + spanLon / 2).toFixed(5),
  };
  const bstr = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const q = `[out:json][timeout:18];(way["highway"](${bstr});way["railway"](${bstr});node["railway"="station"](${bstr});way["public_transport"](${bstr});way["waterway"](${bstr});way["natural"="water"](${bstr});way["leisure"="park"](${bstr});way["landuse"="grass"](${bstr});way["building"](${bstr}););out body geom;`;
  const oRes = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(q),
    signal: AbortSignal.timeout(18000),
  });
  if (!oRes.ok) throw new Error("OpenStreetMap Overpass server is busy; try a built-in real city.");
  const data = await oRes.json();
  return { name, map: rasterizeOsm(data.elements ?? [], bbox, seed, REAL_MAP_W, REAL_MAP_H) };
}
