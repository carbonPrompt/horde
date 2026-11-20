// 0.47: Codex diagrams, drawn at runtime from config so they can never go stale. Colors come from CSS variables
// (--fg, --muted, --accent) set on .cx-svg, with fallbacks so a lone svg still reads.
import * as C from "./config";
import { padCost } from "./scoring";

const FG = "var(--fg,#e8ecf1)", MUTED = "var(--muted,#8a94a3)", ACC = "var(--accent,#ffd54f)";
const GATE = "#4fc3f7", WALL = "#f5f5f5", INF = "#ff5252", CIV = "#ffffff", OK = "#7cfc9a";
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="sans-serif" font-size="13">${body}</svg>`;
const t = (x: number, y: number, s: string, o: { fill?: string; size?: number; anchor?: string; bold?: boolean } = {}) =>
  `<text x="${x}" y="${y}" fill="${o.fill ?? FG}" font-size="${o.size ?? 13}" text-anchor="${o.anchor ?? "middle"}"${o.bold ? ' font-weight="700"' : ""}>${s}</text>`;
const dot = (x: number, y: number, c: string, r = 5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, c: string) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2.5"/><path d="M${x2} ${y2} l-9 -5 v10 z" fill="${c}" transform="rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI} ${x2} ${y2})"/>`;
const cross = (x: number, y: number, c = INF) => `<path d="M${x - 7} ${y - 7} L${x + 7} ${y + 7} M${x + 7} ${y - 7} L${x - 7} ${y + 7}" stroke="${c}" stroke-width="3"/>`;
const money = (n: number) => "$" + +(n / 1e6).toFixed(1) + "M";

