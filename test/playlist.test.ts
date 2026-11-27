import { expect, test } from "bun:test";
import { Playlist, BATTLE_TRACKS } from "../src/playlist";
import { readFileSync } from "fs";

test("each round of the rotation plays every track once, in random order", () => {
  const p = new Playlist(4);
  for (let round = 0; round < 25; round++) {
    const seen = [p.next(), p.next(), p.next(), p.next()];
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  }
});
test("random 0.999 never overruns the list", () => {
  const p = new Playlist(4, () => 0.999999);
  expect([p.next(), p.next(), p.next(), p.next()]).toEqual([4, 3, 2, 1]);
});
test("battle starts pick the next track; zombie sounds are off", () => {
  const main = readFileSync("src/main.ts", "utf8"), audio = readFileSync("src/audio.ts", "utf8"), build = readFileSync("build.ts", "utf8");
  expect(main.split("snd.music(`battle-${playlist.next()}`)").length - 1).toBe(2);
  expect(main).not.toContain('snd.music("battle")');
  expect(audio).toContain("const ZOMBIE_SOUNDS = false;");
  for (let i = 1; i <= BATTLE_TRACKS; i++) expect(build).toContain(`"battle-${i}"`);
});
