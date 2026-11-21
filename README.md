# Horde

A free zombie-outbreak strategy game that runs in your browser. Hold a city, get people out.

**Play in your browser:** https://carbonprompt.github.io/horde/ (Windows players can grab the installer from the
Releases page instead. From 0.26 on, the Windows app finds new versions itself: Versions in Settings lists
every release, and Settings can install updates automatically. Your save is backed up before any switch.)

## How it plays

- **Pick a time.** The hour the sirens go off decides where people are: home at night, at work by day, on the roads
  at rush hour.
- **Plan.** Draw a safe zone around city blocks, set gates and walls, place units on rooftops and streets, and build
  Evac Points (rooftop helipads) inside the zone. Each extra pad costs twice the last, and from Medium up every extra
  unit or building of a kind costs a bit more than the one before.
- **Pick a difficulty.** Easy, Medium, Hard or Insane. Harder means more outbreak sites, bigger and more frequent
  hordes, less money, and on Hard and Insane no pause once the battle starts. Every city keeps its own medals for each
  difficulty, plus how many people you saved per $1M.
- **Warning.** An emergency broadcast goes out and people head for your zones. Nobody knows where it starts.
- **Outbreak.** After 20 seconds the first cases turn somewhere outside your zones, more outbreaks pop up around the
  city over the next stretch (more on harder difficulties), and it spreads person to person.
- **Hordes.** Then hordes walk in from outside the city on real land routes (highways, rail, bridges; swimmers use
  the river). They come almost on a rhythm, but not quite, and grow bigger and more frequent as time passes and the
  city empties.
- **Squads.** Troops are four riflemen, Sniper teams a sniper and a spotter, Paratroopers five soldiers, every one a
  dot that fires on its own. Right-click a roof and Troops walk over, climb up and fortify, out of reach of the
  infected; right-click a street and they come down and fight. Lost soldiers can be replaced mid-battle.
- **Command.** Battle groups like StarCraft: Ctrl+1 to Ctrl+0 saves a group (or a safe zone), the number selects it
  and twice jumps there, with a group bar in the corner. Select units with a click or a dragged box and give orders: right-click to move (they
  shoot what's in range on the way and never get dragged off chasing), attack-move, patrol, escort a family, stop,
  stand by, Shift to queue. A minimap sits in the top right, and the cursor label tells you what's under it and what
  things cost. The AC-130 flies in from the map edge, picks its 25 mm, 40 mm or 105 mm gun by target, and can be sent
  to a new spot or home.
- **People.** Every dot is a person with a family and a story: some go home first to gather their kids, some carry
  guns, a few refuse to leave until a unit talks them out.
- **Round end.** The round ends when everyone left alive is out. You get a score out of 100 (people saved, speed,
  city intact, zombies killed) and a medal. Then keep fighting endless, harder hordes for a Mayhem score, or end there.
- **Codex.** How to Play is a searchable codex: every rule, key and unit with pictures, short clips and diagrams.
  Unit, strike and building pages come straight from the game's stats, so they stay current (mods included).

Units take up real space: tanks and turrets block streets, infected claw at them like walls, and tanks and APCs
crush infected they drive over. Shelling leaves craters that slow everyone crossing them, buildings collapse into
rubble, and a Recall button pulls your mobile units back to the zone.

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
