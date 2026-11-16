// 0.36 real cities: the 13 cities and their set battle areas (design 2026-11-12). The capture tool bakes
// each area from OpenStreetMap; the game reads the baked data plus these knobs. Centres may move up to 400 m in the
// bake's eyeball pass; ids never change once shipped (bests and plans are keyed by them).
import type { LatLon } from "./geo";

export interface AreaSpec { id: string; name: string; at: LatLon; angle?: number; water: boolean; budget?: number; waveMul?: number; sites?: number; stands?: string[] }
export interface CitySpec {
  id: string; name: string; seed: number; osmRelation: number | null; boundaryQuery: string; diagonals: string[]; seaPoints: LatLon[];
  trial: string; budget: number; waveMul: number; sites: number; speedMul: number; blurb: string; areas: AreaSpec[];
}

const slug = (s: string) => s.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Areas whose box has no river, lake, bay or ocean in it. */
const DRY = new Set([
  "Midtown and Times Square", "Central Park South", "Hollywood", "Dodger Stadium and Echo Park", "Griffith Park and Los Feliz",
  "Exposition Park", "Mission and Dolores Park", "Haight and Golden Gate Park", "Dupont Circle", "Wrigley Field",
  "Little Havana", "Wynwood", "loanDepot park", "Founders Parkway", "The Meadows", "Metzler Ranch", "Rock Park", "Montmartre",
  "Arc de Triomphe", "Midtown Crossing", "Elmwood Park", "Henry Doorly Zoo", "Civic Center and the Capitol",
  "Oakland and Schenley Park", "Downtown and Wilcox Street", "Festival Park and Plum Creek", // Plum Creek is a creek, not playable water
  "Capitol and the Mall", "White House and Lafayette Square", "Charles Schwab Field", "Providence Park",
]);
const a = (name: string, lat: number, lon: number): AreaSpec => ({ id: slug(name), name, at: [lat, lon], water: !DRY.has(name) });

