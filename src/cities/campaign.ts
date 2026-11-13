// 0.35: the nine campaign cities (design 2026-11-12). Every one is built around its water, laid out on a grid,
// and has 2 to 4 stand points with different trade-offs. Stand points are for the checker and the City 1 tutorial
// only; players are never shown them.
import type { CityRecipe, Grid } from "./recipe";

const SMALL: Grid = { block: [18, 12], street: 3, avenueEvery: 3, avenue: 6 };
const BIG: Grid = { block: [20, 14], street: 3, avenueEvery: 3, avenue: 6 };
const all = (w: number, h: number) => ({ x: 0, y: 0, w, h });

export const CAMPAIGN_RECIPES: Record<string, CityRecipe> = {
  // 1. Basics. A gentle river with three bridges; the town green on the north bank is the tutorial's stand.
  fairhaven: {
    id: "fairhaven", w: 400, h: 300, seed: 101, grid: SMALL, pocketParks: 0.04,
    water: [{ kind: "river", axis: "x", at: 172, width: 14, bends: [[150, 6], [280, -2]], rough: 3 }],
    boulevards: [{ axis: "y", at: 200, width: 7 }],
    parks: [{ x: 168, y: 88, w: 46, h: 36 }, { x: 78, y: 206, w: 40, h: 30 }],
    districts: [{ rect: all(400, 300), levels: [1, 3] }, { rect: { x: 130, y: 50, w: 130, h: 110 }, levels: [3, 7] }],
    bridges: [{ x: 60, y: 172 }, { x: 200, y: 178 }, { x: 330, y: 170 }],
    rail: { axis: "x", at: 40, stations: [80, 200, 320] },
    stands: [{ name: "Town Green", x: 191, y: 106, r: 26 }, { name: "Riverside Park", x: 98, y: 221, r: 24 }],
  },
  // 2. Coast and harbor: a wide boardwalk and a main avenue for the big units; the gunboat works the harbor.
  "pike-landing": {
    id: "pike-landing", w: 480, h: 360, seed: 202, grid: SMALL, pocketParks: 0.04,
    water: [{ kind: "sea", side: "s", depth: 58, rough: 8 }],
    boulevards: [{ axis: "x", at: 288, width: 8 }, { axis: "y", at: 240, width: 8 }],
    parks: [{ x: 196, y: 138, w: 54, h: 38 }, { x: 56, y: 56, w: 44, h: 32 }],
    stadiums: [{ x: 330, y: 118, w: 64, h: 46 }],
    districts: [{ rect: all(480, 360), levels: [1, 3] }, { rect: { x: 170, y: 190, w: 180, h: 90 }, levels: [4, 9] }],
    bridges: [],
    highway: { axis: "x", at: 24 },
    stands: [{ name: "Harbor Park", x: 223, y: 157, r: 26 }, { name: "Old Town Square", x: 78, y: 72, r: 24 }, { name: "Stadium", x: 362, y: 141, r: 30 }],
  },
  // 3. River valley: a wide river with only two bridges. Tall north bank, low south bank. Hold or blow the bridges.
  stonebridge: {
    id: "stonebridge", w: 540, h: 400, seed: 303, grid: SMALL, pocketParks: 0.04,
    water: [{ kind: "river", axis: "x", at: 200, width: 18, bends: [[180, 8], [360, -6]], rough: 3 }],
    boulevards: [{ axis: "y", at: 140, width: 7 }, { axis: "y", at: 400, width: 7 }],
    parks: [{ x: 238, y: 86, w: 52, h: 38 }, { x: 98, y: 258, w: 46, h: 36 }],
    stadiums: [{ x: 380, y: 280, w: 64, h: 46 }],
    districts: [{ rect: all(540, 400), levels: [1, 3] }, { rect: { x: 0, y: 0, w: 540, h: 185 }, levels: [4, 10] }],
    bridges: [{ x: 140, y: 200 }, { x: 400, y: 196 }],
    stands: [{ name: "North Bank Park", x: 264, y: 105, r: 26 }, { name: "Southside Park", x: 121, y: 276, r: 24 }, { name: "Stadium", x: 412, y: 303, r: 30 }],
  },
  // 4. A big lake in the middle splits the crowd: one zone can't reach everyone.
  lakemont: {
    id: "lakemont", w: 600, h: 450, seed: 404, grid: SMALL, pocketParks: 0.04,
    water: [{ kind: "lake", rect: { x: 200, y: 128, w: 200, h: 176 }, round: true, rough: 6 }],
    boulevards: [{ axis: "x", at: 116, width: 7 }, { axis: "x", at: 322, width: 7 }, { axis: "x", at: 80, width: 7 }],
    parks: [{ x: 86, y: 178, w: 48, h: 42 }, { x: 460, y: 198, w: 48, h: 42 }, { x: 268, y: 38, w: 60, h: 36 }],
    stadiums: [{ x: 268, y: 340, w: 64, h: 46 }],
    districts: [{ rect: all(600, 450), levels: [1, 3] }, { rect: { x: 180, y: 10, w: 240, h: 100 }, levels: [4, 9] }],
    bridges: [],
    rail: { axis: "x", at: 92, stations: [100, 300, 500] },
    stands: [{ name: "West Shore", x: 110, y: 199, r: 26 }, { name: "East Shore", x: 484, y: 219, r: 26 }, { name: "North Park", x: 298, y: 56, r: 26 }, { name: "Stadium", x: 300, y: 363, r: 30 }],
  },
  // 5. Peninsula: a tall downtown on the point, a channel on the west crossed by two bridges, land only to the south.
  highgate: {
    id: "highgate", w: 600, h: 450, seed: 505, grid: SMALL, pocketParks: 0.04,
    water: [{ kind: "area", rects: [{ x: 34, y: 0, w: 76, h: 450 }, { x: 34, y: 0, w: 566, h: 56 }, { x: 492, y: 0, w: 108, h: 450 }] }],
    boulevards: [{ axis: "y", at: 300, width: 8 }],
    parks: [{ x: 270, y: 88, w: 62, h: 40 }, { x: 148, y: 248, w: 48, h: 38 }, { x: 378, y: 338, w: 52, h: 40 }],
    districts: [{ rect: all(600, 450), levels: [1, 4] }, { rect: { x: 170, y: 56, w: 260, h: 150 }, levels: [8, 14] }],
    bridges: [{ x: 70, y: 150 }, { x: 70, y: 320 }],
    stands: [{ name: "The Point", x: 301, y: 108, r: 26 }, { name: "Midtown Park", x: 172, y: 267, r: 24 }, { name: "South Park", x: 404, y: 358, r: 26 }],
  },
  // 6. Estuary and harbor: a wide river runs into the sea; deep water for the battleship and gunboats.
  tidewater: {
    id: "tidewater", w: 650, h: 500, seed: 606, grid: BIG, pocketParks: 0.04,
    water: [{ kind: "sea", side: "s", depth: 80, rough: 6 }, { kind: "river", axis: "y", at: 330, width: 40, bends: [[220, -16]], rough: 3 }],
    boulevards: [{ axis: "x", at: 404, width: 8 }],
    parks: [{ x: 118, y: 148, w: 54, h: 42 }, { x: 440, y: 118, w: 54, h: 42 }],
    stadiums: [{ x: 460, y: 300, w: 64, h: 46 }],
    districts: [{ rect: all(650, 500), levels: [1, 3] }, { rect: { x: 60, y: 60, w: 230, h: 200 }, levels: [4, 10] }],
    bridges: [{ x: 330, y: 100 }, { x: 314, y: 260 }],
    rail: { axis: "x", at: 60, stations: [120, 520] },
    highway: { axis: "y", at: 600 },
    stands: [{ name: "West Park", x: 145, y: 169, r: 26 }, { name: "East Park", x: 467, y: 139, r: 26 }, { name: "Harbor Stadium", x: 492, y: 323, r: 30 }],
  },
  // 7. Archipelago: nine islands joined by bridges, a stadium on the middle one. Air units and several zones.
  "seven-isles": {
    id: "seven-isles", w: 650, h: 500, seed: 707, grid: BIG, pocketParks: 0.04,
    water: [{ kind: "area", rects: [{ x: 208, y: 0, w: 30, h: 500 }, { x: 420, y: 0, w: 30, h: 500 }, { x: 0, y: 160, w: 650, h: 28 }, { x: 0, y: 330, w: 650, h: 28 }] }],
    boulevards: [{ axis: "y", at: 560, width: 7 }],
    parks: [{ x: 58, y: 48, w: 50, h: 38 }, { x: 518, y: 398, w: 50, h: 38 }],
    stadiums: [{ x: 298, y: 228, w: 64, h: 46 }],
    districts: [{ rect: all(650, 500), levels: [1, 3] }, { rect: { x: 238, y: 188, w: 182, h: 142 }, levels: [5, 11] }],
    bridges: [{ x: 223, y: 80 }, { x: 223, y: 420 }, { x: 435, y: 250 }, { x: 435, y: 420 }, { x: 100, y: 174 }, { x: 540, y: 174 }, { x: 320, y: 344 }, { x: 100, y: 344 }],
    stands: [{ name: "Stadium Island", x: 330, y: 251, r: 30 }, { name: "North Isle", x: 83, y: 67, r: 26 }, { name: "South Isle", x: 543, y: 417, r: 26 }],
  },
  // 8. River delta: the river forks into three branches; a stadium and a rail yard on the delta. Artillery country.
  "marrow-delta": {
    id: "marrow-delta", w: 650, h: 500, seed: 808, grid: BIG, pocketParks: 0.04,
    water: [{ kind: "area", rects: [
      { x: 190, y: 0, w: 22, h: 210 }, { x: 80, y: 190, w: 132, h: 20 }, { x: 80, y: 190, w: 20, h: 310 },
      { x: 190, y: 190, w: 300, h: 20 }, { x: 470, y: 190, w: 20, h: 310 }, { x: 290, y: 200, w: 18, h: 300 },
    ] }],
    boulevards: [{ axis: "x", at: 90, width: 7 }, { axis: "y", at: 62, width: 7 }, { axis: "y", at: 172, width: 7 }],
    parks: [{ x: 12, y: 56, w: 48, h: 40 }, { x: 146, y: 326, w: 48, h: 38 }, { x: 540, y: 300, w: 50, h: 40 }],
    stadiums: [{ x: 342, y: 300, w: 64, h: 46 }],
    districts: [{ rect: all(650, 500), levels: [1, 3] }, { rect: { x: 220, y: 30, w: 260, h: 150 }, levels: [4, 9] }],
    bridges: [{ x: 200, y: 100 }, { x: 90, y: 350 }, { x: 140, y: 200 }, { x: 299, y: 300 }, { x: 299, y: 450 }, { x: 480, y: 350 }, { x: 400, y: 200 }],
    rail: { axis: "x", at: 120, stations: [100, 340, 540] },
    stands: [{ name: "Delta Stadium", x: 374, y: 323, r: 30 }, { name: "West Fields", x: 36, y: 76, r: 26 }, { name: "Delta Park", x: 170, y: 345, r: 24 }, { name: "East Bank", x: 565, y: 320, r: 26 }],
  },
  // 9. The final city: coast, river and lake together.
  "port-royal": {
    id: "port-royal", w: 650, h: 500, seed: 909, grid: BIG, pocketParks: 0.04,
    water: [
      { kind: "sea", side: "e", depth: 90, rough: 8 },
      { kind: "river", axis: "x", at: 300, width: 16, bends: [[300, -10]], rough: 3 },
      { kind: "lake", rect: { x: 110, y: 50, w: 120, h: 86 }, round: true, rough: 6 },
    ],
    boulevards: [{ axis: "y", at: 380, width: 8 }, { axis: "x", at: 194, width: 8 }],
    parks: [{ x: 300, y: 148, w: 58, h: 42 }, { x: 196, y: 388, w: 52, h: 40 }],
    stadiums: [{ x: 420, y: 360, w: 64, h: 46 }],
    districts: [{ rect: all(650, 500), levels: [1, 4] }, { rect: { x: 240, y: 90, w: 260, h: 170 }, levels: [6, 14] }],
    bridges: [{ x: 100, y: 300 }, { x: 260, y: 300 }, { x: 450, y: 290 }],
    rail: { axis: "y", at: 60, stations: [100, 420] },
    highway: { axis: "x", at: 470 },
    stands: [{ name: "Central Park", x: 329, y: 169, r: 26 }, { name: "South Park", x: 222, y: 408, r: 26 }, { name: "Harbor Stadium", x: 452, y: 383, r: 30 }],
  },
};
