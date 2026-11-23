// 0.47: the Codex. How to Play as data: sections, entries, media and keys. The screen (codexui.ts) renders it;
// unit, ability and support pages come from config (codexStats.ts); test/codex.test.ts keeps it honest.
import { statEntries } from "./codexStats";
import * as C from "./config";

// 0.48: difficulty numbers as the player reads them
const pctOf = (v: number) => `${Math.round(v * 100)}%`;
const D = C.DIFFICULTY;

export type SectionId = "start" | "battle" | "people" | "units" | "strikes" | "support" | "destruction" | "controls" | "more" | "credits";
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "start", title: "Start Here" },
  { id: "battle", title: "The Battle" },
  { id: "people", title: "People" },
  { id: "units", title: "Units" },
  { id: "strikes", title: "Strikes and Abilities" },
  { id: "support", title: "Support Buildings" },
  { id: "destruction", title: "Destruction" },
  { id: "controls", title: "Controls" },
  { id: "more", title: "More" },
  { id: "credits", title: "Credits" },
];

export type Callout = { n: number; x: number; y: number; text: string }; // x, y: 0..1 of the picture
export type Media = { kind: "shot" | "clip" | "diagram"; id: string; alt: string; callouts?: Callout[] };
export type CodexEntry = {
  id: string; section: SectionId; title: string;
  summary: string; // one line, shown while the entry is closed
  body: string; // mini markup: **bold**, `key`, blank line = new paragraph
  media?: Media; keys?: string[];
  since: string; // version the entry first appeared
  updated: string; // version its text or media last changed (badges and staleness)
  stats?: string; // a unit, ability or support kind: the screen adds its stats table
};

const OLD = "0.43.0", NOW = "0.47.0";
const e = (id: string, section: SectionId, title: string, summary: string, body: string, x: Partial<CodexEntry> = {}): CodexEntry =>
  ({ id, section, title, summary, body, since: OLD, updated: NOW, ...x });

