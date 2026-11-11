// Block models (0.17): zoomed in, vehicles are drawn as what they are, built from 0.5 m blocks like the people are
// grains. A tank has a hull, tracks and a turret that turns toward what it is shooting; a battleship has three
// rotating gun turrets. Zoomed out (and in the toolbar) the game keeps the sprite icons.
// Grids face east (+x). One character is one block (a quarter cell). Rows are padded right, so widths can differ.
import type { Unit } from "./sim";
import type { UnitKind } from "./config";
import { AIRFRAMES, drawAirframe } from "./aircraft";

type Family = "army" | "navy" | "air" | "drone";
const FAMILY: Record<Family, Record<string, string>> = {
  army: { h: "#59632c", H: "#78843f", d: "#3a4119" },
  navy: { h: "#6f7c87", H: "#93a0aa", d: "#4a555e" },
  air: { h: "#4b5442", H: "#667058", d: "#30362a" },
  drone: { h: "#9aa0a6", H: "#c3c8cc", d: "#6b7076" },
};
const COMMON: Record<string, string> = {
  t: "#1c1d1f", T: "#3b3d40", g: "#16191d", m: "#6b7280", M: "#a0a7b0", w: "#8ecae6", r: "#c62828", y: "#f2b632",
  c: "#a39d88", C: "#8a8473", b: "#a88552", B: "#cfae78", e: "#4e4130", p: "#26300f", n: "#111214",
};

interface Part { grid: string[]; pivot: [number, number]; at?: [number, number]; turn?: "hull" | "aim" }
interface Model { family: Family; parts: Part[]; hullTurns: "move" | "aim" | "none"; air?: boolean; rotor?: { at: [number, number]; len: number } }

const TRACK = (n: number, lead = "") => (lead + "tT".repeat(n)).slice(0, n);
const TANK_TURRET: Part = { grid: ["..dddddd", ".dHHHHHHd", "dhhhMhhhhd", "dhhhhhhhhhgggggggggg", "dhhhhhhhhd", ".dhhhhhhd", "..dddddd"], pivot: [4.5, 3.5], at: [-1, 0], turn: "aim" };
const BIG_GUN = (x: number): Part => ({ grid: [".ddddd.", "dHHHHHdggggggg", "dhhhhhd", "dhhMhhdggggggg", "dhhhhhd", "dhhhhhdggggggg", ".ddddd."], pivot: [3.5, 3.5], at: [x, 0], turn: "aim" });

function reaper(): string[] {
  const g = Array.from({ length: 21 }, () => Array(12).fill("."));
  for (let y = 0; y < 21; y++) { g[y][6] = y === 0 || y === 20 ? "d" : "h"; g[y][7] = y === 0 || y === 20 ? "d" : "H"; }
  for (let x = 0; x < 12; x++) for (const y of [9, 10, 11]) g[y][x] = y === 10 ? "H" : "h";
  g[10][11] = "w"; g[9][11] = "."; g[11][11] = ".";
  for (const [x, y] of [[0, 7], [1, 8], [0, 13], [1, 12]]) g[y][x] = "d";
  return g.map(r => r.join(""));
}

