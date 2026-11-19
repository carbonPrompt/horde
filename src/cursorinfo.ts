// 0.44: what the pointer is over, for the label next to the cursor. Pure: reads the Sim, draws nothing.
import type { Sim } from "./sim";
import * as C from "./config";
import { ROAD, BUILDING, PARK, WATER, BRIDGE, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION } from "./map";

function terrain(sim: Sim, i: number): string {
  const t = sim.map.tile[i], h = sim.map.height[i];
  if (t === BUILDING) return `Building, ${h} floor${h === 1 ? "" : "s"} (${Math.round(h * C.LEVEL_M)} m roof)`;
  if (t === WATER) return "Water";
  if (t === PARK) return "Park";
  if (t === BRIDGE) return "Bridge";
  if (t === ROAD) return h === INFRA_HIGHWAY ? "Highway" : h === INFRA_RAIL ? "Rail line" : h === INFRA_STATION ? "Station" : "Street";
  return "";
}

/** Lines describing cell (x, y), most important first: a unit or building standing there, the ground, the zone.
 *  Null off the map. */
export function describeCell(sim: Sim, x: number, y: number): string[] | null {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= sim.w || y >= sim.h) return null;
  const i = sim.idx(x, y), out: string[] = [];
  const e = sim.entityAt(x + 0.5, y + 0.5);
  if (e) out.push("unit" in e ? C.UNITS[e.unit.kind].name : "support" in e ? C.SUPPORTS[e.support.kind].name : "AC-130"); // 0.46: an AC-130 overhead
  out.push(terrain(sim, i));
  const z = sim.inZone[i];
  if (z === 1) out.push("Inside safe zone"); else if (z === 2) out.push("Wall"); else if (z === 3) out.push("Gate");
  return out;
}

/** Being short of money is shown as a red balance, not as a reason it can't go there. */
const shortOnly = (why: string | null) => (why === "Not enough budget." ? null : why);

export interface Estimate { price: number | null; left: number | null; blocked: string | null }

/** 0.44: what placing with `tool` at (x, y) would cost, and money left after. Zone: the draft closed through the
 *  hovered point (needs 3 corners counting the hover). Null for tools with no price. */
export function estimateAt(sim: Sim, tool: string, x: number, y: number, draft: [number, number][]): Estimate | null {
  if (tool === "zone") {
    const pts: [number, number][] = [...draft, [Math.round(x), Math.round(y)]];
    if (pts.length < 3) return { price: null, left: null, blocked: null };
    const price = sim.priceOf(pts);
    return { price, left: sim.remaining() - price, blocked: null };
  }
  x = Math.floor(x); y = Math.floor(y);
  if (tool in C.UNITS) {
    const k = tool as C.UnitKind, price = sim.unitCost(k, x, y);
    return { price, left: sim.remaining() - price, blocked: shortOnly(sim.canPlace(k, x, y)) };
  }
  if (tool in C.SUPPORTS) {
    const k = tool as C.SupportKind, price = sim.supportCost(k, x, y);
    return { price, left: sim.remaining() - price, blocked: shortOnly(sim.canPlaceSupport(k, x, y)) };
  }
  return null;
}
