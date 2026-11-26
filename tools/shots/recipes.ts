// 0.47: one recipe per Codex picture or clip. Coordinates are map cells. Edit a recipe (or bump rev) and the Codex
// test fails until `bun tools/shots/run.ts` reshoots it. Every picture is checked by eye before it ships.
import type { Recipe } from "./stale";

// Fairhaven (400 x 300, seed 101). Town Green stand centered 191,106; north-south streets near x 157, 178, 200, 223;
// the river runs along y ~172 with bridges at 60,172 / 200,178 / 330,170.
const FH = { city: "fairhaven", seed: 101, startMin: 600, size: [960, 540] as [number, number], rev: 1 };
const MAP: [number, number, number, number] = [0, 76, 960, 262]; // the map, without the top bar and the 0.51 bottom panel (0.61: 178 px tall, top at 338)
const ZONE = "zone 165,82 217,82 217,130 165,130";
const BASE = [ZONE, "gate 217,98", "place sniper 186,78", "place garrison 172,78", "place turret 178,72", "place evac 191,106"];
const BATTLE = (s: number) => [...BASE, "battle", `advance ${s}`];

export const RECIPES: Recipe[] = [
  // ---------- stills ----------
  { ...FH, id: "battle-overview", kind: "shot", camera: { x: 191, y: 118, scale: 2.4 }, crop: MAP, setup: BATTLE(60) },
  { ...FH, id: "start-cursor-label", kind: "shot", camera: { x: 186, y: 92, scale: 6 }, crop: MAP, setup: [ZONE, "tool sniper", "hover 186,78"] },
  { ...FH, id: "units-ranges", kind: "shot", camera: { x: 182, y: 84, scale: 6 }, crop: MAP, setup: [...BASE, "key r"] },
  { ...FH, id: "battle-horde-arrow", kind: "shot", camera: { x: 200, y: 150, scale: 1.55 }, crop: MAP, setup: BATTLE(50) },
  { ...FH, id: "battle-money-bar", kind: "shot", camera: { x: 191, y: 106, scale: 4 }, crop: [0, 0, 700, 76], setup: BATTLE(30) },
  { ...FH, rev: 4, id: "people-person-window", kind: "shot", camera: { x: 191, y: 106, scale: 5 }, setup: [...BATTLE(12), "person 178,140", "cursor off"] },
  { ...FH, rev: 4, id: "units-selected-card", kind: "shot", camera: { x: 186, y: 92, scale: 6 }, setup: [...BASE, "select 186,78"] },
  { ...FH, id: "units-ac130-orbit", kind: "shot", camera: { x: 191, y: 150, scale: 3 }, crop: MAP,
    setup: [...BASE, "ability gunship", "battle", "advance 30", "tool gunship", "click 191,150", "advance 25", "cursor off"] },
  { ...FH, id: "support-radius", kind: "shot", camera: { x: 191, y: 106, scale: 3.5 }, crop: MAP,
    setup: ["zone 150,66 234,66 234,142 150,142", "tool radio", "hover 160,78"] },
  { ...FH, rev: 2, id: "battle-minimap-alerts", kind: "shot", camera: { x: 191, y: 106, scale: 3 }, crop: [0, 338, 150, 178], setup: BATTLE(75) }, // 0.48 (0.51: the minimap sits in the bottom panel)
  // 0.50: battle groups on the bar (bottom right), and a Troops squad walking over to fortify a roof
  { ...FH, rev: 2, id: "controls-groupbar", kind: "shot", camera: { x: 191, y: 106, scale: 4 }, crop: [180, 282, 600, 58],
    setup: [ZONE, "place garrison 172,78", "place garrison 190,106", "place sniper 186,78", "battle", "advance 3", "select 190,106", "key Ctrl+1", "select 172,78", "key Ctrl+2", "select 186,78", "key Ctrl+3", "key 1", "cursor off"] },
  { ...FH, rev: 2, id: "clip-troops-fortify", kind: "clip", camera: { x: 191, y: 119, scale: 8 }, crop: [180, 140, 600, 180], seconds: 12.5,
    setup: [ZONE, "place garrison 191,119", "battle", "advance 3", "select 191,119", "click 192,126 right"], action: ["advance 12.5"] },
  { ...FH, rev: 4, id: "controls-hud", kind: "shot", size: [1093, 615], camera: { x: 191, y: 106, scale: 4 }, crop: [0, 415, 1093, 178], setup: [...BATTLE(3), "select 172,78", "cursor off"] }, // 0.51
  // ---------- clips ----------
  { ...FH, id: "clip-draw-zone", kind: "clip", camera: { x: 191, y: 106, scale: 4.5 }, crop: MAP, seconds: 5, setup: [],
    action: ["tool zone", "click 165,82", "advance 0.7", "click 217,82", "advance 0.7", "click 217,130", "advance 0.7", "click 165,130", "advance 0.7", "click 165,82"] },
  { ...FH, id: "clip-gate-to-wall", kind: "clip", camera: { x: 212, y: 108, scale: 9 }, crop: MAP, seconds: 4.5, setup: BATTLE(15),
    action: ["tool gate", "advance 0.5", "click 217,115", "advance 2.5"] },
  { ...FH, id: "clip-evac-lift", kind: "clip", camera: { x: 191, y: 106, scale: 6 }, crop: MAP, seconds: 7, setup: BATTLE(16) },
  { ...FH, id: "clip-box-select-move", kind: "clip", camera: { x: 160, y: 132, scale: 6 }, crop: MAP, seconds: 6,
    setup: [ZONE, "place apc 157,148", "place tank 157,157", "battle", "advance 40"],
    action: ["boxselect 150,141 165,163", "advance 0.6", "click 157,110 right", "advance 5"] },
  { ...FH, id: "clip-attack-move", kind: "clip", camera: { x: 160, y: 132, scale: 6 }, crop: MAP, seconds: 6,
    setup: [ZONE, "place apc 157,150", "battle", "advance 40"],
    action: ["select 157,150", "advance 0.3", "key a", "click 157,110", "advance 5"] },
  { ...FH, id: "clip-airstrike", kind: "clip", camera: { x: 191, y: 150, scale: 3 }, crop: MAP, seconds: 6,
    setup: [...BASE, "ability airstrike", "battle", "advance 40"],
    action: ["tool airstrike", "click 150,150", "advance 0.4", "click 232,150", "advance 5"] },
  { ...FH, id: "clip-ac130-arrives", kind: "clip", camera: { x: 191, y: 140, scale: 2 }, crop: MAP, seconds: 6,
    setup: [...BASE, "ability gunship", "battle", "advance 30"],
    action: ["tool gunship", "click 191,150", "cursor off", "advance 5.5"] },
  { ...FH, id: "clip-c4-bridge", kind: "clip", camera: { x: 200, y: 176, scale: 5 }, crop: MAP, seconds: 5,
    setup: [...BASE, "place c4 200,178", "battle", "advance 20"],
    action: ["tool c4", "click 200,178", "advance 4.5"] },
  // ---------- 0.56: How to Play, chapters 1-6 (planning), one Fairhaven round ----------
  { ...FH, id: "howto-1-plan", kind: "shot", camera: { x: 191, y: 106, scale: 3.2 }, setup: [...BASE, "place apc 200,118", "cursor off"] },
  { ...FH, id: "howto-1-battle", kind: "shot", camera: { x: 191, y: 112, scale: 2.2 }, crop: MAP, setup: [...BASE, "battle", "advance 75", "cursor off"] },
  { ...FH, id: "howto-2-night", kind: "shot", startMin: 1380, camera: { x: 200, y: 130, scale: 2.4 }, crop: MAP, setup: ["cursor off"] },
  { ...FH, id: "howto-2-day", kind: "shot", startMin: 600, camera: { x: 200, y: 130, scale: 2.4 }, crop: MAP, setup: ["cursor off"] },
  { ...FH, id: "howto-3-map", kind: "shot", camera: { x: 200, y: 130, scale: 2.4 }, crop: MAP, setup: ["cursor off"] },
  { ...FH, id: "howto-3-heights", kind: "shot", camera: { x: 191, y: 106, scale: 3.2 }, crop: MAP, setup: ["key j", "cursor off"] },
  { ...FH, id: "howto-4-good", kind: "shot", camera: { x: 191, y: 106, scale: 3.6 }, crop: MAP, setup: [ZONE, "tool zone", "hover 191,106"] },
  { ...FH, id: "howto-4-big", kind: "shot", camera: { x: 191, y: 112, scale: 2.2 }, crop: [0, 0, 960, 338], setup: ["zone 120,60 270,60 270,165 120,165", "cursor off"] },
  { ...FH, id: "howto-5-gates", kind: "shot", camera: { x: 212, y: 104, scale: 8 }, crop: MAP, setup: [ZONE, "gate 217,98", "cursor off"] },
  { ...FH, id: "howto-6-ranges", kind: "shot", camera: { x: 186, y: 100, scale: 3.4 }, crop: MAP, setup: [...BASE, "key n", "cursor off"] },
  { ...FH, id: "howto-6-sniper", kind: "shot", camera: { x: 186, y: 88, scale: 6 }, crop: MAP, setup: [ZONE, "tool sniper", "hover 186,78"] },
  // ---------- 0.56: How to Play, chapters 7-12 (the battle) ----------
  { ...FH, id: "howto-7-streets", kind: "shot", camera: { x: 214, y: 100, scale: 5 }, crop: MAP, setup: [ZONE, "place turret 223,98", "place tank 223,112", "place apc 200,118", "cursor off"] },
  { ...FH, id: "howto-8-padcost", kind: "shot", camera: { x: 191, y: 108, scale: 4.5 }, crop: MAP, setup: [ZONE, "place evac 191,106", "place evac 205,120", "tool evac", "hover 178,120"] },
  { ...FH, id: "howto-9-alert", kind: "clip", camera: { x: 191, y: 110, scale: 2.6 }, crop: MAP, seconds: 6, setup: [...BASE, "battle", "advance 4"], action: ["advance 6"] },
  { ...FH, id: "howto-10-late", kind: "shot", camera: { x: 191, y: 110, scale: 2.6 }, crop: MAP, setup: [...BASE, "battle", "advance 100", "cursor off"] },
  { ...FH, id: "howto-10-locked", kind: "shot", camera: { x: 191, y: 110, scale: 2.6 }, crop: MAP, setup: [...BASE, "battle", "advance 45", "key l", "advance 55", "cursor off"] },
  { ...FH, id: "howto-11-menu", kind: "shot", camera: { x: 191, y: 106, scale: 4 }, crop: [455, 338, 505, 178], setup: [...BASE, "battle", "advance 5", "key b", "cursor off"] },
  { ...FH, id: "howto-11-nofire", kind: "shot", camera: { x: 191, y: 112, scale: 4 }, crop: MAP, setup: [...BASE, "ability airstrike", "battle", "advance 20", "tool airstrike", "hover 191,124"] },
  // 0.57: the after-action report (a bigger window: the report is a full-screen page)
  { ...FH, id: "end-report-overview", kind: "shot", size: [1600, 900], crop: [40, 20, 1520, 800], camera: { x: 191, y: 106, scale: 3 }, setup: [...BASE, "battle", "advance 240", "endround", "report overview", "cursor off"] },
  { ...FH, id: "end-report-town", kind: "shot", size: [1600, 900], crop: [40, 20, 1520, 800], camera: { x: 191, y: 106, scale: 3 }, setup: [...BASE, "battle", "advance 240", "endround", "report town", "cursor off"] },
  // 0.58: Statistics after two Fairhaven battles (kept in memory in shot mode)
  // 0.60: supply
  { ...FH, id: "inventory-window", kind: "shot", size: [1600, 900], crop: [380, 56, 840, 300], camera: { x: 191, y: 106, scale: 3 },
    setup: [...BASE, "place mortar 196,112", "battle", "advance 40", "ammo turret 300", "supply small 3", "advance 4", "key i", "cursor off"] },
  { ...FH, id: "engineer-carry", kind: "shot", camera: { x: 192, y: 93, scale: 18 }, crop: MAP, // frame-exact: at 46 s two engineers carry crates around (197,90) and (177,98)
    setup: [...BASE, "battle", "advance 30", "ammo turret 200", "ammo garrison 100", "ammo sniper 10", "advance 16", "cursor off"] },
  { ...FH, id: "chinook-drop", kind: "shot", camera: { x: 191, y: 106, scale: 4 }, crop: MAP,
    setup: [...BASE, "battle", "advance 20", "supply small 4", "advance 18", "store 4", "cursor off"] },
  { ...FH, id: "stats-achievements", kind: "shot", size: [1600, 900], crop: [80, 16, 1440, 868], camera: { x: 191, y: 106, scale: 3 },
    setup: [...BASE, "battle", "advance 240", "endround", "stats achievements", "cursor off"] },
  { ...FH, id: "stats-career", kind: "shot", size: [1600, 900], crop: [80, 16, 1440, 868], camera: { x: 191, y: 106, scale: 3 },
    setup: [...BASE, "battle", "advance 240", "endround", "retry", ...BASE, "battle", "advance 240", "endround", "stats career", "cursor off"] },
  // 0.62: Battle Events (the mutator is on for this one; the alert key takes the camera to the event)
  { ...FH, id: "bev-card", kind: "shot", mutators: ["battle_events"], camera: { x: 191, y: 106, scale: 4 }, setup: [...BASE, "battle", "advance 4", "bev mayor", "advance 1", "key `", "advance 0.5", "cursor off"] },
  { ...FH, id: "howto-12-pause", kind: "shot", camera: { x: 191, y: 106, scale: 3 }, setup: [...BASE, "battle", "advance 10", "key Escape", "cursor off"] },
];