const MODELS: Partial<Record<UnitKind, Model>> = {
  tank: {
    family: "army", hullTurns: "move", parts: [
      { grid: ["." + TRACK(16) + ".", TRACK(18), "dhhhhhhhhhhhhhhhHH", "dmdmhhhhhhhhhhhhhH", "dmdmhhhhhhhhhhhhhH", "dhhhhhhhhhhhhhhhHH", TRACK(18), "." + TRACK(16) + "."], pivot: [9, 4] },
      TANK_TURRET,
    ],
  },
  apc: {
    family: "army", hullTurns: "move", parts: [
      { grid: ["." + TRACK(11) + ".", TRACK(13), "dhhhhhhhhhhHH", "mhhhhhdddhhhH", "mhhhhhdddhhhH", "dhhhhhhhhhhHH", TRACK(13), "." + TRACK(11) + "."], pivot: [6.5, 4] },
      { grid: [".ddd", "dHHHdg", "dhMhhgggggg", "dhhhd", ".ddd"], pivot: [2.5, 2.5], at: [1, 0], turn: "aim" },
    ],
  },
  himars: {
    family: "army", hullTurns: "move", parts: [
      { grid: [".nn..nn....nn..", "HHHHHHHHHddhhHw", "HdHdHdHdHddhhHw", "HHHHHHHHHddhhHw", ".nn..nn....nn.."], pivot: [7.5, 2.5] },
    ],
  },
  howitzer: {
    family: "army", hullTurns: "aim", parts: [
      { grid: ["dd", ".dd", "..ddhhh", "...hhMhgggggggggggg", "..ddhhh", ".dd", "dd"], pivot: [5.5, 3.5] },
    ],
  },
  mortar: {
    family: "army", hullTurns: "aim", parts: [
      { grid: ["..bBbB.", ".beeeeb", "beepeeB", "Beeggeb", "beepeeB", ".Beeeeb", "..bBbB."], pivot: [3.5, 3.5] },
    ],
  },
  turret: {
    family: "army", hullTurns: "none", parts: [
      { grid: [".bBbBb.", "beeeeeB", "Beeeeeb", "beeeeeB", "Beeeeeb", "beeeeeB", ".bBbBb."], pivot: [3.5, 3.5] },
      { grid: ["pMggggg"], pivot: [1.5, 0.5], at: [0, 0], turn: "aim" },
    ],
  },
  gunboat: {
    family: "navy", hullTurns: "move", parts: [
      { grid: ["..ddddddddddddddddd", ".dhhhhhhhhhhhhhhhhhddd", "dhccccccHHHHwchhhhhhhhd", "dhccccccHHHHwchhhhhhhhhd", "dhccccccHHHHwchhhhhhhhd", ".dhhhhhhhhhhhhhhhhhddd", "..ddddddddddddddddd"], pivot: [12, 3.5] },
      { grid: ["dMd", "MMMggggg", "dMd"], pivot: [1.5, 1.5], at: [6, 0], turn: "aim" },
    ],
  },
  battleship: {
    family: "navy", hullTurns: "move", parts: [
      {
        grid: [
          "....dddddddddddddddddddddddddddddddddddd",
          "..ddhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhddddd",
          ".dhhcccccccccccccccccccccccccccccccccccccchhhhdd",
          "dhccccccccccccccmmmmmmmmmmmccccccccccccccccchhhhd",
          "dhccccccccccccmmMMMMMMMMMMMmmccccccccccccccccchhhd",
          "dhccccccccccccmmMMMwwMMMMMMmmcccccccccccccccccchhd",
          "dhccccccccccccmmMMMMMMMMMMMmmccccccccccccccccchhhd",
          "dhccccccccccccccmmmmmmmmmmmccccccccccccccccchhhhd",
          ".dhhcccccccccccccccccccccccccccccccccccccchhhhdd",
          "..ddhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhddddd",
          "....dddddddddddddddddddddddddddddddddddd",
        ], pivot: [25, 5.5],
      },
      BIG_GUN(-16), BIG_GUN(8), BIG_GUN(15),
    ],
  },
  apache: {
    family: "air", hullTurns: "move", air: true, rotor: { at: [1, 0], len: 15 }, parts: [
      { grid: ["......mmr", "......dd", "d......hhh", "dhhhhhhhhhwwg", "d......hhh", "......dd", "......mmr"], pivot: [7, 3.5] },
    ],
  },
  reaper: { family: "drone", hullTurns: "move", air: true, parts: [{ grid: reaper(), pivot: [6.5, 10.5] }] },
};

/** Soldiers: little top-down people, formation slots in cells from the unit's center. */
const SQUADS: Partial<Record<UnitKind, [number, number][]>> = {
  garrison: [[0.6, -0.5], [0.55, 0.6], [-0.6, -0.6], [-0.5, 0.55]],
  sniper: [[0.2, -0.2], [-0.6, 0.6]],
  para: [[0.7, -0.45], [0.5, 0.7], [-0.6, -0.6], [-0.65, 0.5]],
  police: [[0.6, -0.45], [0.5, 0.6], [-0.6, 0.05]],
  militia: [[0.7, -0.3], [0.3, 0.75], [-0.65, -0.65], [-0.45, 0.45]],
};
// u uniform, v vest, h helmet, s skin, g rifle, A unit color (armband)
const KIT: Record<string, Record<string, string>> = {
  garrison: { u: "#6b7536", v: "#424a24", h: "#505b2b", s: "#c8a27a" },
  para: { u: "#8f8259", v: "#5b5236", h: "#4a5530", s: "#c8a27a" },
  police: { u: "#26385f", v: "#121b30", h: "#1b2a4a", s: "#c8a27a" },
  militia: { u: "#4f6170", v: "#7a5a3a", h: "#6d4c2f", s: "#c8a27a" },
  sniper: { u: "#5b6a2e", v: "#3c4a1c", h: "#4d5a2a", s: "#c8a27a", G: "#6f7f38", q: "#3a4719" },
};
const SOLDIER: Part = { grid: ["..uu", ".uAvu", "uvhhvu", "uvhhvgggg", ".uvvsu", "..uu"], pivot: [3, 3] };
const SPOTTER: Part = { grid: ["..Gq", ".qGGq", "GqhhqG", "GqhhGgg", ".qGqsG", "..qG"], pivot: [3, 3] };
const PRONE: Part = { grid: ["..G.q.G.q", ".qGqGGqGqG", "GqGqGqhhGggggggg", ".qGqGGqGqG", "..q.G.q.G"], pivot: [7, 2.5] };
const SOLDIER_BLOCK = 0.12; // cells per block for people (a soldier is ~0.8 cells across: oversized to read)

