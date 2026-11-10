import { MAP_H, MAP_W } from "./config";

export const ROAD = 0, BUILDING = 1, PARK = 2, WATER = 3, BRIDGE = 4;
// Road / Bridge infrastructure subtypes stored in height[i] when tile[i] is ROAD or BRIDGE:
export const INFRA_NONE = 0, INFRA_HIGHWAY = 1, INFRA_RAIL = 2, INFRA_STATION = 3;

export interface CityMap {
  w: number;
  h: number;
  seed: number;
  tile: Uint8Array; // ROAD/BUILDING/PARK/WATER/BRIDGE
  height: Uint8Array; // building height in levels (1..14) when BUILDING; INFRA_* subtype (0..3) when ROAD/BRIDGE
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function walkable(t: number) {
  return t === ROAD || t === PARK || t === BRIDGE;
}

/** A made-up city: a street grid, individual building footprints, parks, a river with bridges, an Interstate highway, and a Mass Transit rail line with stations. */
export function generateCity(seed: number, w = MAP_W, h = MAP_H): CityMap {
  const r = rng(seed);
  const tile = new Uint8Array(w * h).fill(BUILDING);
  const height = new Uint8Array(w * h);

  // Street lines.
  const xs: number[] = [];
  for (let x = 2 + Math.floor(r() * 6); x < w - 3; x += 16 + Math.floor(r() * 14)) xs.push(x);
  const ys: number[] = [];
  for (let y = 2 + Math.floor(r() * 6); y < h - 3; y += 14 + Math.floor(r() * 12)) ys.push(y);
  const roadW = (i: number) => (i % 3 === 0 ? 4 : 3); // every third street is an avenue
  xs.forEach((x0, i) => {
    for (let x = x0; x < Math.min(w, x0 + roadW(i)); x++) for (let y = 0; y < h; y++) tile[y * w + x] = ROAD;
  });
  ys.forEach((y0, i) => {
    for (let y = y0; y < Math.min(h, y0 + roadW(i)); y++) for (let x = 0; x < w; x++) tile[y * w + x] = ROAD;
  });
  // Outer ring road so the edge is never a dead end.
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) tile[y * w + x] = ROAD;
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) tile[y * w + x] = ROAD;

  // Blocks: label connected BUILDING areas, subdivide large blocks into distinct building footprints with courtyards/alleys, and turn ~10% into parks.
  const block = new Int32Array(w * h).fill(-1);
  let nBlocks = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (tile[i] !== BUILDING || block[i] !== -1) continue;
    const id = nBlocks++;
    const isPark = r() < 0.1;
    const base = 1 + Math.floor(r() * r() * 10); // most blocks low, a few tall
    block[i] = id;
    stack.push(i);
    const cells: number[] = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % w, cy = (c / w) | 0;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (isPark) tile[c] = PARK;
      else height[c] = Math.max(1, Math.min(14, base + Math.floor((r() - 0.5) * 3)));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (tile[n] === BUILDING && block[n] === -1) { block[n] = id; stack.push(n); }
      }
    }
    // Carve internal alleys and courtyards inside larger building blocks so individual buildings stand out.
    if (!isPark && maxX - minX >= 9 && maxY - minY >= 8) {
      const splitX = minX + Math.floor((maxX - minX) * (0.4 + r() * 0.2));
      const splitY = minY + Math.floor((maxY - minY) * (0.4 + r() * 0.2));
      const hasCourtyard = r() < 0.55;
      const h1 = Math.max(1, Math.min(14, base + Math.floor((r() - 0.4) * 4)));
      const h2 = Math.max(1, Math.min(14, base + Math.floor((r() - 0.4) * 4)));
      const h3 = Math.max(1, Math.min(14, base + Math.floor((r() - 0.4) * 4)));
      const h4 = Math.max(1, Math.min(14, base + Math.floor((r() - 0.4) * 4)));
      for (const c of cells) {
        const cx = c % w, cy = (c / w) | 0;
        if (cx === splitX || cy === splitY) {
          tile[c] = ROAD; height[c] = 0;
        } else if (hasCourtyard && Math.abs(cx - splitX) <= 2 && Math.abs(cy - splitY) <= 2) {
          tile[c] = PARK; height[c] = 0;
        } else {
          height[c] = cx < splitX ? (cy < splitY ? h1 : h2) : (cy < splitY ? h3 : h4);
        }
      }
    }
  }

  // Interstate Highway corridor (east-west multi-lane divided expressway in southern sector + north-south highway artery).
  const hwyY = ys.find(y => y >= Math.floor(h * 0.72) && y <= Math.floor(h * 0.86)) ?? Math.floor(h * 0.78);
  for (let y = Math.max(2, hwyY - 2); y <= Math.min(h - 3, hwyY + 3); y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tile[i] = ROAD;
      height[i] = INFRA_HIGHWAY;
    }
  }
  const hwyX = xs.find(x => x >= Math.floor(w * 0.14) && x <= Math.floor(w * 0.26)) ?? xs[1] ?? Math.floor(w * 0.2);
  for (let x = Math.max(2, hwyX - 1); x <= Math.min(w - 3, hwyX + 3); x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      tile[i] = ROAD;
      height[i] = INFRA_HIGHWAY;
    }
  }

  // Mass Transit Rail Line & Transit Stations (east-west commuter/metro corridor in northern sector).
  const railY = ys.find(y => y >= Math.floor(h * 0.20) && y <= Math.floor(h * 0.34)) ?? Math.floor(h * 0.28);
  for (let x = 0; x < w; x++) {
    for (let dy = 0; dy < 2; dy++) {
      const y = Math.min(h - 3, railY + dy);
      const i = y * w + x;
      tile[i] = ROAD;
      height[i] = INFRA_RAIL;
    }
  }
  for (const stFrac of [0.22, 0.50, 0.78]) {
    const sx = Math.floor(w * stFrac);
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = sx + dx, y = railY + dy;
        if (x >= 2 && x < w - 2 && y >= 2 && y < h - 2) {
          const i = y * w + x;
          tile[i] = ROAD;
          height[i] = dy === 0 || dy === 1 ? INFRA_RAIL : INFRA_STATION;
        }
      }
    }
  }

  // River: a meandering band across the map, crossed only at a few bridges (including the Interstate bridge).
  const mid = h * (0.45 + r() * 0.15);
  const amp = 10 + r() * 14, freq = (1.5 + r() * 1.5) * Math.PI * 2 / w, ph = r() * 6.28;
  const half = 7;
  const bridgeXs = new Set<number>([hwyX]);
  const crossing = xs.filter((_, i) => i % 2 === 0);
  // pick 3 bridges spread across the map
  for (const k of [0.15, 0.5, 0.85]) {
    let best = crossing[0], bd = 1e9;
    for (const x of crossing) { const d = Math.abs(x - k * w); if (d < bd) { bd = d; best = x; } }
    bridgeXs.add(best);
  }
  const bridgeCols = new Set<number>();
  xs.forEach((x0, i) => {
    if (!bridgeXs.has(x0)) return;
    for (let x = x0; x < x0 + roadW(i); x++) bridgeCols.add(x);
  });
  for (let x = Math.max(2, hwyX - 1); x <= Math.min(w - 3, hwyX + 3); x++) bridgeCols.add(x);
  for (let x = 0; x < w; x++) {
    const cy = mid + amp * Math.sin(x * freq + ph);
    for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++) {
      if (y < 0 || y >= h) continue;
      const i = y * w + x;
      if (bridgeCols.has(x) && tile[i] === ROAD) {
        const sub = height[i];
        tile[i] = BRIDGE;
        height[i] = sub;
        continue;
      }
      tile[i] = WATER;
      height[i] = 0;
    }
  }
  return { w, h, seed, tile, height };
}