export const DIAGRAMS = {
  /** Who passes a gate, who passes a wall. */
  "gate-wall": () => svg(640, 230,
    `<rect x="300" y="20" width="40" height="190" fill="none" stroke="${MUTED}" stroke-dasharray="6 5"/>` +
    t(320, 14, "zone edge", { fill: MUTED, size: 12 }) + t(470, 120, "INSIDE THE ZONE", { fill: MUTED, size: 12 }) + t(150, 120, "OUTSIDE", { fill: MUTED, size: 12 }) +
    // gate street
    `<rect x="40" y="40" width="560" height="44" fill="rgba(255,255,255,0.06)"/><rect x="314" y="40" width="12" height="44" fill="${GATE}"/>` +
    t(320, 34, "GATE", { fill: GATE, bold: true }) + dot(150, 54, CIV) + arrow(160, 54, 450, 54, CIV) + t(520, 58, "people get in", { anchor: "start" }) +
    dot(150, 72, INF) + arrow(160, 72, 300, 72, INF) + cross(310, 72) + t(520, 76, "infected don't", { anchor: "start", fill: INF }) +
    // wall street
    `<rect x="40" y="150" width="560" height="44" fill="rgba(255,255,255,0.06)"/><rect x="314" y="150" width="12" height="44" fill="${WALL}"/>` +
    t(320, 216, "WALL (stronger)", { fill: WALL, bold: true }) + dot(150, 164, CIV) + arrow(160, 164, 300, 164, CIV) + cross(310, 164, CIV) +
    dot(150, 182, INF) + arrow(160, 182, 300, 182, INF) + cross(310, 182) + t(520, 176, "nobody passes", { anchor: "start" })),

  /** Direct fire stops at walls and edge buildings; high-angle fire and air go over. */
  "line-of-fire": () => svg(640, 230,
    `<rect x="300" y="60" width="16" height="140" fill="${WALL}"/>` + t(308, 220, "wall or edge building", { fill: MUTED, size: 12 }) +
    dot(470, 180, INF, 6) + dot(490, 172, INF, 6) + dot(480, 192, INF, 6) + t(485, 214, "infected", { fill: INF, size: 12 }) +
    `<rect x="80" y="172" width="22" height="16" fill="${GATE}"/>` + t(91, 214, "turret, tank, APC, squad, gunboat", { size: 12 }) +
    arrow(104, 180, 296, 180, INF) + cross(300, 180) +
    `<rect x="80" y="120" width="22" height="16" fill="#c792ea"/>` + `<path d="M104 124 Q 300 -20 466 168" fill="none" stroke="${OK}" stroke-width="2.5" stroke-dasharray="7 5"/>` +
    t(70, 154, "mortar, howitzer, HIMARS, battleship", { anchor: "start", size: 12 }) +
    `<rect x="230" y="40" width="40" height="70" fill="rgba(255,255,255,0.12)"/><rect x="240" y="30" width="20" height="12" fill="#ffd54f"/>` +
    arrow(262, 36, 462, 166, OK) + t(220, 24, "rooftop units and aircraft fire over", { anchor: "start", size: 12, fill: OK })),

  /** The NO-FIRE band around your people. */
  "no-fire": () => svg(640, 260,
    `<circle cx="200" cy="130" r="115" fill="rgba(255,82,82,0.10)" stroke="${INF}" stroke-dasharray="6 5"/>` +
    `<circle cx="200" cy="130" r="${Math.round(115 * C.NOFIRE_M / C.NOFIRE_BIG_M)}" fill="rgba(255,82,82,0.16)" stroke="${INF}"/>` +
    dot(190, 125, CIV) + dot(205, 135, CIV) + dot(212, 120, CIV) + dot(196, 140, CIV) + t(200, 162, "your people", { size: 12 }) +
    t(200, 50, `${C.NOFIRE_M} m`, { fill: INF, bold: true }) + t(200, 12, `${C.NOFIRE_BIG_M} m`, { fill: INF, bold: true }) +
    t(350, 70, `${C.NOFIRE_M} m: artillery, mortars, barrage,`, { anchor: "start" }) + t(350, 88, "firebomb, cluster bomb, AC-130 105 mm", { anchor: "start" }) +
    t(350, 128, `${C.NOFIRE_BIG_M} m: airstrike bomb runs, Tomahawk`, { anchor: "start" }) +
    t(350, 168, "The cursor turns red: NO-FIRE.", { anchor: "start", fill: INF }) +
    t(350, 206, "Nuke and MOAB: allowed,", { anchor: "start", fill: ACC }) + t(350, 224, "but they warn you first.", { anchor: "start", fill: ACC })),

  /** Each extra evac pad costs more than the last. */
  "evac-cost": () => {
    const n = 4, costs = Array.from({ length: n }, (_, i) => padCost(C.SUPPORTS.evac.cost, i)), max = costs[n - 1];
    return svg(640, 220, costs.map((c, i) => {
      const h = Math.max(6, (c / max) * 130), x = 90 + i * 130;
      return `<rect x="${x}" y="${180 - h}" width="80" height="${h}" rx="4" fill="#fff176"/>` + t(x + 40, 172 - h, money(c), { bold: true }) + t(x + 40, 200, `pad ${i + 1}`, { fill: MUTED });
    }).join("") + t(320, 18, `Every ${12} s a lift flies people out; each person brings $24,000.`, { fill: MUTED, size: 12 }));
  },

  /** Score bar 0 to 100 with the medal thresholds. */
  medals: () => {
    const x = (v: number) => 40 + v * 5.6, asc = [...C.MEDALS].sort((a, b) => a[1] - b[1]);
    return svg(640, 150, `<rect x="40" y="50" width="560" height="22" rx="4" fill="rgba(255,255,255,0.08)"/>` +
      asc.map(([name, min, col], i) => {
        const end = i + 1 < asc.length ? asc[i + 1][1] : 100;
        return `<rect x="${x(min)}" y="50" width="${x(end) - x(min)}" height="22" fill="${col}" opacity="0.85"/>` +
          `<text x="${x(min)}" y="96" fill="${FG}" font-size="13" text-anchor="middle">${min}</text>` + t((x(min) + x(end)) / 2, 40, name, { fill: col, bold: true });
      }).join("") + `<text x="${x(0)}" y="96" fill="${MUTED}" font-size="13" text-anchor="middle">0</text>` +
      `<text x="${x(100)}" y="96" fill="${MUTED}" font-size="13" text-anchor="middle">100</text>` +
      t(320, 130, `Score: mostly people saved, plus speed, an intact city and kills. Any medal needs at least ${C.MEDAL_MIN_SAVED_PCT}% saved.`, { fill: MUTED, size: 12 }));
  },

  /** From START BATTLE to the hordes. */
  timeline: () => {
    const d = C.DIFFICULTY.medium;
    return svg(640, 150, `<line x1="40" y1="70" x2="610" y2="70" stroke="${MUTED}" stroke-width="2"/>` +
      dot(50, 70, OK, 7) + t(50, 50, "START BATTLE", { fill: OK, bold: true, size: 12 }) + t(50, 98, "phone alert", { size: 12 }) +
      dot(200, 70, INF, 7) + t(200, 50, `${C.WARNING_S} s`, { fill: INF, bold: true }) + t(200, 98, "first cases turn", { size: 12 }) + t(200, 114, "outside your zones", { size: 12, fill: MUTED }) +
      [360, 470, 560].map((x, i) => `<path d="M${x} 58 l8 12 l-8 12 l-8 -12 z" fill="${ACC}" transform="scale(1) translate(0 0)"/>` + t(x, 50 - (i % 2) * 0, i === 0 ? "horde" : "", { fill: ACC, size: 12 })).join("") +
      t(470, 98, `then every ${d.gapMin} to ${d.gapMax} s (Medium),`, { size: 12 }) + t(470, 114, "each bigger and sooner", { size: 12, fill: MUTED }));
  },
};
export type DiagramId = keyof typeof DIAGRAMS;
