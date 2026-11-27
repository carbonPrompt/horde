// 0.64: battle music rotates per level. Each level plays one track on loop; the next level picks at random
// from the tracks not heard yet in this round of the rotation; when all have played, the rotation starts over.

/** How many battle tracks there are (assets/music/battle-1.ogg .. battle-N.ogg). */
export const BATTLE_TRACKS = 4;

export class Playlist {
  private left: number[] = [];
  constructor(private n = BATTLE_TRACKS, private rnd: () => number = Math.random) {}
  /** The track (1..n) for the next level. */
  next(): number {
    if (!this.left.length) this.left = Array.from({ length: this.n }, (_, i) => i + 1);
    const i = Math.min(this.left.length - 1, Math.floor(this.rnd() * this.left.length));
    return this.left.splice(i, 1)[0];
  }
}
