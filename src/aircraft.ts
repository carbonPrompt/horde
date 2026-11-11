// Aircraft models (0.29): every airplane and helicopter seen from straight above at its real size, built from
// small blocks like the tank and battleship. Each airframe is written as outlines in meters (nose toward +x,
// starboard toward +y) and rasterized once into a block grid, so the shapes stay true to the real aircraft.
// Main rotors are discs seen face-on (blurred blades); tail rotors and propellers are seen edge-on, as thin bars.
// The shadow falls down and to the right, further away the higher the aircraft flies.
import { CELL_M } from "./config";

type Pt = [number, number];
type Shape = { pts: Pt[]; c: string } | { e: [number, number, number, number]; c: string };
interface Rotor { x: number; y: number; r: number; blades: number; dir: 1 | -1; chord: number }
interface EdgeOn { x: number; y: number; r: number; along: "x" | "y" } // tail rotors spin in the x-z plane, props in y-z
export interface Airframe {
  res: number;            // meters per block
  len: number;            // overall length in meters (for the zoomed-out minimum size)
  alt: number;            // shadow offset at cruise, in cells
  pal: Record<string, string>;
  shapes: Shape[];
  rotors?: Rotor[];
  edge?: EdgeOn[];
  glow?: Pt[];            // jet exhausts
  minPx?: number;
}

