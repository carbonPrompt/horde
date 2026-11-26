// 0.51: what each part of the bottom panel shows (pure rules; main.ts draws them).
import { expect, test } from "bun:test";
import { commandCard, selectionGrid, buildTabs, infoSource } from "../src/hud";

const base = { phase: "battle" as const, orderable: [], anySelected: false, armed: null, tool: "pan" };
const TOOLS = ["zone", "gate", "remove", "order", "pan", "heatmap", "recall", "closegates", "clear"];

test("RF1: nothing selected: the card holds the 9 tools, the current one is on", () => {
  const c = commandCard({ ...base, tool: "gate" });
  expect(c.map(b => b.id)).toEqual(TOOLS);
  expect(c.find(b => b.id === "gate")!.on).toBe(true);
  expect(c.find(b => b.id === "pan")!.on).toBeFalsy();
  expect(c.find(b => b.id === "gate")!.tool).toBe("gate");
  expect(c.find(b => b.id === "recall")!.key).toBe("Q");
});

test("units selected: orders; Fortify or Dismount only for Troops/Snipers; Top up only in battle with a damaged squad", () => {
  const ids = (o: any) => commandCard({ ...base, anySelected: true, orderable: o }).map(b => b.id);
  expect(ids([{ kind: "apc" }])).toEqual(["move", "amove", "patrol", "escort", "stop", "standby", "target", "remove"]);
  const ground = commandCard({ ...base, anySelected: true, orderable: [{ kind: "garrison" }] });
  expect(ground.find(b => b.id === "fortify")!.label).toBe("Fortify");
  const up = commandCard({ ...base, anySelected: true, orderable: [{ kind: "sniper", fort: "up" }] });
  expect(up.find(b => b.id === "fortify")!.label).toBe("Dismount");
  expect(ids([{ kind: "garrison", damaged: true }])).toContain("topup");
  expect(commandCard({ ...base, phase: "plan", anySelected: true, orderable: [{ kind: "garrison", damaged: true }] }).map(b => b.id)).not.toContain("topup");
  const sb = commandCard({ ...base, anySelected: true, orderable: [{ kind: "apc", standby: true }, { kind: "apc", standby: true }] });
  expect(sb.find(b => b.id === "standby")!.on).toBe(true);
  expect(commandCard({ ...base, anySelected: true, armed: "amove", orderable: [{ kind: "apc" }] }).find(b => b.id === "amove")!.on).toBe(true);
});

test("RF4: Remove in planning, Pull out in battle; a selected building (not orderable) gets target/remove only", () => {
  expect(commandCard({ ...base, phase: "plan", anySelected: true, orderable: [{ kind: "apc" }] }).find(b => b.id === "remove")!.label).toBe("Remove");
  expect(commandCard({ ...base, anySelected: true, orderable: [{ kind: "apc" }] }).find(b => b.id === "remove")!.label).toBe("Pull out");
  expect(commandCard({ ...base, anySelected: true, orderable: [] }).map(b => b.id)).toEqual(["target", "remove"]);
  expect(commandCard({ ...base, phase: "over", anySelected: true, orderable: [] }).map(b => b.id)).toEqual(["target"]);
});

test("selectionGrid: empty, one squad (RF2: all dead still listed, marked dead), several units", () => {
  expect(selectionGrid([])).toEqual({ mode: "empty" });
  const sq = selectionGrid([{ kind: "garrison", hp: 0, max: 400, soldiers: [{ name: "A", hp: 0, max: 100, alive: false }, { name: "B", hp: 50, max: 100, alive: true }] }]);
  expect(sq).toEqual({ mode: "squad", soldiers: [{ name: "A", health: 0, alive: false }, { name: "B", health: 0.5, alive: true }] });
  expect(selectionGrid([{ kind: "apc", hp: 450, max: 900 }])).toEqual({ mode: "units", items: [{ kind: "apc", health: 0.5, index: 0 }] });
  const many = selectionGrid([{ kind: "apc", hp: 900, max: 900 }, { kind: "tank", hp: 2000, max: 1000 }]);
  expect(many).toEqual({ mode: "units", items: [{ kind: "apc", health: 1, index: 0 }, { kind: "tank", health: 1, index: 1 }] });
});

test("buildTabs: first category by default; unknown falls back", () => {
  const cats = { Engineering: ["c4"], Infantry: ["garrison", "sniper"] };
  expect(buildTabs(cats, null)).toEqual({ cats: ["Engineering", "Infantry"], open: "Engineering" });
  expect(buildTabs(cats, "Infantry").open).toBe("Infantry");
  expect(buildTabs(cats, "Bogus").open).toBe("Engineering");
});

