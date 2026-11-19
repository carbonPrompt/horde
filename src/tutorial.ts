// 0.35: the City 1 guided tutorial as a pure step machine. main.ts gathers TutState each frame, shows the current
// step's text and highlight, and offers Skip (prompts off for this run; the battle still counts).
import type { Rect, Stand } from "./cities/recipe";

export interface TutState {
  zoneCells: number; zoneOverlap: number; gates: number; garrisons: number; snipers: number; evacs: number; phase: "plan" | "battle" | "over"; lifts: number;
  // 0.41: gate cells the player flipped to wall / back to gate, gate cells still open, strikes called in battle, a person
  // window opened, speed changed or paused in battle, share of people safe, a horde announced, seconds this step has shown
  toWall: number; toGate: number; gatesOpen: number; strikes: number; personOpened: boolean; speedChanged: boolean; safeShare: number; hordeAnnounced: boolean; stepT: number;
}
export type TutHighlight = { kind: "rect"; rect: Rect } | { kind: "tool"; tool: string } | { kind: "button"; button: string };
/** done: the step is finished. show (optional): while false the step stays current but its banner is hidden. */
export type TutStep = { id: string; text: string; highlight?: TutHighlight; done: (s: TutState) => boolean; show?: (s: TutState) => boolean };

/** The steps, pointing at the tutorial's stand point (its park plus the ring of building blocks around it). */
export function tutorialSteps(target: Stand): TutStep[] {
  const park: Rect = { x: Math.round(target.x - target.r * 1.7), y: Math.round(target.y - target.r * 1.3), w: Math.round(target.r * 3.4), h: Math.round(target.r * 2.6) };
  return [
    // planning
    { id: "look", text: "Right-drag or WASD moves the map; the mouse wheel zooms. Press Next when you're ready.", done: () => false },
    { id: "zone", text: "Draw your safe zone around the highlighted park: pick Safe Zone and click its corners, taking in the rooftops around it (the cost shows next to the cursor). Click the first corner again (or press Enter) to close it.", highlight: { kind: "rect", rect: park }, done: s => s.zoneOverlap >= 0.6 },
    { id: "wall", text: "Blue crossings are gates: people get in, infected don't, but gates break sooner. White is wall: stronger, and nobody passes, your own tanks included. Pick Gate and click a blue crossing to wall it off.", highlight: { kind: "tool", tool: "gate" }, done: s => s.toWall >= 1 },
    { id: "reopen", text: "Click it again to open it. You can flip gates any time, even mid-battle (they take a few seconds to swing).", highlight: { kind: "tool", tool: "gate" }, done: s => s.toGate >= 1 },
    { id: "garrison", text: "Put a Garrison on a rooftop next to the zone. Soldiers on roofs shoot over the crowd. Wrong spot? Click it with Move/Aim and press Delete for a full refund.", highlight: { kind: "tool", tool: "garrison" }, done: s => s.garrisons >= 1 },
    { id: "sniper", text: "Snipers see farther from tall buildings. Press J to see building heights, then put one on a high roof.", highlight: { kind: "tool", tool: "sniper" }, done: s => s.snipers >= 1 },
    { id: "evac", text: "Place an Evac Point inside the zone. Helicopters fly people out from it.", highlight: { kind: "tool", tool: "evac" }, done: s => s.evacs >= 1 },
    { id: "start", text: "Press START BATTLE when you're ready.", highlight: { kind: "button", button: "startbtn" }, done: s => s.phase !== "plan" },
    // battle
    { id: "alert", text: "Everyone got the phone alert. People head for your zone; some go home first to gather family. Watch the first lift.", done: s => s.lifts >= 1 || s.stepT > 60 },
    { id: "speed", text: "1, 2 and 3 set the speed; Space pauses. Pause any time to think.", done: s => s.speedChanged },
    { id: "close", text: "A horde is on its way. When most people are in, close the gates before it reaches them: press L (Lock Gates).", highlight: { kind: "button", button: "closegates" }, done: s => s.gatesOpen === 0, show: s => s.safeShare >= 0.6 || s.hordeAnnounced },
    { id: "strike", text: "Pick Airstrike (under Air). Click where the run starts, then where it ends, away from your people: strikes can't land within 30 m of them.", highlight: { kind: "tool", tool: "airstrike" }, done: s => s.strikes >= 1 },
    { id: "money", text: "Every 10 seconds you earn money for everyone safe. Spend it on more units or strikes any time.", done: s => s.stepT >= 12 },
    { id: "people", text: "Pick Move/Aim and click a white dot. That's a person, with a family and a story. Follow keeps the camera on them.", highlight: { kind: "tool", tool: "pan" }, done: s => s.personOpened || s.stepT > 60 },
    { id: "finish", text: "That's the game. Hold until everyone left alive is out, or press End round when only stragglers are left.", done: () => false, show: s => s.stepT < 20 },
  ];
}

/** Index of the first step at or after `from` that isn't done (the last step once everything is). */
export function currentStep(steps: TutStep[], s: TutState, from: number): number {
  for (let i = Math.max(0, from); i < steps.length; i++) if (!steps[i].done(s)) return i;
  return steps.length - 1;
}

/** 0.35 (final review): the tutorial runs on City 1 until the player has a medal there, or when they ask to replay
 *  it; never in a daily or on another city. A saved plan doesn't stop it (steps already done are skipped). */
export function wantTutorial(o: { first: boolean; medal: boolean; daily: boolean; replay: boolean }): boolean {
  return o.first && !o.daily && (o.replay || !o.medal);
}