export const ENTRIES: CodexEntry[] = [
  // ---------- Start Here ----------
  e("intro", "start", "What is Horde?", "An outbreak is about to hit the city. Plan a defense, then hold out while people get to safety.",
    "An outbreak is about to hit the city. You pick when it starts, plan your defense, then hold out while people get to safety.\n\nThe round goes in two parts: **planning** (draw a safe zone, set gates, place units, all at full refund) and **the battle** (the alert goes out, people run for your zone, the infected spread)."),
  e("pick-time", "start", "Pick a time", "The hour the sirens go off decides where everyone is.",
    "After you choose a city you pick the hour the sirens go off (or Random). Where people are depends on it: home at night, at work in the day, on the roads in the rush hours. The clock in the top bar runs about 30 times faster than real life."),
  e("screen", "start", "The screen", "Stats and speed on top; minimap, info, selection, build and orders along the bottom.",
    "**Top bar:** money, people out and safe, evacuated, infected, killed, the clock, the news ticker, speed (F1 to F3), pause and Start Battle (Restart once it runs).\n\n**Bottom panel, left to right:**\n- **Minimap:** click or drag to jump there, right-click to send the selected units.\n- **Info:** whatever you hover (a build item, a unit, a building), otherwise what you selected (a unit's card, a person's story, a safe zone), otherwise the round's status.\n- **Selection:** one squad lists its soldiers (click one for their card); several units show as tiles (click one to keep only it, Shift-click to drop it); nothing selected, the roster of all your squads.\n- **Build:** pick a category tab, then a tile to place it or buy a charge. B picks up the Safe Zone tool until you have a zone, then steps through the tabs.\n- **Orders:** with units selected, their commands as pictures with the hotkey in the corner (move, attack-move, patrol, escort, stop, stand by, fortify or dismount, top up, target, pull out); with nothing selected, the map tools (Safe Zone, Gate/Wall, Sell, Order, Move/Aim, Heatmap, Recall, Lock Gates, Clear Zone).\n\nThe battle group tabs (1 to 0) sit just above the panel. Every button in the panel is a picture: hover it for its name, hotkey, price or count, and what it does.\n\nOn a phone the panel scrolls sideways: the minimap and the orders come first.", { keys: ["B", "F1", "F2", "F3"], since: "0.51.0", updated: "0.52.0" }),
  e("move-around", "start", "Move around", "Right-drag or WASD to move, wheel to zoom, minimap to jump.",
    "Right-drag or WASD moves the map, the wheel zooms; click or drag on the minimap (bottom left) to jump there. Left-click uses the tool you picked; right-click or Esc puts it down.\n\nThe label next to the cursor says what is under it (a building's floors and roof height, a street, a unit) and, while you place something or draw a zone, what it costs and the money left.",
    { keys: ["Right-drag", "W A S D", "Wheel", "Esc"], updated: "0.51.0" }),
  e("safe-zone", "start", "1. Draw a safe zone", "Click corners to outline the zone people run to. Bigger zones cost more.",
    "Pick Safe Zone and click its corners, then click the first corner again (or press Enter) to close it. Right-click removes the last corner. Bigger zones cost more.\n\nPlaced something in the wrong spot? Click it with Move/Aim (or drag a box around mobile units) and press Delete for a full refund.",
    { keys: ["Enter", "Right-click", "Delete", "K"] }),
  e("gates-walls", "start", "2. Gates and walls", "Gates let people in and keep infected out; walls are stronger but nobody passes.",
    "Every street that crosses your zone's edge starts as a **gate** (blue): people get in, infected don't, but gates break sooner. Pick Gate and click one to make it a **wall** (white): stronger, but nobody passes. Click again to open it. You can flip gates in battle too; they take a few seconds to swing. Lock Gates (L) shuts them all.",
    { keys: ["G", "L"] }),
  e("walls-fire", "start", "What walls block", "Walls stop your vehicles and direct fire; artillery, rooftop units and aircraft fire over.",
    "Walls also stop your own tanks, APCs and squads (they use gates or breaches), and turrets, tanks, APCs, squads and the gunboat can't shoot through a wall or the buildings on your zone's edge. Mortars, howitzers, HIMARS, the battleship, rooftop units and aircraft fire over them."),
  e("units-basics", "start", "3. Units", "Troops and Snipers go on roofs (fortified) or zone streets, Turrets on streets. Hover anything for its stats.",
    "Troops and Snipers go on roofs, where they fortify, or on streets inside your zone; Turrets go on streets. Taller buildings give snipers more range (press J to see heights). Units inside the zone never run out of ammo; outside, they do. Hover over any button or placed unit to see its stats.",
    { keys: ["J", "R"] }),
  e("evacuate", "start", "4. Evacuate", "Evac Points fly people out every 12 s; each extra pad costs double the last.",
    "Build Evac Points inside your zone: every 12 s a lift flies people out, and trains carry people out on the rails. Each extra pad costs double the last ($3M, $6M, $12M...). A lift waves off if infected crowd the pad. Each person flown out brings $24,000 in federal evacuation funding."),
  // ---------- The Battle ----------
  e("alert", "battle", "The alert", "START BATTLE sends the phone alert; families decide where to go.",
    "When you press START BATTLE everyone gets the phone alert. Families decide what to do: some go straight to your zone, some go home first to gather the family, some meet at the zone and wait there for the rest. The first cases turn somewhere outside your zones after 20 seconds."),
  e("close-gates", "battle", "Close the gates in time", "Once most people are in, close the gates before the hordes reach them.",
    "Once most people are in, close the gates before the hordes reach them.", { keys: ["L"] }),
  e("hordes", "battle", "Hordes", "Hordes walk in from outside along highways, rails, bridges and the river.",
    "Hordes walk in from outside the city along highways, rail lines, bridges and the river (an amber arrow shows where the next one comes in). Each is bigger and comes sooner."),
  e("money", "battle", "Money", "You earn for every person safe and every infected killed. Spend it any time.",
    `Every 10 seconds you earn money for each person safe, plus a little for every infected killed. Spend it any time: units (they take a few seconds to set up), strikes, C4, even extra safe zones (those cost a lot more).\n\nSelling a unit mid-battle (Sell / Evac) sends a helicopter to pull it out first; then you get its cost back. Prices are real-world US dollars; ordnance is limited per battle, like a real stockpile.\n\n**The price line:** from Medium up, every unit of a kind you already have standing makes the next one dearer (Medium +${pctOf(D.medium.priceStep)}, Hard +${pctOf(D.hard.priceStep)}, Insane +${pctOf(D.insane.priceStep)} each; Paratroopers too, per squad bought). Lose or sell one and the next gets cheaper again. Mixing unit kinds in good spots goes further than stacking one.\n\n**Support buildings** have a line too: from Medium up, each one of a kind you already have makes the next one cost more (Medium x${D.medium.supportMul}, Hard x${D.hard.supportMul}, Insane x${D.insane.supportMul} the last). Evac Points keep their own line (each costs ${C.EVAC_COST_MUL}x the last) on every difficulty.\n\n**Cost of operations (Insane):** every 10 s each unit and building standing costs ${(D.insane.upkeepPct * 100).toFixed(1)}% of what you paid for it, shown in the top bar after your income. It never takes you below $0.`, { updated: "0.49.0" }),
  e("strikes-rules", "strikes", "How strikes work", "Strikes land a few seconds after you call them and hurt civilians too.",
    "Airstrike and the A-10 take two clicks (where the run starts, where it ends); the rest take one. Each lands a few seconds later and hurts civilians too (the AC-130 only shoots infected).\n\nCratering strikes and shelling can't land within 20 to 30 m of your people (the cursor turns red: NO-FIRE); the nuke and MOAB are allowed but warn you first."),
  e("speed", "battle", "Speed", "F1, F2 and F3 set the speed; Space pauses (not on Hard or Insane).",
    "F1, F2 and F3 set the speed (half, normal, double); Space pauses. (The number keys are battle groups since 0.50.)\n\nOn **Hard** and **Insane** the battle runs in real time once it starts: no pause and no speed change until the round is scored. Plan everything you can before you press Start.", { keys: ["F1", "F2", "F3", "Space"], updated: "0.50.0" }),
  e("difficulty", "battle", "Difficulty", "Easy saves almost everyone; Insane is a fight for every person.",
    `Difficulty decides how many people you can save, not whether you can.\n\n**Easy:** small, slow hordes and plenty of money. You save almost everyone.\n**Medium:** you save most people if you pay attention.\n**Hard:** bigger, faster hordes, ${pctOf(D.hard.budgetMul)} of the money and ${pctOf(D.hard.incomeMul)} of the income, a steeper price line, and no pause once the battle starts. A good plan saves most people; spamming one unit doesn't.\n**Insane:** ${pctOf(D.insane.budgetMul)} of the money, ${pctOf(D.insane.incomeMul)} of the income, the steepest price line, cost of operations, no pause. Half the city is a good day.\n\nThe end screen shows **people saved per $1M** spent, your best for that city and difficulty, and the **Under Budget** badge for a medal won spending no more than ${pctOf(C.UNDER_BUDGET_PCT)} of your starting money plus income.`, { since: "0.48.0", updated: "0.48.0" }),
  e("soldiers", "units", "Soldiers", "Every soldier, officer and militia fighter is a dot with a colored ring. Click near one for the squad, Tab for the next.",
    `Troops are 4 riflemen, a Sniper team is a sniper and a spotter, Paratroopers are 5 elite soldiers (better shots, tougher, a 3 s drop) and one of them is a **grenadier** with an M320: every ${C.GREN_EVERY_S} s he lobs a grenade into the biggest pack of infected in range, ${C.GREN_AMMO} rounds, then his rifle (his dot has an orange center while he has rounds); a Police squad is 3 officers and Militia (from an Armory or an APC) 4 fighters. Every one of them is a person: a green dot like the crowd's, with a ring that says the job: **red** Troops, **yellow** Snipers, **purple** Paratroopers, **blue** Police, **orange** Militia. Each fires on their own, so every soldier lost is firepower lost. A dim ring means low ammo, a grey one none.\n\n**Selecting them.** Click near any dot of a squad (you don't have to hit it exactly; soldiers win over the crowd) to select the whole squad; double-click for every squad of that kind on screen; drag a box. Hovering lights the squad up. **Tab** jumps to your next squad (idle ones first), Shift+Tab back. With nothing selected, the selection panel lists every squad and what it is doing (fighting, moving, fortified, low ammo, idle): click a row to select it, double-click to jump there.\n\n**Fortify a roof.** Select Troops or a Sniper team and right-click a roof: they walk over and climb up (${C.FORTIFY_S} s, no shooting, and they can be bitten at the foot of the building). Fortified, the whole squad sits inside one sandbag fortification on the roof, gets the roof's range bonus and can't be bitten; they jostle around in there, shifting toward whatever they are shooting at. One Troops squad and one Sniper team per building.\n\n**Come down and fight.** Right-click a street with a fortified squad selected: they climb down (${C.DISMOUNT_S} s) and go. On the ground they move as a fire team: a wedge in the open, single file in a narrow or packed street, keeping to the building fronts, and they close up when they stop. They take every order (move, attack-move, patrol, escort) and hold where they stand when you give none. Outside the zone they carry a limited load of ammo; back inside, it refills.\n\n**Buying.** Troops go anywhere: a roof (fortified), a street or a park, inside or outside your zone; in battle a UH-60 flies them in (${C.UNITS.garrison.deploy} s) and pulls them out in ${C.TROOPS_EXTRACT_S} s when you sell them. Outside the zone they only have the ammo they carry. In battle you can also click your zone's open ground and use Buy Troops here. Sniper teams go on a roof or a street inside the zone. Paratroopers drop from the air anywhere, fast.\n\nA bitten soldier turns. Click a soldier's dot to see who they are; select a squad that lost soldiers and press \`U\` (Top up) to fly in a replacement for a share of the squad's price.`, { keys: ["U", "Tab"], since: "0.49.0", updated: "0.53.1" }),
  e("groups", "controls", "Battle groups", "Ctrl+1-5 saves a group, 1-5 selects it, twice jumps there. The group tabs sit above the selection box.",
    "Select units (or click a safe zone's open ground) and press **Ctrl+1** to **Ctrl+5**: that key now holds the group. **Shift+Ctrl** adds the selection to it.\n\nPress the number to select the group again, press it twice quickly to jump the camera there, Shift+number to add it to what you have selected. A group key can hold a safe zone instead: then it selects the zone (Buy Troops here) and jumps to it.\n\nThe group tabs sit just above the selection box in the middle of the bottom panel. Each group you make shows a picture of its most common unit with its number in the top-left corner, how many are left and their health; click it to select the group. The keys 6 to 0 are the quick bar. Units that die or are pulled out leave their groups. Groups save with your plan and your battle saves.\n\nIn a web browser, Ctrl+1-5 may switch browser tabs instead; the Windows app has no such problem.", { keys: ["Ctrl+1", "1"], since: "0.50.0", updated: "0.54.0" }),
  e("minimap-alerts", "battle", "Alerts on the minimap", "Red rings on the minimap show trouble; ` (the key left of 1) jumps to it.",
    "Pulsing rings on the minimap show where something needs you: people bitten inside a safe zone or a wall down (big red), a unit under attack or an evac lift waved off, infected clawing at a wall, people bitten out in the city (small). Urgent ones come with a radio blip.\n\nPress the \` key (left of 1) to jump the camera to the most urgent one, or click it on the minimap. Alerts work on every difficulty.", { keys: ["`"], since: "0.48.0", updated: "0.54.0" }),
  e("round-score", "battle", "The round and your score", "The round ends when the city is empty. Score 0 to 100, medals from Bronze to Platinum.",
    "The round ends when nobody is left in the city, or when only a few stuck stragglers remain. End round (top bar) scores it right away: people in the zone count as saved.\n\nYour score (0 to 100) is mostly people saved, plus how fast, how intact the city is and how many infected you killed: Bronze 10, Silver 30, Gold 50, Platinum 75, and at least 5% saved for any medal. Next to it: people saved per $1M spent, and the Under Budget badge.\n\nThen Keep fighting: endless, harder hordes scored as Mayhem until you pull out (Pause menu: Pull out).", { updated: "0.48.0" }),
  // ---------- People ----------
  e("every-dot", "people", "Every dot is a person", "Click a white dot with Move/Aim to see who they are and what happened to them.",
    "Every dot is a person with a name, an age, a family and a home. Pick Move/Aim and click a white dot to see who they are, where they were when the sirens went off and everything that has happened to them since. **Follow** keeps the camera on them.\n\nSome carry guns and defend their family; panicked crowds can crush; anyone can be carrying the infection."),
  e("refusers", "people", "Age, refusers and grief", "Some households refuse to leave. Park a unit beside them to talk them out.",
    "The elderly walk slower, teens a bit faster, and some teens head for the zone on their own. A few households refuse to leave and shelter at home (click a person to see if they are one). Some are bluffing and run once the infected come close. Park a unit beside them for a while to talk them out. People who stay cost the score a little.\n\nSeeing someone they love turn can stop a person in their tracks, send them back for them, or make them refuse to go on."),
  // ---------- Units ----------
  e("mobile-orders", "units", "Mobile units and orders", "Select mobile units and right-click to send them. A, P, E, S and D give orders.",
    "The APC, the Gunboat (on the river) and Paratroopers think for themselves: they hunt crowds near where you put them, go after infected chasing civilians first, back off before they get swarmed, and go home to reload.\n\nSelect mobile units with Move/Aim (click, Shift-click, or drag a box) and right-click where to send them: they go straight there, shooting what is in range, and hold. A then click: attack-move (they stop to fight on the way). P: patrol between here and there. E then click a person: escort their family. S: stop and hold. D: stand by (hold fire). Shift queues orders; the minimap moves the camera and right-click on it sends units.\n\nWhile units are selected, the arrow keys move the camera (A, S and D are commands). Units you never order still fight on their own. Recall (Q) pulls mobile units into the zone, Q again sends them back.",
    { keys: ["Right-click", "A", "P", "E", "S", "D", "Shift", "Q"] }),
  e("target-delete", "units", "Target priority and removing units", "Select a unit, then T changes what it shoots first and Delete removes it.",
    "Click one of your units with Move/Aim to select it, then press T to change what it shoots first (nearest, closest to the walls, or infected chasing civilians) or Delete to remove it.",
    { keys: ["T", "Delete"] }),
  e("ac130", "units", "AC-130 gunship", "It flies in by itself, circles 40 s at a time and fires three guns at infected only.",
    "It flies in by itself from the nearest edge of the map and circles the spot 40 s at a time (it leaves to refuel and comes back, all battle). Its 25 mm Gatling takes stragglers, the 40 mm Bofors small groups and the 105 mm howitzer packs of 10 or more, firing only at infected.\n\nClick the plane with Move/Aim to select it: right-click sends it to a new spot, Delete sends it home (before it arrives, that cancels it and gives the charge back).",
    { keys: ["Right-click", "Delete"] }),
  // ---------- Support ----------
  e("support-buildings", "support", "Support buildings", "Built on buildings inside your zone: discounts, repairs, range, ammo, fire rate, police, militia.",
    `Support buildings go on buildings inside your zone: Budget office (20% off nearby), Repair yard (walls, gates, vehicles; at most ${C.REPAIR_MAX} per battle), Radio tower (+40% range nearby), Supply depot (ammo by cargo drone to units outside the walls), Command post (+30% fire rate), Precinct (police squads), Armory (militia on the walls).`),
  // ---------- Destruction ----------
  e("c4", "destruction", "C4 and destruction", "Plant C4 on a bridge or building, then click it in battle to blow it.",
    "Plant C4 on a bridge or a building, then click it again in battle to blow it: a bridge drops into the river, a building collapses into rubble that slows everyone. Heavy weapons crater streets and bring buildings down too. Fuel tanks blow during the battle."),
  // ---------- Controls ----------
  e("controls-all", "controls", "All controls", "Every key and mouse action in one list.",
    "WASD (or the arrow keys, or right-drag) always moves the map, wheel zooms, minimap jumps the camera. Every button shows its key in its top-left corner.\n\nMove/Aim (V): click to select (a click near a soldier's dot picks the squad), Shift-click to add, drag a box for squads and mobile units, double-click a unit for every one of its kind on screen, Tab / Shift+Tab for the next / previous squad (idle first), Esc to deselect; right-click sends them (Shift queues). Right-click a roof with Troops or Snipers selected to fortify it (or C, then click the roof); right-click a street to bring a fortified squad down.\n\nBattle groups: Ctrl+1-5 saves the selection (or a selected safe zone) as a group, Shift+Ctrl adds to it, 1-5 selects it, press it twice to jump there, Shift+1-5 adds it to the selection.\n\nQuick bar: drag build tiles onto its 5 slots under the build grid; keys 6 7 8 9 0 by default. Right-click a slot and press any free key to change it (Esc keeps the old one, Backspace clears it).\n\nWith units selected: Q attack-move, R patrol, E escort, F stop, G stand by, C fortify or dismount, T target priority, U top up a squad, X or Delete remove (planning) or pull out (battle).\n\nWith nothing selected: Z Safe Zone, X Sell/Evac, C Order, V Move/Aim, G gate tool, B build (the Safe Zone tool until you have a zone, then the next build tab), Q recall, L lock gates, K clear zone.\n\nAlways: Space pauses (not on Hard or Insane), F1/F2/F3 speed, \` (left of 1) jump to the latest alert, J heights, N unit ranges, H kill heatmap, Esc menu, F5 quick save (pick a save slot first), F11 fullscreen (Windows app). Hover any button for its name and key.", { updated: "0.54.0" }),
  // ---------- More ----------
  e("real-cities", "more", "Real cities, mutators and the daily challenge", "13 real OpenStreetMap cities, any city live when online, mutators and a daily challenge.",
    "Play 13 real OpenStreetMap cities (Boston, Castle Rock, Chicago, Denver, Los Angeles, New York, Miami, Omaha, Paris, Pittsburgh, Portland, San Francisco, Washington), or search any city live when online. Mutators and the Daily Challenge are on the Cities screen. H shows where your kills happened.",
    { keys: ["H"] }),
  e("tips-tutorial", "more", "Tips and the tutorial", "Tips show the first time something happens; the tutorial runs on the first city.",
    "Tips appear in the ticker the first time something new happens (Settings: Tips). The tutorial runs on the first city; you can replay it from the Pause menu."),
  // ---------- Credits ----------
  e("credits", "credits", "Credits", "Map data, music, sound effects and who built it.",
    "Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).\n\nMusic made with ACE-Step 1.5 (MIT license). Sound effects made with Stable Audio Open 1.0, Powered by Stability AI (Stability AI Community License).\n\nBuilt by AI agents (Claude and Gemini) and a human."),
];