// --- outline helpers (meters) ---
const P = (c: string, pts: Pt[]): Shape => ({ pts, c });
/** A shape symmetric about the centerline: give the port half (y <= 0) from nose to tail. */
const M = (c: string, half: Pt[]): Shape => ({ pts: [...half, ...half.slice().reverse().map(([x, y]) => [x, -y] as Pt)], c });
const R = (c: string, x0: number, y0: number, x1: number, y1: number): Shape => P(c, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
/** A rectangle and its mirror on the other side (give the starboard one, y > 0). */
const Rm = (c: string, x0: number, y0: number, x1: number, y1: number): Shape[] => [R(c, x0, y0, x1, y1), R(c, x0, -y1, x1, -y0)];
const E = (c: string, x: number, y: number, rx: number, ry: number): Shape => ({ e: [x, y, rx, ry], c });

const GLASS = { w: "#22323d", W: "#4d6b80" };
const PAL = {
  army: { h: "#414a35", H: "#566147", d: "#2a3022", e: "#393f2e", n: "#121416", m: "#6b7280", ...GLASS },
  cargo: { h: "#737b82", H: "#8b939a", d: "#4f565c", e: "#666d74", n: "#15171a", m: "#9aa1a8", ...GLASS },
  ghost: { h: "#4b5258", H: "#5e666c", d: "#32373c", e: "#42484e", n: "#101214", m: "#7b828a", ...GLASS },
  eagle: { h: "#545b61", H: "#676f75", d: "#3a3f44", e: "#4a5056", n: "#121416", m: "#80878e", ...GLASS },
  hog: { h: "#646c6f", H: "#7a8285", d: "#464c4f", e: "#596063", n: "#141618", m: "#8e9598", ...GLASS },
  drone: { h: "#a6abaf", H: "#c0c4c7", d: "#7e8387", e: "#959a9e", n: "#1a1c1e", m: "#5c6166", ...GLASS },
  missile: { h: "#9aa1a7", H: "#b7bdc2", d: "#6f757a", e: "#8a9197", n: "#1c1e20", m: "#5c6166", ...GLASS },
  quad: { h: "#2e3236", H: "#464b50", d: "#1b1e21", e: "#25282b", n: "#0d0e10", m: "#5c6166", b: "#a88552", B: "#cfae78", ...GLASS },
};

// --- the airframes (real dimensions) ---
const C130_BODY: Shape[] = [ // C-130J: 29.8 m long, 40.4 m span, 4.3 m fuselage
  M("h", [[-11.5, -1.0], [-12.6, -7.8], [-14.4, -7.8], [-14.9, -1.0]]),          // tailplane
  M("h", [[14.9, -0.9], [14.3, -1.8], [12.5, -2.15], [-5, -2.15], [-12, -1.2], [-14.9, -0.7]]),
  M("h", [[3.2, -2], [2.6, -20.2], [0.2, -20.2], [-1.6, -2]]),                    // high straight wing
  ...Rm("e", -3.2, 4.6, 6.0, 5.9), ...Rm("e", -2.6, 9.4, 5.6, 10.6),              // four turboprop nacelles
  R("d", -15.2, -0.3, -10.5, 0.3),                                                // fin, edge-on
  R("H", -2.0, -0.3, 11.5, 0.3),                                                  // roof spine
  M("w", [[14.6, -0.6], [14.1, -1.5], [13.0, -1.8], [12.6, -1.6], [12.6, -0.25]]),
];
const C130_PROPS: EdgeOn[] = [5.25, 10].flatMap(y => [{ x: 6.3, y, r: 2.05, along: "y" as const }, { x: 6.3, y: -y, r: 2.05, along: "y" as const }]);

export const AIRFRAMES: Record<string, Airframe> = {
  uh60: { // UH-60 Black Hawk: 19.8 m with rotors, 16.4 m four-blade rotor, tail rotor on the right
    res: 0.5, len: 19.8, alt: 2, pal: PAL.army,
    shapes: [
      M("h", [[-1, -0.8], [-7.6, -0.4], [-8.1, -0.4]]),
      R("h", -7.9, -2.2, -7.0, 2.2),
      M("h", [[7.5, -0.3], [7.0, -0.95], [5.5, -1.2], [-1.5, -1.2], [-2.2, -0.9]]),
      M("w", [[7.1, -0.25], [6.7, -0.85], [5.0, -1.05], [4.8, -0.9], [4.8, -0.25]]),
      ...Rm("e", -1.6, 0.25, 2.2, 1.1), ...Rm("n", -2.1, 0.35, -1.6, 1.0),
      R("d", -8.4, -0.25, -7.2, 0.25),
    ],
    rotors: [{ x: 0.3, y: 0, r: 8.18, blades: 4, dir: 1, chord: 0.53 }],
    edge: [{ x: -7.9, y: 0.75, r: 1.68, along: "x" }],
  },
  ch47: { // CH-47 Chinook: 15.5 m fuselage, two 18.3 m three-blade rotors turning opposite ways
    res: 0.5, len: 30, alt: 2.2, pal: PAL.army,
    shapes: [
      M("h", [[7.9, -0.6], [7.4, -1.6], [6.4, -1.9], [-7.2, -1.9], [-7.8, -1.4]]),
      ...Rm("d", -3.2, 1.9, 4.4, 2.4),                                            // fuel sponsons
      ...Rm("e", -7.0, 1.7, -3.4, 2.6), ...Rm("n", -7.5, 1.85, -7.0, 2.45),       // engines on the aft pylon
      R("H", -7.6, -0.9, -4.4, 0.9), R("H", 4.6, -0.7, 7.0, 0.7),                 // rotor pylons
      M("w", [[7.7, -0.45], [7.3, -1.4], [6.3, -1.7], [6.0, -1.55], [6.0, -0.25]]),
    ],
    rotors: [{ x: -6.0, y: 0, r: 9.14, blades: 3, dir: -1, chord: 0.81 }, { x: 6.3, y: 0, r: 9.14, blades: 3, dir: 1, chord: 0.81 }],
  },
  apache: { // AH-64 Apache: 17.7 m, 14.6 m four-blade rotor, stub wings with Hellfires, tail rotor on the left
    res: 0.5, len: 17.7, alt: 1.8, pal: PAL.army,
    shapes: [
      M("h", [[-1.5, -0.55], [-8.4, -0.3], [-8.8, -0.3]]),
      R("h", -8.6, -1.7, -7.8, 1.7), R("d", -9.0, -0.25, -7.6, 0.25),
      ...Rm("h", -0.5, 0.6, 0.7, 2.7),                                             // stub wings
      ...Rm("m", -1.0, 2.25, 1.5, 2.95), ...Rm("n", 1.2, 2.3, 1.6, 2.9),           // Hellfire racks
      M("h", [[7.4, -0.25], [6.6, -0.55], [3.0, -0.7], [0.5, -0.8], [-1.8, -0.55]]),
      ...Rm("e", -1.6, 0.75, 1.7, 1.45), ...Rm("n", -2.1, 0.8, -1.6, 1.4),
      M("w", [[6.4, -0.2], [6.1, -0.45], [2.9, -0.55], [2.9, -0.2]]),
      R("d", 4.4, -0.6, 4.9, 0.6),
      E("n", 7.3, 0, 0.55, 0.5),                                                   // TADS sensor turret
    ],
    rotors: [{ x: 0.4, y: 0, r: 7.32, blades: 4, dir: 1, chord: 0.53 }],
    edge: [{ x: -8.5, y: -0.6, r: 1.4, along: "x" }],
  },
  reaper: { // MQ-9 Reaper: 11 m long, 20 m span, V-tail, pusher propeller
    res: 0.5, len: 11, alt: 4, pal: PAL.drone,
    shapes: [
      M("h", [[0.8, -0.4], [0.3, -10], [-0.3, -10], [-0.7, -0.4]]),
      ...Rm("n", -0.5, 3.0, 1.1, 3.5), ...Rm("n", -0.5, 5.5, 1.1, 6.0),            // Hellfires under the wings
      M("h", [[-3.6, -0.3], [-4.6, -2.0], [-5.1, -2.0], [-4.9, -0.3]]),
      M("h", [[5.5, -0.2], [5.0, -0.55], [3.5, -0.65], [-3.0, -0.45], [-5.3, -0.25]]),
      E("H", 3.4, 0, 1.0, 0.45),                                                   // satcom bulge
    ],
    edge: [{ x: -5.6, y: 0, r: 1.15, along: "y" }],
  },
  c130: { res: 0.5, len: 29.8, alt: 7, pal: PAL.cargo, shapes: C130_BODY, edge: C130_PROPS },
  mc130: { res: 0.5, len: 29.8, alt: 7, pal: PAL.ghost, shapes: C130_BODY, edge: C130_PROPS },
  ac130: { // AC-130J Ghostrider: the C-130 with a 30 mm cannon and a 105 mm howitzer out the left side
    res: 0.5, len: 29.8, alt: 7, pal: PAL.ghost, edge: C130_PROPS,
    shapes: [...C130_BODY, R("n", 5.0, -3.6, 5.5, -2.1), R("n", -4.4, -4.8, -3.6, -2.1), R("m", -4.6, -2.6, -3.4, -2.1)],
  },
  f15e: { // F-15E Strike Eagle: 19.4 m long, 13 m span, twin tails and engines
    res: 0.5, len: 19.4, alt: 6, pal: PAL.eagle,
    shapes: [
      M("h", [[2.0, -2.0], [-4.4, -6.5], [-6.1, -6.5], [-5.6, -2.0]]),
      M("h", [[-6.5, -1.6], [-8.8, -4.3], [-10.2, -4.3], [-9.5, -1.6]]),
      M("h", [[9.7, 0], [8.5, -0.45], [6.5, -0.75], [3.5, -0.9], [3.0, -2.2], [-6.0, -2.0], [-8.6, -1.5], [-9.7, -1.4]]),
      ...Rm("n", 2.8, 1.2, 3.4, 2.2),                                             // intake lips
      ...Rm("d", -9.6, 1.25, -5.4, 1.85),                                         // fins, edge-on
      ...Rm("n", -10.1, 0.3, -9.5, 1.3),                                          // nozzles
      M("w", [[7.0, -0.2], [6.6, -0.5], [3.6, -0.55], [3.2, -0.3]]),
    ],
    glow: [[-10.1, 0.8], [-10.1, -0.8]],
  },
  a10: { // A-10 Thunderbolt II: 16.3 m long, 17.5 m straight wing, engines high on the rear fuselage
    res: 0.5, len: 16.3, alt: 4, pal: PAL.hog,
    shapes: [
      M("h", [[1.4, -0.8], [1.0, -8.76], [-0.7, -8.76], [-1.3, -0.8]]),
      ...Rm("m", -0.6, 3.3, 1.9, 3.8), ...Rm("m", -0.6, 5.5, 1.9, 6.0),            // stores
      ...Rm("H", -0.8, 1.5, 2.3, 2.3),                                             // gear pods
      M("h", [[-6.3, -0.4], [-6.5, -2.9], [-8.1, -2.9], [-8.1, -0.4]]),
      M("h", [[8.0, -0.3], [7.0, -0.75], [3.0, -0.85], [-3.5, -0.7], [-7.4, -0.4], [-8.1, -0.3]]),
      ...Rm("d", -8.4, 2.6, -5.7, 3.15),                                           // twin fins at the tailplane tips
      ...Rm("e", -6.3, 0.85, -2.5, 2.05), ...Rm("n", -2.8, 1.0, -2.4, 1.9),        // engine pods and intakes
      R("n", 8.0, -0.25, 8.7, 0.25),                                               // GAU-8 muzzle
      M("w", [[6.3, -0.2], [6.0, -0.55], [4.6, -0.6], [4.4, -0.2]]),
    ],
  },
  tomahawk: { // Tomahawk cruise missile: 5.6 m, 0.52 m body, 2.7 m pop-out wings
    res: 0.13, len: 5.6, alt: 1.5, pal: PAL.missile, minPx: 16,
    shapes: [
      M("h", [[0.1, -0.2], [-0.1, -1.33], [-0.45, -1.33], [-0.4, -0.2]]),
      M("h", [[-2.2, -0.2], [-2.6, -0.7], [-2.8, -0.7], [-2.8, -0.2]]),
      M("h", [[2.8, 0], [2.6, -0.2], [2.2, -0.26], [-2.65, -0.26], [-2.8, -0.2]]),
      R("d", 2.55, -0.1, 2.8, 0.1),
    ],
    glow: [[-2.9, 0]],
  },
  quad: { // heavy-lift hexacopter, 2.4 m across, crate slung underneath
    res: 0.1, len: 2.4, alt: 1.2, pal: PAL.quad, minPx: 12,
    shapes: [
      R("b", -0.36, -0.36, 0.36, 0.36),
      ...[0, 1, 2, 3, 4, 5].map(i => { const a = i * Math.PI / 3 + Math.PI / 6, c = Math.cos(a), s = Math.sin(a), w = 0.07; return P("d", [[-s * w, c * w], [c * 1.1 - s * w, s * 1.1 + c * w], [c * 1.1 + s * w, s * 1.1 - c * w], [s * w, -c * w]]); }),
      E("h", 0, 0, 0.3, 0.3),
    ],
    rotors: [0, 1, 2, 3, 4, 5].map(i => { const a = i * Math.PI / 3 + Math.PI / 6; return { x: Math.cos(a) * 1.1, y: Math.sin(a) * 1.1, r: 0.42, blades: 2, dir: (i % 2 ? 1 : -1) as 1 | -1, chord: 0.07 }; }),
  },
};
export type AirKey = keyof typeof AIRFRAMES;

// --- rasterize ---
function inside(sh: Shape, x: number, y: number): boolean {
  if ("e" in sh) { const [cx, cy, rx, ry] = sh.e; const dx = (x - cx) / rx, dy = (y - cy) / ry; return dx * dx + dy * dy <= 1; }
  let hit = false; const p = sh.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function bounds(a: Airframe): [number, number, number, number] {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const sh of a.shapes) {
    const pts: Pt[] = "e" in sh ? [[sh.e[0] - sh.e[2], sh.e[1] - sh.e[3]], [sh.e[0] + sh.e[2], sh.e[1] + sh.e[3]]] : sh.pts;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return [x0, y0, x1, y1];
}
/** The block grid (rows of palette characters) and where the airframe's origin falls in it. */
export function rasterize(a: Airframe): { grid: string[]; pivot: Pt } {
  const [x0, y0, x1, y1] = bounds(a), r = a.res;
  const W = Math.ceil((x1 - x0) / r) + 1, H = Math.ceil((y1 - y0) / r) + 1;
  const g = Array.from({ length: H }, () => Array<string>(W).fill("."));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) * r, y = y0 + (j + 0.5) * r;
    for (const sh of a.shapes) if (inside(sh, x, y)) g[j][i] = sh.c;
  }
  // light from the top of the grid: the upper edge of the paint catches it, the lower edge falls in shade
  const out = g.map(row => row.slice());
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = g[j][i];
    if (c !== "h" && c !== "w") continue;
    const up = g[j - 1]?.[i] ?? ".", dn = g[j + 1]?.[i] ?? ".";
    if (c === "w") { if (up !== "w") out[j][i] = "W"; continue; }
    if (up === ".") out[j][i] = "H"; else if (dn === ".") out[j][i] = "d";
  }
  return { grid: out.map(r => r.join("")), pivot: [-x0 / r, -y0 / r] };
}

