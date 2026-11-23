// 0.51.1: picture glyphs for the command card (orders and zone commands). Each one shows the action itself (an arrow
// for move, a loop for patrol, a shield for escort...). Drawn once with canvas paths into data URLs; no DOM in tests.

type Draw = (g: CanvasRenderingContext2D) => void;
const S = 48, OUT = "#0a0d12";

/** Stroke a path twice: a dark outline under the colored line, so glyphs read on any tile. */
function line(g: CanvasRenderingContext2D, color: string, w: number, path: () => void) {
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = OUT; g.lineWidth = w + 4; g.beginPath(); path(); g.stroke();
  g.strokeStyle = color; g.lineWidth = w; g.beginPath(); path(); g.stroke();
}
function fill(g: CanvasRenderingContext2D, color: string, path: () => void) {
  g.lineJoin = "round"; g.beginPath(); path(); g.closePath();
  g.strokeStyle = OUT; g.lineWidth = 4; g.stroke(); g.fillStyle = color; g.fill();
}
/** An arrowhead at (x, y) pointing along angle a. */
function head(g: CanvasRenderingContext2D, color: string, x: number, y: number, a: number, r = 9) {
  fill(g, color, () => { g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r); g.lineTo(x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r); });
}
const arrow = (color: string): Draw => g => { line(g, color, 5, () => { g.moveTo(12, 36); g.lineTo(31, 17); }); head(g, color, 33, 15, -Math.PI / 4, 11); };
const sandbags = (g: CanvasRenderingContext2D) => {
  line(g, "#64748b", 3, () => { g.moveTo(6, 42); g.lineTo(42, 42); }); // the roof edge
  for (const [x, y] of [[9, 35], [19, 35], [29, 35], [14, 28], [24, 28]] as const)
    fill(g, "#eab308", () => { g.ellipse(x + 5, y + 3, 6, 3.6, 0, 0, Math.PI * 2); });
};
const zoneBox = (g: CanvasRenderingContext2D) => { g.setLineDash([5, 3]); line(g, "#4ade80", 3, () => g.rect(6, 10, 24, 28)); g.setLineDash([]); };

const DRAW: Record<string, Draw> = {
  move: arrow("#80cbc4"),
  amove: g => {
    arrow("#f87171")(g);
    line(g, "#facc15", 2.5, () => { g.arc(14, 34, 7, 0, Math.PI * 2); }); // the crosshair it fires through
    line(g, "#facc15", 2.5, () => { g.moveTo(14, 24); g.lineTo(14, 44); g.moveTo(4, 34); g.lineTo(24, 34); });
  },
  patrol: g => {
    line(g, "#fbbf24", 5, () => g.arc(24, 25, 13, Math.PI * 0.75, Math.PI * 2.35));
    const e = Math.PI * 2.35; // the arrowhead sits on the arc's end, pointing along it (clockwise)
    head(g, "#fbbf24", 24 + Math.cos(e) * 13, 25 + Math.sin(e) * 13, e + Math.PI / 2, 10);
  },
  escort: g => {
    fill(g, "#22c55e", () => { g.moveTo(24, 6); g.lineTo(40, 12); g.lineTo(38, 28); g.quadraticCurveTo(34, 38, 24, 43); g.quadraticCurveTo(14, 38, 10, 28); g.lineTo(8, 12); });
    fill(g, "#f8fafc", () => g.arc(24, 21, 4.5, 0, Math.PI * 2)); // the person it guards
    fill(g, "#f8fafc", () => { g.moveTo(17, 34); g.quadraticCurveTo(24, 24, 31, 34); });
  },
  stop: g => {
    fill(g, "#ef4444", () => { for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(24 + Math.cos(a) * 18, 24 + Math.sin(a) * 18); } });
    g.fillStyle = "#f8fafc"; g.fillRect(13, 21, 22, 6);
  },
  standby: g => { // hold fire: pause bars
    fill(g, "#94a3b8", () => g.rect(13, 11, 8, 26)); fill(g, "#94a3b8", () => g.rect(27, 11, 8, 26));
  },
  fortify: g => { sandbags(g); line(g, "#38bdf8", 4, () => { g.moveTo(24, 24); g.lineTo(24, 9); }); head(g, "#38bdf8", 24, 7, -Math.PI / 2, 8); },
  dismount: g => { sandbags(g); line(g, "#38bdf8", 4, () => { g.moveTo(24, 5); g.lineTo(24, 18); }); head(g, "#38bdf8", 24, 21, Math.PI / 2, 8); },
  target: g => {
    line(g, "#facc15", 3.5, () => g.arc(24, 24, 13, 0, Math.PI * 2));
    line(g, "#facc15", 3.5, () => { g.moveTo(24, 4); g.lineTo(24, 16); g.moveTo(24, 32); g.lineTo(24, 44); g.moveTo(4, 24); g.lineTo(16, 24); g.moveTo(32, 24); g.lineTo(44, 24); });
    fill(g, "#ef4444", () => g.arc(24, 24, 3.5, 0, Math.PI * 2));
  },
  remove: g => line(g, "#ef4444", 7, () => { g.moveTo(13, 13); g.lineTo(35, 35); g.moveTo(35, 13); g.lineTo(13, 35); }),
  topup: g => { // reinforce the squad: a medic cross
    fill(g, "#22c55e", () => { g.moveTo(19, 8); g.lineTo(29, 8); g.lineTo(29, 19); g.lineTo(40, 19); g.lineTo(40, 29); g.lineTo(29, 29); g.lineTo(29, 40); g.lineTo(19, 40); g.lineTo(19, 29); g.lineTo(8, 29); g.lineTo(8, 19); g.lineTo(19, 19); });
  },
  recall: g => { zoneBox(g); line(g, "#f8fafc", 4, () => { g.moveTo(43, 24); g.lineTo(23, 24); }); head(g, "#f8fafc", 20, 24, Math.PI, 8); },
  sendback: g => { zoneBox(g); line(g, "#f8fafc", 4, () => { g.moveTo(18, 24); g.lineTo(37, 24); }); head(g, "#f8fafc", 40, 24, 0, 8); },
  closegates: g => { // a padlock
    line(g, "#94a3b8", 5, () => { g.moveTo(16, 22); g.lineTo(16, 15); g.arc(24, 15, 8, Math.PI, 0); g.lineTo(32, 22); });
    fill(g, "#facc15", () => g.rect(10, 21, 28, 21));
    fill(g, OUT, () => g.arc(24, 30, 3, 0, Math.PI * 2)); g.fillStyle = OUT; g.fillRect(23, 30, 2, 7);
  },
  clear: g => { zoneBox(g); line(g, "#ef4444", 5, () => { g.moveTo(10, 40); g.lineTo(40, 8); }); },
};

export const ORDER_ICON_IDS = Object.keys(DRAW);
const cache: Record<string, string> = {};
/** Data URL of the glyph for a command id ("" outside a browser or for an unknown id). */
export function orderIcon(id: string): string {
  if (cache[id] !== undefined) return cache[id];
  const d = DRAW[id];
  if (!d || typeof document === "undefined") return "";
  const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
  d(cv.getContext("2d")!);
  return (cache[id] = cv.toDataURL());
}