// ---------- Media: pictures (tools/shots/recipes.ts), clips, diagrams (codexDiagrams.ts). One per entry. ----------
const shot = (id: string, alt: string, callouts?: Callout[]): Media => ({ kind: "shot", id, alt, ...(callouts ? { callouts } : {}) });
const clip = (id: string, alt: string, callouts?: Callout[]): Media => ({ kind: "clip", id, alt, ...(callouts ? { callouts } : {}) });
const diagram = (id: string, alt: string): Media => ({ kind: "diagram", id, alt });
const c = (n: number, x: number, y: number, text: string): Callout => ({ n, x, y, text });

export const ENTRY_MEDIA: Record<string, Media> = {
  "intro": shot("battle-overview", "Fairhaven a minute into a battle: the safe zone full of people, infected spreading through the streets", [c(1, 0.5, 0.42, "Your safe zone"), c(2, 0.2, 0.8, "Crowds crossing the bridges toward the zone")]),
  "move-around": shot("start-cursor-label", "The cursor over a building with the Sniper tool: the label shows the building's floors, roof height and the price", [c(1, 0.6, 0.22, "The label follows the cursor")]),
  "safe-zone": clip("clip-draw-zone", "A safe zone being drawn corner by corner and closed on the first corner"),
  "gates-walls": diagram("gate-wall", "A gate lets people in and stops infected; a wall stops everyone"),
  "walls-fire": diagram("line-of-fire", "Direct fire stops at walls; mortars, artillery, rooftop units and aircraft fire over them"),
  "units-basics": shot("start-heights", "Building heights shown with J: taller buildings are lighter; a sniper and a garrison sit on rooftops by the zone"),
  "evacuate": clip("clip-evac-lift", "A helicopter lands on an evac pad inside the zone and lifts people out"),
  "alert": diagram("timeline", "Timeline from START BATTLE to the first cases and the hordes"),
  "close-gates": clip("clip-gate-to-wall", "In battle, gates are clicked shut and turn from blue gates to white walls"),
  "hordes": shot("battle-horde-arrow", "A horde marching in from the edge of the city along a road"),
  "money": shot("battle-money-bar", "The top bar in battle: money and income, people outside, safe, evacuated, infected, killed and the clock", [c(1, 0.72, 0.25, "Money and income every 10 s"), c(2, 0.35, 0.72, "Who is where")]),
  "strikes-rules": diagram("no-fire", "The no-fire rings around your people and which strikes each ring blocks"),
  "round-score": diagram("medals", "Score bar from 0 to 100 with the medal thresholds"),
  "every-dot": shot("people-person-window", "A person's window: name, age, family, where they were when the sirens went off and what happened since"),
  "mobile-orders": clip("clip-box-select-move", "Two mobile units are box-selected, then sent across the map with a right-click"),
  "target-delete": shot("units-selected-card", "A selected sniper: its card in the info panel and its orders in the command card, with Target (T) and Remove (Delete)", [c(1, 0.25, 0.8, "Its card: range, damage, ammo and kills"), c(2, 0.9, 0.8, "Command card: T changes the target, Delete removes it")]),
  "ac130": shot("units-ac130-orbit", "The AC-130 circling its spot and firing on infected below"),
  "support-buildings": shot("support-radius", "Placing a Radio Tower inside the zone: the circle shows the area it boosts"),
  "c4": clip("clip-c4-bridge", "C4 on a bridge is blown in battle and the bridge drops into the river"),
  "soldiers": clip("clip-troops-fortify", "A Troops squad on a zone street is sent to a roof with a right-click: it walks to the building, climbs up and fortifies"),
  "groups": shot("controls-groupbar", "The group tabs: slot 1 a Troops squad on the ground, 2 a fortified one, 3 a Sniper team, each with its count and health"),
  "minimap-alerts": shot("battle-minimap-alerts", "The minimap in battle with pulsing red rings where people are being bitten out in the city"),
  "screen": shot("controls-hud", "The bottom panel with a Troops squad selected: minimap, its card, its four soldiers, the build tabs and grid, and its orders as pictures", [c(1, 0.08, 0.5, "Minimap"), c(2, 0.25, 0.5, "Info"), c(3, 0.45, 0.5, "Selection"), c(4, 0.65, 0.5, "Build"), c(5, 0.9, 0.5, "Orders")]),
};
export const STAT_MEDIA: Record<string, Media> = {
  "unit-sniper": shot("units-ranges", "Unit ranges shown with R: each unit's circle is how far it reaches"),
  "unit-apc": clip("clip-attack-move", "An APC on attack-move: it stops to fight infected on the way to where it was sent"),
  "ability-airstrike": clip("clip-airstrike", "An airstrike called with two clicks: the jet bombs the line from the first click to the second"),
  "ability-gunship": clip("clip-ac130-arrives", "The AC-130 flies in from the nearest edge and starts circling"),
  "support-evac": diagram("evac-cost", "Each extra evac pad costs double the last"),
};

