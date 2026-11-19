// 0.45: StarCraft-style unit orders. Plain data on each Unit (saved with plans and snapshots); Sim.think runs them.
export type OrderKind = "move" | "amove" | "patrol" | "escort";
/** x, y: where it goes. Patrol: px, py is the other end. Escort: who is the person whose group it guards. */
export interface Order { k: OrderKind; x: number; y: number; px?: number; py?: number; who?: number }
export const ORDER_KINDS: OrderKind[] = ["move", "amove", "patrol", "escort"];
export const ARRIVE_R = 1.5; // cells: close enough to count as there
export const ESCORT_R = 4; // cells: an escort stays this close to its group

/** The queue after the unit stands at (atX, atY): the head is done when reached; a patrol turns around instead;
 *  an escort is never "reached" (Sim ends it when its group is safe or gone). */
export function nextOrder(orders: Order[], atX: number, atY: number): Order[] {
  const o = orders[0];
  if (!o || o.k === "escort" || !arrived(o, atX, atY)) return orders;
  if (o.k !== "patrol") return orders.slice(1);
  const rest = orders.slice(1), chain = rest.filter(p => p.k === "patrol");
  if (!chain.length) return [{ k: "patrol", x: o.px!, y: o.py!, px: o.x, py: o.y }, ...rest]; // turn around
  // Shift-queued patrol points: one loop through every point and back through the start
  const inChain = (x: number, y: number) => orders.some(p => p.k === "patrol" && p.x === x && p.y === y);
  const last = chain[chain.length - 1], back: Order[] = [];
  if (!inChain(o.px!, o.py!)) back.push({ k: "patrol", x: o.px!, y: o.py!, px: last.x, py: last.y });
  back.push({ ...o });
  return [...rest, ...back];
}

/** At the order's point: within ARRIVE_R of the cell's center (the one test Sim and the queue both use). */
export function arrived(o: Order, atX: number, atY: number): boolean { return Math.hypot(o.x + 0.5 - atX, o.y + 0.5 - atY) <= ARRIVE_R; }

/** A saved order list, checked (plans come from the save file). Undefined if anything in it is off. */
export function cleanOrders(v: unknown): Order[] | undefined {
  if (!Array.isArray(v) || v.length > 64) return undefined;
  const out: Order[] = [];
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  for (const o of v) {
    if (!o || typeof o !== "object" || !ORDER_KINDS.includes((o as Order).k) || !num((o as Order).x) || !num((o as Order).y)) return undefined;
    const q = o as Order, c: Order = { k: q.k, x: q.x, y: q.y };
    if (q.k === "patrol") { if (!num(q.px) || !num(q.py)) return undefined; c.px = q.px; c.py = q.py; }
    if (q.k === "escort") { if (!Number.isInteger(q.who) || q.who! < 0) return undefined; c.who = q.who; }
    out.push(c);
  }
  return out;
}