export const MODEL_ZOOM = 5, SQUAD_ZOOM = 9;
export const hasModel = (k: UnitKind) => !!MODELS[k];
export const hasSquad = (k: UnitKind) => !!SQUADS[k];

interface Baked { img: HTMLCanvasElement; shadow: HTMLCanvasElement }
const baked = new Map<string, Baked>();
function bake(p: Part, pal: Record<string, string>, outline: boolean, key: string): Baked {
  let b = baked.get(key);
  if (b) return b;
  const w = Math.max(...p.grid.map(r => r.length)) + 2, h = p.grid.length + 2;
  const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const img = mk(), shadow = mk(), x = img.getContext("2d")!, sx = shadow.getContext("2d")!;
  const solid = (cx: number, cy: number) => { const ch = p.grid[cy]?.[cx]; return !!ch && ch !== "."; };
  for (let cy = -1; cy <= p.grid.length; cy++) for (let cx = -1; cx < w - 1; cx++) {
    const ch = p.grid[cy]?.[cx];
    let color: string | undefined;
    if (ch && ch !== ".") color = pal[ch] ?? COMMON[ch];
    else if (outline && (solid(cx - 1, cy) || solid(cx + 1, cy) || solid(cx, cy - 1) || solid(cx, cy + 1))) color = "#0a0d12"; // outline (base part only: turrets on a deck would double it)
    if (!color) continue;
    x.fillStyle = color; x.fillRect(cx + 1, cy + 1, 1, 1);
    sx.fillStyle = "#000"; sx.fillRect(cx + 1, cy + 1, 1, 1);
  }
  b = { img, shadow };
  baked.set(key, b);
  return b;
}

interface Pose { heading: number; aim: number; lx: number; ly: number; spin: number; moveT: number; run: number; firing: number }
const poses = new WeakMap<Unit, Pose>();
const turnTo = (a: number, b: number, k: number) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * Math.min(1, k); };

/** Track which way each unit faces (from its movement) and where its guns point (from its last shot). */
function pose(u: Unit, dt: number): Pose {
  let p = poses.get(u);
  if (!p) { p = { heading: 0, aim: 0, lx: u.x, ly: u.y, spin: Math.random() * 6, moveT: 9, run: 0, firing: 9 }; poses.set(u, p); }
  const dx = u.x - p.lx, dy = u.y - p.ly;
  p.moveT += dt;
  if (dx * dx + dy * dy > 0.0004) { p.heading = turnTo(p.heading, Math.atan2(dy, dx), dt * 6); p.lx = u.x; p.ly = u.y; p.moveT = 0; }
  if (p.moveT < 0.4) p.run += dt * 14;
  if (u.shotT >= 0) p.aim = turnTo(p.aim, Math.atan2(u.shotY - (u.y + 0.5), u.shotX - (u.x + 0.5)), dt * 8);
  else p.aim = turnTo(p.aim, p.heading, dt * 2);
  p.spin += dt * 40;
  return p;
}