/** Hand-written entries plus the generated unit, ability and support pages, with their media attached. */
export function allEntries(): CodexEntry[] {
  return [...ENTRIES, ...statEntries()].map(e => (ENTRY_MEDIA[e.id] ?? STAT_MEDIA[e.id]) ? { ...e, media: ENTRY_MEDIA[e.id] ?? STAT_MEDIA[e.id] } : e);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Mini markup to HTML: escapes everything, then **bold**, `key`, blank line = paragraph. */
export function renderBody(md: string): string {
  return md.split(/\n\s*\n/).map(p => "<p>" + esc(p.trim()).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<kbd>$1</kbd>") + "</p>").join("");
}

export function verCmp(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Literal, case-insensitive search over title, summary, body and keys. Blank = everything. */
export function filterEntries(q: string, list: CodexEntry[] = allEntries()): CodexEntry[] {
  const n = q.trim().toLowerCase();
  if (!n) return list;
  return list.filter(e => [e.title, e.summary, e.body, ...(e.keys ?? [])].some(s => s.toLowerCase().includes(n)));
}

/** NEW / UPDATED against the version the player last opened the Codex in (none yet = no badges). */
export function badgeFor(e: CodexEntry, seen: string | undefined): "new" | "updated" | null {
  if (!seen) return null;
  if (verCmp(e.since, seen) > 0) return "new";
  if (verCmp(e.updated, seen) > 0) return "updated";
  return null;
}

/** The version badges compare against: the last Codex visit, else the version that last wrote the save (a save from
 * before 0.47 sees what changed since), else nothing (a brand-new player gets no badges). */
export function seenFor(codexSeen: string | undefined, prevGameVersion: string | undefined): string | undefined {
  const s = codexSeen ?? prevGameVersion;
  return s && verCmp(s, CODEX_EPOCH) < 0 ? CODEX_EPOCH : s; // 0.47.1: the whole Codex is new at launch; badge only later changes
}

/** The version the Codex launched in. A save from before it gets no badges for the launch itself (every entry
 * would carry one); badges start with the first change after it. */
export const CODEX_EPOCH = "0.47.0";

/** 0.47.1: the version that wrote a save slot before this session touched it, kept per slot on first sight (the
 * desktop updater and the Codex visit both restamp the save later). null = the profile in use before any slot. */
export function slotPrevVersion(m: Map<number | null, string | undefined>, slot: number | null, gameVersion: string | undefined): string | undefined {
  if (!m.has(slot)) m.set(slot, gameVersion);
  return m.get(slot);
}
