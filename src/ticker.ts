/** Alerts for the scrolling strip in the top bar (0.19): hordes, breaches, losses, tips. Pure, no DOM. */
export interface Alert { text: string; urgent: boolean; until?: number }

export class AlertQueue {
  private q: Alert[] = [];
  private cur: Alert | null = null; // the one scrolling now (still counts for repeats until done())
  constructor(private max = 6) {}
  /** Repeats of a waiting or scrolling text are dropped. Urgent alerts wait ahead of non-urgent ones. When full, the
   *  oldest non-urgent alert goes (or the oldest if all are urgent). `until`: skip it if its turn comes after that time. */
  push(text: string, urgent: boolean, until?: number) {
    if (this.cur?.text === text || this.q.some(a => a.text === text)) return;
    if (this.q.length >= this.max) {
      const i = this.q.findIndex(a => !a.urgent);
      this.q.splice(i >= 0 ? i : 0, 1);
    }
    const a: Alert = { text, urgent, ...(until !== undefined ? { until } : {}) };
    const at = urgent ? this.q.findIndex(x => !x.urgent) : -1;
    if (at >= 0) this.q.splice(at, 0, a); else this.q.push(a);
  }
  /** The next alert still worth showing at time `now`; it becomes the scrolling one. */
  shift(now = -Infinity): Alert | undefined {
    let a: Alert | undefined;
    while ((a = this.q.shift()) && a.until !== undefined && now > a.until) { /* stale: skip */ }
    this.cur = a ?? null;
    return a;
  }
  /** The scrolling alert has left the strip. */
  done() { this.cur = null; }
  get size() { return this.q.length; }
  items(): readonly Alert[] { return this.q; }
  clear() { this.q = []; this.cur = null; }
}