/** Draw a vehicle model at a given pose (live units and wrecks share this). */
function drawVehicle(ctx: CanvasRenderingContext2D, kind: UnitKind, px: number, py: number, s: number, hull: number, aim: number, lift: number, spin: number, shadowOnly = false) {
  const m = MODELS[kind]; if (!m) return;
  if (AIRFRAMES[kind]) { drawAirframe(ctx, kind, px, py, s, hull, lift / (s * 0.9), spin, spin === 0); return; } // 0.29: real-size aircraft
  const b = s / 4; // pixels per block
  const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  for (const pass of m.air && lift > 0 ? ["shadow", "body"] as const : ["body"] as const) {
    if (shadowOnly && pass === "body") break;
    ctx.save();
    if (pass === "shadow") { ctx.globalAlpha *= 0.3; ctx.translate(px + lift * 0.7, py + lift * 0.9); }
    else ctx.translate(px, py - lift * 0.15);
    ctx.rotate(hull); ctx.scale(b, b);
    m.parts.forEach((part, i) => {
      const k = bake(part, FAMILY[m.family], i === 0, `${kind}:${i}`);
      ctx.save();
      if (part.at) ctx.translate(part.at[0], part.at[1]);
      if (part.turn === "aim") ctx.rotate(aim - hull);
      ctx.drawImage(pass === "shadow" ? k.shadow : k.img, -part.pivot[0] - 1, -part.pivot[1] - 1);
      ctx.restore();
    });
    if (m.rotor) { // two blades turning fast, drawn translucent like a blur
      ctx.translate(m.rotor.at[0], m.rotor.at[1]); ctx.rotate(spin);
      ctx.fillStyle = pass === "shadow" ? "#000" : "rgba(20,22,26,0.55)";
      const L = m.rotor.len / 2;
      ctx.fillRect(-L, -0.35, 2 * L, 0.7); ctx.fillRect(-0.35, -L, 0.7, 2 * L);
    }
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smooth;
}

/** Draw a unit's block model centered on (px, py); `s` is pixels per cell. */
export function drawModel(ctx: CanvasRenderingContext2D, u: Unit, px: number, py: number, s: number, dt: number, now: number) {
  const m = MODELS[u.kind]; if (!m) return;
  const p = pose(u, dt);
  // a hovering gunship points its nose (and gun) at what it is shooting; on the move it faces where it goes
  const hull = m.hullTurns === "aim" ? p.aim : m.hullTurns === "none" ? 0 : m.air && u.kind === "apache" && p.moveT > 0.5 ? p.aim : p.heading;
  const lift = m.air ? s * (0.9 + 0.08 * Math.sin(now / 400 + p.spin)) : 0;
  drawVehicle(ctx, u.kind, px, py, s, hull, p.aim, lift, p.spin);
}

function slot(px: number, py: number, s: number, ang: number, ox: number, oy: number): [number, number] {
  const c = Math.cos(ang), si = Math.sin(ang);
  return [px + (ox * c - oy * si) * s, py + (ox * si + oy * c) * s];
}

/** Soldiers zoomed in: little people with rifles, facing the fight; they run when they move. */
export function drawSquad(ctx: CanvasRenderingContext2D, u: Unit, px: number, py: number, s: number, color: string, dt: number, simTime: number) {
  const f = SQUADS[u.kind]; if (!f) return;
  const p = pose(u, dt);
  const moving = p.moveT < 0.4;
  const face = moving ? p.heading : u.shotT >= 0 ? p.aim : p.heading;
  const pal = { ...KIT[u.kind] ?? KIT.garrison, A: color };
  const b = s * SOLDIER_BLOCK;
  const flash = u.shotT >= 0 && simTime - u.shotT < 0.07;
  const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  f.forEach(([ox, oy], i) => {
    const [x, y] = slot(px, py, s, p.heading, ox, oy);
    const part = u.kind === "sniper" ? (i === 0 ? PRONE : SPOTTER) : SOLDIER;
    const k = bake(part, pal, true, `${u.kind}:${part === SOLDIER ? "s" : part === PRONE ? "p" : "o"}:${color}`);
    const bob = moving ? Math.sin(p.run + i * 1.7) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(face + (i === 0 ? 0 : (i % 2 ? 0.12 : -0.12))); ctx.scale(b, b);
    if (moving && part !== PRONE) { // legs swinging under the body
      ctx.fillStyle = "#1d1f22";
      ctx.fillRect(-0.5 + bob * 1.6, -1.6, 1.6, 1); ctx.fillRect(-0.5 - bob * 1.6, 0.6, 1.6, 1);
    }
    ctx.drawImage(k.img, -part.pivot[0] - 1, -part.pivot[1] - 1);
    if (flash && (i === 0 || u.kind !== "sniper") && (i + Math.floor(simTime * 20)) % 2 === 0) { // muzzle flash at the rifle tip
      const tip = part === PRONE ? 9 : 6.5;
      ctx.fillStyle = "#ffd54f"; ctx.fillRect(tip, -0.9, 1.6, 1.4); ctx.fillStyle = "#fff8e1"; ctx.fillRect(tip + 0.2, -0.6, 0.8, 0.8);
    }
    ctx.restore();
  });
  ctx.imageSmoothingEnabled = smooth;
}

// ---------- Support buildings ----------
type Rect = (x: number, y: number, w: number, h: number, c: string) => void;
const STAR = ["..#..", ".###.", "#####", ".#.#."];
const DOLLAR = ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."];
function pix(R: Rect, pat: string[], x: number, y: number, c: string, sz = 1) { pat.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") R(x + i * sz, y + j * sz, sz, sz, c); }); }
function sandbags(R: Rect, x0: number, y0: number, w: number, h: number) {
  for (let i = 0; i < w; i++) { const c = i % 2 ? "#cfae78" : "#a88552"; R(x0 + i, y0, 1, 1, c); R(x0 + i, y0 + h - 1, 1, 1, c); }
  for (let j = 1; j < h - 1; j++) { const c = j % 2 ? "#cfae78" : "#a88552"; R(x0, y0 + j, 1, 1, c); R(x0 + w - 1, y0 + j, 1, 1, c); }
}
function tent(R: Rect, x: number, y: number, w: number, h: number, base: string, dark: string, light: string) {
  R(x, y, w, h, base); R(x, y, w, 1, light); R(x, y + Math.floor(h / 2), w, 0.6, dark); R(x, y + h - 0.6, w, 0.6, dark);
}

/** A support building, zoomed in: 14 x 14 blocks (3.5 cells) of animated pixel art. */
export function drawSupport(ctx: CanvasRenderingContext2D, kind: string, px: number, py: number, s: number, now: number, color: string, info: { pickupAt?: number; simTime: number }) {
  const b = s / 4;
  ctx.save(); ctx.translate(px, py); ctx.scale(b, b);
  const R: Rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  R(-7.5, -7.5, 15, 15, "#0a0d12");
  const blink = (period: number, phase = 0) => ((now + phase) % period) < period / 2;
  switch (kind) {
    case "command": {
      R(-7, -7, 14, 14, "#4a4630"); sandbags(R, -7, -7, 14, 14);
      tent(R, -5.5, -5.5, 6, 4, "#59632c", "#3a4119", "#78843f");
      tent(R, -5.5, 1, 6, 4, "#59632c", "#3a4119", "#78843f");
      R(1.5, 2, 4, 3, "#59632c"); R(1.5, 2, 4, 0.6, "#78843f"); R(4.6, 2.4, 0.7, 2.2, "#8ecae6"); // humvee
      R(2, -5.5, 3.4, 3.4, "#6b7280"); R(2.3, -5.2, 2.8, 2.8, "#4b5563"); // radar mount
      ctx.save(); ctx.translate(3.7, -3.8); ctx.rotate(now / 450); // spinning radar dish
      R(-0.7, -2.8, 1.3, 5.6, "#d1d5db"); R(-0.7, -2.8, 0.5, 5.6, "#9ca3af"); R(0.4, -0.3, 1.6, 0.6, "#6b7280"); R(1.8, -0.5, 0.6, 1, "#374151");
      ctx.restore();
      R(-0.2, -6.2, 0.4, 2.4, "#9ca3af"); R(-0.4, -6.6, 0.8, 0.8, blink(1000) ? "#ff3b3b" : "#5a1010"); // antenna
      R(0.6, -6.4, 1.6, 1, color); // flag
      break;
    }
    case "supply": {
      R(-7, -7, 14, 14, "#5c6066");
      for (let i = -7; i < 7; i += 2) { R(i, -7, 1, 0.5, "#f2b632"); R(i + 1, 6.5, 1, 0.5, "#f2b632"); }
      const crate = (x: number, y: number, base: string, top: string, h: number) => { // stacked crates: taller stacks show more layers
        for (let l = 0; l < h; l++) { R(x - l * 0.25, y - l * 0.25, 3, 3, l === h - 1 ? base : "#2b2b2b"); }
        const tx = x - (h - 1) * 0.25, ty = y - (h - 1) * 0.25;
        R(tx, ty, 3, 0.7, top); R(tx + 1.3, ty, 0.4, 3, "#3b2e1c"); R(tx, ty + 1.3, 3, 0.4, "#3b2e1c");
      };
      crate(-6, -6, "#8a6a3e", "#a8834f", 3); crate(-2.5, -6, "#4f5a2a", "#6b7536", 2); crate(-6, -2.5, "#4f5a2a", "#6b7536", 3);
      crate(-2.5, -2.5, "#8a6a3e", "#a8834f", 1); crate(-6, 1, "#8a6a3e", "#a8834f", 2); crate(-2.5, 1, "#4f5a2a", "#6b7536", 3);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#2b5d8a" : "#8a2b2b"; ctx.beginPath(); ctx.arc(-5.6 + i * 1.6, 5.3, 0.75, 0, 7); ctx.fill(); }
      const fy = Math.sin(now / 1400) * 3.5, carrying = Math.cos(now / 1400) > 0; // forklift working the lane
      R(2.3, -6.5, 4, 13, "#4e5258");
      R(2.8, fy - 1.2, 2.6, 2.8, "#f2b632"); R(3.2, fy - 0.8, 1.6, 1.2, "#222"); R(3.0, fy + 1.6, 0.4, 1.4, "#333"); R(4.8, fy + 1.6, 0.4, 1.4, "#333");
      if (carrying) { R(2.9, fy + 1.8, 2.4, 1.8, "#8a6a3e"); R(2.9, fy + 1.8, 2.4, 0.5, "#a8834f"); }
      R(5.6, -6.6, 1, 1, color);
      break;
    }
    case "evac": {
      R(-7, -7, 14, 14, "#2b2f35");
      ctx.strokeStyle = "#f2c94c"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.stroke();
      R(-2.5, -3, 1.1, 6, "#f5f5f5"); R(1.4, -3, 1.1, 6, "#f5f5f5"); R(-2.5, -0.55, 5, 1.1, "#f5f5f5");
      const soon = info.pickupAt !== undefined;
      for (const [x, y] of [[-6.6, -6.6], [5.8, -6.6], [-6.6, 5.8], [5.8, 5.8]]) R(x, y, 0.8, 0.8, blink(soon ? 300 : 1200, x * 50) ? (soon ? "#ffb300" : "#69f0ae") : "#1b3a2a");
      ctx.fillStyle = "#ff7043"; ctx.beginPath(); const sw = Math.sin(now / 700) * 0.4; ctx.moveTo(-6.5, 3); ctx.lineTo(-4.2, 3.4 + sw); ctx.lineTo(-6.5, 3.9); ctx.fill(); // windsock
      break;
    }
    case "budget": {
      R(-7, -7, 14, 14, "#6e7177"); R(-7, -7, 14, 0.6, "#8a8d93"); R(-7, 6.4, 14, 0.6, "#4e5157");
      R(2, -6, 4, 3, "#8ecae6"); R(2, -6, 4, 0.5, "#b3e5fc"); // skylight
      for (const [x, y] of [[-6, -6], [-6, -3]]) {
        R(x, y, 2.6, 2.4, "#9ca3af"); ctx.save(); ctx.translate(x + 1.3, y + 1.2); ctx.rotate(now / 120);
        R(-0.9, -0.15, 1.8, 0.3, "#374151"); R(-0.15, -0.9, 0.3, 1.8, "#374151"); ctx.restore();
      }
      pix(R, DOLLAR, -1.5, 0, color);
      break;
    }
    case "repair": {
      R(-7, -7, 14, 14, "#4a4d52");
      R(-7, -7, 8, 7, "#7a7f86"); for (let i = -7; i < 1; i += 1) R(i, -7, 0.4, 7, "#666b72"); // corrugated garage roof
      R(-6, -0.4, 6, 0.6, "#2f3236"); // door
      R(2, 0.5, 4.5, 3, "#59632c"); R(2, 0.5, 4.5, 0.6, "#78843f"); R(5.6, 1, 0.6, 2, "#8ecae6"); // vehicle on the bay
      if (Math.sin(now / 90) > 0.3) { R(1.4 + Math.random() * 0.8, 3.4 + Math.random() * 0.6, 0.4, 0.4, "#fff59d"); R(1.8, 3.7, 0.3, 0.3, "#ffffff"); } // welding sparks
      R(-5.5, 3, 2, 2, "#f2b632");
      ctx.save(); ctx.translate(-4.5, 4); ctx.rotate(-0.6 + Math.sin(now / 1800) * 0.9); R(0, -0.3, 6.5, 0.6, "#f2b632"); R(6.2, -0.1, 0.3, 1.4, "#333"); ctx.restore(); // crane boom
      R(5.4, -6.4, 1, 1, color);
      break;
    }
    case "radio": {
      R(-7, -7, 14, 14, "#3d4a3a");
      ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 0.15; ctx.beginPath();
      for (const [x, y] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) { ctx.moveTo(0, 0); ctx.lineTo(x, y); } ctx.stroke();
      R(-1.5, -1.5, 3, 3, "#9ca3af"); ctx.strokeStyle = "#4b5563"; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(-1.5, -1.5); ctx.lineTo(1.5, 1.5); ctx.moveTo(1.5, -1.5); ctx.lineTo(-1.5, 1.5); ctx.stroke();
      R(3, 3, 3, 3, "#6b7280"); R(3, 3, 3, 0.5, "#9ca3af"); // equipment shed
      R(-0.5, -0.5, 1, 1, blink(900) ? "#ff3b3b" : "#5a1010");
      const k = (now / 1600) % 1; ctx.strokeStyle = color; ctx.globalAlpha *= 1 - k; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(0, 0, 1.5 + k * 9, 0, 7); ctx.stroke(); // signal
      break;
    }
    case "police": {
      R(-7, -7, 14, 14, "#3b4a66"); R(-7, -7, 14, 0.6, "#50608a");
      pix(R, STAR, -2.5, -5.5, "#ffd54f");
      R(-7, 0.5, 14, 6.5, "#2a2d33"); for (let i = -6; i < 7; i += 3) R(i, 0.5, 0.25, 2, "#cfd8dc");
      const car = (x: number, y: number, ph: number) => {
        R(x, y, 4, 2.2, "#eceff1"); R(x + 1, y, 2, 2.2, "#263238"); R(x + 2.8, y + 0.3, 0.6, 1.6, "#8ecae6");
        const on = blink(400, ph); R(x + 1.6, y + 0.2, 0.7, 0.8, on ? "#ff1744" : "#5a1010"); R(x + 1.6, y + 1.1, 0.7, 0.8, on ? "#0d1b4a" : "#2979ff");
      };
      car(-5.5, 1.3, 0); car(0.8, 3.8, 200);
      R(5, -6.4, 1, 1, color);
      break;
    }
    case "militia": {
      R(-7, -7, 14, 14, "#5a4a32"); sandbags(R, -7, -7, 14, 5);
      tent(R, -6, -5.5, 5, 3.5, "#7a5a3a", "#4e3a24", "#9a7650"); tent(R, 0.5, -5.5, 5.5, 3.5, "#6d6a45", "#45432b", "#8b875a");
      R(-1.1, 2.7, 2.2, 0.6, "#4a3020"); R(-0.3, 1.9, 0.6, 2.2, "#4a3020"); // campfire logs
      const fl = Math.sin(now / 80) * 0.3 + Math.sin(now / 47) * 0.2;
      R(-0.6, 1.9 - fl, 1.2, 1.2, "#ff9100"); R(-0.3, 2.2 - fl * 0.5, 0.6, 0.6, "#ffd54f");
      R(2, 2, 4.2, 2.6, "#8a8a7a"); R(2, 2, 1.8, 2.6, "#6e6e60"); R(5.4, 2.3, 0.6, 2, "#8ecae6"); // pickup truck
      R(-6, 2.5, 0.3, 3, "#ddd"); R(-5.7, 2.5, 1.6, 1, color); // flag
      break;
    }
    default: R(-7, -7, 14, 14, color);
  }
  ctx.restore();
}

/** Fuel depot zoomed in: round storage tanks with a pipe run. */
export function drawDepot(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  const b = s / 4;
  ctx.save(); ctx.translate(px, py); ctx.scale(b, b);
  ctx.fillStyle = "#3d4046"; ctx.fillRect(-7, -5, 14, 10);
  ctx.fillStyle = "#6b7280"; ctx.fillRect(-6, -0.3, 12, 0.6);
  for (const [x, y, r] of [[-3.5, -1, 2.8], [3.2, 1, 2.4]]) {
    ctx.fillStyle = "#0a0d12"; ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#cfd3d8"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 7); ctx.stroke();
    ctx.fillStyle = "#ff6d00"; ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  }
  ctx.restore();
}

// ---------- Destruction ----------
interface Wreck { kind: UnitKind; x: number; y: number; hull: number; aim: number; t: number; seed: number; air: boolean; squad: boolean; color: string }
const wrecks: Wreck[] = [];
let seen = new Set<Unit>(), lastT = 0;
const WRECK_S = 30, BODY_S = 20;
const rnd = (seed: number, i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };

/** Called once per frame with the live units: anything that vanished with hp <= 0 was destroyed and leaves a wreck. */
export function noteUnits(units: Unit[], simTime: number, colorOf: (k: UnitKind) => string) {
  if (simTime < lastT - 0.5) { wrecks.length = 0; seen = new Set(); } // a new battle
  lastT = simTime;
  const now = new Set(units);
  for (const u of seen) {
    if (now.has(u) || u.hp === undefined || u.hp > 0 || u.hp === -1 || u.parentUnit) continue;
    const p = poses.get(u), m = MODELS[u.kind];
    wrecks.push({ kind: u.kind, x: u.x + 0.5, y: u.y + 0.5, hull: m?.hullTurns === "aim" ? p?.aim ?? 0 : p?.heading ?? 0, aim: p?.aim ?? 0, t: simTime, seed: Math.random() * 100, air: !!m?.air, squad: !!SQUADS[u.kind], color: colorOf(u.kind) });
  }
  seen = now;
  for (let i = wrecks.length - 1; i >= 0; i--) if (simTime - wrecks[i].t > WRECK_S) wrecks.splice(i, 1);
}

/** Explosions, debris, burning hulks and fallen soldiers. Drawn under the live units. */
export function drawWrecks(ctx: CanvasRenderingContext2D, camX: number, camY: number, s: number, simTime: number, zoomedIn: boolean) {
  for (const w of wrecks) {
    let a = simTime - w.t;
    let px = camX + w.x * s, py = camY + w.y * s;
    const fade = Math.min(1, ((w.squad ? BODY_S : WRECK_S) - a) / 5);
    if (fade <= 0) continue;
    ctx.save(); ctx.globalAlpha *= fade;
    if (w.squad) {
      if (zoomedIn) { // the squad goes down where it stood
        const f = SQUADS[w.kind] ?? [];
        f.forEach(([ox, oy], i) => {
          const [x, y] = slot(px, py, s, w.hull, ox, oy), r = s * SOLDIER_BLOCK;
          ctx.save(); ctx.translate(x, y); ctx.rotate(rnd(w.seed, i) * 6.28); ctx.scale(r, r);
          ctx.fillStyle = "#5a0d0d"; ctx.fillRect(-1, -1.5, 3.5 + Math.min(1, a) * 1.5, 3);
          const pal = KIT[w.kind] ?? KIT.garrison;
          ctx.fillStyle = "#0a0d12"; ctx.fillRect(-3.5, -1.5, 6, 3);
          ctx.fillStyle = pal.u; ctx.fillRect(-3, -1, 5, 2); ctx.fillStyle = pal.h; ctx.fillRect(1.2, -0.8, 1.6, 1.6);
          ctx.restore();
        });
      }
      if (a < 0.4) { ctx.fillStyle = `rgba(200,30,30,${1 - a / 0.4})`; for (let i = 0; i < 8; i++) { const an = rnd(w.seed, i + 20) * 6.28, d = a * s * 2.5 * rnd(w.seed, i + 40); ctx.fillRect(px + Math.cos(an) * d, py + Math.sin(an) * d, Math.max(1, s * 0.12), Math.max(1, s * 0.12)); } }
      ctx.restore(); continue;
    }
    if (w.air && a < 1.2) { // spinning down
      const k = a / 1.2;
      if (zoomedIn) drawVehicle(ctx, w.kind, px, py, s * (1 - 0.2 * k), w.hull + k * 9, w.aim + k * 9, s * 0.9 * (1 - k), k * 60);
      if (a > 0.1) { ctx.fillStyle = "rgba(60,60,60,0.6)"; ctx.beginPath(); ctx.arc(px - s * 0.4, py - s * (1 - k), s * 0.3, 0, 7); ctx.fill(); }
      ctx.restore(); continue;
    }
    if (w.air) a -= 1.2;
    const size = w.kind === "battleship" ? 3 : w.kind === "gunboat" || w.kind === "tank" ? 1.8 : 1.3;
    if (a > 0.25 && zoomedIn) { // the burnt-out hulk
      ctx.save(); ctx.filter = "brightness(0.3) saturate(0.2)";
      drawVehicle(ctx, w.kind, px, py, s, w.hull, w.aim + rnd(w.seed, 5) - 0.5, 0, 0);
      ctx.restore();
    }
    const blk = Math.max(1.5, s * 0.25);
    if (a < 0.9) { // blocky fireball
      const R = s * size * (0.5 + a * 1.6);
      for (let i = 0; i < 40; i++) {
        const an = rnd(w.seed, i) * 6.28, d = Math.sqrt(rnd(w.seed, i + 100)) * R;
        const heat = d / R + a;
        ctx.fillStyle = heat < 0.5 ? "#fff59d" : heat < 0.9 ? "#ffb300" : heat < 1.3 ? "#ff5722" : "#5d4037";
        ctx.fillRect(px + Math.cos(an) * d - blk, py + Math.sin(an) * d - blk, blk * 2, blk * 2);
      }
    }
    if (a < 1.6) { // debris flung out
      ctx.fillStyle = "#2b2b2b";
      for (let i = 0; i < 12; i++) {
        const an = rnd(w.seed, i + 200) * 6.28, v = (0.8 + rnd(w.seed, i + 300) * 2.2) * s * size;
        const d = v * a * (1 - a / 3.2);
        ctx.fillRect(px + Math.cos(an) * d, py + Math.sin(an) * d - Math.sin(Math.min(1, a / 1.6) * Math.PI) * s * 0.8, blk, blk);
      }
    }
    if (a > 0.3 && a < 14) { // fires still burning on the hulk
      for (let i = 0; i < 3; i++) {
        const ox = (rnd(w.seed, i + 400) - 0.5) * s * size, oy = (rnd(w.seed, i + 500) - 0.5) * s * size * 0.5;
        const fl = Math.sin(simTime * 18 + i * 2) * 0.5 + 0.5;
        ctx.fillStyle = fl > 0.5 ? "#ff9100" : "#ffd54f"; ctx.fillRect(px + ox - blk / 2, py + oy - blk * (1 + fl), blk, blk * (1 + fl));
      }
    }
    if (a > 0.2) { // smoke drifting up and away
      for (let i = 0; i < 6; i++) {
        const life = ((a * 0.6 + i / 6) % 1), alpha = (1 - life) * 0.35 * Math.min(1, (WRECK_S - 8 - a) / 6);
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(70,70,72,${alpha})`;
        ctx.beginPath(); ctx.arc(px + life * s * 1.5 + Math.sin(i + a) * s * 0.3, py - life * s * 4, s * (0.4 + life * 1.1), 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }
}
