// 0.35: the City 1 guided tutorial as a pure step machine. main.ts gathers TutState each frame, shows the current
// step's text and highlight, and offers Skip (prompts off for this run; the battle still counts).
import type { Rect, Stand } from "./cities/recipe";

export interface TutState { zoneCells: number; zoneOverlap: number; gates: number; garrisons: number; snipers: number; evacs: number; phase: "plan" | "battle" | "over"; lifts: number }
export type TutStep = { id: string; text: string; highlight?: { kind: "rect" | "tool"; rect?: Rect; tool?: string }; done: (s: TutState) => boolean };

/** The steps, pointing at the tutorial's stand point (its park). */
export function tutorialSteps(target: Stand): TutStep[] {
  const park: Rect = { x: Math.round(target.x - target.r * 0.9), y: Math.round(target.y - target.r * 0.7), w: Math.round(target.r * 1.8), h: Math.round(target.r * 1.4) };
  return [
    { id: "pan", text: "Drag to look around. Scroll to zoom. Press Next when you're ready.", done: () => false },
    { id: "zone", text: "Draw your safe zone over the highlighted park: pick Safe Zone, then click its corners. Take in the rooftops around the park too. Support buildings only go on roofs inside your zone, and Evac Points need a roof, street or park inside it.", highlight: { kind: "rect", rect: park }, done: s => s.zoneOverlap >= 0.6 },
    { id: "gates", text: "Gates are where people get in. Your zone made some on its edge; the Gate tool adds more.", highlight: { kind: "tool", tool: "gate" }, done: s => s.gates >= 1 },
    { id: "garrison", text: "Put a Garrison on a rooftop next to the zone. Soldiers on roofs shoot over the crowd.", highlight: { kind: "tool", tool: "garrison" }, done: s => s.garrisons >= 1 },
    { id: "sniper", text: "Snipers see farther from tall buildings. Place one on a high roof.", highlight: { kind: "tool", tool: "sniper" }, done: s => s.snipers >= 1 },
    { id: "evac", text: "Place an Evac Point inside the zone. Helicopters fly people out from it.", highlight: { kind: "tool", tool: "evac" }, done: s => s.evacs >= 1 },
    { id: "start", text: "Press Start when you're ready.", done: s => s.phase !== "plan" },
    { id: "lift", text: "People are heading for the zone. Watch the first lift.", done: s => s.lifts >= 1 },
    { id: "end", text: "That's the game. Hold until everyone left alive is out.", done: () => false },
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
