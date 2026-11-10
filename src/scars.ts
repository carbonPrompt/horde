// 0.23: battle damage painted into the ground, under the crowd. A transparent layer at a few pixels
// per cell holds craters (each hit its own; they stack) and the debris of collapsed buildings. Smoke plumes rise from
// fresh impacts and collapses; smoke is the one thing drawn above the crowd (it is in the air).
// The crater look is kept in paintCrater() alone, so it can be swapped for a more realistic one later.
import * as C from "./config";
import { PARK } from "./map";
import type { Sim } from "./sim";

/** Small deterministic RNG so the same crater always paints the same way. */
function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export interface Plume { x: number; y: number; r: number; t: number; dust: boolean }

export class Scars {
  canvas = document.createElement("canvas");
  px = 4; // pixels per cell
  dirty = false;
  plumes: Plume[] = [];
  private g: CanvasRenderingContext2D;
  private sim: Sim | null = null;
  private seq = 0;
  private painted = new Uint8Array(0);
  private wind: [number, number] = [1, 0];

  constructor() { this.g = this.canvas.getContext("2d")!; }

  /** Start over for a new battle / map. */
  private reset(sim: Sim) {
    this.sim = sim;
    this.px = Math.max(1, Math.min(C.SCAR_PX, Math.floor(4096 / Math.max(sim.w, sim.h))));
    this.canvas.width = sim.w * this.px; this.canvas.height = sim.h * this.px;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.seq = 0; this.painted = new Uint8Array(sim.w * sim.h); this.plumes = [];
    const a = rng(sim.w * 7919 + sim.h)() * Math.PI * 2;
    this.wind = [Math.cos(a), Math.sin(a)];
    this.dirty = true;
  }

  /** Paint anything new since the last call. Cheap when nothing happened. */
  update(sim: Sim) {
    if (sim !== this.sim) this.reset(sim);
    // collapsed buildings first, so a crater from the same blast sits on top of its rubble
    if (sim.buildingsCollapsed !== this.collapsedSeen) {
      this.collapsedSeen = sim.buildingsCollapsed;
      const n = sim.w * sim.h;
      let dust = 0;
      for (let i = 0; i < n; i++) if (sim.rubble[i] && !this.painted[i]) {
        this.painted[i] = 1; this.paintRubble(i % sim.w, (i / sim.w) | 0);
        if ((dust++ & 3) === 0) this.addPlume((i % sim.w) + 0.5, ((i / sim.w) | 0) + 0.5, 1.6, sim.time, true);
      }
      this.dirty = true;
    }
    if (sim.craterSeq !== this.seq) {
      for (const c of sim.craters) if (c.seq > this.seq) {
        this.paintCrater(c.x, c.y, c.r, c.seq, sim.map.tile[sim.idx(Math.min(sim.w - 1, Math.max(0, c.x | 0)), Math.min(sim.h - 1, Math.max(0, c.y | 0)))] === PARK);
        if (sim.time - c.t < 2) this.addPlume(c.x, c.y, c.r, c.t, false);
      }
      this.seq = sim.craterSeq;
      this.dirty = true;
    }
    if (this.plumes.length) this.plumes = this.plumes.filter(p => sim.time - p.t < C.SMOKE_S && sim.time >= p.t - 1);
  }
  private collapsedSeen = 0;

  private addPlume(x: number, y: number, r: number, t: number, dust: boolean) {
    if (this.plumes.length * PUFFS >= C.SMOKE_MAX) this.plumes.shift();
    this.plumes.push({ x, y, r, t, dust });
  }