interface Baked { img: HTMLCanvasElement; shadow: HTMLCanvasElement; pivot: Pt }
const baked = new Map<string, Baked>();
function bake(key: string): Baked {
  let b = baked.get(key);
  if (b) return b;
  const a = AIRFRAMES[key], { grid, pivot } = rasterize(a);
  const w = Math.max(...grid.map(r => r.length)) + 2, h = grid.length + 2;
  const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const img = mk(), shadow = mk(), x = img.getContext("2d")!, sx = shadow.getContext("2d")!;
  const solid = (cx: number, cy: number) => { const ch = grid[cy]?.[cx]; return !!ch && ch !== "."; };
  sx.fillStyle = "#000";
  for (let cy = -1; cy <= grid.length; cy++) for (let cx = -1; cx < w - 1; cx++) {
    const ch = grid[cy]?.[cx];
    let color: string | undefined;
    if (ch && ch !== ".") color = a.pal[ch] ?? "#ff00ff";
    else if (solid(cx - 1, cy) || solid(cx + 1, cy) || solid(cx, cy - 1) || solid(cx, cy + 1)) color = "#0a0d12";
    if (!color) continue;
    x.fillStyle = color; x.fillRect(cx + 1, cy + 1, 1, 1);
    sx.fillRect(cx + 1, cy + 1, 1, 1);
  }
  b = { img, shadow, pivot: [pivot[0] + 1, pivot[1] + 1] };
  baked.set(key, b);
  return b;
}

