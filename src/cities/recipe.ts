// 0.35: a designed city is plain data. buildCity (build.ts) turns it into a CityMap; checkCity (check.ts) measures
// it against the campaign rules (water, grid streets, stand points, one land mass, ways in).

export type Rect = { x: number; y: number; w: number; h: number };

/** Water. A river runs the length of the map along `axis` ("x": east-west band at y = at); `bends` are
 *  [position along the river, offset] steps (the river shifts by `offset` cells from that position on), drawn
 *  as axis-aligned steps, never diagonals. A sea fills one side of the map `depth` cells deep. `rough` lets a
 *  bank wander up to that many cells (smooth noise) so water looks natural; streets stay a grid. */
export type Water =
  | { kind: "river"; axis: "x" | "y"; at: number; width: number; bends?: [number, number][]; rough?: number }
  | { kind: "lake"; rect: Rect; round?: boolean; rough?: number }
  | { kind: "sea"; side: "n" | "s" | "e" | "w"; depth: number; coves?: Rect[]; rough?: number }
  | { kind: "area"; rects: Rect[] };

/** Street grid: blocks of block[0] x block[1] cells, streets `street` wide, every avenueEvery-th street an avenue
 *  `avenue` wide. */
export interface Grid { block: [number, number]; street: number; avenueEvery: number; avenue: number }

/** A candidate safe-zone centre and radius, in cells. Never shown to the player (except the tutorial's). */
export interface Stand { name: string; x: number; y: number; r: number }

export interface CityRecipe {
  id: string;
  w: number;
  h: number;
  seed: number;
  grid: Grid;
  water: Water[];
  /** Wide streets: a band `width` cells wide along `axis` ("x" = east-west at y = at). */
  boulevards?: { axis: "x" | "y"; at: number; width: number }[];
  parks: Rect[];
  /** Share of grid blocks turned into small parks and plazas (texture, extra open ground). Default 0. */
  pocketParks?: number;
  stadiums?: Rect[];
  /** Building heights in levels; later districts win where they overlap. Default [1, 3]. */
  districts: { rect: Rect; levels: [number, number] }[];
  /** Bridge points: a bridge is built across the water at the street nearest each point. */
  bridges: { x: number; y: number }[];
  rail?: { axis: "x" | "y"; at: number; stations: number[] };
  highway?: { axis: "x" | "y"; at: number };
  stands: Stand[];
}