  /** Crater art: scorch fading into the ground, thrown chunks, a lit rim, a dark bowl, cracks. */
  private paintCrater(cx: number, cy: number, rCells: number, seed: number, park: boolean) {
    const g = this.g, P = this.px, x = cx * P, y = cy * P, rnd = rng(seed * 2654435761), r = rCells * P * (0.8 + rnd() * 0.35);
    const sc = g.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
    sc.addColorStop(0, park ? "rgba(26,18,10,.5)" : "rgba(10,9,8,.55)"); sc.addColorStop(1, "rgba(10,9,8,0)");
    g.fillStyle = sc; g.beginPath(); g.arc(x, y, r * 1.9, 0, 7); g.fill();
    for (let i = 0, n = 10 + Math.round(rCells * 7); i < n; i++) {
      const a = rnd() * 6.283, d = r * (1.05 + rnd() * 0.9), s = Math.max(1, P * (0.25 + rnd() * 0.6)), c = 55 + rnd() * 40;
      g.fillStyle = park ? `rgb(${c + 10},${c - 6},${c - 26})` : `rgb(${c | 0},${(c - 4) | 0},${(c - 10) | 0})`;
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s);
    }
    g.lineWidth = Math.max(1, r * 0.28);
    g.strokeStyle = park ? "rgba(110,86,58,.6)" : "rgba(128,114,96,.6)"; g.beginPath(); g.arc(x, y, r * 0.95, 0, 7); g.stroke();
    const lit = 3.4 + (rnd() - 0.5) * 0.6; g.strokeStyle = park ? "rgba(150,122,84,.3)" : "rgba(170,156,134,.32)"; g.beginPath(); g.arc(x, y, r * 0.95, lit, lit + 2.2); g.stroke();
    const b = g.createRadialGradient(x + r * 0.2, y + r * 0.2, 1, x, y, r * 0.85);
    b.addColorStop(0, "#1a1714"); b.addColorStop(0.7, park ? "#2e2418" : "#2b2620"); b.addColorStop(1, park ? "#4d3c28" : "#4a4237");
    g.fillStyle = b; g.beginPath(); g.arc(x, y, r * 0.82, 0, 7); g.fill();
    if (!park) {
      g.strokeStyle = "rgba(15,14,13,.8)"; g.lineWidth = Math.max(1, P * 0.3);
      for (let i = 0; i < 5 + rCells; i++) {
        let a = rnd() * 6.283, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        g.beginPath(); g.moveTo(px, py);
        for (let k = 0; k < 4; k++) { a += (rnd() - 0.5) * 0.8; px += Math.cos(a) * r * 0.25; py += Math.sin(a) * r * 0.25; g.lineTo(px, py); }
        g.stroke();
      }
    }
  }

  /** Rubble art for one collapsed cell: dark base, broken slabs with a short shadow, a bit of rebar. */
  private paintRubble(cx: number, cy: number) {
    const g = this.g, P = this.px, x0 = cx * P, y0 = cy * P, rnd = rng(cx * 73856093 ^ cy * 19349663);
    g.fillStyle = "#3b3631"; g.fillRect(x0, y0, P, P);
    for (let i = 0; i < 3; i++) {
      const px = x0 + rnd() * P, py = y0 + rnd() * P, sz = P * (0.3 + rnd() * 0.6), sh = 70 + rnd() * 70;
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(px + 1, py + 1, sz, sz * 0.66);
      g.fillStyle = `rgb(${sh | 0},${(sh - 6) | 0},${(sh - 14) | 0})`; g.fillRect(px, py, sz, sz * 0.66);
    }
    if (rnd() < 0.2) { g.fillStyle = "rgba(140,90,60,.8)"; g.fillRect(x0 + rnd() * P, y0 + rnd() * P, Math.max(1, P * 0.5), 1); }
  }

  /** Smoke and dust, drawn above the crowd. t = sim time; cam in screen pixels per cell. */
  drawSmoke(ctx: CanvasRenderingContext2D, camX: number, camY: number, s: number, t: number, W: number, H: number) {
    const [wx, wy] = this.wind;
    for (const p of this.plumes) {
      const age = t - p.t;
      for (let i = 0; i < PUFFS; i++) {
        const born = (i / PUFFS) * C.SMOKE_S * 0.55, a = age - born; // puffs leave the crater one after another
        if (a < 0) continue;
        const life = C.SMOKE_S - born, k = a / life;
        if (k >= 1) continue;
        const drift = a * C.SMOKE_WIND, rise = a * 0.9;
        const wob = Math.sin(i * 1.7 + p.x) * p.r * 0.4;
        const x = camX + (p.x + wx * drift + wob) * s, y = camY + (p.y + wy * drift - rise) * s;
        const pr = Math.max(2, (p.r * (0.5 + k * 1.6)) * s);
        if (x < -pr || y < -pr || x > W + pr || y > H + pr) continue;
        const alpha = (p.dust ? 0.4 : 0.55) * (1 - k) * Math.min(1, a * 3);
        const gr = ctx.createRadialGradient(x, y, 1, x, y, pr);
        const col = p.dust ? "170,156,132" : "176,172,166";
        gr.addColorStop(0, `rgba(${col},${alpha.toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, pr, 0, 7); ctx.fill();
      }
    }
  }
}
const PUFFS = 14;