/** Pixels per meter for an airframe at zoom `s`, never so small it vanishes when zoomed out. */
function ppmFor(a: Airframe, s: number) { const real = s / CELL_M; return Math.max(real, (a.minPx ?? 28) / a.len); }
/** Half the airframe's length on screen, for placing labels beside it. */
export function airHalfPx(key: string, s: number) { const a = AIRFRAMES[key]; return a ? a.len * ppmFor(a, s) / 2 : s; }

const heads = new WeakMap<object, number>();
/** Turn a displayed heading toward `target` at `rate` rad/s (aircraft bank round; they don't snap). */
export function smoothHeading(o: object, target: number, dt: number, rate = 3) {
  const h = heads.get(o);
  if (h === undefined) { heads.set(o, target); return target; }
  const d = ((target - h + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const n = h + Math.max(-rate * dt, Math.min(rate * dt, d));
  heads.set(o, n); return n;
}

/**
 * Draw an airframe centered on (px, py). `alt` scales the shadow offset (1 = cruise, 0 = on the ground);
 * `spin` is the rotor angle in radians; `stopped` draws still blades (a wreck).
 */
export function drawAirframe(ctx: CanvasRenderingContext2D, key: string, px: number, py: number, s: number, heading: number, alt: number, spin: number, stopped = false) {
  const a = AIRFRAMES[key]; if (!a) return;
  const b = bake(key), ppm = ppmFor(a, s), bpx = ppm * a.res;
  const off = a.alt * alt * Math.max(s, ppm * CELL_M);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = bpx < 1.5;
  for (const pass of ["shadow", "body"] as const) {
    ctx.save();
    if (pass === "shadow") { ctx.globalAlpha *= 0.3 - Math.min(0.12, a.alt * alt * 0.012); ctx.translate(px + off * 0.6, py + off * 0.8); }
    else ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.save(); ctx.scale(bpx, bpx);
    ctx.drawImage(pass === "shadow" ? b.shadow : b.img, -b.pivot[0], -b.pivot[1]);
    ctx.restore();
    ctx.scale(ppm, ppm);
    const sh = pass === "shadow";
    for (const r of a.rotors ?? []) {
      ctx.save(); ctx.translate(r.x, r.y);
      if (!stopped) { // the blur of the disc, then the blades with a short smear behind each
        ctx.fillStyle = sh ? "rgba(0,0,0,0.25)" : "rgba(18,20,24,0.13)";
        ctx.beginPath(); ctx.arc(0, 0, r.r, 0, 6.2832); ctx.fill();
      }
      const base = spin * r.dir;
      for (let k = 0; k < (stopped ? 1 : 3); k++) {
        ctx.fillStyle = sh ? "#000" : `rgba(16,18,20,${stopped ? 0.95 : [0.55, 0.22, 0.1][k]})`;
        for (let i = 0; i < r.blades; i++) {
          ctx.save(); ctx.rotate(base - r.dir * k * 0.09 + i * 6.2832 / r.blades);
          ctx.fillRect(0, -r.chord / 2, r.r, r.chord);
          ctx.restore();
        }
      }
      if (!sh) { ctx.fillStyle = "#15171a"; ctx.beginPath(); ctx.arc(0, 0, Math.max(r.chord, r.r * 0.06), 0, 6.2832); ctx.fill(); }
      ctx.restore();
    }
    if (!sh) for (const e of a.edge ?? []) { // tail rotors and props, edge-on: a flickering bar
      const flick = stopped ? 0.8 : 0.45 + 0.15 * Math.sin(spin * 3 + e.x);
      ctx.fillStyle = `rgba(20,22,26,${flick.toFixed(2)})`;
      const t = Math.max(0.3, a.res * 0.8);
      if (e.along === "x") ctx.fillRect(e.x - e.r, e.y - t / 2, e.r * 2, t);
      else ctx.fillRect(e.x - t / 2, e.y - e.r, t, e.r * 2);
    }
    if (!sh && !stopped) for (const [gx, gy] of a.glow ?? []) {
      const rr = a.res * 2.2, g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
      g.addColorStop(0, "rgba(255,236,190,0.85)"); g.addColorStop(0.4, "rgba(255,150,40,0.45)"); g.addColorStop(1, "rgba(255,120,20,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, rr, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smooth;
}
