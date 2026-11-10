# Horde

A free zombie-outbreak strategy game that runs in your browser. Hold a city, get people out.

**Play in your browser:** https://carbonprompt.github.io/horde/ (Windows players can grab the installer from the
Releases page instead.)

## How it plays

- **Plan.** Draw a safe zone around city blocks, set gates and walls, place units on rooftops and streets, and build
  Evac Points (rooftop helipads) inside the zone. Each extra pad costs twice the last.
- **Pick a difficulty.** Easy, Medium, Hard or Insane. Harder means more outbreak sites and bigger, more frequent
  hordes. Every city keeps its own medals for each difficulty.
- **Warning.** An emergency broadcast goes out and people head for your zones. Nobody knows where it starts.
- **Outbreak.** After 20 seconds the first cases turn somewhere outside your zones and it spreads person to person.
- **Hordes.** Then hordes walk in from outside the city on real land routes (highways, rail, bridges; swimmers use
  the river). They come almost on a rhythm, but not quite, and grow bigger and more frequent as time passes and the
  city empties.
- **Round end.** The round ends when everyone left alive is out. You get a score out of 100 (people saved, speed,
  city intact, zombies killed) and a medal. Then keep fighting endless, harder hordes for a Mayhem score, or end there.

Real-world prices (budgets in the millions), an arsenal from rifle squads to HIMARS, Abrams, Apaches, AC-130s and
Tomahawks (with per-battle stockpiles), strike orders, XP unlocks, achievements, daily challenges, mutators, mods
(see `MODDING.md`), and real cities from OpenStreetMap.

## Build it yourself

Requires [Bun](https://bun.sh).

```
bun build.ts        # writes dist/horde.html, a single self-contained file
bun test            # simulation tests
```

The Windows app wraps the same file in Electron; see `desktop/` (`build-win.ps1` with Inno Setup 6).

## Credits

- Built by AI agents (Claude and Gemini) and a human.
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open
  Database License (ODbL).
- Music made with ACE-Step 1.5 (MIT license).
- Sound effects made with Stable Audio Open 1.0. Powered by Stability AI. The generated sounds are covered by the
  [Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md).
