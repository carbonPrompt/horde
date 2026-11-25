// 0.47: scripted scenes for Codex pictures and clips. tools/shots runs the game with ?shots=1 and sends these ops
// through window.horde.shot; main.ts carries them out with the same functions a player's clicks use.
// Coordinates are map cells.

export type ShotOp =
  | { op: "zone"; pts: [number, number][] } // draws a safe zone corner by corner with the zone tool, then closes it
  | { op: "place"; kind: string; x: number; y: number } // a unit, support building, "c4" or a strike target (picks that tool, clicks)
  | { op: "gate"; x: number; y: number } // gate tool click: flips gate <-> wall
  | { op: "ability"; kind: string } // buy one charge while planning
  | { op: "time"; min: number } // start time, minutes after midnight
  | { op: "battle" }
  | { op: "advance"; s: number } // sim seconds, stepped frame-exactly
  | { op: "select"; x: number; y: number } // Move/Aim click (a unit, a person, the AC-130)
  | { op: "boxselect"; x0: number; y0: number; x1: number; y1: number }
  | { op: "key"; key: string }
  | { op: "click"; x: number; y: number; button: "left" | "right" } // with the current tool
  | { op: "tool"; tool: string }
  | { op: "hover"; x: number; y: number } // where the cursor (and its label) sits
  | { op: "person"; x: number; y: number } // selects the person nearest (x, y), opening their window
  | { op: "cursor"; on: false } // hides the pointer (and the hover panel) for a clean still
  | { op: "camera"; x: number; y: number; scale: number } // centers on (x, y) at a zoom
  | { op: "endround" } // 0.57: End round now (the after-action report opens)
  | { op: "report"; tab: string }; // 0.57: picks a tab of the after-action report

export interface ShotApi { apply(op: ShotOp): void; step(seconds: number): void }

const bad = (s: string): never => { throw new Error(`bad shot op: ${s}`); };
const num = (s: string | undefined, line: string) => { const n = Number(s); return s !== undefined && s !== "" && Number.isFinite(n) ? n : bad(line); };
const pt = (s: string | undefined, line: string): [number, number] => {
  const p = (s ?? "").split(",");
  return p.length === 2 ? [num(p[0], line), num(p[1], line)] : bad(line);
};

export function parseOp(line: string): ShotOp {
  const [op, ...a] = line.trim().split(/\s+/);
  switch (op) {
    case "zone": { if (a.length < 3) bad(line); return { op, pts: a.map(x => pt(x, line)) }; }
    case "place": { if (a.length !== 2 || !/^[a-z0-9_]+$/.test(a[0])) bad(line); const [x, y] = pt(a[1], line); return { op, kind: a[0], x, y }; }
    case "gate": case "select": case "hover": case "person": { if (a.length !== 1) bad(line); const [x, y] = pt(a[0], line); return { op, x, y }; }
    case "ability": return a.length === 1 && /^[a-z0-9_]+$/.test(a[0]) ? { op, kind: a[0] } : bad(line);
    case "time": return a.length === 1 ? { op, min: num(a[0], line) } : bad(line);
    case "battle": return a.length === 0 ? { op } : bad(line);
    case "advance": return a.length === 1 ? { op, s: num(a[0], line) } : bad(line);
    case "boxselect": { if (a.length !== 2) bad(line); const [x0, y0] = pt(a[0], line), [x1, y1] = pt(a[1], line); return { op, x0, y0, x1, y1 }; }
    case "key": return a.length === 1 ? { op, key: a[0] } : bad(line);
    case "click": {
      if (a.length < 1 || a.length > 2 || (a[1] && a[1] !== "left" && a[1] !== "right")) bad(line);
      const [x, y] = pt(a[0], line); return { op, x, y, button: (a[1] as "left" | "right") ?? "left" };
    }
    case "tool": return a.length === 1 ? { op, tool: a[0] } : bad(line);
    case "cursor": return a.length === 1 && a[0] === "off" ? { op, on: false } : bad(line);
    case "camera": { if (a.length !== 2) bad(line); const [x, y] = pt(a[0], line); return { op, x, y, scale: num(a[1], line) }; }
    case "endround": return a.length === 0 ? { op } : bad(line);
    case "report": return a.length === 1 && ["overview", "timeline", "units", "strikes", "town", "money", "heatmap"].includes(a[0]) ? { op, tab: a[0] } : bad(line);
    default: return bad(line);
  }
}

export function runOps(api: ShotApi, ops: string[]): void {
  for (const line of ops) {
    const op = parseOp(line);
    if (op.op === "advance") api.step(op.s); else api.apply(op);
  }
}

/** Shot mode only from a local file (tools/shots opens dist/horde.html from disk): a shared ?shots=1 link on the web
 * build must never touch a real player's save (it unlocks tools in memory and clears plans). */
export function shotsAllowed(href: string): boolean {
  try { const u = new URL(href); return u.protocol === "file:" && u.searchParams.has("shots"); } catch { return false; }
}
