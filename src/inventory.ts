// 0.60: the Inventory window (hotkey I): each zone's ammo stock with use rate and time left, buy buttons, engineers,
// auto-restock and job priority, what is in the air, who is waiting; the batteries' reserves. Pure: HTML strings only.
import * as C from "./config";

export interface InvZone {
  name: string; small: number; vehicle: number; capSmall: number; capVehicle: number; rateSmall: number; rateVehicle: number; auto: boolean; prio: "ammo" | "repair";
  engineers: number; depot: number; engineerPrice: number; inbound: { what: string; eta: number }[]; waiting: string[]; waitingMoney: boolean;
  batteries: { label: string; reserve: number; mag: number; unit: number }[];
}

const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const n0 = (v: number) => Math.round(Number.isFinite(v) ? v : 0).toLocaleString("en-US");
const mmss = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

function stockRow(label: string, cls: "small" | "vehicle", have: number, cap: number, rate: number, crates: number, price: number, money: number): string {
  const pct = Math.max(0, Math.min(100, (100 * have) / Math.max(1, cap)));
  const left = rate > 0 ? `-${n0(rate)}/min  ~${n0(Math.floor(have / rate))} min left` : "no use yet";
  return `<div class="inv-row"><span class="inv-l">${esc(label)}</span><span class="inv-n">${n0(have)} rds</span>` +
    `<span class="inv-bar"><i style="width:${pct.toFixed(0)}%;background:${pct < 25 ? "#f87171" : "#4ade80"}"></i></span><span class="inv-r">${esc(left)}</span>` +
    `<button data-inv="${cls}" data-n="${crates}"${money < price ? " disabled" : ""}>+${n0(crates * (cls === "small" ? C.CRATE_SMALL : C.CRATE_VEHICLE))} ${esc(C.money(price))}</button></div>`;
}

/** 0.60.1: the "waiting for supply" line: units out of ammo first, then those at the wall, then those on the way (stable inside each). */
export function waitingList(units: { label: string; state: "dry" | "wall" | "way" }[]): string[] {
  const order = { dry: 0, wall: 1, way: 2 }, word = { dry: "no ammo", wall: "at the wall", way: "on the way" };
  return units.map((u, i) => ({ u, i })).sort((a, b) => order[a.u.state] - order[b.u.state] || a.i - b.i).map(({ u }) => `${u.label} (${word[u.state]})`);
}
export function inventoryHtml(zones: InvZone[], cur: number, money: number, phase: "plan" | "battle"): string {
  if (!zones.length) return `<div class="inv-empty">Draw a safe zone first: each zone keeps its own ammo stock.</div>`;
  const z = zones[Math.max(0, Math.min(zones.length - 1, cur))], N = 10;
  const tabs = zones.length > 1 ? `<div class="inv-tabs">${zones.map((x, i) => `<button data-invzone="${i}"${i === cur ? ' class="on"' : ""}>${esc(x.name)}</button>`).join("")}</div>` : "";
  const head = `<div class="inv-head"><b>${esc(z.name)}</b><span>Engineers ${n0(z.engineers)}${z.depot ? ` (+${n0(z.depot)} Depot)` : ""}</span>` +
    `<button data-inv="engineer"${money < z.engineerPrice ? " disabled" : ""}>+1 engineer ${esc(C.money(z.engineerPrice))}</button>` +
    `<button data-inv="prio" class="${z.prio === "ammo" ? "on" : ""}" data-v="ammo">Ammo first</button><button data-inv="prio" class="${z.prio === "repair" ? "on" : ""}" data-v="repair">Repairs first</button>` +
    `<button data-inv="auto" class="${z.auto ? "on" : ""}">Auto-restock ${z.auto ? "on" : "off"}</button></div>`;
  const rows = stockRow("Small arms", "small", z.small, z.capSmall, z.rateSmall, N, N * C.CRATE_PRICE_SMALL, money) +
    stockRow("Vehicle rounds", "vehicle", z.vehicle, z.capVehicle, z.rateVehicle, N, N * C.CRATE_PRICE_VEHICLE, money);
  const bats = z.batteries.map(b => {
    const cls = /HIMARS/.test(b.label) ? C.CRATE_PRICE_ROCKETS : C.CRATE_PRICE_SHELLS;
    return `<div class="inv-row"><span class="inv-l">${esc(b.label)}</span><span class="inv-n">${n0(b.reserve)} in reserve</span><span class="inv-r">+${n0(b.mag)} a magazine</span>` +
      `<button data-inv="reserve" data-unit="${b.unit}"${money < cls ? " disabled" : ""}>+1 magazine ${esc(C.money(cls))}</button></div>`;
  }).join("");
  const lines = [
    z.inbound.length ? `Inbound: ${z.inbound.map(i => `${i.what}, ${mmss(i.eta)}`).join("; ")}` : "",
    z.waiting.length ? `Waiting for supply: ${z.waiting.join(", ")}` : "",
    z.waitingMoney ? "Auto-restock is waiting for money." : "",
    phase === "plan" ? "Bought now, it is on site when the battle starts. In battle a Chinook brings it." : "",
  ].filter(Boolean).map(l => `<div class="inv-line">${esc(l)}</div>`).join("");
  return tabs + head + rows + (bats ? `<div class="inv-sub">Batteries</div>${bats}` : "") + lines;
}