/** Extract continuous Mass Transit rail polylines from a CityMap so commuter/evacuation trains can traverse them. */
export function extractRailLines(map: CityMap): [number, number][][] {
  const { w, h, tile, height } = map;
  const lines: [number, number][][] = [];
  // Scan horizontal-dominant and vertical-dominant rail corridors
  const visited = new Uint8Array(w * h);
  const isRail = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return (tile[i] === ROAD || tile[i] === BRIDGE) && (height[i] === INFRA_RAIL || height[i] === INFRA_STATION);
  };
  // Trace rail paths starting near map edges
  for (let y = 2; y < h - 2; y++) {
    for (const startX of [1, 2, 3]) {
      if (isRail(startX, y) && !visited[y * w + startX]) {
        const pts: [number, number][] = [];
        let cx = startX, cy = y;
        while (cx < w - 1) {
          pts.push([cx + 0.5, cy + 0.5]);
          for (let dy = -3; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) visited[ny * w + nx] = 1;
          }
          let found = false;
          for (const stepX of [4, 3, 2, 1]) {
            for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
              if (isRail(cx + stepX, cy + dy)) {
                cx += stepX; cy += dy; found = true; break;
              }
            }
            if (found) break;
          }
          if (!found) break;
        }
        if (pts.length >= 20) lines.push(pts);
      }
    }
  }
  for (let x = 2; x < w - 2; x++) {
    for (const startY of [1, 2, 3]) {
      if (isRail(x, startY) && !visited[startY * w + x]) {
        const pts: [number, number][] = [];
        let cx = x, cy = startY;
        while (cy < h - 1) {
          pts.push([cx + 0.5, cy + 0.5]);
          for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) visited[ny * w + nx] = 1;
          }
          let found = false;
          for (const stepY of [4, 3, 2, 1]) {
            for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
              if (isRail(cx + dx, cy + stepY)) {
                cx += dx; cy += stepY; found = true; break;
              }
            }
            if (found) break;
          }
          if (!found) break;
        }
        if (pts.length >= 20) lines.push(pts);
      }
    }
  }
  return lines;
}
