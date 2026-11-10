# Modding Horde

Horde is meant to be changed. Every number in the game, and the names and descriptions of its hardware, can be
overridden with a plain JSON file. No code, no tools: a text editor is enough.

## Quick start

1. Open **Settings** and press **Export default stats**. You get `horde-default-stats.json`: every value in the game
   as it is right now.
2. Copy it, delete everything you don't want to change, and edit the rest.
3. Install it:
   - **Windows app:** Settings > **Open mods folder**, drop the file in, restart the game.
   - **Browser:** Settings > **Load mod file**. The page reloads with the mod on. **Remove browser mods** takes them off.
4. Settings lists every active mod, how many values it changed, and anything it could not apply (a typo, a value of
   the wrong type). A bad line never stops the game; it is skipped and reported.

Mods load in file-name order, so a later file wins when two change the same value.

## A small example

```json
{
  "name": "Heavy Metal",
  "description": "Tougher tanks, faster hordes, more money.",
  "constants": { "HORDE_SIZE_POW": 1.8, "START_BUDGET": 60000000 },
  "units": {
    "tank": { "cost": 8000000, "cannon": { "damage": 3000 }, "mobile": { "hp": 5000 } },
    "sniper": { "range": 30, "name": "Marksman" }
  },
  "abilities": { "nuke": { "max": 3 } },
  "unlocks": { "tank": 0 },
  "cities": { "ashford": { "budget": 90000000, "waveMul": 1.2 } },
  "medals": { "Platinum": 85 }
}
```

## Sections

| Section | What it changes | Keys |
|---|---|---|
| `constants` | Every plain number in the rules: horde size and growth, timings, evac rate and pay, income, zone costs, blast radii, damage | names from the template, e.g. `HORDE_SIZE_POW`, `EVAC_CAP`, `EVAC_PAY`, `WARNING_S`, `EVAC_COST_MUL`, `SCORE_W_SAVED`, `NUKE_RADIUS` |
| `units` | Buildable and spawned units | unit id, then any field: `name`, `cost`, `deploy`, `range`, `rate`, `damage`, `ammo`, `splash`, `salvo`, `cannon {...}`, `mobile {speed, hp, leash, flee}` |
| `unitInfo` | The hover cards: role, description, special notes | unit id, then `role`, `desc`, `specials` (a list of text) |
| `supports` | Support buildings (Evac Point, Command Post...) | id, then `name`, `cost`, `deploy`, `radius`, `hint` |
| `abilities` | Strikes and call-ins | id, then `name`, `cost`, `max` (per battle), `delay`, `hint` |
| `mutators` | Battle modifiers | id, then `name`, `desc` |
| `cities` | Campaign and real cities | id, then `name`, `budget`, `waveMul`, `sites`, `speedMul`, `blurb`, `trial` |
| `unlocks` | XP needed for each locked tool (0 = open from the start) | tool id, then a number |
| `medals` | Percent evacuated for each medal | `Bronze`, `Silver`, `Gold`, `Platinum` |

`name`, `description`, `author` and `version` at the top are just labels.

Notes:
- Money is in US dollars. Distances are in cells (one cell is 2 m). Times are in seconds.
- Use the string `"Infinity"` for unlimited values (the template shows it on boats' HP and some ammo).
- A value must keep its type: a number stays a number, text stays text.
- Adding brand-new units is not supported yet; change existing ones (names, stats and descriptions all included).

## The save file

Progress is one readable JSON file. Edit it with the game closed.

- **Windows app:** `%APPDATA%\Horde\save.json`
- **Browser:** Settings > **Export save file** / **Import save file**

| Field | Meaning |
|---|---|
| `xp` | Total XP (drives ranks and unlocks) |
| `best` | Best result per city: `pct` evacuated, `medal` |
| `daily` | Best result per Daily Challenge date |
| `achievements` | Achievement id and the date it was earned |
| `plans` | Your saved defense layout per city (zone corners, walls, units, supports, bought strikes) |
| `settings` | Fullscreen, edge scrolling, volumes, crowd size, developer mode |

Developer mode (Settings) also unlocks everything and adds a panel (F10) with unlimited money, no ordnance limits and
XP buttons.