export const CATALOGUE: CitySpec[] = [
  {
    id: "manhattan", name: "New York, NY", seed: 10038, osmRelation: null, boundaryQuery: "New York City, New York, USA",
    diagonals: ["Broadway"], seaPoints: [[40.6, -74.04], [40.643, -74.071]], trial: "nuke", budget: 250_000_000, waveMul: 3.0, sites: 6, speedMul: 1.12,
    blurb: "All five boroughs. Skyscraper canyons, Central Park and the bridges over the East River.",
    areas: [
      a("Lower Manhattan and Brooklyn Bridge", 40.7075, -74.0045), a("Midtown and Times Square", 40.757, -73.986),
      { ...a("Central Park South", 40.768, -73.976), waveMul: 2.2 }, a("Harlem and the Upper Park", 40.801, -73.951),
      a("Downtown Brooklyn and DUMBO", 40.6992, -73.9903), a("Long Island City", 40.748, -73.948),
      { ...a("Yankee Stadium", 40.8296, -73.9262), waveMul: 1.8 }, { ...a("St. George, Staten Island", 40.643, -74.077), waveMul: 1.8 },
    ],
  },
  {
    id: "los-angeles", name: "Los Angeles, CA", seed: 90012, osmRelation: null, boundaryQuery: "Los Angeles, California, USA",
    diagonals: ["Sunset Boulevard"], seaPoints: [[33.95, -118.55], [33.983, -118.474], [33.738, -118.276]], trial: "gunship", budget: 120_000_000, waveMul: 2.0, sites: 5, speedMul: 1.05,
    blurb: "Downtown towers, Hollywood, the beach and the port, tied together by freeways.",
    areas: [
      { ...a("Downtown", 34.05, -118.25), water: false }, a("Hollywood", 34.101, -118.329), a("Venice Beach", 33.986, -118.469),
      a("Exposition Park", 34.014, -118.288), a("Dodger Stadium and Echo Park", 34.0739, -118.24),
      a("Griffith Park and Los Feliz", 34.11, -118.29), a("San Pedro Waterfront", 33.738, -118.2825),
    ],
  },
  {
    id: "san-francisco", name: "San Francisco, CA", seed: 94105, osmRelation: null, boundaryQuery: "San Francisco, California, USA",
    diagonals: [], seaPoints: [[37.8, -122.5], [37.8, -122.37], [37.796, -122.39], [37.81, -122.42], [37.811, -122.412], [37.777, -122.385], [37.808, -122.437]], trial: "battleship", budget: 90_000_000, waveMul: 1.7, sites: 5, speedMul: 1.05,
    blurb: "Water on three sides. Piers, tight grids and Golden Gate Park.",
    areas: [
      a("Financial District and Ferry Building", 37.794, -122.395), a("Fisherman's Wharf", 37.808, -122.417),
      a("Mission and Dolores Park", 37.76, -122.426), a("Haight and Golden Gate Park", 37.77, -122.454),
      a("SoMa and Oracle Park", 37.7786, -122.3893), a("The Marina", 37.8048, -122.437),
    ],
  },
  {
    id: "washington", name: "Washington, DC", seed: 20004, osmRelation: null, boundaryQuery: "Washington, District of Columbia, USA",
    diagonals: ["Pennsylvania Avenue Northwest", "Pennsylvania Avenue Southeast", "Massachusetts Avenue Northwest", "Connecticut Avenue Northwest",
      "New York Avenue Northwest", "Vermont Avenue Northwest", "New Hampshire Avenue Northwest", "Rhode Island Avenue Northwest"],
    seaPoints: [], trial: "apache", budget: 100_000_000, waveMul: 1.8, sites: 5, speedMul: 1.05,
    blurb: "The Mall, the Capitol and the White House, with the great avenues cutting across the grid.",
    areas: [
      a("Capitol and the Mall", 38.8895, -77.0135), a("White House and Lafayette Square", 38.899, -77.037), a("Navy Yard", 38.8748, -77.007),
      a("Georgetown Waterfront", 38.904, -77.063), a("Dupont Circle", 38.91, -77.043), a("RFK and the Anacostia", 38.89, -76.972),
    ],
  },
  {
    id: "boston", name: "Boston, MA", seed: 2108, osmRelation: null, boundaryQuery: "Boston, Massachusetts, USA",
    diagonals: [], seaPoints: [[42.34, -70.98], [42.3645, -71.045], [42.3545, -71.041], [42.372, -71.052]], trial: "tomahawk", budget: 90_000_000, waveMul: 1.7, sites: 4, speedMul: 1.05,
    blurb: "Old crooked streets, the Common, the harbor and the Charles River.",
    areas: [
      a("Common and Beacon Hill", 42.357, -71.066), a("Back Bay and the Esplanade", 42.351, -71.081), a("North End", 42.364, -71.054),
      { ...a("Fenway", 42.3467, -71.0972), waveMul: 1.0 }, { ...a("Seaport", 42.3515, -71.042), waveMul: 0.7 }, a("Charlestown Navy Yard", 42.3755, -71.056),
    ],
  },
  {
    id: "chicago", name: "Chicago, IL", seed: 60601, osmRelation: null, boundaryQuery: "Chicago, Illinois, USA",
    diagonals: ["North Milwaukee Avenue", "North Clark Street", "North Lincoln Avenue", "South Archer Avenue", "North Elston Avenue"],
    seaPoints: [[41.9, -87.58], [41.878, -87.614], [41.892, -87.608], [41.921, -87.626], [41.863, -87.609]], trial: "command", budget: 150_000_000, waveMul: 2.2, sites: 5, speedMul: 1.05,
    blurb: "The Loop and the river, the lakefront parks, and deep canyon streets with high-rise sniper perches.",
    areas: [
      { ...a("The Loop and the River", 41.885, -87.635), waveMul: 1.5 }, a("Grant Park", 41.878, -87.621), a("Navy Pier and Streeterville", 41.892, -87.615),
      { ...a("Wrigley Field", 41.9484, -87.6553), waveMul: 1.8 }, a("Lincoln Park", 41.9235, -87.634), a("Museum Campus", 41.863, -87.617),
    ],
  },
  {
    id: "denver", name: "Denver, CO", seed: 80202, osmRelation: null, boundaryQuery: "Denver, Colorado, USA",
    diagonals: [], seaPoints: [], trial: "a10", budget: 60_000_000, waveMul: 1.3, sites: 4, speedMul: 1.0,
    blurb: "Downtown's turned grid where Cherry Creek meets the South Platte, and the big parks east of it.",
    areas: [
      a("LoDo and Confluence Park", 39.754, -105.006), { ...a("Civic Center and the Capitol", 39.739, -104.987), waveMul: 0.7, sites: 3 }, a("City Park", 39.748, -104.95),
      a("Washington Park", 39.7, -104.971), a("Empower Field and Sloan's Lake", 39.744, -105.022), a("RiNo", 39.769, -104.98),
    ],
  },
  {
    id: "omaha", name: "Omaha, NE", seed: 68102, osmRelation: null, boundaryQuery: "Omaha, Nebraska, USA",
    diagonals: [], seaPoints: [], trial: "tank", budget: 40_000_000, waveMul: 1.1, sites: 4, speedMul: 1.0,
    blurb: "Wide streets, the Old Market and the Missouri River.",
    areas: [
      a("Downtown and the Riverfront", 41.258, -95.93), a("Old Market", 41.2555, -95.931), a("Charles Schwab Field", 41.267, -95.932),
      a("Midtown Crossing", 41.258, -95.967), a("Elmwood Park", 41.244, -96.012), a("Henry Doorly Zoo", 41.225, -95.928),
    ],
  },
  {
    id: "miami", name: "Miami, FL", seed: 33131, osmRelation: null, boundaryQuery: "Miami, Florida, USA",
    diagonals: [], seaPoints: [[25.76, -80.15], [25.775, -80.183], [25.765, -80.186], [25.726, -80.233]], trial: "himars", budget: 80_000_000, waveMul: 1.6, sites: 5, speedMul: 1.05,
    blurb: "Towers on Biscayne Bay, the Miami River and low, packed neighborhoods.",
    areas: [
      a("Downtown and Bayfront Park", 25.775, -80.189), a("Brickell", 25.765, -80.191), a("Little Havana", 25.766, -80.219),
      a("Wynwood", 25.801, -80.199), a("loanDepot park", 25.778, -80.22), a("Coconut Grove", 25.7295, -80.2395),
    ],
  },
  {
    id: "castle-rock", name: "Castle Rock, CO", seed: 80104, osmRelation: null, boundaryQuery: "Castle Rock, Colorado, USA",
    diagonals: [], seaPoints: [], trial: "reaper", budget: 20_000_000, waveMul: 0.85, sites: 3, speedMul: 0.95,
    blurb: "A small town along Plum Creek. Open avenues and low roofs.",
    areas: [
      a("Downtown and Wilcox Street", 39.372, -104.859), a("Festival Park and Plum Creek", 39.374, -104.862), a("Rock Park", 39.379, -104.848),
      a("Founders Parkway", 39.403, -104.863), a("The Meadows", 39.411, -104.892), a("Metzler Ranch", 39.399, -104.832),
    ],
  },
  {
    id: "portland", name: "Portland, OR", seed: 97204, osmRelation: null, boundaryQuery: "Portland, Oregon, USA",
    diagonals: [], seaPoints: [], trial: "cluster", budget: 50_000_000, waveMul: 1.3, sites: 4, speedMul: 1.0,
    blurb: "Small downtown blocks split by the wide Willamette River and its bridges.",
    areas: [
      a("Downtown and Pioneer Square", 45.519, -122.679), a("Waterfront Park", 45.517, -122.671), a("Pearl District", 45.528, -122.682),
      a("Lloyd District and Moda Center", 45.531, -122.667), a("Providence Park", 45.521, -122.692), a("South Waterfront", 45.502, -122.668),
    ],
  },
  {
    id: "pittsburgh", name: "Pittsburgh, PA", seed: 15222, osmRelation: null, boundaryQuery: "Pittsburgh, Pennsylvania, USA",
    diagonals: [], seaPoints: [], trial: "moab", budget: 70_000_000, waveMul: 1.6, sites: 5, speedMul: 1.08,
    blurb: "Three rivers, the Golden Triangle and a web of steel bridges.",
    areas: [
      a("Point State Park", 40.4415, -80.006), a("Market Square", 40.4405, -79.999), { ...a("North Shore", 40.447, -80.008), waveMul: 0.5, sites: 2 },
      a("Strip District", 40.451, -79.983), { ...a("Oakland and Schenley Park", 40.4435, -79.953), waveMul: 1.1 }, a("South Side Flats", 40.429, -79.98),
    ],
  },
  {
    id: "paris", name: "Paris, France", seed: 75004, osmRelation: null, boundaryQuery: "Paris, Ile-de-France, France",
    diagonals: ["Avenue des Champs-Élysées", "Boulevard Haussmann", "Boulevard Saint-Germain", "Avenue de l'Opéra", "Avenue de la Grande Armée",
      "Boulevard Voltaire", "Avenue Kléber", "Avenue Marceau"],
    seaPoints: [], trial: "police", budget: 180_000_000, waveMul: 2.6, sites: 6, speedMul: 1.1,
    blurb: "The Seine and its islands, the grand boulevards and the hill of Montmartre.",
    areas: [
      a("Ile de la Cite", 48.8545, 2.347), { ...a("Louvre and Tuileries", 48.862, 2.333), waveMul: 1.0, sites: 3 }, a("Champ de Mars", 48.858, 2.2945),
      a("Arc de Triomphe", 48.8738, 2.295), a("Bastille", 48.853, 2.369), a("Montmartre", 48.8865, 2.343), a("Bercy", 48.8385, 2.3785),
    ],
  },
];
