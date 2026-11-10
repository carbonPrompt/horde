/** When an aircraft's sound should start (0.19.1): not when it is ordered, but as it actually arrives. Pure. */
export interface Flight { t: number; dur: number; hoverS: number }

/** Sim seconds from spawn until the aircraft is over its target (flyovers cross it halfway; helos at the end of leg one). */
export function arriveT(f: Flight): number {
  return f.hoverS > 0 ? (f.dur - f.hoverS) / 2 : f.dur / 2;
}
/** True once the aircraft is within `leadS` real seconds of arriving at the current speed. Nothing before the clock
 *  has moved (t = 0), so ordering while paused stays silent. */
export function soundDue(f: Flight, speed: number, leadS: number): boolean {
  return f.t > 0 && f.t >= arriveT(f) - leadS * Math.max(1, speed);
}

/** How loud a sound is at the camera's zoom (0.19.1: far out you hear the nuke, not the gunfire).
 *  scale = cam.scale (about 1 = whole city, 8+ = street level). r = blast radius in cells for booms. */
export function zoomGain(kind: "shot" | "boom" | "event" | "air", r: number, scale: number): number {
  const c = Math.min(1, Math.max(0, (scale - 1.2) / 4.8)); // 0 zoomed out .. 1 from scale 6 in
  if (kind === "air") return 0.5 + 0.5 * c;
  if (kind === "boom") return r >= 20 ? 1 : r >= 5 ? 0.4 + 0.6 * c : c;
  return c * c; // gunfire and small events fade in fast as you get close
}