test("RF3: infoSource: hovered build item > hovered map thing > selection > idle", () => {
  expect(infoSource("tank", true, true)).toBe("hover-item");
  expect(infoSource(null, true, true)).toBe("hover-entity");
  expect(infoSource(null, false, true)).toBe("selection");
  expect(infoSource(null, false, false)).toBe("idle");
});

test("a selected safe zone (no units) offers Buy Troops / Buy Sniper team in battle", () => {
  expect(commandCard({ ...base, anySelected: false, zone: true }).map(b => b.id)).toEqual(["buytroops", "buysniper"]);
  expect(commandCard({ ...base, phase: "plan", anySelected: false, zone: true }).map(b => b.id)).toEqual(TOOLS);
});

test("0.51.1: every command on the card has a picture and a tooltip line", () => {
  const { ORDER_ICON_IDS } = require("../src/ordericons");
  const { CMD_DESC } = require("../src/hud");
  const ids = new Set<string>();
  const us = [{ kind: "garrison", damaged: true }, { kind: "sniper", fort: "up" }, { kind: "apc" }];
  for (const phase of ["plan", "battle", "over"] as const) {
    for (const b of commandCard({ phase, orderable: us, anySelected: true, armed: null, tool: "pan" })) ids.add(b.id);
    for (const b of commandCard({ phase, orderable: [], anySelected: false, armed: null, tool: "pan", zone: true })) ids.add(b.id);
    for (const b of commandCard({ phase, orderable: [{ kind: "garrison", fort: "up" }], anySelected: true, armed: null, tool: "pan" })) ids.add(b.label === "Dismount" ? "dismount" : b.id);
  }
  for (const id of ids) {
    expect(CMD_DESC[id]).toBeTruthy();
    if (!["buytroops", "buysniper", "zone", "gate", "order", "pan", "heatmap"].includes(id)) expect(ORDER_ICON_IDS).toContain(id); // those use unit/tool sprites
  }
  for (const id of ["recall", "sendback", "closegates", "clear", "dismount"]) expect(ORDER_ICON_IDS).toContain(id);
});

test("0.51.1: the panel's buttons carry tooltips instead of text labels", () => {
  const fs = require("fs");
  const html = fs.readFileSync(import.meta.dir + "/../index.html", "utf8") as string;
  const tools = /<div id="cmdtools">([\s\S]*?)<\/div>\s*<div id="cmdorders"/.exec(html)![1];
  const buttons = tools.match(/<button[^>]*>/g)!;
  expect(buttons.length).toBe(10); // 0.60: + Inventory (two full rows of five)
  for (const b of buttons) { expect(b).toContain("data-tip="); expect(b).not.toContain(" title="); }
  expect(html).toContain('id="uitip"');
  const main = fs.readFileSync(import.meta.dir + "/../src/main.ts", "utf8") as string;
  expect(main).toMatch(/class="cmd[^`]*data-tip=/);
  expect(main).toMatch(/data-ptool="\$\{t\}" data-tip=/);
});

test("0.52: squad state words and the Tab order (idle first)", () => {
  const { squadState, tabOrder, nextInTab } = require("../src/hud");
  const q = (o: object) => ({ firedAgo: 99, moving: false, fortified: false, ammo: 100, maxAmmo: 100, ...o });
  expect(squadState(q({ firedAgo: 1 }))).toBe("fighting");
  expect(squadState(q({ ammo: 0 }))).toBe("out of ammo");
  expect(squadState(q({ ammo: 10 }))).toBe("low ammo");
  expect(squadState(q({ ammo: Infinity }))).toBe("idle");
  expect(squadState(q({ moving: true }))).toBe("moving");
  expect(squadState(q({ fortified: true }))).toBe("fortified");
  const order = tabOrder(["fighting", "idle", "moving", "low ammo", "fortified"]);
  expect(order).toEqual([1, 3, 0, 2, 4]);
  expect(nextInTab(order, -1, false)).toBe(1);
  expect(nextInTab(order, 1, false)).toBe(3);
  expect(nextInTab(order, 4, false)).toBe(1); // wraps
  expect(nextInTab(order, 1, true)).toBe(4);
  expect(nextInTab([], -1, false)).toBe(-1);
});

test("0.55: the command card shows the live keys", () => {
  const K = require("../src/keymap");
  K.setBinds({ ...K.defaultBinds(), "order.stop": "o", "tool.zone": "p" });
  try {
    expect(commandCard({ ...base, anySelected: true, orderable: [{ kind: "apc" }] }).find(b => b.id === "stop")!.key).toBe("O");
    expect(commandCard({ ...base }).find(b => b.id === "zone")!.key).toBe("P");
    expect(commandCard({ ...base }).find(b => b.id === "heatmap")!.key).toBe("H"); // the heatmap view key
  } finally { K.setBinds(K.defaultBinds()); }
});
