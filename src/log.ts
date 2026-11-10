// Debug log. In the Windows app every line also goes to %APPDATA%\Horde\logs\horde-<date>.log
// (written by the main process); in a browser it stays in memory and can be saved from Settings.
import { desktop } from "./save";

type Level = "info" | "warn" | "error";
const ring: string[] = [];

export function log(level: Level, event: string, data?: Record<string, unknown>) {
  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${event}`;
  if (data) { try { line += " " + JSON.stringify(data); } catch { line += " [unserializable]"; } }
  ring.push(line);
  if (ring.length > 3000) ring.shift();
  try { desktop?.log?.(line); } catch { /* never let logging break the game */ }
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const recentLog = () => ring.join("\n");

let errors = 0;
export function installErrorHooks() {
  addEventListener("error", e => {
    if (errors++ > 50) return; // a broken frame loop would otherwise flood the file
    log("error", "js-error", { msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack });
  });
  addEventListener("unhandledrejection", e => {
    if (errors++ > 50) return;
    log("error", "promise-rejection", { reason: String((e.reason as Error)?.stack ?? e.reason) });
  });
}

/** Rolling performance numbers, reported every 30 s of play. */
export class Perf {
  frames = 0; frameMs = 0; worstFrame = 0; ticks = 0; tickMs = 0; worstTick = 0; dropped = 0; since = performance.now();
  frame(ms: number) { this.frames++; this.frameMs += ms; this.worstFrame = Math.max(this.worstFrame, ms); }
  tick(ms: number) { this.ticks++; this.tickMs += ms; this.worstTick = Math.max(this.worstTick, ms); }
  due(now: number) { return now - this.since >= 30000; }
  report(now: number, extra: Record<string, unknown>) {
    const secs = (now - this.since) / 1000;
    log("info", "perf", {
      fps: +(this.frames / secs).toFixed(1), frameAvgMs: +(this.frameMs / Math.max(1, this.frames)).toFixed(1), worstFrameMs: Math.round(this.worstFrame),
      tickAvgMs: +(this.tickMs / Math.max(1, this.ticks)).toFixed(2), worstTickMs: +this.worstTick.toFixed(1), droppedSteps: this.dropped, ...extra,
    });
    Object.assign(this, { frames: 0, frameMs: 0, worstFrame: 0, ticks: 0, tickMs: 0, worstTick: 0, dropped: 0, since: now });
  }
}
