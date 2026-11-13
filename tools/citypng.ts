// Draws a campaign city to a PNG to look at, with its stand points ringed and the checker's verdict printed.
//   bun tools/citypng.ts <id|all> [outDir]     (default outDir: ./citypng)
import { buildCity } from "../src/cities/build";
import { checkCity } from "../src/cities/check";
import { CAMPAIGN_RECIPES } from "../src/cities/campaign";
import { BRIDGE, BUILDING, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER } from "../src/map";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + i] = v; }); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const ids = process.argv[2] === "all" || !process.argv[2] ? Object.keys(CAMPAIGN_RECIPES) : [process.argv[2]];
const out = process.argv[3] ?? "citypng";
mkdirSync(out, { recursive: true });
const S = 2; // pixels per cell
for (const id of ids) {
  const r = CAMPAIGN_RECIPES[id], m = buildCity(r), rep = checkCity(m, r);
  const W = m.w * S, H = m.h * S, rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x, t = m.tile[i], hv = m.height[i];
    let c: number[];
    if (t === WATER) c = [38, 84, 140];
    else if (t === PARK) c = [62, 128, 64];
    else if (t === BRIDGE) c = [150, 120, 80];
    else if (t === ROAD) c = hv === INFRA_HIGHWAY ? [200, 170, 90] : hv === INFRA_RAIL ? [120, 70, 70] : hv === INFRA_STATION ? [170, 100, 100] : [70, 70, 74];
    else { const g = Math.min(255, 110 + hv * 10); c = [g, g, g - 10]; }
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const p = ((y * S + dy) * W + x * S + dx) * 3; rgb[p] = c[0]; rgb[p + 1] = c[1]; rgb[p + 2] = c[2]; }
  }
  for (const [k, st] of r.stands.entries()) { // ring: yellow = ok, red = fails
    const ok = rep.stands[k].ok, col = ok ? [255, 220, 40] : [230, 40, 40];
    for (let a = 0; a < 720; a++) {
      const px = Math.round((st.x + Math.cos(a / 114.6) * st.r) * S), py = Math.round((st.y + Math.sin(a / 114.6) * st.r) * S);
      for (let d = 0; d < 2; d++) if (px + d >= 0 && py >= 0 && px + d < W && py < H) { const p = (py * W + px + d) * 3; rgb[p] = col[0]; rgb[p + 1] = col[1]; rgb[p + 2] = col[2]; }
    }
  }
  writeFileSync(`${out}/${id}.png`, png(W, H, rgb));
  console.log(`${id} ${m.w}x${m.h}: water ${(rep.waterFrac * 100).toFixed(1)}%, diag ${rep.diagonalRuns}, land ${rep.landComponents}, entries ${rep.entries} on ${rep.entryEdges} edges; ` +
    rep.stands.map(s => `${s.name}: ${s.ok ? "ok" : "FAIL " + s.why.join("/")} (open ${s.open}, roofs ${s.roofs})`).join("; "));
}
