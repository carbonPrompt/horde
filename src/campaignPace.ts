// 0.35: battle XP per campaign city for a player who stops when the round is won, measured with the balance bot
// on Medium (`STOP_AT_ROUND=1 DIFF=medium bun tools/balance.ts campaign --spend --support`, 2026-11-13).
export const PACE_XP: Record<string, number> = {
  fairhaven: 1955, "pike-landing": 1415, stonebridge: 2010, lakemont: 1299, highgate: 1355,
  tidewater: 1333, "seven-isles": 908, "marrow-delta": 1163, "port-royal": 1001,
};
/** XP lost for using the nuke (Port Royal lends it): the playthrough must still reach the nuke after paying it. */
export const PACE_MARGIN = 500;
/** Bot's % saved per city (the "winnable" floor test keeps every city at 15% or more). */
export const PACE_SAVED: Record<string, number> = {
  fairhaven: 59.1, "pike-landing": 34.1, stonebridge: 40.5, lakemont: 36.1, highgate: 38.9,
  tidewater: 35.4, "seven-isles": 16.9, "marrow-delta": 28.5, "port-royal": 22.2,
};
/** 0.35.1: hordes survived by round end per city (same bot run). A bronze-only player's round XP is taken as
 *  BRONZE_SCORE x 10 + waves x 20 (sim.ts round XP on Medium, no bonus): the floor the unlock curve is paced on. */
export const PACE_WAVES: Record<string, number> = {
  fairhaven: 58, "pike-landing": 39, stonebridge: 67, lakemont: 33, highgate: 34,
  tidewater: 33, "seven-isles": 19, "marrow-delta": 26, "port-royal": 22,
};
export const BRONZE_SCORE = 10;
