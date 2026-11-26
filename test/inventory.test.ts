// 0.60: the Inventory window (pure HTML).
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { inventoryHtml, type InvZone } from "../src/inventory";

const z = (p: Partial<InvZone> = {}): InvZone => ({ name: "Zone 1", small: 42000, vehicle: 1200, capSmall: 64000, capVehicle: 3600, rateSmall: 900, rateVehicle: 60, auto: true, prio: "ammo",
  engineers: 4, depot: 2, engineerPrice: 150000, inbound: [{ what: "10,000 small arms", eta: 24 }], waiting: ["APC 2 (at the wall)"], waitingMoney: false,
  batteries: [{ label: "Mortar 1", reserve: 18, mag: 60, unit: 3 }], ...p });

test("inventory renders stock, rate and time left", () => {
  const h = inventoryHtml([z()], 0, 5e7, "battle");
  expect(h).toContain("42,000 rds"); expect(h).toContain("-900/min"); expect(h).toContain("~46 min left");
  expect(h).toContain("Inbound: 10,000 small arms, 0:24");
  expect(h).toContain("Waiting for supply: APC 2 (at the wall)");
  expect(h).toContain("Mortar 1"); expect(h).toContain('data-inv="reserve" data-unit="3"');
  expect(h).toContain('data-inv="small"'); expect(h).toContain('data-inv="engineer"'); expect(h).toContain('data-inv="auto"'); expect(h).toContain('data-inv="prio"');
  expect(h).not.toContain("—");
});

test("waiting for money line", () => {
  expect(inventoryHtml([z({ waitingMoney: true })], 0, 0, "battle")).toContain("Auto-restock is waiting for money");
});

test("no NaN with empty zone", () => {
  const h = inventoryHtml([z({ small: 0, vehicle: 0, rateSmall: 0, rateVehicle: 0, inbound: [], waiting: [], batteries: [], engineers: 0, depot: 0 })], 0, 0, "plan");
  expect(h).not.toMatch(/NaN|undefined|Infinity/); expect(h).toContain("no use yet");
});

test("zone tabs and buy prices", () => {
  const h = inventoryHtml([z(), z({ name: "Zone 2" })], 1, 5e7, "plan");
  expect(h).toContain('data-invzone="0"'); expect(h).toContain('data-invzone="1" class="on"');
  expect(h).toContain(C.money(10 * C.CRATE_PRICE_SMALL));
});
