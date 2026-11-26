// 0.41: one-line tips the first time a mechanic shows up (once per save, with a Tips switch in Settings).
// main.ts calls tip(id) at the moment the thing happens; shouldTip decides; the text goes to the ticker.
export const TIPS = {
  horde: "Hordes walk in along highways, rail lines, bridges and the river. The amber arrow shows where the next one comes in.",
  ammo: "A unit is low on ammo. Engineers carry crates from the zone's stock; the Inventory ({key:inventory}) shows the stock and buys more.",
  people: "Move/Aim selected: click a white dot to see who that person is. Follow keeps the camera on them.",
  targeting: "Move/Aim: click one of your units to select it, then press {key:order.target} to change what it shoots first (nearest, closest to the walls, or chasers).",
  mobile: "Mobile units take orders: select them with Move/Aim and right-click where to send them. With nothing selected, {key:tool.recall} (Recall) pulls them in; press it again to send them out.",
  sell: "Selling mid-battle sends a helicopter to pull the unit out first. You get its cost back when it's out.",
  padCost: "Each extra Evac Point costs double the last one. Spread them where the crowd will be.",
  waveOff: "A lift waved off: infected were too close to the pad. Keep the area around Evac Points clear.",
  c4: "C4 is planted. Click it again during the battle to blow it: bridges drop into the river, buildings collapse into rubble.",
  endRound: "Only stragglers are left. End round (top bar) scores the round now; people in the zone count as saved.",
  views: "{key:view.heights} shows building heights, {key:view.ranges} shows unit ranges, {key:view.heatmap} shows where your kills happen.",
  build: "Build menus: {key:menu.units} Units, {key:menu.actions} Actions, {key:menu.support} Support, then the letter on a tile. Drag a tile onto the quick bar ({key:quick.1}-{key:quick.5}). Change any key in Settings > Controls.",
  orders: "Right-click sends them. {key:order.amove} attack-move, {key:order.patrol} patrol, {key:order.escort} escort a person, {key:order.stop} stop, {key:order.standby} stand by (hold fire). Shift queues orders. {key:camera.up}{key:camera.left}{key:camera.down}{key:camera.right} always moves the camera.",
  groups: "Battle groups: select units, press Ctrl+{key:group.1} to Ctrl+{key:group.5}. Then the key alone selects them, twice jumps there. {key:squad.next} jumps to your next squad. {key:quick.1}-{key:quick.5} are the quick bar.",
  gunship: "AC-130 on station. Click the plane with Move/Aim: right-click sends it to a new spot, Delete sends it home (before it arrives: charge back).",
  refuse: "This person refuses to leave. Park a unit next to them for a while to talk them out.",
  report: "After the round, the report's Town tab tells what happened to the families. Every battle is kept in your save slot's history.", // 0.57
} as const;
export type TipId = keyof typeof TIPS;
export const TIP_IDS = Object.keys(TIPS) as TipId[];

/** Show tip `id` now? Once per save, never with tips switched off. */
export function shouldTip(id: TipId, seen: readonly string[], tipsOn: boolean): boolean {
  return tipsOn && !seen.includes(id);
}
