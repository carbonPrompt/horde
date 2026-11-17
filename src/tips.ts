// 0.41: one-line tips the first time a mechanic shows up (once per save, with a Tips switch in Settings).
// main.ts calls tip(id) at the moment the thing happens; shouldTip decides; the text goes to the ticker.
export const TIPS = {
  horde: "Hordes walk in along highways, rail lines, bridges and the river. The amber arrow shows where the next one comes in.",
  ammo: "Units outside your zone run out of ammo. Supply drops and a Supply depot keep them firing.",
  people: "Move/Aim selected: click a white dot to see who that person is. Follow keeps the camera on them.",
  targeting: "Move/Aim: click one of your units to change what it shoots first (nearest, closest to the walls, or chasers).",
  mobile: "Order sends an APC, tank, squad or boat to a spot. Q (Recall) pulls mobile units into the zone; Q again sends them back.",
  sell: "Selling mid-battle sends a helicopter to pull the unit out first. You get its cost back when it's out.",
  padCost: "Each extra Evac Point costs double the last one. Spread them where the crowd will be.",
  waveOff: "A lift waved off: infected were too close to the pad. Keep the area around Evac Points clear.",
  c4: "C4 is planted. Click it again during the battle to blow it: bridges drop into the river, buildings collapse into rubble.",
  endRound: "Only stragglers are left. End round (top bar) scores the round now; people in the zone count as saved.",
  views: "J shows building heights, R shows unit ranges, H shows where your kills happen.",
  quickbar: "Drag a tool onto the quick bar (Z to M) to keep it one key away.",
  refuse: "Some people refuse to leave (amber rings). Park a unit next to them for a while to talk them out.",
} as const;
export type TipId = keyof typeof TIPS;
export const TIP_IDS = Object.keys(TIPS) as TipId[];

/** Show tip `id` now? Once per save, never under the tutorial banner, never with tips switched off. */
export function shouldTip(id: TipId, seen: readonly string[], tutorialOn: boolean, tipsOn: boolean): boolean {
  return tipsOn && !tutorialOn && !seen.includes(id);
}
