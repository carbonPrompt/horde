// 0.45: the minimap, top right of the map. Pure coordinate helpers (tested) plus the drawing.
import type { Sim, Ping, PingKind } from "./sim";
import { INF } from "./sim";
import * as C from "./config";

/** How a w x h map sits inside a W x H minimap: uniform scale, centered (letterboxed). */
export function miniFit(W: number, H: number, w: number, h: number) {
  const scale = Math.min(W / w, H / h);
  return { scale, ox: (W - w * scale) / 2, oy: (H - h * scale) / 2 };
}
export function worldToMini(x: number, y: number, W: number, H: number, w: number, h: number): [number, number] {
  const f = miniFit(W, H, w, h);
  return [f.ox + x * f.scale, f.oy + y * f.scale];
}
/** Minimap pixel to map cell coordinates, clamped to the map (a click in the letterbox lands on the edge). */
export function miniToWorld(mx: number, my: number, W: number, H: number, w: number, h: number): [number, number] {
  const f = miniFit(W, H, w, h);
  return [Math.max(0, Math.min(w, (mx - f.ox) / f.scale)), Math.max(0, Math.min(h, (my - f.oy) / f.scale))];
}

const UNIT_DOT = "#80cbc4", SUPPORT_DOT = "#cbd5e1", PAD_DOT = "#7cfc9a";

/** 0.48: alert rings, StarCraft style. Kinds that matter most draw bigger. */
export const PING_STYLE: Record<PingKind, { color: string; r: number; label: string }> = {
  zone: { color: "#ff1744", r: 14, label: "Someone bitten inside a safe zone" },
  breach: { color: "#ff1744", r: 14, label: "A wall is down" },
  unit: { color: "#ff5252", r: 11, label: "A unit is under attack" },
  abort: { color: "#ffab40", r: 11, label: "An evac lift waved off" },
  wall: { color: "#ff6e40", r: 9, label: "Infected clawing at a wall or gate" },
  bite: { color: "#ff5252", r: 7, label: "People bitten in the city" },
  ammo: { color: "#ffd740", r: 10, label: "A unit is out of ammo" }, // 0.60
};
/** Which ring F jumps to: the newest of the most urgent kind still showing. */
export function pickPing(pings: Ping[], now: number, life: number): Ping | null {
  const rank: Record<PingKind, number> = { zone: 5, breach: 5, unit: 4, abort: 4, ammo: 4, wall: 3, bite: 1 };
  let best: Ping | null = null;
  for (const p of pings) if (now - p.t < life && (!best || rank[p.kind] > rank[best.kind] || (rank[p.kind] === rank[best.kind] && p.t > best.t))) best = p;
  return best;
}
/** Pulsing rings for live alerts on the overlay canvas (drawn every frame; the minimap itself redraws 4x a second). */
export function drawPings(ctx: CanvasRenderingContext2D, pings: Ping[], now: number, life: number, w: number, h: number, dpr: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height, f = miniFit(W, H, w, h);
  ctx.clearRect(0, 0, W, H);
  for (const p of pings) {
    const age = now - p.t;
    if (age < 0 || age >= life) continue;
    const st = PING_STYLE[p.kind], x = f.ox + p.x * f.scale, y = f.oy + p.y * f.scale;
    const fade = 1 - age / life;
    for (const off of [0, 0.5]) { // two rings a half pulse apart
      const ph = ((age + off) % 1);
      ctx.globalAlpha = fade * (1 - ph);
      ctx.strokeStyle = st.color; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, (2 + ph * st.r) * dpr, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = fade; ctx.fillStyle = st.color; ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
  }
  ctx.globalAlpha = 1;
}

/** Terrain (the map's base image), the zone, infected density, units, evac pads and the camera's view.
 *  view: the main canvas size in px; cam: its offset and scale (px per cell). */
export function drawMinimap(ctx: CanvasRenderingContext2D, sim: Sim, baseImg: CanvasImageSource, zoneImg: CanvasImageSource | null,
  cam: { x: number; y: number; scale: number }, view: { w: number; h: number }) {
  const W = ctx.canvas.width, H = ctx.canvas.height, f = miniFit(W, H, sim.w, sim.h);
  ctx.fillStyle = "#0b0f16"; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseImg, f.ox, f.oy, sim.w * f.scale, sim.h * f.scale);
  if (zoneImg) { ctx.globalAlpha = 0.85; ctx.drawImage(zoneImg, f.ox, f.oy, sim.w * f.scale, sim.h * f.scale); ctx.globalAlpha = 1; }
  // infected: count per minimap pixel, drawn red, brighter where thicker
  const mw = Math.max(1, Math.floor(sim.w * f.scale)), mh = Math.max(1, Math.floor(sim.h * f.scale));
  const cnt = new Uint16Array(mw * mh);
  for (let k = sim.civN; k < sim.n; k++) {
    if (sim.state[k] !== INF) continue;
    const px = Math.min(mw - 1, (sim.ax[k] * f.scale) | 0), py = Math.min(mh - 1, (sim.ay[k] * f.scale) | 0);
    if (px >= 0 && py >= 0 && cnt[py * mw + px] < 65535) cnt[py * mw + px]++;
  }
  const img = ctx.getImageData(Math.round(f.ox), Math.round(f.oy), mw, mh);
  for (let i = 0; i < cnt.length; i++) if (cnt[i]) {
    const a = Math.min(1, 0.45 + cnt[i] / 12);
    img.data[i * 4] = img.data[i * 4] * (1 - a) + 255 * a; img.data[i * 4 + 1] *= 1 - a; img.data[i * 4 + 2] *= 1 - a;
  }
  ctx.putImageData(img, Math.round(f.ox), Math.round(f.oy));
  const dot = (x: number, y: number, c: string, r: number) => { ctx.fillStyle = c; ctx.fillRect(f.ox + x * f.scale - r, f.oy + y * f.scale - r, r * 2, r * 2); };
  for (const b of sim.supports) dot(b.x + 0.5, b.y + 0.5, b.kind === "evac" ? PAD_DOT : SUPPORT_DOT, b.kind === "evac" ? 2.5 : 1.5);
  for (const u of sim.units) dot(u.x + 0.5, u.y + 0.5, C.UNITS[u.kind].mobile ? UNIT_DOT : SUPPORT_DOT, C.UNITS[u.kind].mobile ? 2 : 1.2);
  // the camera's view
  const x0 = -cam.x / cam.scale, y0 = -cam.y / cam.scale, x1 = (view.w - cam.x) / cam.scale, y1 = (view.h - cam.y) / cam.scale;
  ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 1;
  ctx.strokeRect(f.ox + x0 * f.scale + 0.5, f.oy + y0 * f.scale + 0.5, (x1 - x0) * f.scale, (y1 - y0) * f.scale);
}
