import type { CityRecipe } from "../src/cities/recipe";

// A small city with everything in it: a river along x, a round lake, a park, a stadium, two bridges, two districts.
export function fixture(): CityRecipe {
  return {
    id: "fixture", w: 160, h: 120, seed: 11,
    grid: { block: [12, 10], street: 2, avenueEvery: 3, avenue: 4 },
    water: [
      { kind: "river", axis: "x", at: 60, width: 8 },
      { kind: "lake", rect: { x: 120, y: 8, w: 22, h: 16 }, round: true },
    ],
    parks: [{ x: 18, y: 14, w: 32, h: 26 }],
    stadiums: [{ x: 70, y: 78, w: 30, h: 24 }],
    districts: [{ rect: { x: 0, y: 0, w: 160, h: 120 }, levels: [1, 3] }, { rect: { x: 50, y: 0, w: 40, h: 50 }, levels: [6, 10] }],
    bridges: [{ x: 30, y: 60 }, { x: 110, y: 60 }],
    stands: [{ name: "park", x: 34, y: 27, r: 20 }],
  };
}

