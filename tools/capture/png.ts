// PNG writer and map pictures for the capture tool (and tools/citypng.ts).
import { deflateSync } from "node:zlib";
import { BRIDGE, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER, type CityMap } from "../../src/map";
import type { Stand } from "../../src/cities/recipe";
import type { Overview } from "../../src/realcity/overview";

export function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function cellColor(t: number, hv: number): number[] {
  if (t === WATER) return [38, 84, 140];
  if (t === PARK) return [62, 128, 64];
  if (t === BRIDGE) return [150, 120, 80];
  if (t === ROAD) return hv === INFRA_HIGHWAY ? [200, 170, 90] : hv === INFRA_RAIL ? [120, 70, 70] : hv === INFRA_STATION ? [170, 100, 100] : [70, 70, 74];
  const g = Math.min(255, 110 + Math.min(hv, 14) * 10); return hv > 14 ? [g, g - 30, g - 60] : [g, g, g - 10];
}

/** A battle area at `s` px per cell, stand points ringed (yellow ok, red failing). */
export function drawMap(m: CityMap, stands: Stand[] = [], ok: boolean[] = [], s = 2): Buffer {
  const W = m.w * s, H = m.h * s, rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const c = cellColor(m.tile[y * m.w + x], m.height[y * m.w + x]);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) rgb.set(c, ((y * s + dy) * W + x * s + dx) * 3);
  }
  stands.forEach((st, k) => {
    const col = ok[k] === false ? [230, 40, 40] : [255, 220, 40];
    for (let a = 0; a < 720; a++) {
      const px = Math.round((st.x + Math.cos(a / 114.6) * st.r) * s), py = Math.round((st.y + Math.sin(a / 114.6) * st.r) * s);
      for (let d = 0; d < 2; d++) if (px + d >= 0 && py >= 0 && px + d < W && py < H) rgb.set(col, (py * W + px + d) * 3);
    }
  });
  return png(W, H, rgb);
}

const OV_COL = [[16, 18, 22], [92, 92, 84], [140, 136, 126], [62, 128, 64], [38, 84, 140], [210, 180, 90], [150, 80, 80]];
/** The whole-city overview with each area's turned box outlined. */
export function drawOverview(o: Overview, quads: [number, number][][]): Buffer {
  const rgb = new Uint8Array(o.w * o.h * 3);
  for (let i = 0; i < o.px.length; i++) rgb.set(OV_COL[o.px[i]] ?? [255, 0, 255], i * 3);
  for (const q of quads) for (let k = 0; k < 4; k++) {
    const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4], n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let t = 0; t <= n; t++) { const x = Math.round(ax + (bx - ax) * t / n), y = Math.round(ay + (by - ay) * t / n); if (x >= 0 && y >= 0 && x < o.w && y < o.h) rgb.set([255, 220, 40], (y * o.w + x) * 3); }
  }
  return png(o.w, o.h, rgb);
}
