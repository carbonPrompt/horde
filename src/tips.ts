// 0.41: one-line tips the first time a mechanic shows up (once per save, with a Tips switch in Settings).
// main.ts calls tip(id) at the moment the thing happens; shouldTip decides; the text goes to the ticker.
export const TIPS = {
  horde: "Hordes walk in along highways, rail lines, bridges and the river. The amber arrow shows where the next one comes in.",
  ammo: "Units outside your zone run out of ammo. Supply drops and a Supply depot keep them firing.",
  people: "Move/Aim selected: click a white dot to see who that person is. Follow keeps the camera on them.",
  targeting: "Move/Aim: click one of your units to select it, then press T to change what it shoots first (nearest, closest to the walls, or chasers).",
  mobile: "Mobile units take orders: select them with Move/Aim and right-click where to send them. Q (Recall) pulls them into the zone; Q again sends them back.",
  sell: "Selling mid-battle sends a helicopter to pull the unit out first. You get its cost back when it's out.",
  padCost: "Each extra Evac Point costs double the last one. Spread them where the crowd will be.",
  waveOff: "A lift waved off: infected were too close to the pad. Keep the area around Evac Points clear.",
  c4: "C4 is planted. Click it again during the battle to blow it: bridges drop into the river, buildings collapse into rubble.",
  endRound: "Only stragglers are left. End round (top bar) scores the round now; people in the zone count as saved.",
  views: "J shows building heights, R shows unit ranges, H shows where your kills happen.",
  build: "B steps through the build tabs. Drag a tile onto the quick bar (keys 6-0); right-click a slot to give it any key.",
  orders: "Right-click sends them. Q attack-move, R patrol, E escort a person, F stop, G stand by (hold fire). Shift queues orders. WASD always moves the camera.",
  groups: "Battle groups: select units, press Ctrl+1 to Ctrl+5. Then 1-5 selects them, twice jumps there. Tab jumps to your next squad. Keys 6-0 are the quick bar.",
  gunship: "AC-130 on station. Click the plane with Move/Aim: right-click sends it to a new spot, Delete sends it home (before it arrives: charge back).",
  refuse: "This person refuses to leave. Park a unit next to them for a while to talk them out.",
} as const;
export type TipId = keyof typeof TIPS;
export const TIP_IDS = Object.keys(TIPS) as TipId[];

/** Show tip `id` now? Once per save, never under the tutorial banner, never with tips switched off. */
export function shouldTip(id: TipId, seen: readonly string[], tutorialOn: boolean, tipsOn: boolean): boolean {
  return tipsOn && !tutorialOn && !seen.includes(id);
}
