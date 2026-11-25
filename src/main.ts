import * as C from "./config";
import { BRIDGE, BUILDING, CityMap, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER } from "./map";
import { fetchLiveOsmCity } from "./osm";
import { CIV, INF, SAFE_CIV, SHOT_CANNON, SHOT_ROCKET, SHOT_SHELL, SHOT_SNIPER, Sim } from "./sim";
import type { Score, Entity, Orbit, Unit } from "./sim";
import { groupsToPlan, groupsFromPlan, pruneGroups, assignGroup, groupUnits, groupSummary } from "./groups";
import { commandCard, selectionGrid, infoSource, buildTabs, CMD_DESC, squadState, tabOrder, nextInTab, type CardButton } from "./hud";
import { QUICK_SLOTS, keyLabel, keyFor, keyOf, actionFor, setBinds, cleanKeys, overrides, bindProblem, binds, withKeys, menuStep, menuOfTool, MENU_NAME, controlsRows, resetGroup, defaultBinds, type Group, type Binds, type Ctx, type MenuId } from "./keymap";
import { orderIcon } from "./ordericons";
import { cleanQuickbar, setSlot, swapSlots, clearSlot, type Slots } from "./quickbar";
import { describeCell, estimateAt } from "./cursorinfo";
import { keyIntent, cameraKeysActive, pruneSelection, typingInField, groupIntent, type ArmCmd } from "./input";
import { drawMinimap, miniToWorld, drawPings, pickPing } from "./minimap";
import { soldierCardLines } from "./squads";
import type { Ping } from "./sim";
import * as Save from "./save";
import * as Snap from "./snapshot";
import * as P from "./progress";
import * as Mods from "./mods";
// Mods first: they change numbers that everything below reads. Desktop: <userData>\mods\*.json; browser: stored copies.
const BROWSER_MODS = "horde.mods";
function browserMods(): Mods.ModFile[] { try { return JSON.parse(localStorage.getItem(BROWSER_MODS) ?? "[]"); } catch { return []; } }
const modReports: Mods.ModReport[] = [...(Save.desktop?.readMods?.() ?? []), ...browserMods()].map(Mods.applyMod);
import type { Plan } from "./save";
import { log, installErrorHooks, recentLog, Perf } from "./log";
import { GLView } from "./gl";
import { Scars } from "./scars";
import { initUpdater } from "./updaterui";
import { Sound } from "./audio";
import { initSprites, SPRITE_CANVAS, SPRITE_URL, SpriteKey, supportSpriteKey } from "./sprites";
import { AlertQueue } from "./ticker";
import { partPoints, mergeBest, mergeEfficiency, bestKey, anyMedal, difficultyFor, bestOfAreas } from "./scoring";
import { loadRealArea, realAreaMap, realAreaStreets } from "./realcity/load";
import { buildPlaces, type Places } from "./places";
import { SE_KEEP_FIGHTING, type Col } from "./stats";
import { headerHtml, tabHtml, tabsHtml, sampleAt, DEFAULT_COLS, COL_NAMES, type Tab } from "./endreport";
import { storyLine, clockMin } from "./people";
import { buildTownReport, townInputFromSim } from "./townreport";
import { makeRecord, persistRecord, outcomeFor, emptyCareer, type BattleRecord, type BattleKind } from "./battlerecord";
import { areaCardInfo, bindCityMap, cityMapModel, drawCityMap, fitView, type CityMapUi } from "./citymapui";
import { soundDue, zoomGain } from "./audiotiming";
import { airHalfPx, drawAirframe, smoothHeading } from "./aircraft";
import { drawDepot, drawModel, drawSquad, drawSupport, drawWrecks, hasModel, hasSquad, MODEL_ZOOM, noteUnits, SQUAD_ZOOM } from "./models";
import { clockSpan, START_CHOICES, randomStart, needsTimePick, formatClock } from "./people";
import { personHtml, personAt, followable, followEndLine, endStatsLines } from "./personui";
import { TIPS, shouldTip, type TipId } from "./tips";
import { mountCodex, stripCodexLinks } from "./codexui";
import { seenFor, slotPrevVersion } from "./codex";
import { DIAGRAMS } from "./codexDiagrams";
import { runOps, shotsAllowed, type ShotOp } from "./shotmode";

installErrorHooks();
initSprites();
document.querySelectorAll<HTMLImageElement>("img[data-sprite]").forEach(img => {
  const k = img.dataset.sprite as SpriteKey;
  if (SPRITE_URL[k]) img.src = SPRITE_URL[k];
});
document.querySelectorAll<HTMLImageElement>("img[data-oicon]").forEach(img => { img.src = orderIcon(img.dataset.oicon!); }); // 0.51.1
/** 0.54: every tool's key top-left on its button (0.55: the live binding; re-run after a rebind). */
function labelToolCards() {
  document.querySelectorAll<HTMLElement>("#cmdtools button").forEach(b => {
    const k = b.dataset.tool ?? (b.id === "heatmapbtn" ? "heatmap" : b.id); b.dataset.tipdesc = CMD_DESC[k] ?? "";
    const key = keyLabel(keyFor(k === "heatmap" ? "view.heatmap" : `tool.${k}`)); b.dataset.tipkey = key; const hk = b.querySelector(".hk"); if (hk) hk.textContent = key;
  });
}
const perf = new Perf();

type Tool = "pan" | "order" | "zone" | "gate" | C.UnitKind | C.SupportKind | "remove" | C.AbilityKind | "c4" | "depot";
const ABILITY_KINDS = Object.keys(C.ABILITIES) as C.AbilityKind[];
const isAbility = (t: Tool): t is C.AbilityKind => t in C.ABILITIES;
const isSupport = (t: Tool): t is C.SupportKind => t in C.SUPPORTS;
let strikeStart: [number, number] | null = null; // first click of an airstrike run
let mapVersion = 0;
const scars = new Scars(); // 0.23: craters and rubble in the ground, smoke above
let scarUploadT = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;
const glv = new GLView($<HTMLCanvasElement>("gl"));
const snd = new Sound();
addEventListener("pointerdown", () => snd.unlock());
addEventListener("keydown", () => snd.unlock());
document.addEventListener("click", e => { if ((e.target as HTMLElement).closest("button")) snd.click(); }); // map + agents on the graphics card; 2D canvas on top for the rest

let save = Save.load();
setBinds(cleanKeys(save.settings.keys, save.settings.quickKeys)); // 0.55: every key settable (keymap.ts)
labelToolCards(); renderHelpKeys(); labelSpeedKeys();
const slotVersions = new Map<number | null, string | undefined>(); // 0.47.1: per slot, the version that wrote it before this session (Codex badges)
slotPrevVersion(slotVersions, Save.activeSlot(), save.gameVersion); // read before the updater stamps the current version
if (save.xp == null) { save.xp = P.grandfatherXp(save.best); Save.store(save); } // players from before XP keep their access
/** Unlocked by XP, lent by the current campaign city, or everything in developer mode. */
const isOpen = (t: string) => P.unlocked(t, save.xp ?? 0, city?.trial, !!save.settings.devMode);
const toolName = (t: string) => (C.UNITS as Record<string, { name: string }>)[t]?.name ?? (C.SUPPORTS as Record<string, { name: string }>)[t]?.name ?? (C.ABILITIES as Record<string, { name: string }>)[t]?.name ?? t;
let mode: "attract" | "game" = "attract"; // attract = the title screen with a city falling in the background
let city: C.CityDef | null = null; // null = quick battle on a random city
let customMap: { name: string; map: CityMap; streets?: [string, number[]][] } | null = null; // 0.57 streets: live OSM names
let dailyDate: string | null = null;
const activeMutators = new Set<C.MutatorId>();
let seed = Math.floor(Math.random() * 1e9);
let startMin = 600; // 0.39: the clock's start (minutes since midnight), picked after the city; Retry keeps it
const newBattleId = () => { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36); } };
const simOpts = () => ({
  battleId: newBattleId(), // 0.57: one record per battle
  civilians: save.settings.crowd ?? C.CIVILIANS,
  realCityId: city?.real && !city.realArea && !city.areas?.length ? city.id : undefined, // pre-0.36 single map
  realArea: customMap ? undefined : city?.realArea, // 0.36: a baked battle area
  recipe: customMap || dailyDate ? undefined : city?.recipe,
  customMap: customMap?.map,
  mutators: [...activeMutators],
  difficulty: difficultyFor(!!dailyDate, save.settings.difficulty),
  ...(city ? { budget: city.budget, waveMul: city.waveMul, sites: city.sites, speedMul: city.speedMul } : {}),
});
let sim = new Sim(seed);
let pausedSpeed = save.settings.speed ?? 1; // 0.32: the player's last chosen speed (½x, 1x, 2x), kept through pause and between rounds
let tool: Tool = "zone";
let speed = 1; // 0 paused
let draft: [number, number][] = []; // zone being drawn
let actionsT = 0;
let selSoldier: import("./squads").Soldier | null = null; // 0.49: the soldier whose dot was clicked
let sel: Entity[] = []; // 0.44/0.45: what is selected with the Move/Aim tool (click, Shift-click, or drag a box)
let selZone = -1; // 0.50: a safe zone selected by clicking its open ground (bindable to a group key; Troops deploy from it)
let lastGroupKey = { n: -1, t: 0 }; // 0.50: a group key pressed twice quickly jumps the camera there
let armedCmd: ArmCmd | null = null; // 0.45: A/P/E pressed: the next left-click aims it
let box: [number, number, number, number] | null = null; // 0.45: selection box being dragged (canvas px)
let hover: [number, number] | null = null; // cell under the mouse
let showHeights = false;
let showRanges = false;
let showHeatmap = false;
let hoverUnitHeatmap: C.UnitKind | null = null;
let hoverNavTool: Tool | "heatmap" | "closegates" | "recall" | "clear" | null = null;
let lastMapBuildT = 0;
let message = "";
let messageT = 0;

// Camera: cells -> screen pixels.
const cam = { x: 0, y: 0, scale: 2 };
function fitCamera() {
  const s = mode === "attract" ? Math.max(canvas.width / sim.w, canvas.height / sim.h) : Math.min(canvas.width / sim.w, canvas.height / sim.h) * 0.98;
  cam.scale = s;
  cam.x = (canvas.width - sim.w * s) / 2;
  cam.y = (canvas.height - sim.h * s) / 2;
}
const toCell = (px: number, py: number): [number, number] => [(px - cam.x) / cam.scale, (py - cam.y) / cam.scale];

// ---------- Static map image ----------
let baseImg = document.createElement("canvas");
let heightImg = document.createElement("canvas");
function buildBase() {
  mapVersion = sim.mapVersion;
  lastMapBuildT = performance.now();
  const { w, h, tile, height } = sim.map;
  const dmg = sim.damage, rub = sim.rubble;
  for (const [img, heights] of [[baseImg, false], [heightImg, true]] as const) {
    img.width = w; img.height = h;
    const g = img.getContext("2d")!;
    const d = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      let r = 0, gg = 0, b = 0;
      const t = tile[i], dm = dmg[i];
      const x = i % w, y = (i / w) | 0;
      if (rub[i]) {
        const speck = ((i * 2654435761) >>> 28) & 15;
        [r, gg, b] = [54 + speck, 46 + (speck >> 1), 40 + (speck >> 1)];
      } else if (t === ROAD) {
        const sc = Math.min(24, dm >> 3);
        const inf = height[i];
        if (inf === INFRA_HIGHWAY) {
          // Divided Interstate Highway: dark asphalt with yellow median stripe and dashed lane lines
          const stripe = ((x + y) % 6 === 0) ? 16 : 0;
          [r, gg, b] = [52 + stripe - (sc >> 1), 56 + (stripe >> 1) - sc, 64 - sc];
        } else if (inf === INFRA_RAIL) {
          // Mass Transit Rail Line: gravel ballast + wooden crossties + steel rails
          const tie = ((x + y) & 1) === 0;
          [r, gg, b] = tie ? [98 - sc, 86 - sc, 74 - sc] : [64 - (sc >> 1), 60 - sc, 58 - sc];
        } else if (inf === INFRA_STATION) {
          // Mass Transit Station Platform: concrete deck with cyan safety edge
          const edge = (x + y) % 4 === 0;
          [r, gg, b] = edge ? [56, 178, 228] : [108 - sc, 118 - sc, 132 - sc];
        } else {
          [r, gg, b] = [40 - (sc >> 1), 44 - sc, 52 - sc];
        }
      } else if (t === PARK) {
        const sc = Math.min(30, dm >> 3);
        [r, gg, b] = [38 + (sc >> 1), 70 - sc, 44 - (sc >> 1)];
      } else if (t === WATER) [r, gg, b] = [24, 52, 88];
      else if (t === BRIDGE) {
        const inf = height[i];
        if (inf === INFRA_HIGHWAY) [r, gg, b] = [122, 112, 88];
        else if (inf === INFRA_RAIL) [r, gg, b] = [88, 96, 108];
        else [r, gg, b] = [96, 84, 66];
      } else if (t === BUILDING) {
        const lv = height[i];
        if (heights) { // cool-to-warm by height
          const k = Math.min(1, lv / 14);
          [r, gg, b] = [40 + 215 * k, 60 + 120 * (1 - Math.abs(k - 0.5) * 2), 160 * (1 - k) + 40];
        } else {
          // Subtle 3D rooftop bevel: brighter on N/W edge of each building footprint, darker on S/E edge
          const nEdge = (y > 0 && tile[i - w] !== BUILDING) || (x > 0 && tile[i - 1] !== BUILDING);
          const sEdge = (y < h - 1 && tile[i + w] !== BUILDING) || (x < w - 1 && tile[i + 1] !== BUILDING);
          const bevel = nEdge ? 10 : sEdge ? -10 : 0;
          const v = Math.max(30, Math.min(220, 62 + lv * 6 + bevel - (dm >> 3)));
          [r, gg, b] = [v + (dm > 80 ? 10 : 0), v + 2 - (dm >> 5), v + 8 - (dm >> 4)];
        }
      }
      d.data.set([r, gg, b, 255], i * 4);
    }
    g.putImageData(d, 0, 0);
  }
  glv.setMap(baseImg, heightImg);
}

// Zone overlay, rebuilt when the zone changes and every few frames in battle (wall HP).
const zoneImg = document.createElement("canvas");
function buildZone() {
  const { w, h } = sim;
  zoneImg.width = w; zoneImg.height = h;
  const g = zoneImg.getContext("2d")!;
  const d = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const z = sim.inZone[i];
    if (!z) continue;
    let c: number[];
    if (z === 1) c = [80, 220, 120, 38];
    else {
      const hp = sim.wallHp[i];
      const gMax = sim.gateMaxHp(), wMax = sim.wallMaxHp();
      if (hp <= 0) c = [160, 30, 30, 200];
      else if (z === 3) { const k = hp / gMax; c = [80 + 175 * (1 - k), 200 * k, 255 * k, 255]; }
      else { const k = hp / (z === 3 ? gMax : wMax); c = [255, 120 + 135 * k, 120 + 135 * k, 255]; }
    }
    d.data.set(c, i * 4);
  }
  g.putImageData(d, 0, 0);
  glv.setZone(zoneImg);
}

// ---------- Plan save / restore ----------
const GONE = { kind: "apc", x: -1, y: -1 } as unknown as Unit; // 0.50: a planned unit that didn't fit (its group places drop it)
function exportPlan(): Plan {
  const walls: number[] = [];
  sim.inZone.forEach((z, i) => { if (z === 2) walls.push(i); });
  const planned = sim.units.filter(u => u.kind !== "para" && u.kind !== "police" && u.kind !== "militia");
  return {
    poly: sim.zones[0] ?? [], zones: sim.zones.map(z => z.slice()), walls,
    groups: groupsToPlan(sim.groups, planned), // 0.50
    units: planned.map(u => {
      // 0.45: orders given in planning (after the start, the copy kept then: Retry replays the plan, not what was left)
      const po = sim.phase === "plan" ? (u.cmd ? { orders: u.orders ?? [], standby: !!u.standby } : undefined) : u.planOrders;
      const [ux, uy] = sim.phase !== "plan" && u.planPos ? u.planPos : [Math.floor(u.x), Math.floor(u.y)]; // 0.50: Troops walk now; Retry puts them where they were planned
      return po ? [u.kind, ux, uy, u.mode ?? "near", po.orders.map(o => ({ ...o })), ...(po.standby ? [true] : [])] as Plan["units"][number]
        : [u.kind, ux, uy, u.mode ?? "near"] as Plan["units"][number];
    }),
    supports: sim.supports.map(b => [b.kind, b.x, b.y]),
    abilities: { ...sim.bought }, c4: [...sim.c4], demo: [...sim.demo], start: startMin,
  };
}
function planSummary() {
  const units: Record<string, number> = {};
  for (const u of sim.units) units[u.kind] = (units[u.kind] ?? 0) + 1;
  const supports: Record<string, number> = {};
  for (const b of sim.supports) supports[b.kind] = (supports[b.kind] ?? 0) + 1;
  let gates = 0, walls = 0;
  for (const z of sim.inZone) { if (z === 3) gates++; else if (z === 2) walls++; }
  return { zoneCells: sim.zoneCells, zoneCost: sim.zoneClosed ? sim.zoneCost() : 0, gateCells: gates, wallCells: walls, units, supports, abilities: { ...sim.bought }, c4: sim.c4.size, budgetLeft: sim.remaining() };
}
const cityTag = () => ({ city: dailyDate ? `daily:${dailyDate}` : customMap ? `osm:${customMap.name}` : city ? city.id : "quick", seed, difficulty: sim.difficulty, mutators: [...activeMutators] });
function importPlan(p: Plan) {
  sim.ignoreFootprint = true; // 0.23: an old plan may overlap under the new footprints; it still loads
  try { importPlanInner(p); } finally { sim.ignoreFootprint = false; }
}
function importPlanInner(p: Plan) {
  for (const z of p.zones ?? (p.poly.length ? [p.poly] : [])) sim.addZone(z);
  for (const i of p.walls) if (sim.inZone[i] === 3) { sim.inZone[i] = 2; sim.wallHp[i] = sim.wallMaxHp(); }
  sim.fieldDirty = true;
  for (const [k, x, y] of p.supports ?? []) if (k === "budget") sim.placeSupport(k, x, y);
  for (const [k, x, y] of p.supports ?? []) if (k !== "budget") sim.placeSupport(k, x, y);
  let doubled = 0;
  const placed: Unit[] = []; // 0.50: plan index -> unit (a placeholder where it didn't fit), for the groups
  for (const [k, x, y, m, ord, sb] of p.units) {
    const err = sim.place(k, x, y);
    if (err && sim.buildingTaken(k, x, y)) doubled++; // 0.49: one Garrison / Sniper team per building
    if (err) { placed.push(GONE); continue; } // didn't fit: its orders go with it
    const u = sim.units[sim.units.length - 1];
    placed.push(u);
    if (m) u.mode = m;
    if (ord && sim.canOrder(u)) { u.orders = ord.map(o => ({ ...o })); u.cmd = true; u.standby = !!sb; if (sb) u.holdAt = [u.x, u.y]; } // 0.45
  }
  sim.groups = pruneGroups(groupsFromPlan(p.groups, placed, sim.zones.length), u => u !== GONE); // 0.50
  for (const k of ABILITY_KINDS) for (let n = p.abilities?.[k] ?? 0; n > 0; n--) sim.buyAbility(k);
  for (const b of p.c4 ?? []) if (sim.bridges[b] && sim.remaining() >= C.C4_COST) sim.c4.add(b);
  for (const i of p.demo ?? []) sim.toggleDemo(i % sim.w, (i / sim.w) | 0); // 0.38
  if (doubled) say(`${doubled === 1 ? "A Troops squad or Sniper team shared a building" : `${doubled} Troops squads or Sniper teams shared buildings`} in this plan; one per building now, the extra ${doubled === 1 ? "one was" : "ones were"} left out.`, 6000);
}
function newSim(keepPlan: boolean, newSeed = false) {
  closeOutBattle(); // 0.57: a battle left before it ended is recorded as abandoned
  armedMenu = null; // 0.55
  clearTicker(); closePerson();
  const plan = keepPlan ? exportPlan() : null;
  if (newSeed) seed = Math.floor(Math.random() * 1e9);
  if (city?.realArea && !realAreaMap(city.realArea)) { const c = city; loadRealArea(c.realArea!).then(() => { if (city === c) newSim(keepPlan, false); }); return; } // review #2
  sim = new Sim(seed, simOpts());
  sim.setStartTime(startMin); // 0.40: people where they'd be at that hour
  if (plan) importPlan(plan);
  log("info", "restart", { ...cityTag(), keptPlan: keepPlan });
  draft = []; pings = []; speed = 1; tipGates = false; lastWave = 0; warnedWave = -1; warnShown = false; outbreakShown = false; xpGiven = 0; roundShown = false;
  recordDone = false; lastRecord = null; lastBroken = []; placesCache = null; endDismissed = false;
  syncDev();
  buildBase(); buildZone(); fitCamera();
  $("end").hidden = true;
  refreshUi();
}

// ---------- Screens: title, cities, how to play, settings, pause ----------
const stack: string[] = []; // open screens, top last
function show(id: string | null) {
  document.querySelectorAll<HTMLElement>(".screen").forEach(e => (e.hidden = e.id !== "s-" + id));
  $("screens").hidden = !id;
  if (id === "cities") renderCities();
  if (id === "settings") { syncSettings(); renderMods(); const vb = document.getElementById("versions-btn") as HTMLButtonElement | null; if (vb) { vb.disabled = mode === "game"; $("ver-ingame").hidden = mode !== "game"; } }
  if (id === "record") renderRecord();
  if (id === "controls") { promptAct = null; renderControls(); setControlsMsg(""); } // 0.55
  if (id === "slots") renderSlots();
  if (id === "howto") codexShown();
}
function go(id: string) { armedMenu = null; stack.push(id); show(id); }
// ---------- 0.47: the Codex (How to Play) ----------
let codex: ReturnType<typeof mountCodex> | null = null;
const cxLink = (id: string) => `<a class="cx-link" data-cx="${id}" title="Open in the Codex">?</a>`;
let codexSlot: number | null | undefined; // the save slot the Codex last showed badges for
let codexBack: { cat: string | null } | null = null; // 0.47.1: a "?" opened from the map goes Back to the map (and its picker), not Pause
function codexShown() {
  const slot = Save.activeSlot();
  const seen = () => seenFor(save.settings.codexSeen, slotPrevVersion(slotVersions, slot, save.gameVersion));
  if (!codex) codex = mountCodex($("codex"), $<HTMLInputElement>("codex-q"), {
    media: (window as any).HORDE_CODEX ?? {}, diagrams: DIAGRAMS,
    seen: seen(), open: save.settings.codexOpen,
    canPlayClip: document.createElement("video").canPlayType('video/webm; codecs="vp9"') !== "",
    onOpenChange: ids => { save.settings.codexOpen = ids; Save.store(save); },
    log: (what, d) => log("warn", "codex", { what, ...d }),
  });
  else if (slot !== codexSlot) codex.setProfile(seen(), save.settings.codexOpen); // another slot's badges and open sections
  codexSlot = slot;
  if (save.settings.codexSeen !== C.VERSION) { save.settings.codexSeen = C.VERSION; Save.store(save); } // badges stay for this visit
}
function openCodex(id: string) {
  if (mode === "game" && !stack.length) {
    const cat = buildCat;
    pause();
    codexBack = { cat }; stack.length = 0; // Back closes the Codex straight into the game
  }
  if (stack[stack.length - 1] !== "howto") go("howto");
  codex!.open(id);
}
document.addEventListener("click", e => {
  const a = (e.target as HTMLElement).closest?.(".cx-link") as HTMLElement | null;
  if (a?.dataset.cx) { e.preventDefault(); e.stopPropagation(); openCodex(a.dataset.cx); }
}, true);
function renderRecord() {
  const xp = save.xp ?? 0, rk = P.rankFor(xp), have = save.achievements ?? {};
  $("rec-rank").textContent = `${rk.name} · ${xp.toLocaleString()} XP${rk.next ? ` · ${rk.next[0]} at ${rk.next[1].toLocaleString()} XP` : " · top rank"}`;
  $("rec-unlocks").innerHTML = Object.entries(P.UNLOCK_XP).sort((a, b) => a[1] - b[1])
    .map(([k, x]) => `<div class="${xp >= x ? "got" : ""}"><b>${toolName(k)}</b><span>${xp >= x ? "Unlocked" : `${x.toLocaleString()} XP`}</span></div>`).join("");
  $("rec-ach").innerHTML = P.ACHIEVEMENTS.map(a => `<div class="${have[a.id] ? "got" : ""}"><b>${a.name}</b><span>${a.desc}${have[a.id] ? ` · ${have[a.id]}` : ""}</span></div>`).join("");
}
function back() {
  stack.pop();
  const top = stack[stack.length - 1] ?? null;
  if (!top && mode === "game") resume(); else show(top);
}

function cityUnlocked(i: number) { return P.campaignOpen(save.best, i); } // 0.35: old campaign medals carry over
function cityBestHtml(cityId: string, lockedMsg: string | null, unplayed: string, areaKeys?: string[]) {
  if (lockedMsg) return `<span class="best" style="color:#8a919c">${lockedMsg}</span>`;
  const cur = difficultyFor(false, save.settings.difficulty);
  const bestAt = (d: C.Difficulty) => areaKeys ? bestOfAreas(save.best, areaKeys, d) : save.best[bestKey(cityId, d)]; // 0.36: a real city = its best area
  const marks = C.DIFFICULTY_IDS.map(d => {
    const b = bestAt(d);
    const m = b?.medal && C.MEDALS.find(x => x[0] === b.medal);
    const ch = d[0].toUpperCase();
    return `<b class="dmark" data-diff="${d}" title="${C.DIFFICULTY[d].name}: ${b?.medal ?? "No medal"}" style="color:${m ? m[2] : "#555c66"};margin-right:4px">${ch}</b>`;
  }).join("");
  const best = bestAt(cur);
  const medal = best && C.MEDALS.find(m => m[0] === best.medal);
  const txt = best ? `${best.medal ?? "No medal"} · ${best.pct.toFixed(0)} pts${best.underBudget ? " · Under Budget" : ""}${best.mayhem ? ` · Mayhem ${best.mayhem.toLocaleString()}` : ""}` : unplayed;
  return `<span class="best" style="color:${medal ? medal[2] : "#8a919c"}">${marks} · ${txt}</span>`;
}
function updateDailyButton() {
  const dc = C.dailyChallengeFor();
  const best = save.daily?.[dc.date];
  const mNames = dc.mutators.map(m => C.MUTATORS[m].name).join(" + ");
  $("daily").innerHTML = `<span>Daily: ${dc.city.name}</span><small>${best?.medal ? `${best.medal} (${best.pct.toFixed(0)} pts)` : mNames}</small>`;
}
function syncDifficultyButtons() {
  const cur = difficultyFor(false, save.settings.difficulty);
  document.querySelectorAll<HTMLButtonElement>("button[data-diff]").forEach(b => {
    const d = b.dataset.diff as C.Difficulty;
    b.classList.toggle("on", d === cur);
  });
}
function renderCities() {
  syncDifficultyButtons();
  const mlist = $("mutatorlist");
  mlist.innerHTML = "";
  for (const id of C.MUTATOR_IDS) {
    const m = C.MUTATORS[id];
    const b = document.createElement("button");
    b.className = "mutator" + (activeMutators.has(id) ? " on" : "");
    b.title = m.desc;
    b.innerHTML = `<b style="color:${m.color}">${m.name}</b><span>${m.short}</span>`;
    b.addEventListener("click", () => {
      if (activeMutators.has(id)) activeMutators.delete(id); else activeMutators.add(id);
      renderCities();
    });
    mlist.appendChild(b);
  }
  const list = $("citylist");
  list.innerHTML = "";
  C.CITIES.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "city";
    const stars = "●".repeat(1 + Math.floor((i * 4) / (C.CITIES.length - 1)));
    b.innerHTML = `<b>${c.name}</b><span class="stars" title="danger">${stars}</span><span class="blurb">${c.blurb}</span>` +
      cityBestHtml(c.id, !cityUnlocked(i) ? `Locked: win a medal in ${C.CITIES[i - 1].name}` : null, "Not played");
    b.disabled = !cityUnlocked(i);
    b.addEventListener("click", () => { dailyDate = null; customMap = null; playCity(c); });
    list.appendChild(b);
  });
  const rlist = $("realcitylist");
  rlist.innerHTML = "";
  C.REAL_CITIES.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "city";
    const stars = "●".repeat(1 + Math.floor((i * 4) / (C.REAL_CITIES.length - 1)));
    b.innerHTML = `<b>${c.name}</b><span class="stars" title="danger">${stars}</span><span class="blurb">${c.blurb}</span>` +
      cityBestHtml(c.id, null, c.areas?.length ? `${c.areas.length} battle areas · OpenStreetMap` : "OpenStreetMap · Ready", c.areas?.map(a => a.key));
    b.addEventListener("click", () => { dailyDate = null; customMap = null; openRealCity(c); });
    rlist.appendChild(b);
  });
}

function syncSettings() {
  $<HTMLInputElement>("opt-fs").checked = save.settings.fullscreen;
  $<HTMLInputElement>("opt-edge").checked = save.settings.edgeScroll;
  $<HTMLInputElement>("opt-ranges").checked = save.settings.showRanges;
  $<HTMLInputElement>("opt-tips").checked = save.settings.tips !== false; // 0.41
  $<HTMLInputElement>("opt-checkupd").checked = save.settings.checkUpdates !== false;
  $<HTMLInputElement>("opt-autoupd").checked = !!save.settings.autoUpdate;
  $<HTMLInputElement>("opt-dev").checked = !!save.settings.devMode;
  $<HTMLSelectElement>("opt-crowd").value = String(save.settings.crowd ?? C.CIVILIANS);
  const v = save.settings.vol ?? { master: 0.8, sfx: 0.8, music: 0.5 };
  $<HTMLInputElement>("vol-master").value = String(Math.round(v.master * 100));
  $<HTMLInputElement>("vol-sfx").value = String(Math.round(v.sfx * 100));
  $<HTMLInputElement>("vol-music").value = String(Math.round(v.music * 100));
}
function applyFullscreen() {
  const on = save.settings.fullscreen;
  if (Save.desktop) Save.desktop.setFullscreen(on);
}

// ---------- 0.39: the person window and Follow ----------
let selPerson = -1, following = false, lastPersonHtml = "";
function selectPerson(k: number) {
  selPerson = k; lastPersonHtml = "";
  if (sim.refuser[k] === 1 && tipPossible("refuse")) tip("refuse"); // 0.44: the refuser tip comes with their window (no rings)
  if (following) following = followable(sim, k);
  renderPerson();
  log("info", "person-select", { k });
  renderSelection(); // 0.51
}
function closePerson() { selPerson = -1; following = false; $("person").hidden = true; lastPersonHtml = ""; renderSelection(); } // 0.51: the selection panel says so
function renderPerson() {
  if (selPerson < 0 || mode !== "game") { if (!$("person").hidden) $("person").hidden = true; return; }
  const html = personHtml(sim, selPerson, following);
  if (html !== lastPersonHtml) {
    const keep = $("person").querySelector(".pw-story")?.scrollTop ?? 0; // keep the story where the player scrolled it
    $("person").innerHTML = html; lastPersonHtml = html;
    const st = $("person").querySelector(".pw-story"); if (st) st.scrollTop = keep;
  }
  $("person").classList.toggle("following", following);
  $("person").hidden = false;
}
function centerOn(x: number, y: number) { cam.x = canvas.width / 2 - x * cam.scale; cam.y = canvas.height / 2 - y * cam.scale; }
function followTick() {
  if (!followable(sim, selPerson)) { following = false; notify(followEndLine(sim, selPerson)); renderPerson(); return; }
  centerOn(sim.ax[selPerson], sim.ay[selPerson]);
}
$("person").addEventListener("click", ev => {
  const t = ev.target as HTMLElement;
  const fam = t.closest<HTMLElement>("[data-k]");
  if (fam) { selectPerson(+fam.dataset.k!); if (following) centerOn(sim.ax[selPerson], sim.ay[selPerson]); return; }
  const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "close") closePerson();
  else if (act === "follow" && followable(sim, selPerson)) {
    following = !following;
    if (following && cam.scale < 6) cam.scale = 6; // close enough to see them
    renderPerson();
  } else if (act === "home") { following = false; const c = sim.homeCell[selPerson]; if (c >= 0) centerOn((c % sim.w) + 0.5, ((c / sim.w) | 0) + 0.5); renderPerson(); }
});

function startAttract() {
  closeOutBattle(); // 0.57
  loadSeq++; // a pending area load must not pull the player back into a battle
  $("timepick").hidden = true; closePerson(); // 0.39
  clearTicker();
  mode = "attract"; city = null; customMap = null; dailyDate = null; showHeatmap = false;
  document.body.classList.add("attract");
  seed = Math.floor(Math.random() * 1e9);
  sim = new Sim(seed);
  sim.startBattle();
  speed = 2;
  resize(); buildBase(); buildZone(); fitCamera();
  $("end").hidden = true;
  updateDailyButton();
  syncDifficultyButtons();
  stack.length = 0; go("title");
  snd.music("title");
}


/** 0.36: a real area's map is decoded on first use (async); everything else starts at once. */
// Each start bumps loadSeq; an area decode that finishes after another start (Daily, Load battle, Title) is dropped.
let loadSeq = 0;
function playCity(c: C.CityDef | null, seedOverride?: number) {
  const tok = ++loadSeq;
  if (c?.realArea && !realAreaMap(c.realArea)) {
    const btn = document.getElementById("cm-play") as HTMLButtonElement | null; if (btn) btn.disabled = true;
    const done = () => { if (btn) btn.disabled = false; };
    const want = { daily: dailyDate, custom: customMap };
    loadRealArea(c.realArea).then(() => { done(); if (tok === loadSeq) { dailyDate = want.daily; customMap = want.custom; playCityNow(c, seedOverride); } },
      err => { done(); if (tok === loadSeq) alert((err as Error).message); });
    return;
  }
  playCityNow(c, seedOverride);
}
function playCityNow(c: C.CityDef | null, seedOverride?: number) {
  closeOutBattle(); recordDone = false; lastRecord = null; lastBroken = []; placesCache = null; endDismissed = false; // 0.57
  clearTicker(); $("timepick").hidden = true; closePerson();
  mode = "game"; city = c; showHeatmap = false;
  document.body.classList.remove("attract");
  stack.length = 0; show(null);
  seed = seedOverride ?? (c ? c.seed : Math.floor(Math.random() * 1e9));
  sim = new Sim(seed, simOpts());
  const planKey = dailyDate ? `daily:${dailyDate}` : c ? c.id : null;
  const saved = planKey && save.plans[planKey];
  if (saved) importPlan(saved);
  log("info", "city-start", { ...cityTag(), loadedPlan: !!saved, civilians: sim.civN });
  $("osm-credit").hidden = !(c?.real || customMap);
  const firstTime = !!c?.recipe && !anyMedal(save.best, c.id);
  if (c?.intro && firstTime) setTimeout(() => say(c.intro!.join(" "), 12000), 600); // 0.35: what this city teaches
  else if (c?.trial && !P.unlocked(c.trial, save.xp ?? 0)) setTimeout(() => say(`Field trial: ${toolName(c.trial!)} is on loan to you in ${c.name}. Earn ${P.UNLOCK_XP[c.trial!].toLocaleString()} XP to keep it everywhere.`, 9000), 600);
  if (!needsTimePick(false)) startMin = 600;
  sim.setStartTime(startMin); // 0.40 (the picker re-places when a time is chosen)
  Object.assign(perf, new Perf()); // perf numbers cover play time only
  draft = []; pings = []; speed = 1; tipGates = false; lastWave = 0; warnedWave = -1; warnShown = false; outbreakShown = false; xpGiven = 0; roundShown = false;
  showRanges = save.settings.showRanges;
  resize(); buildBase(); buildZone(); fitCamera();
  $("end").hidden = true;
  const baseName = dailyDate ? `Daily (${dailyDate}): ${c?.name ?? ""}` : customMap ? `OSM: ${customMap.name}` : c ? c.name : "Quick battle";
  $("cityname").textContent = `${baseName} · ${sim.diff.name}`;
  syncDev();
  setTool(saved ? "sniper" : "zone"); refreshUi();
  const mutStr = activeMutators.size ? ` Active mutators: ${[...activeMutators].map(m => C.MUTATORS[m].name).join(", ")}.` : "";
  const planMsg = (saved ? `Your last plan is loaded. Change it or press Start.`
    : "Plan your defense: draw a safe zone, add gates, place units, then Start.") + mutStr;
  if (needsTimePick(false)) openTimePick(saved?.start ?? startMin, () => say(planMsg, 6000));
  else say(planMsg, 6000);
}

// ---------- 0.39: start-time picker ----------
function timePickOpen() { return !$("timepick").hidden; }
function openTimePick(pre: number, then: () => void) {
  const grid = $("tp-grid");
  const choose = (min: number) => { startMin = min; sim.setStartTime(min); buildZone(); $("timepick").hidden = true; log("info", "start-time", { min }); refreshUi(); then(); };
  grid.innerHTML = START_CHOICES.map(c => `<button data-min="${c.min}"${c.min === pre ? ' class="sel"' : ""}>${c.label}<small>${formatClock(c.min)}</small></button>`).join("") +
    `<button data-min="random">Random<small>any hour</small></button>`;
  grid.onclick = ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-min]");
    if (!b) return;
    choose(b.dataset.min === "random" ? randomStart(Math.floor(Math.random() * 1e9)) : +b.dataset.min!);
  };
  const sel = $<HTMLSelectElement>("tp-hour");
  sel.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h * 60}">${formatClock(h * 60)}</option>`).join("");
  sel.value = String(Math.floor(pre / 60) * 60);
  $("tp-set").onclick = () => choose(+sel.value);
  $("timepick").hidden = false;
}

/** 0.36: a real city opens its City Map; a city with no baked areas plays its old single map. */
let cmUi: CityMapUi | null = null;
function openRealCity(c: C.CityDef) {
  const model = c.areas?.length ? cityMapModel(c.id) : null;
  if (!model) { playCity(c); return; }
  const cv = $<HTMLCanvasElement>("cm-canvas");
  go("citymap");
  cv.width = Math.round(cv.clientWidth * devicePixelRatio); cv.height = Math.round(cv.clientHeight * devicePixelRatio);
  const d = difficultyFor(false, save.settings.difficulty);
  cmUi = {
    model, view: fitView(model, cv.width, cv.height), selected: -1, onPick: i => pickArea(model.areas[i].key),
    medalColor: key => { const b = save.best[bestKey(key, d)]; const m = b?.medal && C.MEDALS.find(x => x[0] === b.medal); return m ? m[2] : null; },
  };
  $("cm-title").textContent = model.name.toUpperCase();
  $("cm-card").hidden = true;
  const list = $("cm-list"); list.innerHTML = "";
  model.areas.forEach(a => {
    const b = document.createElement("button"); b.className = "city"; b.dataset.key = a.key;
    const info = areaCardInfo(a.key, save.best, d);
    b.innerHTML = `<b>${a.name}</b><span class="best" style="color:${cmUi!.medalColor(a.key) ?? "#8a919c"}">${info.best}</span>`;
    b.addEventListener("click", () => pickArea(a.key));
    list.appendChild(b);
  });
  drawCityMap(cv, cmUi);
}
function pickArea(key: string) {
  if (!cmUi) return;
  cmUi.selected = cmUi.model.areas.findIndex(a => a.key === key);
  const info = areaCardInfo(key, save.best, difficultyFor(false, save.settings.difficulty));
  $("cm-area").textContent = info.title; $("cm-best").textContent = info.best; $("cm-card").hidden = false;
  $("cm-card").dataset.key = key;
  document.querySelectorAll<HTMLElement>("#cm-list .city").forEach(e => e.classList.toggle("sel", e.dataset.key === key));
  drawCityMap($<HTMLCanvasElement>("cm-canvas"), cmUi);
}
bindCityMap(document.getElementById("cm-canvas") as HTMLCanvasElement, () => cmUi, () => { if (cmUi) drawCityMap($<HTMLCanvasElement>("cm-canvas"), cmUi); });
$("cm-play").addEventListener("click", () => { const key = $("cm-card").dataset.key; const c = key && C.areaCity(key); if (c) { dailyDate = null; customMap = null; playCity(c); } });

function playDaily() {
  const dc = C.dailyChallengeFor();
  dailyDate = dc.date;
  customMap = null;
  activeMutators.clear();
  for (const m of dc.mutators) activeMutators.add(m);
  playCity(dc.city, dc.seed);
}

function pause() {
  if (armedMenu) setMenu(null); // 0.55
  if (mode !== "game") return;
  if (endDismissed) { endDismissed = false; showHeatmap = false; refreshUi(); return; } // 0.57: Menu brings the finished battle's report back
  codexBack = null;
  log("info", "pause", { phase: sim.phase, t: +sim.time.toFixed(1) });
  if (!speedLocked()) speed = 0; // 0.48: on Hard/Insane the menu opens but the battle carries on
  refreshUi();
  stack.length = 0; go("pause");
}
function resume() {
  stack.length = 0; show(null);
  if (sim.phase === "battle") speed = battleSpeed();
  if (codexBack?.cat) setBuildTab(codexBack.cat);
  codexBack = null;
  refreshUi();
}

let xpGiven = 0; // XP already credited for this battle (round end, then the rest at the final end)
let lastNews = ""; // new unlocks / achievements from the latest result, for the end card
function recordResult(r: Score) {
  const xp0 = save.xp ?? 0;
  if (r.xp > xpGiven) { save.xp = xp0 + r.xp - xpGiven; xpGiven = r.xp; Save.store(save); }
  const news: string[] = [];
  const fresh = P.newlyUnlocked(xp0, save.xp ?? 0).map(toolName);
  if (fresh.length) news.push(`Unlocked: ${fresh.join(", ")}`);
  save.achievements = save.achievements ?? {};
  const got = P.earned({ r, kills: sim.kills, held: Math.max(0, sim.time - C.WARNING_S), lifts: sim.liftsFlown, nukes: sim.nukesUsed, unitsLost: sim.unitsLost, daily: !!dailyDate, usedAbilities: sim.abilitiesUsed }, save.achievements);
  for (const a of got) save.achievements[a.id] = new Date().toISOString().slice(0, 10);
  if (got.length) { news.push(`Achievement${got.length > 1 ? "s" : ""}: ${got.map(a => a.name).join(", ")}`); log("info", "achievements", { ids: got.map(a => a.id) }); }
  if (fresh.length) log("info", "unlocked", { tools: fresh, xp: save.xp });
  lastNews = news.join(" · ");
  Save.store(save);
  const rank = (m: string | null) => (m ? C.MEDALS.length - C.MEDALS.findIndex(x => x[0] === m) : 0);
  if (dailyDate) {
    save.daily = save.daily ?? {};
    const prev = save.daily[dailyDate];
    save.daily[dailyDate] = mergeBest(prev, r.score, r.medal ?? null);
    Save.store(save);
    return;
  }
  if (!city) return;
  if (city.recipe) { // 0.35: one-time bonus for a campaign city's first medal
    const cb = P.clearBonus(city, anyMedal(save.best, city.id), r.medal ?? null);
    if (cb) {
      const x0 = save.xp ?? 0; save.xp = x0 + cb;
      const fr = P.newlyUnlocked(x0, save.xp).map(toolName);
      lastNews = [lastNews, `First medal in ${city.name}: +${cb.toLocaleString()} XP`, fr.length ? `Unlocked: ${fr.join(", ")}` : ""].filter(Boolean).join(" · ");
      log("info", "clear-bonus", { city: city.id, xp: cb, total: save.xp });
    }
  }
  const key = bestKey(city.id, sim.difficulty);
  const prev = save.best[key];
  // 0.20: pct holds the round score (0..100); old entries were "% evacuated" and only go when beaten
  save.best[key] = mergeBest(prev, r.score, r.medal ?? null); // never drops a medal (final review #1)
  if (r.mayhem !== undefined && r.mayhem > (save.best[key].mayhem ?? -1)) save.best[key] = { ...save.best[key], mayhem: r.mayhem };
  save.best[key] = mergeEfficiency(save.best[key], r.perM, r.underBudget); // 0.48
  Save.store(save);
}

// ---------- 0.57: battle records ----------
let endDismissed = false; // 0.57 review: the player closed the finished battle's report to look at the map (H or Menu brings it back)
let recordDone = false; // the final record of this battle is written (leaving after it writes nothing more)
let lastRecord: BattleRecord | null = null, lastBroken: { key: string; was: number | null; now: number }[] = [];
let placesCache: { sim: Sim; places: Places } | null = null;
let recQueue: Promise<unknown> = Promise.resolve(); // history writes, one after another
function placesFor(s: Sim): Places {
  if (placesCache?.sim === s) return placesCache.places;
  const streets = customMap?.streets ?? (city?.realArea && !customMap ? realAreaStreets(city.realArea) : undefined);
  const real = !!customMap || !!city?.real; // a real map without baked names gets none (a made-up name would be wrong)
  const places = buildPlaces(s.map, s.seed, { streets, generate: !real, area: city?.realArea ? city.name : null, schools: s.schools.length });
  placesCache = { sim: s, places };
  return places;
}
function battleKind(): BattleKind { return dailyDate ? "daily" : customMap ? "osm" : city?.recipe ? "campaign" : city?.real ? "real" : city ? "campaign" : "quick"; }
function battleName(): string { return dailyDate ? `Daily ${dailyDate}${city ? ": " + city.name : ""}` : customMap ? customMap.name : city ? city.name : "Quick battle"; }
/** Build this battle's record now (synchronously, from the live sim) and queue the history write. */
function writeRecord(kind: "round" | "final" | "abandoned", r: Score, done?: () => void): BattleRecord {
  const s = sim, t0 = performance.now();
  let town; try { town = buildTownReport(townInputFromSim(s, placesFor(s), battleName()), Number.parseInt(s.stats.battleId.replace(/[^0-9a-f]/gi, "").slice(0, 7) || "0", 16)); }
  catch (err) { log("error", "town-report", { error: String((err as Error)?.stack ?? err) }); }
  const pp = partPoints(r.parts);
  const rec = makeRecord(
    { id: s.stats.battleId, date: new Date().toLocaleDateString("en-CA"), version: C.VERSION, cityId: dailyDate ? `daily:${dailyDate}` : customMap ? "osm" : city?.id ?? "quick",
      cityName: battleName(), kind: battleKind(), difficulty: s.difficulty, sirenMin: s.startMin, flags: { dev: !!s.stats.flags?.dev || !!save.settings.devMode, modded: !!s.stats.flags?.modded } },
    { medal: r.medal ?? null, score: r.score, parts: { saved: pp.saved, speed: pp.speed, city: pp.city, kills: pp.kills }, roundComplete: s.roundDone, abandoned: kind === "abandoned",
      keepFighting: r.mayhem !== undefined || s.stats.ev.k.includes(SE_KEEP_FIGHTING), ...(r.mayhem !== undefined ? { mayhem: r.mayhem } : {}) },
    r, s.stats, { roundAt: s.roundAt, nukes: s.nukesUsed, bridges: s.blown.size, crushed: s.crushed, budget: s.budget, held: Math.max(0, (kind === "round" && s.roundAt !== null ? s.roundAt : s.time) - C.WARNING_S), people: s.civN, town });
  if (kind !== "round") recordDone = true;
  lastRecord = rec; lastBroken = [];
  log("info", "battle-record", { kind, id: rec.meta.id, ms: Math.round(performance.now() - t0), stories: town?.stories.length ?? 0, flags: rec.meta.flags });
  const slot = Save.activeSlot();
  if (!slot) { done?.(); return rec; } // no slot picked: shown, not kept
  recQueue = recQueue.then(async () => {
    if (Save.activeSlot() !== slot) { log("warn", "battle-record-skipped", { id: rec.meta.id, why: "slot changed" }); return; } // the player switched slots meanwhile: leave that slot alone
    const res = await persistRecord(() => Save.readHistory(slot), h => Save.writeHistory(slot, h), save.career ?? emptyCareer(), rec);
    if (!res.career) { log("error", "battle-record-not-kept", { id: rec.meta.id, why: res.why }); return; } // 0.57 review: the career only counts what the history kept
    save.career = res.career; Save.store(save);
    if (lastRecord === rec) lastBroken = res.broken;
    done?.();
  }).catch(err => log("error", "battle-record-failed", { error: String((err as Error)?.stack ?? err) }));
  return rec;
}
/** The player is leaving this battle (restart, new city, menu, load, quit): record it if it isn't already. */
function closeOutBattle() {
  if (mode !== "game" || recordDone) return;
  const o = outcomeFor({ phase: sim.phase, roundDone: sim.roundDone, endNow: false, leaving: true, keepFighting: false });
  if (o === "none") return;
  if (o === "final" && sim.phase === "battle") sim.callIt(); // leaving during Keep fighting: score it as pulled out
  const r = o === "abandoned" ? sim.scoreNow("You left the battle before the round was over.") : sim.result ?? sim.roundResult;
  if (r) writeRecord(o === "abandoned" ? "abandoned" : "final", r);
}

// 0.57: the after-action report on the end card
let erTab: Tab = "overview", erCols: Col[] = [...DEFAULT_COLS];
function renderReport() {
  const r = lastRecord; if (!r) return;
  $("er-head").innerHTML = headerHtml(r, { xpLine: "", news: lastNews });
  $("er-tabs").innerHTML = tabsHtml(erTab, true);
  $("er-body").innerHTML = tabHtml(erTab, r, { broken: lastBroken, live: true, timelineCols: erCols });
}
$("end").addEventListener("click", ev => {
  const el = ev.target as HTMLElement;
  const tab = el.closest<HTMLElement>("[data-tab]"); if (tab) { erTab = tab.dataset.tab as Tab; renderReport(); return; }
  if (el.closest("[data-act=heatmap]")) { $("end-heatmap").click(); return; }
  const st = el.closest<HTMLElement>(".er-story[data-k]");
  if (st && !st.querySelector(".er-log")) { // a story's people: each one's full log, in place
    const k = Number(st.dataset.k), lead = sim.famLead[k], a = lead >= 0 ? lead : k, b = lead >= 0 ? Math.min(sim.civN, lead + sim.famSize[lead]) : k + 1;
    const nameOf = (j: number) => personAt(sim, j)?.first ?? "family";
    const html = Array.from({ length: Math.min(6, b - a) }, (_, i) => a + i).map(j => {
      const p = personAt(sim, j); if (!p) return "";
      return `<div class="er-log"><b>${esc(p.first)} ${esc(p.last)}, ${p.age}</b><ul>${sim.storyOf(j).map(e => `<li>${esc(clockSpanText(e.t))} ${esc(storyLine(e.code, e.arg, nameOf))}</li>`).join("")}</ul></div>`;
    }).join("");
    st.insertAdjacentHTML("beforeend", html);
  }
});
$("end").addEventListener("change", ev => {
  const el = ev.target as HTMLInputElement; if (!el.dataset.col) return;
  erCols = Array.from($("end").querySelectorAll<HTMLInputElement>("[data-col]")).filter(x => x.checked).map(x => x.dataset.col as Col);
  renderReport();
});
$("end").addEventListener("mousemove", ev => { // hover readout on a chart
  const svg = (ev.target as Element).closest?.("svg.er-svg") as SVGSVGElement | null; if (!svg || !lastRecord) return;
  const w = Number(svg.dataset.w), pl = Number(svg.dataset.pl), pr = Number(svg.dataset.pr), rc = svg.getBoundingClientRect();
  const x = (ev.clientX - rc.left) / rc.width * w, sm = sampleAt(lastRecord, x - pl, w - pl - pr); if (!sm) return;
  const ro = svg.nextElementSibling?.querySelector(".er-readout"); if (!ro) return;
  const cols = erTab === "money" ? ["money", "spent"] as Col[] : erTab === "timeline" ? erCols : DEFAULT_COLS;
  ro.textContent = `${fmtT(sm.t)}: ` + cols.map(c => `${COL_NAMES[c]} ${c === "money" || c === "spent" || c === "damage" ? C.money(sm[c]) : Math.round(sm[c]).toLocaleString("en-US")}`).join(" \u00b7 ");
  const cur = svg.querySelector(".er-cursor"); if (cur) { cur.setAttribute("x1", String(x)); cur.setAttribute("x2", String(x)); cur.setAttribute("stroke-opacity", "0.4"); }
});
const clockSpanText = (t: number) => formatClock(clockMin(sim.startMin, t));

// ---------- Input ----------
// Alert ticker (0.19): hordes, breaches, losses and tips scroll along the top bar. say() is for replies to a click.
const alerts = new AlertQueue();
let tickerBusy = false;
/** until: sim time after which the alert is stale and skipped (horde warnings). */
function notify(text: string, urgent = false, until?: number) { alerts.push(text, urgent, until); runTicker(); }
/** 0.41: a one-line tip the first time something shows up (once per save; Settings > Tips switches them off). */
/** Cheap check before any costly test for a tip (tips on, not seen yet). */
function tipPossible(id: TipId) { return mode === "game" && save.settings.tips !== false && !(save.settings.tipsSeen ?? []).includes(id); }
function tip(id: TipId) {
  if (mode !== "game") return;
  const seen = save.settings.tipsSeen ?? [];
  if (!shouldTip(id, seen, save.settings.tips !== false)) return;
  save.settings.tipsSeen = [...seen, id]; Save.store(save);
  notify(`Tip: ${withKeys(TIPS[id])}`, false, sim.time + 25);
}
function runTicker() {
  if (tickerBusy) return;
  const box = $("ticker");
  if (!box.clientWidth) return; // strip hidden (menus): wait, never start a 0 s scroll that would never end
  const a = alerts.shift(sim.time);
  if (!a) return;
  tickerBusy = true;
  const sp = document.createElement("span");
  sp.textContent = a.text; sp.className = a.urgent ? "urgent" : "";
  box.appendChild(sp);
  const from = box.clientWidth, to = -sp.offsetWidth;
  sp.style.transform = `translateX(${from}px)`;
  sp.getBoundingClientRect(); // commit the start position before the transition
  sp.style.transition = `transform ${((from - to) / 120).toFixed(2)}s linear`;
  sp.style.transform = `translateX(${to}px)`;
  sp.addEventListener("transitionend", () => { sp.remove(); tickerBusy = false; alerts.done(); runTicker(); }, { once: true });
}
function clearTicker() { alerts.clear(); $("ticker").replaceChildren(); tickerBusy = false; }
function say(m: string, ms = 4000) { message = m; messageT = performance.now(); messageMs = ms; }
let messageMs = 4000;

/** 0.22.1: picking the tool you already hold puts it down (back to Move/Aim). */
function toggleTool(t: Tool) { if (tool === t && t !== "pan") setTool("pan"); else setTool(t); }
function setTool(t: Tool) {
  if (!isOpen(t)) { say(`${toolName(t)} unlocks at ${P.UNLOCK_XP[t].toLocaleString()} XP. You have ${(save.xp ?? 0).toLocaleString()}.`, 3500); return; }
  orderSel = null; nukeArm = null;
  if (t === "order") { t = "pan"; say("Select units (click them or drag a box), then right-click where to send them. Q attack-move, R patrol, E escort, F stop, G stand by.", 6000); } // 0.45: the Order card now opens unit control
  if (t !== "pan" && (sel.length || armedCmd)) { sel = []; armedCmd = null; renderActions(); } // 0.44: the strip goes with the selection
  tool = t; strikeStart = null;
  openCatFor(t); // 0.51 review: after tool = t, so the right tile lights
  if (t !== "zone") draft = [];
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  renderQuickbar();
  const hints: Record<Tool, string> = {
    pan: "Right-drag to move the map, wheel to zoom. Click a unit to select it (drag a box for several): right-click sends mobile units or an AC-130, T changes what it shoots first, X or Delete removes it (an AC-130 goes home).",
    order: "Unit control: select units with Move/Aim (click or drag a box), then right-click where to send them. Q attack-move, R patrol, E escort, F stop, G stand by.",
    barrage: C.ABILITIES.barrage.hint, moab: C.ABILITIES.moab.hint, nuke: C.ABILITIES.nuke.hint,
    a10: C.ABILITIES.a10.hint, cluster: C.ABILITIES.cluster.hint, tomahawk: C.ABILITIES.tomahawk.hint, gunship: C.ABILITIES.gunship.hint,
    himars: "Click a street or park, ideally inside your zone (free reloads). Ripples 6 rockets at the thickest crowd up to 460 m away. Nothing closer than 60 m.",
    tank: "Click a street. An M1 Abrams: machine gun plus a 120 mm main gun, 3,000 HP armor. Patrols, kites, drives home to rearm. Takes strike orders (Order tool).",
    apache: "Click anywhere inside your safe zone. An AH-64 flies over everything, hunting infected near its post with a 30 mm gun and rockets. Takes strike orders (Order tool) anywhere.",
    reaper: "Click anywhere inside your safe zone. An MQ-9 drone loiters over a wide area firing Hellfires at the densest packs. Takes strike orders (Order tool) anywhere.",
    howitzer: "Click a street or park inside your zone. Howitzers shell the thickest crowds far away, slowly. Can't hit anything close.",
    apc: "Click a street, even outside the zone. The APC guards that spot; out of ammo it drives into the zone, reloads and comes back.",
    depot: "Click a fuel depot (orange) to set it off: a huge blast that kills everyone near it, civilians too.",
    gunboat: "Click the river. The gunboat patrols the water near where you put it and shoots crowds by the banks. Infected can't reach it.",
    zone: "Click corners of your safe zone. Click the first corner (or press Enter) to close it. Esc cancels.",
    gate: "Click a crossing to switch gate (blue: civilians get in, weaker) / wall (white: nobody gets in, stronger). In battle you can still close gates.",
    garrison: "Click a roof (they fortify there) or a street in your zone. Troops fire fast at short range. In battle they deploy from the zone.",
    sniper: "Click a roof (they fortify there) or a street in your zone. Taller buildings give snipers more range (press J to see heights). In battle they deploy from the zone.",
    turret: "Click a street. Turrets fire very fast but never reload.",
    remove: "Planning: click a unit or support building to remove it for a full refund (or select it with Move/Aim and press Delete). Battle: it stops working and is pulled out after a while, then refunds.",
    battleship: "Click the river. A slow, heavy warship whose guns shell crowds far inland. Set its target (Move map, click it) to cover your walls or civilians on the run.",
    mortar: "Click a street or park. Mortars lob shells far into crowds of infected, but can't hit anything close.",
    evac: C.SUPPORTS.evac.hint, police: C.SUPPORTS.police.hint, militia: C.SUPPORTS.militia.hint,
    budget: C.SUPPORTS.budget.hint, repair: C.SUPPORTS.repair.hint, radio: C.SUPPORTS.radio.hint,
    supply: C.SUPPORTS.supply.hint, command: C.SUPPORTS.command.hint,
    para: C.ABILITIES.para.hint, airstrike: C.ABILITIES.airstrike.hint, firebomb: C.ABILITIES.firebomb.hint,
    supply_drop: C.ABILITIES.supply_drop.hint,
    c4: "Click a bridge or a building to plant a charge, click again to remove it. Battle: click a charged one to blow it. A building drops into rubble that slows everyone: block a road or clear a sight line.",
  };
  $("hint").textContent = hints[t]; $("hint").title = hints[t]; // one line in the footer; the full text on hover
}

function closeDraft() {
  if (draft.length < 3) { say("A safe zone needs at least 3 corners."); return; }
  const extra = sim.zones.length > 0, battle = sim.phase === "battle";
  const err = sim.addZone(draft);
  log(err ? "warn" : "info", "zone", err ? { error: err, corners: draft.length } : { corners: draft.length, cells: sim.zoneCells, cost: sim.zoneCost(), budgetLeft: sim.remaining() });
  if (err) say(err, 5000);
  else {
    draft = []; buildZone();
    if (battle) { log("info", "zone-added-in-battle", { zones: sim.zones.length, t: +sim.time.toFixed(1), left: sim.remaining() }); say("New safe zone up. Its crossings are open gates.", 4000); setTool("pan"); }
    else if (extra) { say("Extra safe zone added. Use Clear zone to start over."); setTool("sniper"); }
    else { say("Safe zone built. Every road crossing is a gate (blue). Wall some off if you like, then place units."); setTool("sniper"); }
  }
  refreshUi();
}

function draftCost() {
  const pts = hover && draft.length ? [...draft, hover] : draft;
  return sim.priceOf(pts);
}

function click(cx: number, cy: number) {
  const x = Math.floor(cx), y = Math.floor(cy);
  const planning = sim.phase === "plan";
  if (tool === "pan") {
    if (armedCmd) { aimArmed(cx, cy); return; } // 0.45: A/P/E then click
    const snap = squadNearScreen(cam.x + cx * cam.scale, cam.y + cy * cam.scale); // 0.52: a click near a soldier picks its squad first
    const hit = snap ? { unit: snap } as Entity : sim.entityAt(cx, cy); // 0.44: clicking a unit selects it (T changes its targeting, Delete removes it)
    selSoldier = snap ? nearestSoldier(snap, cx, cy) : sim.soldierAt(cx, cy)?.soldier ?? null; // 0.49: and a soldier's dot shows their card
    const add = keys.has("shift");
    if (hit) {
      const same = (e: Entity) => entObj(e) === entObj(hit);
      sel = add ? (sel.some(same) ? sel.filter(e => !same(e)) : [...sel, hit]) : [hit];
      selZone = -1; renderActions(); return;
    }
    if (!add) { sel = []; selZone = -1; renderActions(); }
    const k = sim.civAt(cx, cy, Math.max(0.6, 8 / cam.scale)); // 0.39: click a white dot to see who they are
    if (k >= 0) { selectPerson(k); return; }
    if (!add && x >= 0 && y >= 0 && x < sim.w && y < sim.h && sim.inZone[sim.idx(x, y)] === 1) { selZone = sim.zoneAt(x, y); renderActions(); } // 0.50: open zone ground selects the zone
    return;
  }
  if (tool === "order") {
    if (!orderSel) {
      const u = sim.mobileAt(cx, cy);
      if (!u) { say("Click an APC, squad, paratroopers or boat first."); return; }
      orderSel = u; say(`${C.UNITS[u.kind].name} selected. Click where to send it.`, 3000); return;
    }
    const e = sim.orderUnit(orderSel, x, y);
    if (e) { say(e); return; }
    log("info", "order", { kind: orderSel.kind, x, y, t: +sim.time.toFixed(1) });
    say(`${C.UNITS[orderSel.kind].name} moving out.`, 2500); orderSel = null;
    return;
  }
  if (!planning && tool === "remove") {
    const r = sim.sellAt(cx, cy);
    if (typeof r === "string") say(r); else { tip("sell"); say(`Pulling the unit out: ${r.toFixed(0)} s. It won't fight meanwhile; you get its cost back when it's out.`, 4000); log("info", "sell-in-battle", { x, y, secs: r }); }
    return;
  }
  switch (tool) {
    case "zone": {
      if (sim.zoneClosed && draft.length === 0) say(`This starts an extra safe zone: ${C.money(C.EXTRA_ZONE_BASE)} plus ${C.money(C.EXTRA_ZONE_PER_CELL)} per cell.${planning ? " Clear zone redraws the first one instead." : ""}`, 5000);
      const p: [number, number] = [Math.round(cx), Math.round(cy)];
      if (draft.length >= 3) {
        const [fx, fy] = draft[0];
        if (Math.hypot(fx - cx, fy - cy) * cam.scale < 14) { closeDraft(); return; }
      }
      draft.push(p);
      break;
    }
    case "gate": {
      const before = x >= 0 && y >= 0 && x < sim.w && y < sim.h ? sim.inZone[sim.idx(x, y)] : 0;
      const e = sim.toggleGate(x, y);
      if (e) say(e); else buildZone();
      break;
    }
    case "remove": if (!sim.removeAt(x, y)) say("No unit or support building there (or removing a Budget Office would exceed your budget)."); break;
    case "depot": {
      if (planning) { say("Fuel depots go off during the battle. Plan around them."); break; }
      const e = sim.blowDepot(x, y);
      if (e) say(e); else { say("Boom."); log("info", "depot-blown", { x, y, t: +sim.time.toFixed(1) }); }
      break;
    }
    case "garrison": case "sniper": case "turret": case "mortar": case "howitzer": case "apc": case "gunboat": case "battleship": case "himars": case "tank": case "apache": case "reaper": {
      const placedTip = () => { tip("targeting"); if (tool === "apc" || tool === "tank" || tool === "gunboat") tip("mobile"); }; // 0.41
      if (!planning && (tool === "garrison" || tool === "sniper")) { const e = sim.placeTroopsAt(tool, x, y); if (e) say(e); else { placedTip(); say(`${C.UNITS[tool].name} deploying at the zone (${C.UNITS[tool].deploy} s)${sim.map.tile[sim.idx(x, y)] === BUILDING ? ", then off to fortify that roof" : ""}.`, 2500); log("info", "bought-in-battle", { kind: tool, x, y, left: sim.remaining() }); } break; } // 0.50 review I6
      if (!planning) { const e = sim.place(tool, x, y); if (e) say(e); else { placedTip(); say(`${C.UNITS[tool].name} deploying (${C.UNITS[tool].deploy} s).`, 2000); log("info", "bought-in-battle", { kind: tool, x, y, left: sim.remaining() }); } break; } const e = sim.place(tool, x, y); if (e) say(e); else placedTip(); break; }
    case "evac": case "budget": case "repair": case "radio": case "supply": case "command": case "police": case "militia": {
      const e = sim.placeSupport(tool, x, y);
      if (!e && tool === "evac" && sim.supports.filter(b => b.kind === "evac").length === 2) tip("padCost"); // 0.41
      if (e) say(e);
      else if (!planning) { say(`${C.SUPPORTS[tool].name} deploying (${C.SUPPORTS[tool].deploy} s).`, 2000); log("info", "bought-in-battle", { kind: tool, x, y, left: sim.remaining() }); }
      break;
    }
    case "c4": {
      const b = sim.bridgeAt(x, y);
      if (b < 0 && sim.map.tile[sim.idx(x, y)] === BUILDING) { // 0.38: building demolition
        const d = sim.demoAt(x, y);
        const e = planning || d < 0 ? sim.toggleDemo(x, y) : sim.blowBuilding(x, y);
        if (e) say(e);
        else if (planning) { say(d >= 0 ? "Charge removed." : "Demolition charge planted. Blow it during the battle.", 2500); if (d < 0) tip("c4"); }
        else if (d < 0) say("Charge planted. Click the building again to bring it down.", 3000);
        else { say("Building down!"); log("info", "building-blown", { x, y, t: +sim.time.toFixed(1) }); }
        break;
      }
      const e = planning || (b >= 0 && !sim.c4.has(b)) ? sim.toggleC4(x, y) : sim.blowBridge(x, y);
      if (!e && !planning && b >= 0 && !sim.blown.has(b)) { say("Charge planted. Click the bridge again to blow it.", 3000); refreshUi(); break; }
      if (e) say(e); else if (!planning) { say("Bridge down!"); log("info", "bridge-blown", { x, y, t: +sim.time.toFixed(1) }); }
      break;
    }
    case "airstrike": case "firebomb": case "para": case "supply_drop": case "barrage": case "moab": case "nuke": case "a10": case "cluster": case "tomahawk": case "gunship": {
      if (planning) { say("Buy abilities with their buttons now; aim them during the battle."); break; }
      const zs = tool === "nuke" || tool === "moab" ? sim.zoneHitShare(tool, cx, cy) : 0; // 0.38: the outside controller can hit the zone, with a warning
      if ((tool === "nuke" || (tool === "moab" && zs > 0)) && (!nukeArm || Math.hypot(nukeArm[0] - cx, nukeArm[1] - cy) > 4)) {
        nukeArm = [cx, cy];
        const hit = zs > 0 ? ` It reaches ${Math.max(1, Math.round(zs * 100))}% of your safe zone: walls, buildings and people inside will be hit.` : "";
        say(tool === "nuke" ? `Nuclear strike: everything within 160 m dies, people in your zone too.${hit} Click the same spot again to confirm.` : `MOAB warning:${hit} Click the same spot again to confirm.`, 7000);
        break;
      }
      nukeArm = null;
      if (!sim.charges[tool]) { // 0.22: the tool stays armed; each click buys the next one, like placing units
        const be = sim.buyAbility(tool);
        if (be) { say(be, 2500); strikeStart = null; break; }
        log("info", "bought-in-battle", { kind: tool, left: sim.remaining() });
      }
      const line = tool === "airstrike" || tool === "a10";
      if (line && !strikeStart) { strikeStart = [cx, cy]; say("Now click where the run ends."); break; }
      const [sx, sy] = line ? strikeStart! : [cx, cy];
      const e = sim.useAbility(tool, sx, sy, cx, cy);
      strikeStart = null;
      if (e) { say(e); break; }
      log("info", "ability", { kind: tool, x: Math.round(sx), y: Math.round(sy), t: +sim.time.toFixed(1), left: sim.charges[tool] });
      say(`${C.ABILITIES[tool].name} inbound.`, 2500);
      if (tool === "nuke") setTool("pan");
      break;
    }
  }
  refreshUi();
}

let drag: { x: number; y: number; moved: boolean; pan: boolean } | null = null;
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => {
  if (armedMenu) setMenu(null); // 0.55: a click on the map lets go of a waiting build menu
  if (mode !== "game") return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 }; // 0.45: left-drag with Move/Aim draws a selection box; right/middle-drag pans
});
canvas.addEventListener("pointermove", e => {
  const dpr = devicePixelRatio;
  const [cx, cy] = toCell(e.offsetX * dpr, e.offsetY * dpr);
  hover = cx >= 0 && cy >= 0 && cx < sim.w && cy < sim.h ? [cx, cy] : null;
  if (hover && tool === "pan" && cam.scale >= 3 && sim.phase === "battle" && tipPossible("people") && sim.civAt(cx, cy, 0.8) >= 0) tip("people"); // 0.41 (battle: buckets, not a full scan)
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.pan && drag.moved) { following = false; cam.x += dx * dpr; cam.y += dy * dpr; drag.x = e.clientX; drag.y = e.clientY; }
    else if (!drag.pan && drag.moved && tool === "pan" && !armedCmd) { // 0.45: the selection box
      const r = canvas.getBoundingClientRect();
      box = [(drag.x - r.left) * dpr, (drag.y - r.top) * dpr, e.offsetX * dpr, e.offsetY * dpr];
    }
  }
});
/** 0.45: the minimap, top right: 220 px wide (160 under 900 px), redrawn 4 times a second. */
const mini = $<HTMLCanvasElement>("minimap"), miniCtx = mini.getContext("2d")!;
let miniT = 0, miniDrag = false;
function minimap(now: number) {
  const show = mode === "game" && !stack.length;
  if (mini.hidden === show) mini.hidden = !show;
  if (!show || now - miniT < 250) return;
  miniT = now;
  const box = $("hud-mini"), bw = Math.max(80, box.clientWidth - 10), bh = Math.max(60, box.clientHeight - 10); // 0.51: fits its panel
  const ar = Math.min(1.2, sim.h / sim.w), cssW = Math.round(Math.min(bw, bh / ar)), cssH = Math.round(cssW * ar);
  const dpr = devicePixelRatio;
  if (mini.width !== Math.round(cssW * dpr) || mini.height !== Math.round(cssH * dpr)) {
    mini.width = Math.round(cssW * dpr); mini.height = Math.round(cssH * dpr); mini.style.width = cssW + "px"; mini.style.height = cssH + "px";
  }
  drawMinimap(miniCtx, sim, baseImg, zoneImg, cam, { w: canvas.width, h: canvas.height });
}
// 0.48: minimap alerts (all difficulties). The sim throttles per area; the blip is throttled again here.
const miniPings = $<HTMLCanvasElement>("minipings"), pingCtx = miniPings.getContext("2d")!;
let pings: Ping[] = [], lastBlip = -1e9;
function stepPings() {
  if (mode !== "game") { sim.pingLog.length = 0; return; }
  let urgent = false;
  while (sim.pingLog.length) { const p = sim.pingLog.shift()!; pings.push(p); if (p.kind !== "bite" && p.kind !== "wall") urgent = true; }
  pings = pings.filter(p => sim.time - p.t < C.PING_LIFE_S);
  if (pings.length > 40) pings = pings.slice(-40);
  if (urgent && performance.now() - lastBlip > 3000) { lastBlip = performance.now(); snd.play(["radio-1", "radio-2", "radio-3"], 0, 0.22, 0.04); }
  const show = !mini.hidden;
  if (miniPings.hidden === show) miniPings.hidden = !show;
  if (!show) return;
  if (miniPings.width !== mini.width || miniPings.height !== mini.height) { miniPings.width = mini.width; miniPings.height = mini.height; miniPings.style.width = mini.style.width; miniPings.style.height = mini.style.height; }
  drawPings(pingCtx, pings, sim.time, C.PING_LIFE_S, sim.w, sim.h, devicePixelRatio);
}
/** F: jump the camera to the most urgent live alert. */
function jumpToPing() {
  const p = pickPing(pings, sim.time, C.PING_LIFE_S);
  if (!p) { say("No alerts right now.", 1500); return; }
  following = false; centerOn(p.x, p.y); miniT = 0;
}
function miniCell(e: PointerEvent | MouseEvent): [number, number] {
  const r = mini.getBoundingClientRect();
  return miniToWorld((e.clientX - r.left) * (mini.width / r.width), (e.clientY - r.top) * (mini.height / r.height), mini.width, mini.height, sim.w, sim.h);
}
mini.addEventListener("contextmenu", e => e.preventDefault());
mini.addEventListener("pointerdown", e => {
  e.stopPropagation();
  const [x, y] = miniCell(e);
  if (e.button === 2) { if (orderable().length || selOrbits().length) moveOrder(x, y); miniT = 0; return; } // right-click: send the selected units / AC-130s
  if (e.button !== 0) return;
  mini.setPointerCapture(e.pointerId); miniDrag = true; following = false; centerOn(x, y); miniT = 0;
});
mini.addEventListener("pointermove", e => { if (miniDrag) { const [x, y] = miniCell(e); centerOn(x, y); miniT = 0; } });
mini.addEventListener("pointerup", () => { miniDrag = false; });

/** 0.45: units that take orders inside the dragged box (canvas px); Shift adds to the selection. */
function boxSelect(b: [number, number, number, number]) {
  const [x0, x1] = [Math.min(b[0], b[2]), Math.max(b[0], b[2])], [y0, y1] = [Math.min(b[1], b[3]), Math.max(b[1], b[3])];
  const s = cam.scale, inside: Entity[] = [];
  for (const u of sim.units) {
    if (!sim.canOrder(u) || (u.deployT && u.deployT > 0)) continue;
    const pts = u.soldiers ? u.soldiers.filter(so => so.alive).map(so => [so.x, so.y]) : [[u.x + 0.5, u.y + 0.5]]; // 0.50: any soldier of a squad
    if (pts.some(([ux, uy]) => { const px = cam.x + ux * s, py = cam.y + uy * s; return px >= x0 && px <= x1 && py >= y0 && py <= y1; })) inside.push({ unit: u });
  }
  if (keys.has("shift")) { for (const e of inside) if (!sel.some(x => "unit" in x && "unit" in e && x.unit === e.unit)) sel.push(e); }
  else sel = inside;
  if (inside.length) { selZone = -1; closePerson(); tip("orders"); }
  renderActions();
}
canvas.addEventListener("dblclick", () => { // 0.50: every unit of that kind on screen
  if (mode !== "game" || tool !== "pan" || !hover) return;
  const snap = squadNearScreen(cam.x + hover[0] * cam.scale, cam.y + hover[1] * cam.scale); // 0.52: through the dots too
  const hit = snap ? { unit: snap } as Entity : sim.entityAt(hover[0], hover[1]);
  if (!hit || !("unit" in hit)) return;
  const kind = hit.unit.kind, s = cam.scale;
  sel = sim.units.filter(u => u.kind === kind && sim.groupAlive(u) && !(u.deployT && u.deployT > 0)).filter(u => {
    const [ux, uy] = u.soldiers ? sim.squadCenter(u) : [u.x + 0.5, u.y + 0.5];
    const px = cam.x + ux * s, py = cam.y + uy * s; return px >= 0 && py >= 0 && px <= canvas.width && py <= canvas.height;
  }).map(u => ({ unit: u }));
  selZone = -1; renderActions();
});
canvas.addEventListener("pointerleave", () => { if (!drag) hover = null; }); // 0.44: the cursor label goes when the pointer leaves the map
canvas.addEventListener("pointerup", e => {
  if (box) { boxSelect(box); box = null; }
  if (drag && !drag.moved && e.button === 0 && hover) click(hover[0], hover[1]);
  if (drag && !drag.moved && e.button === 2 && armedCmd) { armedCmd = null; renderActions(); } // 0.45: right-click cancels an armed command
  else if (drag && !drag.moved && e.button === 2 && tool === "pan" && (orderable().length || selOrbits().length) && hover) moveOrder(hover[0], hover[1]); // 0.45: right-click = move (0.46: AC-130s too)
  else if (drag && !drag.moved && e.button === 2) {
    if (tool === "zone" && draft.length) draft.pop();          // drawing a zone: drop the last corner
    else if (tool !== "pan") setTool("pan");                 // 0.19.1: right-click puts the tool down
  }
  drag = null;
});
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const dpr = devicePixelRatio, px = e.offsetX * dpr, py = e.offsetY * dpr;
  const f = Math.exp(-e.deltaY * 0.0015);
  const ns = Math.min(40, Math.max(0.5, cam.scale * f));
  cam.x = px - (px - cam.x) * (ns / cam.scale); cam.y = py - (py - cam.y) * (ns / cam.scale); cam.scale = ns;
}, { passive: false });

const keys = new Set<string>();
let loggedEjects = 0;
addEventListener("keydown", e => {
  const k = e.key;
  if (typingInField(e.target) && k !== "Escape" && !/^F\d+$/.test(k)) return; // 0.47.1: typing in a search box is not WASD
  const kk = keyOf(e), act = actionFor(kk, sel.length ? "selected" : "idle"); // 0.55: the live bindings
  keys.add(kk);
  // 0.55: build menus: menu key, then the item's letter. First of all game keys (review #2): a letter wins over any
  // always-key bound to it while its menu waits, and any other key lets go of the menu.
  if (mode === "game" && !stack.length && !e.ctrlKey && !e.metaKey && !e.altKey && rebindSlot === null && !e.repeat && !typingInField(e.target)) {
    const ms = menuStep(armedMenu, kk);
    if (ms.armed !== armedMenu) setMenu(ms.armed);
    if (ms.pick) { e.preventDefault(); pickTool(ms.pick); return; }
    if (!ms.passThrough) { e.preventDefault(); return; }
  }
  if (k === "F10") { e.preventDefault(); toggleDevPanel(); return; }
  if (act === "fullscreen") { e.preventDefault(); save.settings.fullscreen = !save.settings.fullscreen; Save.store(save); applyFullscreen(); return; }
  if (act === "quicksave") { e.preventDefault(); void saveGame(); return; } // 0.33: quick save
  if (act === "squad.next" && mode === "game" && !stack.length) { e.preventDefault(); cycleSquad(e.shiftKey); return; } // 0.52
  if (act === "speed.half" || act === "speed.normal" || act === "speed.fast") { e.preventDefault(); if (mode === "game" && !stack.length) setSpeed(act === "speed.half" ? 0.5 : act === "speed.normal" ? 1 : 2); return; } // 0.50: speed moved off 1/2/3
  if (k === "Escape") {
    if (!stack.length && mode === "game" && armedMenu) { setMenu(null); return; } // 0.55: a waiting build menu first
    if (stack.length) { const top = stack[stack.length - 1]; if (top !== "title" && !(top === "slots" && !Save.activeSlot())) back(); return; }
    if (mode === "game" && selPerson >= 0) { closePerson(); return; } // 0.39
    if (mode === "game" && armedCmd) { armedCmd = null; renderActions(); return; } // 0.45: an armed command first
    if (mode === "game" && sel.length) { sel = []; selSoldier = null; renderActions(); return; } // 0.44
    if (mode === "game" && selZone >= 0) { selZone = -1; renderActions(); return; } // 0.51 review: Esc lets go of a selected zone
    if (mode === "game" && draft.length) { draft = []; return; }
    if (mode === "game" && strikeStart) { strikeStart = null; return; }
    if (mode === "game" && $("end").hidden) pause();
    return;
  }
  if (mode !== "game" || stack.length) return;
  const tgt = e.target as HTMLElement | null;
  if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT")) return; // 0.44: typing is not a command
  // 0.54: the key map (keymap.ts, design ruling): WASD camera always, 1-5 groups, 6-0 quick bar, orders around WASD
  const kl = k.toLowerCase(), plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if ((k === "Delete" || k === "Backspace" || (act === "order.remove" && plain)) && sel.length) { e.preventDefault(); removeSelected(); return; }
  if (act === "order.target" && sel.length && plain) { cycleSelected(); return; }
  { const gi = groupIntent(kk, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }); // 0.50: battle groups (0.54: 1-5)
    if (gi) { e.preventDefault(); runGroup(gi); return; } }
  if (plain && rebindSlot === null && act?.startsWith("quick.")) { e.preventDefault(); useSlot(Number(act.slice(6)) - 1); return; } // 0.54: quick bar
  { const it = keyIntent(kk, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }, orderable().length > 0); // 0.45
    if (it) { e.preventDefault(); runIntent(it); return; } }
  if (act === "order.topup" && plain && sel.length) { topUpSelected(); return; } // 0.49
  if (act === "pause") { e.preventDefault(); if (sim.phase === "battle") setSpeed(speed ? 0 : battleSpeed()); return; }
  if (!plain) return;
  if (act === "alert") { if (sim.phase === "battle") jumpToPing(); return; } // 0.48 (0.54: was F)
  if (act === "view.heights") showHeights = !showHeights;
  else if (act === "view.ranges") showRanges = !showRanges;
  else if (act === "view.heatmap") { showHeatmap = !showHeatmap; if (endDismissed && !showHeatmap) endDismissed = false; refreshUi(); } // 0.57: heatmap off again brings the report back
  else if (k === "Enter" && tool === "zone" && draft.length) closeDraft();
  else if (act === "tool.zone") setTool("zone");
  else if (act === "tool.remove") setTool("remove");
  else if (act === "tool.order") setTool("order");
  else if (act === "tool.pan") setTool("pan");
  else if (act === "tool.gate") setTool("gate"); // 0.41
  else if (act === "tool.recall") $("recall").click();
  else if (act === "tool.closegates") $("closegates").click(); else if (act === "tool.clear") $("clear").click();
});
addEventListener("keyup", e => { keys.delete(keyOf(e)); keys.delete(e.key.toLowerCase()); });

/** 0.48: Hard and Insane lock the clock once the battle starts (no pause, 1x) until the round is scored. */
function speedLocked() { return mode === "game" && sim.phase === "battle" && sim.diff.noPause && !sim.roundResult; }
function battleSpeed() { return speedLocked() ? 1 : pausedSpeed || 1; }
function setSpeed(s: number, dev = false) {
  if (speedLocked() && !dev && s !== 1) { say(`${sim.diff.name}: the battle runs in real time. No pause, no speed change.`, 2500); s = 1; }
  speed = s === 4 ? 2 : s;
  if (speed === 0.5 || speed === 1 || speed === 2) { if (pausedSpeed !== speed) { pausedSpeed = speed; if (mode === "game") { save.settings.speed = speed; Save.store(save); } } }
  refreshUi();
} // 0.30.1: half, real time, 2x (dev tools keep 8x/16x)
function startBattle() {
  if (timePickOpen()) return; // 0.39: pick a time first
  if (sim.phase !== "plan") return;
  if (!sim.zoneClosed) { say("Draw a safe zone first."); return; }
  if (draft.length) { say("Finish or cancel (Esc) the zone you're drawing first."); return; }
  const planKey = dailyDate ? `daily:${dailyDate}` : city ? city.id : null;
  if (planKey) { save.plans[planKey] = exportPlan(); Save.store(save); }
  if (sim.units.filter(u => sim.canOrder(u)).length >= 2) tip("groups"); // 0.50
  sim.startBattle(); speed = battleSpeed(); setTool("pan"); refreshUi(); tip("views"); // 0.41
  sim.stats.flags = { dev: !!save.settings.devMode, modded: modReports.some(m => m.changes > 0) }; // 0.57
  if ((save.career?.battles ?? 0) >= 1) tip("report"); // 0.57: from the second battle on
  if (sim.classKids > 0) notify("Schools are walking their students to your safe zone. Parents: meet your kids there.", false, sim.time + 30); // 0.41 (Insane school day)
  snd.music("battle");
  log("info", "battle-start", { ...cityTag(), ...planSummary(), sites: sim.sites.map(([x, y]) => [Math.round(x), Math.round(y)]) });
  messageT = -1e9; // the planning tip goes; battle news runs in the ticker
}

// ---------- HUD ----------
function refreshUi() {
  renderActions(); // 0.44
  const planning = sim.phase === "plan";
  $("budget").textContent = C.money(sim.remaining());
  $("phase").textContent = planning ? "PLANNING" : sim.phase === "battle" ? "BATTLE" : "OVER";
  const sb = $("startbtn"), label = planning ? "Start Battle" : "Restart";
  if (sb.textContent !== label) { sb.textContent = label; startLabelT = performance.now(); }
  sb.classList.toggle("restart", !planning);
  $<HTMLButtonElement>("closegates").disabled = sim.phase === "over";
  $<HTMLButtonElement>("recall").disabled = sim.phase !== "battle";
  { const rb = $("recall"), ic = rb.querySelector("img")!, k = sim.recalled ? "sendback" : "recall"; // 0.51.1: picture + tooltip
    if (ic.dataset.oicon !== k) { ic.dataset.oicon = k; ic.src = orderIcon(k); rb.dataset.tip = sim.recalled ? "Send back" : "Recall units";
      rb.dataset.tipdesc = sim.recalled ? "Send the recalled units back to where they were." : CMD_DESC.recall; }
    rb.classList.toggle("on", sim.recalled); }
  $("heatmapbtn").classList.toggle("on", showHeatmap);
  $("mut-badges").innerHTML = [...sim.mutators].map(m => `<span style="border-color:${C.MUTATORS[m].color};color:${C.MUTATORS[m].color}" title="${C.MUTATORS[m].desc}">${C.MUTATORS[m].name}</span>`).join("");
  for (const k of C.BUILDABLE) $(`cost-${k}`).textContent = C.money(sim.unitCost(k));
  for (const k of C.SUPPORT_KINDS) $(`cost-${k}`).textContent = C.money(sim.supportCost(k));
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(b => {
    const lockOut = speedLocked() && Number(b.dataset.speed) !== 1; // 0.48: Hard/Insane, real time only
    b.disabled = planning || lockOut; b.classList.toggle("on", !planning && Number(b.dataset.speed) === speed);
    b.title = lockOut ? `${sim.diff.name}: no pause or speed change in battle` : (b.dataset.key ?? ""); // 0.55: the live key (labelSpeedKeys)
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    const t = b.dataset.tool as Tool;
    if (t === "depot") b.disabled = sim.phase !== "battle" || sim.depots.every(d => d.used);
    else if (t === "c4") b.disabled = sim.phase === "over";
    else if (isAbility(t)) b.disabled = sim.phase === "over";
    else if (t === "remove") b.disabled = sim.phase === "over";
    else if (t !== "pan" && t !== "gate") b.disabled = sim.phase === "over";
  });
  for (const k of ABILITY_KINDS) $(`n-${k}`).textContent = `${C.money(sim.abilityCost(k))}${sim.charges[k] ? ` ×${sim.charges[k]}` : ` (${C.ABILITIES[k].max - sim.bought[k]})`}`;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    const t = b.dataset.tool!, lock = !isOpen(t);
    b.classList.toggle("locked", lock);
    if (lock) { b.disabled = true; const sm = b.querySelector("small"); if (sm) sm.textContent = `${(P.UNLOCK_XP[t] / 1000).toFixed(1)}k XP`; b.title = `Unlocks at ${P.UNLOCK_XP[t].toLocaleString()} XP`; }
    else if (b.title.startsWith("Unlocks at")) b.title = "";
  });
  $("n-depot").textContent = `×${sim.depots.filter(d => !d.used).length}`;
  renderBuild(); // 0.51: prices, charges, locks
  renderQuickbar(); // 0.54
  $("n-c4").textContent = `${C.money(C.C4_COST)}${sim.c4.size - sim.blown.size ? ` ×${sim.c4.size - sim.blown.size}` : ""}`;
}

let lastHud = 0;
let warnShown = false, outbreakShown = false;
let orderSel: import("./sim").Unit | null = null, nukeArm: [number, number] | null = null;
const DIRS = ["north", "east", "south", "west"];
const ROUTE: Record<string, string> = { highway: "on the highway", rail: "along the rail line", bridge: "over the bridge", road: "by road", river: "up the river" };
function routeNames(ids: number[]) {
  const parts = ids.map(i => sim.entries[i]).filter(Boolean).map(e => `${ROUTE[e.kind]} from the ${DIRS[e.edge]}`);
  return [...new Set(parts)].join(" and ") || "from outside the city";
}
const SIREN_S = 6; // the warning siren sounds this long at battle start, then fades
let tipGates = false, lastWave = 0, warnedWave = -1, lastBreaches = 0, lastEarned = 0, lastAlarm = 0;
function hud(now: number) {
  if (sel.length && now - actionsT > 250) { actionsT = now; renderActions(); }
  else if (!sel.length && mode === "game" && now - actionsT > 500) { actionsT = now; renderSelection(); } // 0.52: the roster stays live // 0.49: squad strength and the soldier card stay live (0.51: the selection panel and command card too)
  if (mode !== "game" || now - lastHud < 200) return;
  lastHud = now;
  runTicker(); // picks up alerts queued while the strip was hidden
  if (sim.phase === "battle") { // 0.41: tips the battle itself brings up
    if (sim.liftsAborted > 0) tip("waveOff");
    if (tipPossible("gunship") && sim.orbits.some(o => o.arrived && !o.leaving)) tip("gunship"); // 0.46.1: how to move it / send it home
    if (tipPossible("ammo") && sim.units.some(u => Number.isFinite(u.ammo) && u.ammo < (C.UNITS[u.kind]?.ammo ?? 0) * 0.25)) tip("ammo");
    if (sim.outbreak && !sim.roundDone && tipPossible("endRound") && sim.counts().civ <= sim.civN * 0.05) tip("endRound");
  }
  if (selPerson >= 0) renderPerson(); // 0.39
  const c = sim.counts();
  $("stats").innerHTML =
    `<span class="civ">Outside ${c.civ.toLocaleString()}</span>` +
    `<span class="safe">Safe ${c.safe.toLocaleString()}</span>` +
    `<span class="evac">Evacuated ${sim.evacuated.toLocaleString()}</span>` +
    `<span class="inf">Infected ${c.inf.toLocaleString()}</span>` +
    `<span>Killed ${sim.kills.toLocaleString()}</span>` +
    (sim.crushed ? `<span class="inf">Crushed ${sim.crushed.toLocaleString()}</span>` : "") +
    clockSpan(sim.startMin, sim.time) +
    (sim.phase === "battle" && sim.outbreak && !sim.roundDone ? `<button class="endround" data-act="endround" title="Score the round now: people in the zone count as saved, the rest are left behind">End round</button>` : "");
  $("budget").textContent = C.money(sim.remaining());
  if (sim.phase === "battle" && sim.lastIncome) $("budget").textContent += `  +${C.money(sim.lastIncome)}/10s`;
  if (sim.phase === "battle" && sim.lastUpkeep) $("budget").textContent += `  −${C.money(sim.lastUpkeep)} ops`; // 0.48: Insane upkeep
  if (tool === "zone" && draft.length) $("budget").textContent += `  (zone ≈ ${C.money(draftCost())})`;
  while (sim.orderLog.length) say(sim.orderLog.shift()!, 3000); // 0.45
  while (sim.soldLog.length) { const k = sim.soldLog.shift()!; const name = (C.UNITS[k as C.UnitKind] ?? C.SUPPORTS[k as C.SupportKind]).name; say(`${name} pulled out. Money refunded.`, 3000); log("info", "unit-sold", { kind: k, money: sim.remaining() }); }
  while (sim.lostLog.length) { const k = sim.lostLog.shift()!; const name = (C.UNITS[k as C.UnitKind] ?? C.SUPPORTS[k as C.SupportKind]).name; notify(`${name} lost!`); log("warn", "unit-lost", { kind: k, t: +sim.time.toFixed(1) }); }
  if (sim.earned !== lastEarned) { log("info", "income", { pay: sim.lastIncome, total: sim.earned, money: sim.remaining() }); lastEarned = sim.earned; }
  const msg = $("msg");
  msg.textContent = message;
  msg.style.opacity = now - messageT < messageMs ? "1" : "0";
  if (sim.phase === "battle") {
    if (!tipGates && sim.time > 30 && c.civ < sim.civN * 0.03 && sim.inZone.indexOf(3) >= 0) {
      tipGates = true; notify("Almost everyone is inside. Close the gates now: walls are much stronger.");
    }
    if (!sim.outbreak) {
      if (!warnShown) { warnShown = true; notify(`Emergency broadcast: outbreak reported. People are heading for the safe zones. First cases turn in ${Math.ceil(C.WARNING_S)} s.`, true); }
    } else if (!outbreakShown) { outbreakShown = true; notify("The first cases have turned. It's spreading.", true); log("info", "outbreak", { t: +sim.time.toFixed(1), ...c }); }
    if (sim.wave !== lastWave) {
      lastWave = sim.wave;
      const routes = routeNames(sim.waveEntries);
      log("info", "wave", { n: sim.wave, routes, count: sim.lastWaveCount, big: sim.lastWaveBig, t: +sim.time.toFixed(1), evacuated: sim.evacuated, ...c });
      snd.horn();
      if (sim.lastWaveBig) notify("A big one is coming.", true, sim.time + 20);
      notify(`Horde #${sim.wave} (${sim.lastWaveCount.toLocaleString()}) coming in ${routes}!`, true, sim.time + 20); tip("horde");
    }
    const left = sim.nextWaveT - sim.time;
    if (left > 0 && left < C.WAVE_WARN_S && warnedWave !== sim.wave) { warnedWave = sim.wave; notify(`Next horde in ${Math.ceil(left)} s, ${routeNames(sim.upcoming)}.`, true, sim.nextWaveT); }
    while (sim.liftLog.length) {
      const l = sim.liftLog.shift()!;
      if (l.kind === "abort") { notify("Evac lift waved off: too many infected at the pad!"); log("warn", "lift-abort", { x: l.x, y: l.y, t: +sim.time.toFixed(1) }); }
      else log("info", "lift", { n: l.n, x: l.x, y: l.y, total: sim.evacuated, t: +sim.time.toFixed(1) });
    }
  }
  if (sim.breaches > lastBreaches && now - lastAlarm > 30000) { notify("Breach: the infected are through a wall.", true); lastAlarm = now; }
  if (sim.breaches !== lastBreaches) { log("warn", "breach", { total: sim.breaches, t: +sim.time.toFixed(1) }); lastBreaches = sim.breaches; }
  if (sim.roundResult && !roundShown && sim.phase === "battle") { roundShown = true; speed = 0; showEnd(sim.roundResult, true); }
  if (sim.phase === "over" && sim.result && !endDismissed && ($("end").hidden || !$("end-round-row").hidden)) showEnd(sim.result, false); // 0.57 review: not while the player looks at the map
}

let roundShown = false;
/** 0.48: people saved per $1M, readable at any size (0.4, 12, 1,250). */
function fmtPerM(v: number) { return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString(); }
function showEnd(r: Score, round: boolean) {
  $("end-round-row").hidden = !round; $("end-final-row").hidden = round;
  const medal = C.MEDALS.find(m => m[0] === r.medal);
  $("end-medal").textContent = r.medal ?? "No medal";
  $("end-medal").style.color = medal ? medal[2] : "#aaa";
  $("end-reason").textContent = r.reason;
  $("end-headline").textContent = `Zombies killed: ${(r.kills + (r.killsAfter ?? 0)).toLocaleString()} · ${sim.diff.name}`;
  const pp = partPoints(r.parts), f0 = (v: number) => v.toFixed(0);
  const bestMayhem = city && !dailyDate ? save.best[bestKey(city.id, sim.difficulty)]?.mayhem : undefined;
  $("end-score").innerHTML = `Round score <b>${f0(r.score)}</b> = saved ${f0(r.parts.saved)}% (${f0(pp.saved)} pts) + speed (${f0(pp.speed)} pts) + city ${f0(r.parts.city)}% intact (${f0(pp.city)} pts) + ${f0(r.parts.kills)}% of the infected killed (${f0(pp.kills)} pts)` +
    (r.mayhem !== undefined ? `<br>Keep fighting: <b>Mayhem ${r.mayhem.toLocaleString()}</b> = ${(r.killsAfter ?? 0).toLocaleString()} kills + ${Math.floor((r.damageAfter ?? 0) / C.MAYHEM_DAMAGE_PER_POINT).toLocaleString()} for ${C.money(r.damageAfter ?? 0)} of damage${bestMayhem !== undefined && bestMayhem >= r.mayhem ? ` · best ${bestMayhem.toLocaleString()}` : city && !dailyDate ? " · new best" : ""}` : "");
  const held = Math.max(0, sim.time - C.WARNING_S), hm = Math.floor(held / 60), hs = Math.floor(held % 60);
  $("end-pct").textContent = `${r.pct.toFixed(1)}% saved (${r.saved.toLocaleString()} of ${sim.civN.toLocaleString()})${r.left ? ` · ${r.left.toLocaleString()} left behind` : ""}${r.refused || r.refusedLost ? " (people who refused to leave count only a little against it)" : ""} · held ${hm}:${String(hs).padStart(2, "0")} after the outbreak · ${sim.wave} hordes · ${sim.liftsFlown} lifts flown${sim.liftsAborted ? `, ${sim.liftsAborted} waved off` : ""}`;
  const by = new Map<C.UnitKind, [number, number]>();
  for (const u of sim.units) { const v = by.get(u.kind) ?? [0, 0]; by.set(u.kind, [v[0] + 1, v[1] + u.kills]); }
  const rows = [...by].map(([k, [n, kills]]) => `${n} ${C.UNITS[k].name}${n > 1 ? "s" : ""}: ${kills.toLocaleString()}`).join(" · ");
  const swStr = sim.swimmersKilled ? ` (${sim.swimmersKilled.toLocaleString()} swimmers)` : "";
  $("end-kills").textContent = `Killed ${sim.kills.toLocaleString()} infected${swStr}. ${rows}`;
  $("end-people").innerHTML = endStatsLines(r).map(esc).join("<br>"); // 0.42: refusers and accidental kills
  $("end-tiers").textContent = C.MEDALS.map(([n, p]) => `${n} ${p}`).join("  ·  ") + ` points (needs ${C.MEDAL_MIN_SAVED_PCT}% saved)`;
  recordResult(r);
  if (mode === "game" && (round || !recordDone)) { erTab = "overview"; writeRecord(round ? "round" : "final", r, () => { if (!$("end").hidden) renderReport(); }); } // 0.57 (showEnd re-runs while the card is hidden: write once)
  const rk = P.rankFor(save.xp ?? 0);
  const effBest = city && !dailyDate ? save.best[bestKey(city.id, sim.difficulty)]?.perM : undefined; // recordResult ran: includes this run
  const eff = r.perM !== undefined ? ` · ${fmtPerM(r.perM)} saved per $1M${effBest !== undefined && effBest > r.perM + 1e-9 ? ` (best ${fmtPerM(effBest)})` : effBest !== undefined ? " (best)" : ""}${r.underBudget ? " · Under Budget" : ""}` : "";
  $("end-xp").textContent = `Damage bill ${C.money(r.damage)} · spent ${C.money(r.spent)}${eff} · city ${r.intact.toFixed(0)}% intact${r.bonus ? ` · ${r.bonus} bonus +${C.BONUS_XP} XP` : ""} · ${round ? "this round" : "this battle"} +${r.xp.toLocaleString()} XP · ${rk.name}, ${(save.xp ?? 0).toLocaleString()} XP${rk.next ? ` (${rk.next[0]} at ${rk.next[1].toLocaleString()})` : ""}${lastNews ? ` · ${lastNews}` : ""}`;
  renderReport(); // 0.57
  snd.fanfare(!!r.medal);
  if (round) { $("end").hidden = false; log("info", "round-complete", { ...cityTag(), ...r, t: +sim.time.toFixed(1) }); refreshUi(); return; }
  log("info", "battle-end", { ...cityTag(), ...r, t: +sim.time.toFixed(1), evacuated: sim.evacuated, byTrain: sim.trainsEvacuated, lifts: sim.liftsFlown, liftsAborted: sim.liftsAborted, kills: sim.kills, swimmersKilled: sim.swimmersKilled, breaches: sim.breaches, waves: sim.wave, civKilledByUs: sim.civKilledByUs, abilitiesLeft: { ...sim.charges }, bridgesBlown: sim.blown.size, unitKills: [...by].map(([k, [n, kl]]) => `${k}x${n}:${kl}`) });
  const i = city && !dailyDate ? C.CITIES.indexOf(city) : -1;
  const next = i >= 0 ? C.CITIES[i + 1] : undefined;
  $("end-next").hidden = !next || !cityUnlocked(i + 1);
  if (next) $("end-next").textContent = `Next city: ${next.name}`;
  $("end-new").hidden = !!city || !!dailyDate;
  $("end-cities").hidden = !city && !dailyDate;
  $("end").hidden = false;
  refreshUi();
}

const heatmapImg = document.createElement("canvas");
let lastHeatUpdate = 0, lastHeatKind: C.UnitKind | null | undefined = undefined;
function drawHeatmap(now: number, s: number) {
  const kind = hoverUnitHeatmap;
  if (!showHeatmap && !kind) return;
  const grid = kind ? sim.killByKind[kind] : sim.killGrid;
  if (!grid || sim.kills === 0) return;
  if (now - lastHeatUpdate > 250 || lastHeatKind !== kind || heatmapImg.width !== sim.w) {
    lastHeatUpdate = now; lastHeatKind = kind;
    const w = sim.w, h = sim.h;
    heatmapImg.width = w; heatmapImg.height = h;
    const g = heatmapImg.getContext("2d")!, d = g.createImageData(w, h);
    let maxV = 1;
    // Compute 3x3 smoothed kill density so single-cell shots form clear tactical heat blobs
    const blur = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const sum = grid[i] * 3 + grid[i - 1] + grid[i + 1] + grid[i - w] + grid[i + w] +
          (grid[i - w - 1] + grid[i - w + 1] + grid[i + w - 1] + grid[i + w + 1]) * 0.5;
        if (sum > 0) {
          blur[i] = sum;
          if (sum > maxV) maxV = sum;
        }
      }
    }
    const logMax = Math.log1p(maxV);
    for (let i = 0; i < w * h; i++) {
      if (blur[i] <= 0) continue;
      const k = Math.min(1, Math.log1p(blur[i]) / logMax);
      let r = 0, gg = 0, b = 0;
      if (k < 0.45) {
        const u = k / 0.45;
        r = Math.round(140 + 115 * u); gg = Math.round(20 + 60 * u); b = Math.round(180 * (1 - u * 0.6));
      } else if (k < 0.8) {
        const u = (k - 0.45) / 0.35;
        r = 255; gg = Math.round(80 + 140 * u); b = Math.round(70 * (1 - u));
      } else {
        const u = (k - 0.8) / 0.2;
        r = 255; gg = Math.round(220 + 35 * u); b = Math.round(220 * u);
      }
      d.data.set([r, gg, b, Math.round(55 + 175 * k)], i * 4);
    }
    g.putImageData(d, 0, 0);
  }
  ctx.drawImage(heatmapImg, cam.x, cam.y, sim.w * s, sim.h * s);
  const title = kind ? `Kill Heatmap: ${C.UNITS[kind].name}s` : `Kill Heatmap (${sim.kills.toLocaleString()} kills)`;
  label(title, 18 * devicePixelRatio, 28 * devicePixelRatio);
}

// ---------- Render ----------
let lastDrawT = 0;
function draw(now: number) {
  const W = canvas.width, H = canvas.height;
  const frameDt = Math.min(0.1, Math.max(0, (now - lastDrawT) / 1000)) * (sim.phase === "battle" ? speed : 1); lastDrawT = now;
  if (glv.ok) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = "#0d0f12"; ctx.fillRect(0, 0, W, H); }
  ctx.imageSmoothingEnabled = false;
  if (sim.mapVersion !== mapVersion && (now - lastMapBuildT > 200 || sim.phase !== "battle")) buildBase(); // bridge fell or terrain/buildings took damage
  const s = cam.scale;
  if (!glv.ok) ctx.drawImage(showHeights ? heightImg : baseImg, cam.x, cam.y, sim.w * s, sim.h * s);
  scars.update(sim);
  if (scars.dirty && (now - scarUploadT > 200 || sim.phase !== "battle")) { scars.dirty = false; scarUploadT = now; glv.setScar(scars.canvas); }
  if (!glv.ok && !showHeights) ctx.drawImage(scars.canvas, cam.x, cam.y, sim.w * s, sim.h * s);
  if (sim.phase === "battle" && sim.tick % 10 === 0) buildZone();
  if (!glv.ok) ctx.drawImage(zoneImg, cam.x, cam.y, sim.w * s, sim.h * s);
  else glv.draw(cam, W, H, sim.w, sim.h, showHeights, sim.n, sim.ax, sim.ay, sim.state, Math.min(7, Math.max(1, s * 0.2)), sim.mutant);
  drawHeatmap(now, s);

  // Parachuted field supply crates on the ground.
  for (const sc of sim.supplyCrates) {
    const px = cam.x + sc.x * s, py = cam.y + sc.y * s, r = Math.max(4, s * 1.15);
    const left = Math.max(0, sc.until - sim.time);
    ctx.strokeStyle = "rgba(79,195,247,0.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(px, py, C.SUPPLY_CRATE_RADIUS * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const crateSp = SPRITE_CANVAS.supply_drop;
    if (crateSp && r >= 5) {
      spr(crateSp, px - r * 1.25, py - r * 1.25, r * 2.5, r * 2.5);
    } else {
      ctx.fillStyle = "#1e3a52"; ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 1.5;
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r); ctx.strokeRect(px - r, py - r, 2 * r, 2 * r);
    }
    const k = left / C.SUPPLY_CRATE_S;
    ctx.fillStyle = "#000"; ctx.fillRect(px - r, py + r + 2, 2 * r, 2.5);
    ctx.fillStyle = "#4fc3f7"; ctx.fillRect(px - r, py + r + 2, 2 * r * k, 2.5);
  }

  // Fires (under the agents so you can see who is burning).
  for (const f of sim.fires) {
    const px = cam.x + f.x * s, py = cam.y + f.y * s, R = f.r * s;
    const fade = Math.min(1, (f.until - sim.time) / 2);
    const g = ctx.createRadialGradient(px, py, 0, px, py, R);
    const flick = 0.75 + 0.25 * Math.sin(now / 70 + f.x);
    g.addColorStop(0, `rgba(255,220,120,${0.85 * fade * flick})`);
    g.addColorStop(0.6, `rgba(255,110,20,${0.6 * fade})`);
    g.addColorStop(1, "rgba(160,30,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, R, 0, 7); ctx.fill();
  }

  // Fuel depots.
  for (const d of sim.depots) {
    if (d.used) continue;
    const px = cam.x + (d.x + 0.5) * s, py = cam.y + (d.y + 0.5) * s, r = Math.max(5, s * 1.4);
    const depSp = SPRITE_CANVAS.depot;
    if (s >= MODEL_ZOOM) drawDepot(ctx, px, py, s);
    else if (depSp && r >= 5) {
      spr(depSp, px - r * 1.2, py - r * 1.2, r * 2.4, r * 2.4);
    } else {
      ctx.fillStyle = "#ff6d00"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py + r * 0.8); ctx.lineTo(px - r, py + r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const hov = hover && Math.abs(hover[0] - d.x - 0.5) < 2.5 && Math.abs(hover[1] - d.y - 0.5) < 2.5;
    if (hov || tool === "depot") {
      ctx.strokeStyle = "rgba(255,109,0,0.8)"; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(px, py, C.DEPOT_RADIUS * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (hov) label("Fuel depot: set it off during the battle", px + r + 6, py);
    }
  }

  // 0.30.1: gates and walls opening or closing take a few seconds: the cells fill with yellow as they move
  for (const sw of sim.switching) {
    const k = Math.min(1, (sim.time - sw.start) / Math.max(0.01, sw.at - sw.start));
    ctx.fillStyle = sw.to === 2 ? "rgba(255,214,0,0.55)" : "rgba(79,195,247,0.55)";
    ctx.strokeStyle = "#ffd600"; ctx.lineWidth = 1;
    for (const c of sw.cells) {
      const px = cam.x + (c % sim.w) * s, py = cam.y + ((c / sim.w) | 0) * s;
      ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
      ctx.fillRect(px, py + s * (1 - k), s, s * k);
    }
    if (s > 1.5 && sw.cells.length <= 12) {
      const c = sw.cells[0];
      label(`${sw.to === 2 ? "Closing" : "Opening"} ${Math.max(0, sw.at - sim.time).toFixed(1)}s`, cam.x + ((c % sim.w) + 1.5) * s, cam.y + ((c / sim.w) | 0) * s - 4);
    }
  }
  // Bridge charges.
  for (const b of sim.c4) {
    if (sim.blown.has(b)) continue;
    const cells = sim.bridges[b];
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const i of cells) { const x = i % sim.w, y = (i / sim.w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    ctx.strokeStyle = sim.phase === "battle" ? `rgba(255,214,0,${0.6 + 0.4 * Math.sin(now / 200)})` : "#ffd600";
    ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.strokeRect(cam.x + x0 * s, cam.y + y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s); ctx.setLineDash([]);
    if (s > 1.2) label("C4", cam.x + (x1 + 1) * s + 4, cam.y + ((y0 + y1) / 2) * s);
  }
  // 0.38: building demolition charges
  for (const c of sim.demo) {
    if (sim.demoBlown.has(c)) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const i of sim.demoCells(c)) { const x = i % sim.w, y = (i / sim.w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) continue;
    ctx.strokeStyle = sim.phase === "battle" ? `rgba(255,214,0,${0.6 + 0.4 * Math.sin(now / 200)})` : "#ffd600";
    ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.strokeRect(cam.x + x0 * s, cam.y + y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s); ctx.setLineDash([]);
    if (s > 1.2) label("DEMO", cam.x + (x1 + 1) * s + 4, cam.y + ((y0 + y1) / 2) * s);
  }

  // Agents.
  const dot = Math.min(7, Math.max(1, s * 0.2)); // 0.28: grains of sand: a speck, never bigger than a zone corner marker
  const x0 = -cam.x / s - 1, y0 = -cam.y / s - 1, x1 = x0 + W / s + 2, y1 = y0 + H / s + 2;
  if (!glv.ok) {
    for (const [want, mut, color, sz] of [[CIV, 0, "#f5f1e6", dot], [SAFE_CIV, 0, "#9be7a8", dot], [INF, 0, "#ff3b3b", dot], [INF, 1, "#ff66d1", dot * 1.35]] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < sim.n; k++) {
        if (sim.state[k] !== want || (want === INF && (sim.mutant[k] === 1) !== (mut === 1))) continue;
        const ax = sim.ax[k], ay = sim.ay[k];
        if (ax < x0 || ay < y0 || ax > x1 || ay > y1) continue;
        if (sz >= 3) { const cx2 = cam.x + ax * s, cy2 = cam.y + ay * s; ctx.moveTo(cx2 + sz / 2, cy2); ctx.arc(cx2, cy2, sz / 2, 0, 6.2832); }
        else ctx.rect(cam.x + ax * s - sz / 2, cam.y + ay * s - sz / 2, sz, sz);
      }
      ctx.fill();
    }
  }

  // 0.39: the selected person (and their family, fainter): a ring so you can find them in the crowd.
  if (selPerson >= 0 && selPerson < sim.civN && (sim.state[selPerson] === CIV || sim.state[selPerson] === SAFE_CIV)) {
    const lead = sim.famLead[selPerson], size = lead >= 0 ? sim.famSize[selPerson] : 1, r = Math.max(6, dot * 2.5);
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(253,230,138,0.45)";
    if (lead >= 0) for (let m = lead; m < Math.min(lead + size, sim.civN); m++) {
      if (m === selPerson || (sim.state[m] !== CIV && sim.state[m] !== SAFE_CIV)) continue;
      ctx.beginPath(); ctx.arc(cam.x + sim.ax[m] * s, cam.y + sim.ay[m] * s, r * 0.8, 0, 7); ctx.stroke();
    }
    ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(253,230,138,${0.75 + 0.25 * Math.sin(now / 200)})`;
    ctx.beginPath(); ctx.arc(cam.x + sim.ax[selPerson] * s, cam.y + sim.ay[selPerson] * s, r, 0, 7); ctx.stroke();
  }
  // 0.44: people refusing to leave are not highlighted on the map (their person window says so)
  // Explosions: a ring that grows and fades over a second.
  for (const b of sim.blasts) {
    const k = Math.min(1, (sim.time - b.t) / 0.8);
    ctx.fillStyle = b.color + Math.round((1 - k) * 120).toString(16).padStart(2, "0");
    ctx.beginPath(); ctx.arc(cam.x + b.x * s, cam.y + b.y * s, b.r * s * (0.5 + k * 0.7), 0, 7); ctx.fill();
  }
  // Incoming abilities: where they will land.
  for (const p of sim.pending) {
    const left = p.at - sim.time;
    const blink = 0.5 + 0.5 * Math.sin(now / 90);
    if (p.kind === "airstrike") {
      ctx.strokeStyle = `rgba(255,60,60,${0.4 + 0.5 * blink})`; ctx.lineWidth = Math.max(2, C.AIRSTRIKE_RADIUS * 2 * s); ctx.lineCap = "round";
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(cam.x + p.x * s, cam.y + p.y * s); ctx.lineTo(cam.x + p.x2 * s, cam.y + p.y2 * s); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = "butt";
      label(`Airstrike ${left.toFixed(1)}s`, cam.x + p.x * s + 8, cam.y + p.y * s - 8);
    } else if (p.kind === "a10") {
      ctx.strokeStyle = `rgba(144,164,174,${0.4 + 0.5 * blink})`; ctx.lineWidth = Math.max(2, C.A10_WIDTH * 2 * s); ctx.lineCap = "round";
      ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(cam.x + p.x * s, cam.y + p.y * s); ctx.lineTo(cam.x + p.x2 * s, cam.y + p.y2 * s); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = "butt";
      label(`A-10 ${left.toFixed(1)}s`, cam.x + p.x * s + 8, cam.y + p.y * s - 8);
    } else if (p.kind === "barrage" || p.kind === "moab" || p.kind === "nuke" || p.kind === "cluster" || p.kind === "tomahawk" || p.kind === "gunship") {
      const rad = p.kind === "barrage" ? C.BARRAGE_RADIUS : p.kind === "moab" ? C.MOAB_RADIUS : p.kind === "cluster" ? C.CLUSTER_RADIUS : p.kind === "tomahawk" ? C.TOMAHAWK_RADIUS : p.kind === "gunship" ? C.GUNSHIP_RADIUS : C.NUKE_RADIUS;
      ctx.strokeStyle = C.ABILITIES[p.kind].color; ctx.lineWidth = p.kind === "nuke" ? 4 : 2; ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.5 + 0.5 * blink; ctx.beginPath(); ctx.arc(cam.x + p.x * s, cam.y + p.y * s, rad * s, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      label(`${C.ABILITIES[p.kind].name.toUpperCase()} ${left.toFixed(1)}s`, cam.x + p.x * s + 8, cam.y + p.y * s - 8);
    } else if (p.kind === "firebomb" || p.kind === "para" || p.kind === "supply_drop") {
      ctx.strokeStyle = C.ABILITIES[p.kind].color; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      const rad = p.kind === "para" ? 4 : p.kind === "supply_drop" ? C.SUPPLY_DROP_RADIUS * 0.25 : C.FIRE_RADIUS;
      ctx.beginPath(); ctx.arc(cam.x + p.x * s, cam.y + p.y * s, rad * s + 4 * blink, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      label(`${C.ABILITIES[p.kind].name} ${left.toFixed(1)}s`, cam.x + p.x * s + 8, cam.y + p.y * s - 8);
    }
  }

  // AC-130s on station: the orbit ring and the plane circling it.
  for (const o of sim.orbits) {
    const ox = cam.x + o.x * s, oy = cam.y + o.y * s, R = C.GUNSHIP_RADIUS * s;
    if (o.inbound || o.leaving) { // 0.46: flying in from the edge, over to a new spot, or home
      const [tx, ty] = o.inbound ? [o.x + Math.cos(o.angle) * C.GUNSHIP_RADIUS * 1.15, o.y + Math.sin(o.angle) * C.GUNSHIP_RADIUS * 1.15] : sim.edgeEntry(o.fx, o.fy);
      const px = cam.x + o.fx * s, py = cam.y + o.fy * s, h = Math.atan2(ty - o.fy, tx - o.fx);
      if (o.inbound) {
        ctx.strokeStyle = "rgba(206,147,216,0.5)"; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(ox, oy, R, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cam.x + tx * s, cam.y + ty * s); ctx.stroke(); ctx.setLineDash([]);
      }
      if (Number.isFinite(h)) drawAirframe(ctx, "ac130", px, py, s, h, 1, now / 1000 * 12);
      label(o.inbound ? "AC-130 inbound" : "AC-130 heading home", px + airHalfPx("ac130", s) + 4, py - 10);
      continue;
    }
    if (o.away) { // 0.32: refueling: flies out along its heading, later flies back in to the same point of the orbit
      const left = o.until - sim.time, gone = C.GUNSHIP_REFUEL_S - left, fly = 14, v = C.GUNSHIP_RADIUS * 1.15 * 0.5; // orbit speed, cells/s
      const h = o.angle - Math.PI / 2, jx = ox + Math.cos(o.angle) * R * 1.15, jy = oy + Math.sin(o.angle) * R * 1.15;
      const d = gone < fly ? gone * v * s : left < fly ? -left * v * s : NaN;
      if (Number.isFinite(d)) drawAirframe(ctx, "ac130", jx + Math.cos(h) * d, jy + Math.sin(h) * d, s, h, 1, now / 1000 * 12);
      label(`AC-130 refueling, back in ${Math.ceil(left)}s`, ox - 50, oy);
      continue;
    }
    ctx.strokeStyle = "rgba(206,147,216,0.5)"; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(ox, oy, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const px = ox + Math.cos(o.angle) * R * 1.15, py = oy + Math.sin(o.angle) * R * 1.15;
    drawAirframe(ctx, "ac130", px, py, s, o.angle - Math.PI / 2, 1, now / 1000 * 12); // left-hand pylon turn, guns to the middle
    label(`AC-130 ${Math.ceil(o.until - sim.time)}s`, px + airHalfPx("ac130", s) + 4, py - 10);
  }
  // Fallout: a sickly green haze that fades as it decays.
  for (const f of sim.fallout) {
    const left = f.until - sim.time, a = Math.min(0.35, left / C.FALLOUT_S * 0.35);
    ctx.fillStyle = `rgba(118,255,3,${a * (0.8 + 0.2 * Math.sin(now / 300))})`;
    ctx.beginPath(); ctx.arc(cam.x + f.x * s, cam.y + f.y * s, f.r * s, 0, 7); ctx.fill();
    label(`FALLOUT ${Math.ceil(left)}s`, cam.x + f.x * s - 30, cam.y + f.y * s);
  }
  // Strike orders: the selected unit, and where every mobile unit is holding.
  if (tool === "order") for (const u of sim.units) {
    if (!C.UNITS[u.kind].mobile || !u.post) continue;
    const ux = cam.x + (u.x + 0.5) * s, uy = cam.y + (u.y + 0.5) * s, px = cam.x + (u.post[0] + 0.5) * s, py = cam.y + (u.post[1] + 0.5) * s;
    ctx.strokeStyle = u === orderSel ? "#80cbc4" : "rgba(128,203,196,0.4)"; ctx.lineWidth = u === orderSel ? 2 : 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    if (u === orderSel) { ctx.beginPath(); ctx.arc(ux, uy, Math.max(8, s * 2), 0, 7); ctx.stroke(); }
  }
  if (nukeArm && (tool === "nuke" || tool === "moab")) { ctx.strokeStyle = "rgba(118,255,3,0.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cam.x + nukeArm[0] * s, cam.y + nukeArm[1] * s, (tool === "nuke" ? C.NUKE_RADIUS : C.MOAB_RADIUS) * s, 0, 7); ctx.stroke(); }

  // Arrow at the screen edge pointing to where the newest horde entered.
  // Horde routes: where the next one comes in (amber, counting down) and where the last one came in (red).
  const marks: [number, string, string][] = [];
  const toNext = sim.nextWaveT - sim.time;
  if (sim.phase === "battle" && toNext < C.WAVE_WARN_S) for (const i of sim.upcoming) marks.push([i, "255,193,7", `HORDE INBOUND · ${sim.entries[i]?.kind.toUpperCase()} · ${Math.ceil(toNext)}s`]);
  if (sim.waveT >= 0 && sim.time - sim.waveT < 10) for (const i of sim.waveEntries) marks.push([i, "255,60,60", `HORDE #${sim.wave}`]);
  for (const [i, rgb, text] of marks) {
    const e = sim.entries[i]; if (!e) continue;
    const px = cam.x + (e.x + 0.5) * s, py = cam.y + (e.y + 0.5) * s;
    const a = 0.55 + 0.45 * Math.sin(now / 120);
    const ang = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][e.edge]; // pointing into the city
    const onScreen = px > 20 && py > 20 && px < W - 20 && py < H - 20;
    const ax = Math.max(30, Math.min(W - 30, px)), ay = Math.max(30, Math.min(H - 30, py));
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(onScreen ? ang : Math.atan2(py - ay, px - ax));
    ctx.fillStyle = `rgba(${rgb},${a})`;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-14, -16); ctx.lineTo(-14, 16); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (onScreen) { ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, Math.max(10, e.cells.length * s * 0.6), 0, 7); ctx.stroke(); }
    label(text, ax + 18, ay - 18);
  }

  // Support buildings and their aura rings.
  for (const b of sim.supports) {
    const spec = C.SUPPORTS[b.kind];
    const px = cam.x + (b.x + 0.5) * s, py = cam.y + (b.y + 0.5) * s;
    const hov = hover && Math.abs(hover[0] - b.x - 0.5) < 1.5 && Math.abs(hover[1] - b.y - 0.5) < 1.5;
    if (showRanges || hov || sim.phase === "plan" || isSupport(tool)) {
      ctx.strokeStyle = spec.color + (hov ? "cc" : "55"); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(px, py, spec.radius * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (b.kind === "supply" && (hov || sim.phase === "plan") && b.extractT === undefined && (!b.deployT || b.deployT <= 0)) {
      ctx.strokeStyle = "rgba(255,183,77,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      for (const u of sim.units) {
        if (u.ammo === Infinity) continue;
        if (Math.hypot(u.x - b.x, u.y - b.y) <= spec.radius) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cam.x + (u.x + 0.5) * s, cam.y + (u.y + 0.5) * s); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    const r = Math.max(6, s * 1.4);
    if ((b.deployT && b.deployT > 0) || b.extractT !== undefined) ctx.globalAlpha = 0.4;
    const supSp = SPRITE_CANVAS[supportSpriteKey(b.kind)];
    if (s >= MODEL_ZOOM) {
      drawSupport(ctx, b.kind, px, py, s, now, spec.color, { pickupAt: b.pickupAt, simTime: sim.time });
      if (hov) { ctx.strokeStyle = spec.color; ctx.lineWidth = 2; ctx.strokeRect(px - s * 1.9, py - s * 1.9, s * 3.8, s * 3.8); }
    } else if (supSp) {
      ctx.fillStyle = "rgba(12,17,26,0.92)"; ctx.strokeStyle = spec.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(px - r, py - r, 2 * r, 2 * r, 3); ctx.fill(); ctx.stroke();
      spr(supSp, px - r * 0.88, py - r * 0.88, r * 1.76, r * 1.76);
    }
    ctx.globalAlpha = 1;
    if (hov) {
      const dep = b.extractT !== undefined ? ` · pulling out ${Math.max(0, b.extractT).toFixed(0)} s` : b.deployT && b.deployT > 0 ? ` · deploying ${b.deployT.toFixed(0)} s` : "";
      const squads = b.kind === "police" || b.kind === "militia"
        ? ` · squads ${sim.units.filter(u => u.parentSupport === b && (u.hp === undefined || u.hp > 0) && u.ai !== "leave").length}/${b.kind === "police" ? C.POLICE_MAX_SQUADS : C.MILITIA_MAX_SQUADS}` : "";
      label(`${spec.name} · radius ${Math.round(spec.radius * C.CELL_M)} m · paid ${C.money(b.paid)}${squads}${dep}`, px + r + 6, py);
    }
  }

  // Units, ranges, tracers. Destroyed units leave wrecks underneath.
  noteUnits(sim.units, sim.time, k => C.UNITS[k].color);
  drawWrecks(ctx, cam.x, cam.y, s, sim.time, s >= MODEL_ZOOM);
  hoverSquad = hover && !stack.length ? squadNearScreen(cam.x + hover[0] * s, cam.y + hover[1] * s) : null; // 0.52
  for (const u of sim.units) {
    const spec = C.UNITS[u.kind];
    const people = !!u.soldiers; // 0.52: soldiers are dots (drawSoldierDots); no picture, model or bars on the map
    const [ucx, ucy] = people ? sim.squadCenter(u) : [u.x + 0.5, u.y + 0.5];
    const px = cam.x + ucx * s, py = cam.y + ucy * s;
    const hov = people ? hoverSquad === u : hover && Math.abs(hover[0] - u.x - 0.5) < 1.5 && Math.abs(hover[1] - u.y - 0.5) < 1.5;
    if (showRanges || hov || sim.phase === "plan") {
      ctx.strokeStyle = spec.color + (hov ? "cc" : "44"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, u.range * s, 0, 7); ctx.stroke();
    }
    const r = Math.max(5, s * 1.3);
    if (people) { if (hov) unitHoverLabel(u, spec, px, py, r); continue; } // 0.52
    const uSp = SPRITE_CANVAS[u.kind];
    if ((u.deployT && u.deployT > 0) || u.extractT !== undefined) ctx.globalAlpha = 0.4;
    else if (u.ammo < 1) ctx.globalAlpha = 0.55;
    const model = hasModel(u.kind) && s >= MODEL_ZOOM, squad = hasSquad(u.kind) && s >= SQUAD_ZOOM;
    if (model || squad) {
      if (hov) { ctx.strokeStyle = spec.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r * 1.6, 0, 7); ctx.stroke(); }
      if (model) drawModel(ctx, u, px, py, s, frameDt, now);
      else drawSquad(ctx, u, px, py, s, u.ammo >= 1 ? spec.color : "#777", frameDt, sim.time,
        u.soldiers?.filter(so => so.alive).map(so => [cam.x + so.x * s, cam.y + so.y * s] as [number, number])); // 0.49
    } else if (uSp) { // zoomed out: the sprite icon, kept big enough to read
      const sz = Math.max(7, r) * (u.kind === "battleship" ? 2.5 : u.kind === "gunboat" || u.kind === "apc" || u.kind === "howitzer" ? 2.15 : 1.9);
      ctx.fillStyle = "rgba(10,15,24,0.82)";
      ctx.strokeStyle = u.ammo >= 1 ? spec.color : "#666";
      ctx.lineWidth = hov ? 2 : 1.3;
      ctx.beginPath(); ctx.roundRect(px - sz * 0.54, py - sz * 0.54, sz * 1.08, sz * 1.08, 3); ctx.fill(); ctx.stroke();
      spr(uSp, px - sz / 2, py - sz / 2, sz, sz);
    } else {
      ctx.fillStyle = u.ammo >= 1 ? spec.color : "#555";
      ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (u.kind === "sniper") { ctx.moveTo(px, py - r); ctx.lineTo(px + r, py + r); ctx.lineTo(px - r, py + r); ctx.closePath(); }
      else if (u.kind === "battleship") { ctx.moveTo(px + r * 2.4, py); ctx.lineTo(px + r * 1.2, py - r * 0.9); ctx.lineTo(px - r * 2, py - r * 0.9); ctx.lineTo(px - r * 2, py + r * 0.9); ctx.lineTo(px + r * 1.2, py + r * 0.9); ctx.closePath(); }
      else if (u.kind === "gunboat") { ctx.moveTo(px + r * 1.6, py); ctx.lineTo(px + r * 0.6, py - r * 0.7); ctx.lineTo(px - r * 1.3, py - r * 0.7); ctx.lineTo(px - r * 1.3, py + r * 0.7); ctx.lineTo(px + r * 0.6, py + r * 0.7); ctx.closePath(); }
      else if (u.kind === "apc") { ctx.roundRect(px - r * 1.3, py - r * 0.8, r * 2.6, r * 1.6, r * 0.4); }
      else if (u.kind === "howitzer") { ctx.rect(px - r * 1.2, py - r * 0.6, r * 2.4, r * 1.2); ctx.moveTo(px, py); ctx.rect(px - r * 0.25, py - r * 1.6, r * 0.5, r); }
      else if (u.kind === "para" || u.kind === "police" || u.kind === "militia") { ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath(); }
      else if (u.kind === "mortar") { for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3; ctx.lineTo(px + Math.cos(t) * r * 1.15, py + Math.sin(t) * r * 1.15); } ctx.closePath(); }
      else if (u.kind === "turret") ctx.rect(px - r, py - r, 2 * r, 2 * r);
      else ctx.arc(px, py, r, 0, 7);
      ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const maxHp = C.maxHp(spec);
    if (u.hp !== undefined && maxHp !== undefined && u.hp < maxHp) {
      const k = Math.max(0, u.hp / maxHp);
      ctx.fillStyle = "#000"; ctx.fillRect(px - r, py - r - 6, 2 * r, 3);
      ctx.fillStyle = k > 0.5 ? "#7cfc9a" : k > 0.25 ? "#ffd54f" : "#ff5252"; ctx.fillRect(px - r, py - r - 6, 2 * r * k, 3);
    }
    if (u.ammo !== Infinity && u.ammo < spec.ammo) {
      const k = Math.max(0, u.ammo / spec.ammo);
      ctx.fillStyle = "#000"; ctx.fillRect(px - r, py + r + 3, 2 * r, 2.5);
      ctx.fillStyle = u.supplied ? "#ffb74d" : "#90caf9"; ctx.fillRect(px - r, py + r + 3, 2 * r * k, 2.5);
    }
    if (hov) unitHoverLabel(u, spec, px, py, r);
  }
  /** The hover line next to a unit: range, ammo, kills, aim, buffs, state. */
  function unitHoverLabel(u: import("./sim").Unit, spec: C.UnitSpec, px: number, py: number, r: number) {
    {
      const ammo = u.ammo === Infinity ? "∞ (in zone)" : `${Math.floor(u.ammo)}${u.supplied ? " (supplied)" : ""}`;
      const AI: Record<string, string> = { hunt: "hunting", hold: "holding", flee: "backing off", home: "going to reload", reload: "reloading", leave: "heading home" };
      const apc = u.ai && sim.phase === "battle" ? ` · ${AI[u.ai]}${u.hp !== undefined && u.hp !== Infinity ? ` · ${Math.max(0, Math.round(100 * u.hp / spec.mobile!.hp))}% armor` : ""}` : "";
      const dep = u.extractT !== undefined ? ` · pulling out ${Math.max(0, u.extractT).toFixed(0)} s` : u.deployT && u.deployT > 0 ? ` · deploying ${u.deployT.toFixed(0)} s` : "";
      const buffs: string[] = [];
      if (u.rangeBoosted) buffs.push("+40% range");
      if (u.rateMul && u.rateMul > 1) buffs.push("+30% rate");
      const bstr = buffs.length ? ` · [${buffs.join(", ")}]` : "";
      const aim = ` · ${spec.minRange ? "covers" : "aims"}: ${C.TARGET_LABEL[u.mode ?? "near"]}`;
      label(`${spec.name} · range ${Math.round(u.range * C.CELL_M)} m · ammo ${ammo} · kills ${u.kills}${aim}${bstr}${apc}${dep}`, px + r + 6, py);
    }
  }

  scars.drawSmoke(ctx, cam.x, cam.y, s, sim.time, W, H); // in the air: above the crowd and units, under the aircraft
  drawTransports(now, s);
  drawDev(now);
  updateInfoPanel();

  // Placement preview.
  if (hover && sim.phase !== "over" && (C.BUILDABLE as string[]).includes(tool)) {
    const kind = tool as C.UnitKind;
    const [hx, hy] = [Math.floor(hover[0]), Math.floor(hover[1])];
    const spec = C.UNITS[kind];
    const ok = !sim.canPlace(kind, hx, hy);
    drawPlacementGrid(hx, hy, spec.foot, ok, s);
    const lvl = sim.map.height[sim.idx(hx, hy)];
    const range = (spec.range + spec.roofBonus * Math.min(lvl, C.ROOF_BONUS_MAX_LV)) * (sim.hasActiveSupport("radio", hx, hy) ? C.RADIO_RANGE_MUL : 1);
    const cost = sim.unitCost(kind, hx, hy);
    ctx.strokeStyle = ok ? spec.color : "#ff4444"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(cam.x + (hx + 0.5) * s, cam.y + (hy + 0.5) * s, range * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    label(`${spec.name} ${C.money(cost)}${sim.hasActiveSupport("budget", hx, hy) ? " (-20%)" : ""} · ${Math.round(range * C.CELL_M)} m${lvl ? ` · ${lvl} floors` : ""}`, cam.x + (hx + 1) * s + 8, cam.y + hy * s);
  } else if (hover && sim.phase !== "over" && isSupport(tool)) {
    const kind = tool;
    const [hx, hy] = [Math.floor(hover[0]), Math.floor(hover[1])];
    const spec = C.SUPPORTS[kind];
    const ok = !sim.canPlaceSupport(kind, hx, hy);
    drawPlacementGrid(hx, hy, spec.foot, ok, s);
    const cost = sim.supportCost(kind, hx, hy);
    ctx.strokeStyle = ok ? spec.color : "#ff4444"; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(cam.x + (hx + 0.5) * s, cam.y + (hy + 0.5) * s, spec.radius * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    label(`${spec.name} ${C.money(cost)}${kind !== "budget" && sim.hasActiveSupport("budget", hx, hy) ? " (-20%)" : ""} · radius ${Math.round(spec.radius * C.CELL_M)} m`, cam.x + (hx + 1) * s + 8, cam.y + hy * s);
  }

  // Aiming an ability.
  if (hover && sim.phase === "battle" && isAbility(tool)) {
    const [hx, hy] = hover;
    // 0.38: the no-fire band turns a precise strike red; the nuke and MOAB warn when they would reach the zone
    let ex = hx, ey = hy;
    if ((tool === "airstrike" || tool === "a10") && strikeStart) {
      const dx = ex - strikeStart[0], dy = ey - strikeStart[1], l = Math.hypot(dx, dy);
      if (l > C.AIRSTRIKE_LEN) { ex = strikeStart[0] + dx / l * C.AIRSTRIKE_LEN; ey = strikeStart[1] + dy / l * C.AIRSTRIKE_LEN; }
    }
    const refused = strikeStart ? sim.strikeRefusal(tool, strikeStart[0], strikeStart[1], ex, ey) : sim.strikeRefusal(tool, hx, hy);
    const zoneShare = tool === "nuke" || tool === "moab" ? sim.zoneHitShare(tool, hx, hy) : 0;
    const col = refused || zoneShare > 0 ? "#ff4444" : C.ABILITIES[tool].color;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    if (refused) label(`NO-FIRE: within ${tool === "airstrike" || tool === "tomahawk" ? C.NOFIRE_BIG_M : C.NOFIRE_M} m of your people`, cam.x + hx * s + 12, cam.y + hy * s + 18);
    if (zoneShare > 0) {
      const R = tool === "nuke" ? C.NUKE_RADIUS : C.MOAB_RADIUS;
      ctx.fillStyle = "rgba(255,60,60,0.14)"; ctx.beginPath(); ctx.arc(cam.x + hx * s, cam.y + hy * s, R * s, 0, 7); ctx.fill();
      label(`WARNING: ${tool === "nuke" ? "NUKE" : "MOAB"} reaches ${Math.max(1, Math.round(zoneShare * 100))}% of your safe zone`, cam.x + hx * s + 12, cam.y + hy * s + 18);
    }
    if ((tool === "airstrike" || tool === "a10") && strikeStart) {
      ctx.globalAlpha = 0.3; ctx.lineWidth = C.AIRSTRIKE_RADIUS * 2 * s; ctx.setLineDash([]); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cam.x + strikeStart[0] * s, cam.y + strikeStart[1] * s); ctx.lineTo(cam.x + ex * s, cam.y + ey * s); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = "butt";
    } else {
      const R = tool === "firebomb" ? (sim.map.tile[sim.idx(hx | 0, hy | 0)] === PARK ? C.FIRE_RADIUS_PARK : C.FIRE_RADIUS) : tool === "para" ? C.UNITS.para.range : tool === "supply_drop" ? C.SUPPLY_DROP_RADIUS : tool === "barrage" ? C.BARRAGE_RADIUS : tool === "moab" ? C.MOAB_RADIUS : tool === "nuke" ? C.NUKE_RADIUS : tool === "cluster" ? C.CLUSTER_RADIUS : tool === "tomahawk" ? C.TOMAHAWK_RADIUS : tool === "gunship" ? C.GUNSHIP_RADIUS : tool === "a10" ? C.A10_WIDTH : C.AIRSTRIKE_RADIUS;
      ctx.beginPath(); ctx.arc(cam.x + hx * s, cam.y + hy * s, R * s, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawShots(s);
  drawOrdnance(s, now);

  // Zone draft.
  if (draft.length) {
    ctx.strokeStyle = "#7CFC9A"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    draft.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, cam.x + x * s, cam.y + y * s));
    if (hover) ctx.lineTo(cam.x + hover[0] * s, cam.y + hover[1] * s);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#7CFC9A";
    for (const [x, y] of draft) { ctx.beginPath(); ctx.arc(cam.x + x * s, cam.y + y * s, 4, 0, 7); ctx.fill(); }
  }
  drawSoldierDots(s); // 0.49
  drawSelection(s);
  drawCursorInfo(s);
}

/** 0.44: the selection drops whatever is gone (sold, removed, killed, a new battle, a loaded plan). */
function entAlive(e: Entity): boolean {
  if ("orbit" in e) return sim.orbitAlive(e.orbit); // 0.46: an AC-130 until it heads home
  return "unit" in e ? sim.units.includes(e.unit) && e.unit.extractT === undefined && (e.unit.hp === undefined || e.unit.hp > 0)
    : sim.supports.includes(e.support) && e.support.extractT === undefined;
}
/** The thing a selection entry points at. */
function entObj(e: Entity): object { return "unit" in e ? e.unit : "support" in e ? e.support : e.orbit; }
/** 0.46: the selected AC-130s. */
function selOrbits(): Orbit[] { return sel.flatMap(e => "orbit" in e && sim.orbitAlive(e.orbit) ? [e.orbit] : []); }
function selAlive(): boolean {
  if (!sel.length) return false;
  const kept = pruneSelection(sel, entAlive);
  if (kept.length !== sel.length) { sel = kept; if (!orderable().length) armedCmd = null; renderActions(); }
  return sel.length > 0;
}
/** 0.45: the selected units that take orders. */
function orderable(): import("./sim").Unit[] { return sel.flatMap(e => "unit" in e && sim.canOrder(e.unit) ? [e.unit] : []); }
function removeSelected() {
  if (!selAlive()) return;
  if (sim.phase === "plan") {
    let refused = false;
    for (const e of sel) { if ("orbit" in e) continue; if (!sim.removeEntity(e)) refused = true; else log("info", "removed", { kind: "unit" in e ? e.unit.kind : e.support.kind }); }
    if (refused) say("Removing this Budget Office would exceed your budget.");
    sel = sel.filter(entAlive); renderActions(); refreshUi(); return;
  }
  if (sim.phase !== "battle") return;
  const os = selOrbits(); // 0.46: Delete sends an AC-130 home (cancelled before it arrives: the charge comes back)
  if (os.length) {
    const refunded = os.filter(o => !o.arrived).length;
    for (const o of os) sim.sendHome(o);
    say(refunded ? `AC-130 cancelled: charge returned${refunded > 1 ? ` (${refunded})` : ""}.` : `AC-130${os.length > 1 ? "s" : ""} heading home.`, 3000);
    log("info", "gunship-home", { n: os.length, refunded });
  }
  let secs = 0, why = "";
  for (const e of sel) { if ("orbit" in e) continue; const r = sim.sellEntity(e); if (typeof r === "string") why = r; else secs = Math.max(secs, r); }
  if (secs) { tip("sell"); say(`Pulling ${sel.length > 1 ? "them" : "the unit"} out: ${secs.toFixed(0)} s. No fighting meanwhile; you get the cost back when out.`, 4000); log("info", "sell-in-battle", { secs }); }
  else if (why) say(why);
  sel = sel.filter(entAlive); renderActions();
}
function cycleSelected() {
  if (!selAlive()) return;
  const us = sel.flatMap(e => "unit" in e && C.UNITS[e.unit.kind].range > 0 ? [e.unit] : []);
  if (!us.length) return;
  const m = sim.cycleTargetOf(us[0]);
  for (const u of us.slice(1)) u.mode = m;
  say(`${us.length > 1 ? "These units now shoot" : "This unit now shoots"} ${C.TARGET_LABEL[m]} first.`, 2500); log("info", "target-mode", { mode: m });
  renderActions();
}
/** 0.45: carry out a command from a key or the bar. */
function runIntent(it: import("./input").Intent) {
  const us = orderable();
  if (it.k === "arm") { armedCmd = it.cmd; renderActions(); return; }
  if (it.k === "cancel") { armedCmd = null; renderActions(); return; }
  if (it.k === "stop") { for (const u of us) sim.stopUnit(u); say(us.length > 1 ? "Holding here." : "Holding here.", 1500); }
  else if (it.k === "standby") { for (const u of us) sim.standBy(u); say("Standing by: holding fire.", 2000); }
  log("info", "command", { k: it.k, n: us.length });
  renderActions();
}
/** 0.45: the armed command lands where the player clicked. */
function aimArmed(cx: number, cy: number) {
  const us = orderable(), cmd = armedCmd!, queue = keys.has("shift");
  if (!us.length) { armedCmd = null; return; }
  let e: string | null;
  if (cmd === "fortify") { // 0.51: the Fortify button armed: this click picks the roof
    const troops = us.filter(u => u.kind === "garrison" || u.kind === "sniper");
    let why: string | null = null, ok = 0;
    for (const u of troops) { const err = sim.issue(u, { k: "fortify", x: Math.floor(cx), y: Math.floor(cy) }, false); if (err) why = err; else ok++; }
    if (!ok) { say(why ?? "Select Troops or Snipers."); return; }
    armedCmd = null; renderActions(); return;
  }
  if (cmd === "escort") {
    const k = sim.civAt(cx, cy, Math.max(0.8, 10 / cam.scale));
    if (k < 0) { say("Click a person to escort."); return; }
    e = sim.issueGroup(us, { k: "escort", x: cx, y: cy, who: k }, queue);
  } else e = sim.issueGroup(us, { k: cmd, x: cx, y: cy }, queue);
  if (e) { say(e); return; }
  log("info", "order", { k: cmd, n: us.length, x: Math.floor(cx), y: Math.floor(cy), queue });
  if (!queue) armedCmd = null; // Shift keeps it armed for the next point
  renderActions();
}
/** 0.50: the group tabs (0.54: 1-5, over the selection box, unit pictures): each slot shows its main unit, how many are left and their health, or its zone. */
const MOCK_GROUPS = new URLSearchParams(location.search).get("mock") === "groupbar"; // design mockup only
function renderGroupbar() {
  const bar = $("grouptabs");
  const show = mode === "game" && (MOCK_GROUPS || sim.groups.some(g => g)); // 0.51: the tabs show once a group exists (they'd cover the map for nothing)
  bar.hidden = !show;
  if (!show) return;
  { const c = $("hud-sel").getBoundingClientRect(), m = bar.parentElement!.getBoundingClientRect(); bar.style.left = `${c.left + c.width / 2 - m.left}px`; } // 0.54: centered over the selection box (C)
  const selUnits = new Set(sel.flatMap(e => "unit" in e ? [e.unit] : []));
  bar.querySelectorAll<HTMLButtonElement>(".gslot").forEach((b, n) => {
    const key = b.dataset.key!;
    const sm = MOCK_GROUPS ? ([{ kind: "garrison", count: 4, health: 1 }, { kind: "garrison", count: 3, health: 0.62 }, { kind: "sniper", count: 2, health: 1 }, { kind: "apc", count: 2, health: 0.35 }, { zone: 0 }, null, { kind: "para", count: 5, health: 0.9 }, null, null, null] as ReturnType<typeof groupSummary>[])[n]
      : groupSummary(sim.groups[n], u => sim.groupAlive(u), u => { const sp = C.UNITS[u.kind]; return sp.mobile?.hp ?? sp.hp ?? 1; });
    const g = sim.groups[n], picked = !MOCK_GROUPS && g && "units" in g && g.units.some(u => selUnits.has(u)) || (!MOCK_GROUPS && g && "zone" in g && selZone === g.zone);
    // 0.54: a picture of the group's most common unit (a zone: the zone icon), the number top-left, count and health
    const pic = !sm ? "" : "zone" in sm ? SPRITE_URL.zone ?? "" : SPRITE_URL[sm.kind as SpriteKey] ?? "";
    const name = !sm ? "" : "zone" in sm ? `Zone ${sm.zone + 1}` : C.UNITS[sm.kind as C.UnitKind]?.name ?? sm.kind;
    const html = `${pic ? `<img class="gp" src="${pic}" alt="">` : ""}<span class="gk">${key}</span>${sm && !("zone" in sm) ? `<span class="gn">${sm.count}</span>` : ""}${sm && !("zone" in sm) ? `<span class="gh"><i style="width:${Math.round(sm.health * 100)}%;background:${sm.health > 0.6 ? "#4ade80" : sm.health > 0.3 ? "#fbbf24" : "#f87171"}"></i></span>` : ""}`;
    if (b.innerHTML !== html) b.innerHTML = html;
    b.hidden = !sm; // 0.54: only the groups you made show
    b.dataset.tip = sm ? `Group ${key}: ${name}` : ""; b.dataset.tipkey = key;
    b.classList.toggle("on", !!sm); b.classList.toggle("sel", !!picked);
    b.dataset.tipdesc = "Click selects, double-click jumps there. Ctrl+" + key + " saves the selection here.";
  });
}
/** 0.50: battle-group keys. */
function runGroup(gi: { k: "assign" | "add" | "select" | "addsel"; n: number }) {
  const key = gi.n === 9 ? "0" : String(gi.n + 1);
  if (gi.k === "assign" || gi.k === "add") {
    sim.groups = assignGroup(sim.groups, gi.n, sel, selZone, gi.k === "add");
    const g = sim.groups[gi.n];
    say(!g ? `Group ${key} cleared.` : "zone" in g ? `Safe zone ${g.zone + 1} is on ${key}.` : `Group ${key}: ${g.units.length} unit${g.units.length > 1 ? "s" : ""}.`, 1600);
    renderActions(); renderGroupbar(); return;
  }
  const g = sim.groups[gi.n], now = performance.now(), twice = lastGroupKey.n === gi.n && now - lastGroupKey.t < 350;
  lastGroupKey = { n: gi.n, t: now };
  if (!g) return;
  if ("zone" in g) {
    if (gi.k === "select") { sel = []; selZone = g.zone; }
    if (twice && sim.zones[g.zone]) { const p = sim.zones[g.zone]; centerOn(p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length); following = false; }
    renderActions(); return;
  }
  const us = groupUnits(sim.groups, gi.n, u => sim.groupAlive(u));
  const ents: Entity[] = us.map(u => ({ unit: u }));
  sel = gi.k === "addsel" ? [...sel, ...ents.filter(e => !sel.some(x => "unit" in x && x.unit === (e as { unit: import("./sim").Unit }).unit))] : ents;
  selZone = -1; closePerson();
  if (twice && us.length) { centerOn(us.reduce((a, u) => a + u.x + 0.5, 0) / us.length, us.reduce((a, u) => a + u.y + 0.5, 0) / us.length); following = false; }
  renderActions();
}
/** 0.45: right-click with units selected: move there (Shift adds it to their queue). 0.50: Troops/Snipers sent to a
 *  roof fortify it; a fortified squad sent to a street comes down first, then goes. */
function moveOrder(cx: number, cy: number) {
  const us = orderable(), os = selOrbits();
  if (os.length) { // 0.46: the selected AC-130s fly over to circle the new spot
    let why: string | null = null;
    for (const o of os) why = sim.redeployOrbit(o, cx, cy) ?? why;
    if (why) say(why); else { snd.radio(); say(sim.redeployNote(os[0]), 3000); log("info", "gunship-move", { n: os.length, x: Math.floor(cx), y: Math.floor(cy) }); }
  }
  if (!us.length) return;
  const x = Math.floor(cx), y = Math.floor(cy), roof = x >= 0 && y >= 0 && x < sim.w && y < sim.h && sim.map.tile[sim.idx(x, y)] === BUILDING;
  const troop = (u: import("./sim").Unit) => u.kind === "garrison" || u.kind === "sniper";
  let rest = us;
  if (roof) { // 0.50: fortify that building (one squad of a kind per building: the rest get "per building")
    let why: string | null = null, ok = 0;
    for (const u of us.filter(troop)) { const err = sim.issue(u, { k: "fortify", x, y }, false); if (err) why = err; else ok++; }
    rest = us.filter(u => !troop(u));
    if (!rest.length) { if (why && !ok) say(why); else log("info", "order", { k: "fortify", n: ok, x, y }); return; }
  } // a fortified squad given a street comes down first, then goes (Sim.issue does both)
  const e = sim.issueGroup(rest, { k: "move", x: cx, y: cy }, keys.has("shift"));
  if (e) say(e); else log("info", "order", { k: "move", n: rest.length, x: Math.floor(cx), y: Math.floor(cy), queue: keys.has("shift") });
}
/** The small bar for the selection: names, targeting (T), unit commands, remove/pull out (Del). */
/** 0.49: replace a lost soldier in each selected squad (one per press). */
function topUpSelected() {
  let done = 0, why = "";
  for (const e of sel) if ("unit" in e && e.unit.soldiers) { const err = sim.topUp(e.unit); if (err) why = err; else done++; }
  say(done ? `${done > 1 ? `${done} squads` : "Squad"} topped up.` : why || "Select a squad.", 1800);
  refreshUi(); renderActions();
}
/** 0.51: the command card (bottom right). Nothing selected: the static tools page (#cmdtools, its buttons keep their
 *  own handlers and states). Something selected (or a safe zone in battle): the orders page, from hud.commandCard. */
/** 0.51: the selection panel (C): one squad lists its soldiers (click one for their card); several things list
 *  as tiles (click narrows the selection to it, Shift-click drops it). */
function renderSelection() {
  const box = $("hud-sel");
  const live = sel.filter(e => !("orbit" in e)) as ({ unit: import("./sim").Unit } | { support: import("./sim").Support })[];
  const g = selectionGrid(live.map(e => "unit" in e
    ? { kind: e.unit.kind, hp: e.unit.hp ?? 1, max: C.maxHp(C.UNITS[e.unit.kind]) ?? 1, soldiers: e.unit.soldiers?.map(so => ({ name: so.name, hp: so.hp, max: C.SOLDIER_HP, alive: so.alive })) }
    : { kind: e.support.kind, hp: 1, max: 1 }));
  const bar = (h: number) => `<span class="sh"><i style="width:${Math.round(h * 100)}%;background:${h > 0.6 ? "#4ade80" : h > 0.3 ? "#fbbf24" : "#f87171"}"></i></span>`;
  let html = "";
  if (g.mode === "squad") {
    const u = (live[0] as { unit: import("./sim").Unit }).unit;
    const card = selSoldier && u.soldiers!.includes(selSoldier) && selSoldier.alive ? soldierCardLines(u.kind, u.soldiers!, selSoldier) : null;
    html = `<div class="sel-head">${C.UNITS[u.kind].name} <span class="hk">${u.soldiers!.filter(so => so.alive).length}/${u.soldiers!.length}</span></div>`
      + g.soldiers.map((so, i) => `<button class="sel-row${so.alive ? "" : " dead"}${u.soldiers![i] === selSoldier ? " on" : ""}" data-so="${i}">${so.name}${bar(so.health)}</button>`).join("")
      + (card ? `<div class="sel-card">${card.join(" · ")}</div>` : "");
  } else if (g.mode === "units") {
    html = `<div class="sel-head">${live.length} selected</div><div class="sel-grid">` + g.items.map(it => {
      const name = (C.UNITS as Record<string, C.UnitSpec | undefined>)[it.kind]?.name ?? (C.SUPPORTS as Record<string, { name: string } | undefined>)[it.kind]?.name ?? it.kind, img = SPRITE_URL[it.kind as SpriteKey];
      return `<button class="sel-tile" data-idx="${it.index}" title="${name}: click to select only this, Shift-click to drop it">${img ? `<img src="${img}" alt="">` : name.slice(0, 3)}${bar(it.health)}</button>`;
    }).join("") + `</div>`;
  } else if (selPerson < 0 && mode === "game" && squadsNow().length) { // 0.52: the roster: every squad and what it is doing
    const qs = squadsNow(), n: Record<string, number> = {};
    html = `<div class="sel-head">Squads <span class="hk">Tab</span></div>` + qs.map(u => {
      n[u.kind] = (n[u.kind] ?? 0) + 1;
      const st = stateOf(u), live = u.soldiers!.filter(so => so.alive).length;
      return `<button class="sel-row roster" data-ru="${sim.units.indexOf(u)}" title="Click: select. Double-click: jump there."><span><i class="ring" style="border-color:${C.RING_COLOR[u.kind] ?? "#e2e8f0"}"></i>${C.UNITS[u.kind].name} ${n[u.kind]} <small class="st-${st.replace(/ /g, "-")}">${st}</small></span><span class="hk">${live}/${u.soldiers!.length}</span></button>`;
    }).join("");
  } else html = `<div class="sel-empty">${selPerson >= 0 ? "" : "Nothing selected"}</div>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}
// ---- 0.51.1: hover tooltip for the picture buttons (name, hotkey, price or count, what it does) ----
let tipPt: [number, number] | null = null, tipEl: HTMLElement | null = null, tipT = 0;
/** Re-read what is under the pointer; call after anything re-renders the buttons so the text stays live. */
function updateTip() {
  const box = $("uitip");
  const el = tipPt ? (document.elementFromPoint(tipPt[0], tipPt[1]) as HTMLElement | null)?.closest<HTMLElement>("[data-tip]") ?? null : null;
  if (!el) { tipEl = null; box.hidden = true; return; }
  if (el !== tipEl) { if (!tipEl) tipT = performance.now(); tipEl = el; }
  if (performance.now() - tipT < 250) { box.hidden = true; setTimeout(updateTip, 260); return; } // a short wait before the first one
  const d = el.dataset, key = d.tipkey ? `<kbd>${esc(d.tipkey)}</kbd>` : "";
  const html = `<b>${esc(d.tip!)}</b>${key}${d.tipsub ? `<br><span class="sub">${esc(d.tipsub)}</span>` : ""}${d.tipdesc ? `<span class="desc">${esc(d.tipdesc)}</span>` : ""}`;
  if (box.innerHTML !== html) box.innerHTML = html;
  box.hidden = false;
  const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  const x = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2));
  const y = r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6; // above the button (the panel sits at the bottom)
  box.style.left = `${x}px`; box.style.top = `${y}px`;
}
addEventListener("pointermove", e => { if (e.pointerType === "touch") return; const was = tipPt; tipPt = [e.clientX, e.clientY]; if (!was || (e.target as HTMLElement).closest?.("[data-tip]") || tipEl) updateTip(); }, { passive: true });
addEventListener("pointerdown", e => { if (e.pointerType === "touch") { tipPt = null; updateTip(); } });
document.documentElement.addEventListener("pointerleave", () => { tipPt = null; updateTip(); });

function renderActions() {
  renderGroupbar(); // 0.50: highlights the selected group
  renderSelection(); // 0.51
  const tools = $("cmdtools"), orders = $("cmdorders");
  const us = orderable(), os = selOrbits(), anySelected = sel.length > 0 && mode === "game";
  const card = commandCard({ phase: sim.phase, anySelected, armed: armedCmd, tool, zone: !sel.length && selZone >= 0 && !!sim.zones[selZone],
    orderable: us.map(u => ({ kind: u.kind, fort: u.fort, standby: u.standby, damaged: !!u.soldiers?.some(so => !so.alive) })) });
  const toolsPage = card.length > 0 && card[0].tool !== undefined; // the tools list: show the static page
  tools.hidden = !toolsPage; orders.hidden = toolsPage;
  if (toolsPage) { if (tipEl) updateTip(); return; }
  const armedU = sel.find(e => "unit" in e && C.UNITS[e.unit.kind].range > 0) as { unit: import("./sim").Unit } | undefined;
  const sq = us.find(u => u.soldiers?.some(so => !so.alive));
  const onlyAir = os.length > 0 && os.length === sel.length;
  const label = (b: CardButton) => b.id === "target" ? (armedU ? `Target: ${C.TARGET_LABEL[armedU.unit.mode ?? "near"]}` : "Target")
    : b.id === "remove" && onlyAir ? (os.every(o => !o.arrived) ? "Cancel (charge back)" : "Send home")
    : b.id === "topup" && sq ? `Top up ${C.money(Math.round((sq.squadPaid ?? sq.paid ?? 0) / sq.soldiers!.length))}`
    : b.id === "buytroops" ? `Buy Troops ${C.money(sim.unitCost("garrison"))}` : b.id === "buysniper" ? `Buy Sniper team ${C.money(sim.unitCost("sniper"))}` : b.label;
  // 0.51.1: pictures only; the name, hotkey and what it does show in the hover tooltip (data-tip*)
  const icon = (b: CardButton) => b.id === "buytroops" ? SPRITE_URL.garrison ?? "" : b.id === "buysniper" ? SPRITE_URL.sniper ?? ""
    : orderIcon(b.id === "fortify" && b.label === "Dismount" ? "dismount" : b.id);
  const desc = (b: CardButton) => b.id === "remove" && onlyAir ? "Send the AC-130 home (before it arrives you get the charge back)."
    : b.id === "remove" && sim.phase === "plan" ? "Remove it and get its cost back." : b.id === "remove" ? "A helicopter pulls it out; you get its cost back once it is out."
    : CMD_DESC[b.id === "fortify" && b.label === "Dismount" ? "dismount" : b.id] ?? "";
  const html = card.filter(b => b.id !== "target" || armedU).map(b => `<button class="cmd${b.on ? " on" : ""}" data-cmd="${b.id}" data-tip="${esc(label(b))}" data-tipkey="${b.key === "RMB" ? "Right-click" : b.key}" data-tipdesc="${esc(desc(b))}"><img src="${icon(b)}" alt="${esc(label(b))}" draggable="false">${b.key && b.key !== "RMB" ? `<span class="hk">${b.key}</span>` : ""}</button>`).join("");
  if (orders.innerHTML !== html) orders.innerHTML = html;
  if (tipEl) updateTip();
}
const ORDER_COLOR: Record<string, string> = { move: "#80cbc4", amove: "#f87171", patrol: "#fbbf24", escort: "#86efac", fortify: "#4fc3f7" };
/** 0.52: the squad's living soldier nearest a map point (for the soldier card). */
function nearestSoldier(u: import("./sim").Unit, x: number, y: number) {
  let best: import("./squads").Soldier | null = null, bd = Infinity;
  for (const so of u.soldiers ?? []) if (so.alive) { const d = Math.hypot(so.x - x, so.y - y); if (d < bd) { bd = d; best = so; } }
  return best;
}
/** 0.52: your squads (people units) still on the map, and each one's state for the roster and Tab. */
function squadsNow() { return sim.units.filter(u => u.soldiers && u.extractT === undefined && u.soldiers.some(so => so.alive)); }
function stateOf(u: import("./sim").Unit) {
  // shotT -1 = never fired
  return squadState({ firedAgo: u.shotT !== undefined && u.shotT >= 0 ? sim.time - u.shotT : Infinity, moving: u.movedT !== undefined && sim.time - u.movedT < 0.6,
    fortified: sim.isFortified(u), ammo: u.ammo, maxAmmo: C.UNITS[u.kind].ammo });
}
/** 0.52: Tab / Shift+Tab: the next squad, idle ones first; selects it and centers the camera on it. */
function cycleSquad(back: boolean) {
  const qs = squadsNow(); if (!qs.length) { say("No squads yet.", 1500); return; }
  const cur = sel.length === 1 && "unit" in sel[0] ? qs.indexOf((sel[0] as { unit: import("./sim").Unit }).unit) : -1;
  const i = nextInTab(tabOrder(qs.map(stateOf)), cur, back), u = qs[i];
  sel = [{ unit: u }]; selZone = -1; selSoldier = null; closePerson();
  const [x, y] = sim.squadCenter(u); centerOn(x, y); following = false;
  renderActions();
}
/** 0.52: the squad whose soldier is nearest a screen point, within SNAP_PX css px (soldiers win over everything). */
const SNAP_PX = 12;
let hoverSquad: import("./sim").Unit | null = null;
function squadNearScreen(sx: number, sy: number): import("./sim").Unit | null {
  const s = cam.scale, lim = SNAP_PX * devicePixelRatio;
  let best: import("./sim").Unit | null = null, bd = lim * lim;
  for (const u of sim.units) {
    if (!u.soldiers || u.extractT !== undefined) continue;
    for (const so of u.soldiers) {
      if (!so.alive) continue;
      const dx = cam.x + so.x * s - sx, dy = cam.y + so.y * s - sy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = u; }
    }
  }
  return best;
}
/** 0.52: every soldier is a green dot the size of a person, with a ring that says the job (C.RING_COLOR) and keeps a
 *  readable size on screen. Fortified squads sit in sandbags; the selected squad gets white rings and a hull; the
 *  hovered one lights up. No pictures for people units at any zoom (design ruling). */
function drawSoldierDots(s: number) {
  const dpr = devicePixelRatio, dot = Math.min(7, Math.max(1, s * 0.2)) * 1.15, r = Math.max(1.1 * dpr, dot / 2);
  const ring = Math.max(3.6 * dpr, r + Math.max(1.3 * dpr, s * 0.14)), lw = Math.max(1.4 * dpr, s * 0.07);
  const selected = new Set(sel.filter(e => "unit" in e).map(e => (e as { unit: import("./sim").Unit }).unit));
  for (const u of sim.units) {
    if (!u.soldiers) continue;
    const spec = C.UNITS[u.kind], living = u.soldiers.filter(so => so.alive);
    if (!living.length) continue;
    const isSel = selected.has(u), isHov = hoverSquad === u;
    ctx.globalAlpha = (u.deployT && u.deployT > 0) || u.extractT !== undefined ? 0.45 : 1;
    const fb = sim.isFortified(u) ? sim.fortBoxOf(u) : null, onRoof = !!fb && sim.map.tile[sim.idx(Math.floor(u.x), Math.floor(u.y))] === BUILDING;
    if (onRoof) { // 0.52.1: one sandbag fortification around the squad, drawn inside the roof (design ruling)
      const [bx, by, bs] = fb!, lwS = Math.max(1.5 * dpr, s * 0.16), pad = lwS / 2 + s * 0.04;
      ctx.strokeStyle = "#c69c5a"; ctx.lineWidth = lwS; ctx.setLineDash([Math.max(2.5 * dpr, s * 0.32), Math.max(1 * dpr, s * 0.09)]);
      ctx.beginPath(); ctx.roundRect(cam.x + bx * s + pad, cam.y + by * s + pad, bs * s - pad * 2, bs * s - pad * 2, s * 0.25); ctx.stroke();
      ctx.setLineDash([]);
    }
    const out = u.ammo < 1, low = !out && u.ammo !== Infinity && u.ammo < spec.ammo * 0.25;
    const rc = out ? "#6b7280" : C.RING_COLOR[u.kind] ?? "#e2e8f0";
    if (isSel && living.length > 1 && !onRoof) { // a thin hull: one circle around the squad (on a roof the sandbags show it)
      const [cx, cy] = sim.squadCenter(u); let rr = 0;
      for (const so of living) rr = Math.max(rr, Math.hypot(so.x - cx, so.y - cy));
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, dpr); ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.arc(cam.x + cx * s, cam.y + cy * s, rr * s + ring + 3 * dpr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // 0.52.1: inside the sandbags the rings shrink to fit their cell so nothing hangs past the roof
    const rg = onRoof ? Math.max(r + 0.6 * dpr, Math.min(ring, s * 0.36)) : ring, lwq = onRoof ? Math.min(lw, Math.max(0.8 * dpr, s * 0.06)) : lw;
    for (const so of living) {
      const x = cam.x + so.x * s, y = cam.y + so.y * s;
      if (x < -20 || y < -20 || x > ctx.canvas.width + 20 || y > ctx.canvas.height + 20) continue;
      if (isSel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lwq; ctx.beginPath(); ctx.arc(x, y, rg + lwq * 1.3, 0, 7); ctx.stroke(); }
      ctx.strokeStyle = rc; ctx.lineWidth = isHov ? lwq * 1.8 : lwq;
      const a = ctx.globalAlpha; if (low) ctx.globalAlpha = a * 0.5;
      ctx.beginPath(); ctx.arc(x, y, rg, 0, 7); ctx.stroke(); ctx.globalAlpha = a;
      ctx.fillStyle = C.SOLDIER_COLOR; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (so.role === "grenadier" && (so.grenades ?? 0) > 0) { ctx.fillStyle = "#ffb74d"; ctx.beginPath(); ctx.arc(x, y, Math.max(0.7 * dpr, r * 0.55), 0, 7); ctx.fill(); } // 0.53: the M320 man
    }
  }
  ctx.globalAlpha = 1;
}
function drawSelection(s: number) {
  if (box) { ctx.strokeStyle = "#80cbc4"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeRect(Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1])); ctx.setLineDash([]); }
  if (!selAlive()) return;
  for (const e of sel) {
    if ("orbit" in e) { // 0.46: a ring on the plane, and a line to where it's headed
      const [ax, ay] = sim.orbitPos(e.orbit), px = cam.x + ax * s, py = cam.y + ay * s;
      ctx.strokeStyle = "#80cbc4"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, Math.max(12, airHalfPx("ac130", s) + 4), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(cam.x + e.orbit.x * s, cam.y + e.orbit.y * s, Math.max(6, s * 1.5), 0, 7); ctx.stroke();
      continue;
    }
    const o = "unit" in e ? e.unit : e.support, squad = "unit" in e && !!e.unit.soldiers; // 0.52: squads are marked on their dots
    const [ox, oy] = squad ? sim.squadCenter((e as { unit: import("./sim").Unit }).unit) : [o.x + 0.5, o.y + 0.5];
    const px = cam.x + ox * s, py = cam.y + oy * s;
    if (!squad) { ctx.strokeStyle = "unit" in e && e.unit.standby ? "#94a3b8" : "#80cbc4"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, Math.max(8, s * 2), 0, 7); ctx.stroke(); }
    if (!("unit" in e) || !e.unit.orders?.length) continue;
    // its queue: a line through every point, colored by order
    let lx = px, ly = py;
    for (const q of e.unit.orders) {
      let tx = q.x + 0.5, ty = q.y + 0.5;
      if (q.k === "escort") { const c = sim.escortCenter(q.who!); if (!c) continue; [tx, ty] = c; }
      const qx = cam.x + tx * s, qy = cam.y + ty * s;
      ctx.strokeStyle = ORDER_COLOR[q.k]; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(qx, qy);
      if (q.k === "patrol") ctx.lineTo(cam.x + (q.px! + 0.5) * s, cam.y + (q.py! + 0.5) * s);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ORDER_COLOR[q.k]; ctx.beginPath(); ctx.arc(qx, qy, 3, 0, 7); ctx.fill();
      lx = qx; ly = qy;
    }
  }
}

/** 0.44: next to the pointer, in every tool and phase: what is under it (unit, ground with roof height, zone) and,
 *  while placing or drawing the zone, what it costs and what is left. Sits above-right of the pointer so the
 *  strike warnings (below-right) stay readable. */
function drawCursorInfo(s: number) {
  if (!hover || stack.length || mode !== "game") return;
  const lines = describeCell(sim, hover[0], hover[1]);
  if (!lines) return;
  const est = estimateAt(sim, tool, hover[0], hover[1], draft);
  const rows: [string, string][] = lines.map(t => [t, "#e2e8f0"]);
  if (armedCmd) rows.unshift([armedCmd === "amove" ? "Attack-move: click a spot" : armedCmd === "patrol" ? "Patrol: click a spot" : armedCmd === "fortify" ? "Fortify: click a roof" : "Escort: click a person", ORDER_COLOR[armedCmd]]); // 0.45 (0.51: fortify)
  if (est?.blocked) rows.push([est.blocked, "#fbbf24"]);
  else if (est && est.price !== null) rows.push([`Cost ${C.money(est.price)} · ${C.money(est.left!)} left`, est.left! < 0 ? "#f87171" : "#86efac"]);
  const dpr = devicePixelRatio, fs = 12 * dpr, lh = 16 * dpr, pad = 6 * dpr;
  ctx.font = `${fs}px system-ui, sans-serif`;
  const w = Math.max(...rows.map(([t]) => ctx.measureText(t).width)) + pad * 2, h = rows.length * lh + pad;
  let x = cam.x + hover[0] * s + 14 * dpr, y = cam.y + hover[1] * s - 14 * dpr - h;
  if (x + w > ctx.canvas.width - 4) x = cam.x + hover[0] * s - 14 * dpr - w;
  if (y < 4) y = cam.y + hover[1] * s + 40 * dpr;
  ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.fillRect(x, y, w, h);
  rows.forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, x + pad, y + pad / 2 + (i + 1) * lh - 4 * dpr); });
}

/** 0.28: rounds in flight. No beams: a tiny tracer streak for small arms, a longer thin one for the sniper,
 *  a thicker glowing slug for cannon, a chunky shell with its shadow (it climbs and drops) for artillery, and a
 *  rocket with a smoke trail. Muzzle flashes at the gun. Nothing is drawn zoomed out. */
function drawShots(s: number) {
  if (s < 2.5 || !sim.shots.length) return;
  // render clock: the sim ticks at 20 Hz, a bullet crosses its range faster than that, so draw between ticks
  const t = sim.time + (sim.phase === "battle" ? Math.min(Math.max(0, acc), 0.1) : 0), X = (x: number) => cam.x + x * s, Y = (y: number) => cam.y + y * s;
  const vw = canvas.width, vh = canvas.height;
  ctx.save(); ctx.lineCap = "round";
  for (const sh of sim.shots) {
    if (sh.t > t) continue; // a salvo's later rounds
    const big = sh.cls >= SHOT_SHELL;
    if (!big && s < 4) continue;
    // small rounds stay on screen for at least ~0.1 s so the eye catches the streak (a real tracer burns that long)
    const fl = big ? Math.max(1e-3, sh.land - sh.t) : Math.max(0.1, sh.land - sh.t), k = Math.min(1, (t - sh.t) / fl);
    if (t > sh.t + fl + (big ? 0 : 0.02)) continue;
    const x0 = X(sh.x0), y0 = Y(sh.y0), x1 = X(sh.x1), y1 = Y(sh.y1);
    if (Math.max(x0, x1) < -20 || Math.min(x0, x1) > vw + 20 || Math.max(y0, y1) < -20 || Math.min(y0, y1) > vh + 20) continue;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const px = x0 + dx * k, py = y0 + dy * k;
    // muzzle flash: the first instant after the shot
    if (t - sh.t < 0.05 && s >= 4) {
      const fr = Math.min(14, s * (sh.cls === SHOT_SHELL ? 0.7 : sh.cls === SHOT_ROCKET ? 0.6 : sh.cls === SHOT_CANNON ? 0.5 : sh.cls === SHOT_SNIPER ? 0.32 : 0.22));
      const mx = x0 + ux * s * 0.6, my = y0 + uy * s * 0.6;
      ctx.globalAlpha = 0.9; ctx.fillStyle = "#fff4c2";
      ctx.beginPath(); ctx.moveTo(mx - uy * fr * 0.45, my + ux * fr * 0.45); ctx.lineTo(mx + ux * fr * 1.6, my + uy * fr * 1.6); ctx.lineTo(mx + uy * fr * 0.45, my - ux * fr * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffb74d"; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(mx, my, fr * 0.5, 0, 7); ctx.fill();
    }
    if (sh.cls === SHOT_SHELL) {
      // shells climb and fall: the shell rides above its shadow and looms larger at the top of the arc
      const hgt = Math.sin(Math.PI * k), f = 1 + hgt * 0.7;
      const L = Math.max(3, s * 0.42 * f), Wd = Math.max(2, s * 0.2 * f), lift = hgt * Math.min(40, len * 0.18);
      ctx.globalAlpha = 0.35; ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(px, py, L * 0.5, Wd * 0.5, Math.atan2(dy, dx), 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      // 0.32: the round itself (pitching nose-up on the climb, nose-down on the fall reads as a slight turn of the sprite)
      drawAirframe(ctx, sh.kind === "mortar" ? "mortar" : "shell", px, py - lift, s * f, Math.atan2(dy, dx) - (0.5 - k) * 0.25, 0, 0);
    } else if (sh.cls === SHOT_ROCKET) {
      const k0 = Math.max(0, k - 0.3), ang = Math.atan2(dy, dx);
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#b0b0b0"; ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.beginPath(); ctx.moveTo(x0 + dx * k0, y0 + dy * k0); ctx.lineTo(px, py); ctx.stroke();
      // 0.32: the motor's flame behind the rocket, then the rocket
      const key = sh.kind === "reaper" ? "hellfire" : "gmlrs", half = airHalfPx(key, s), fl2 = half * (0.9 + 0.3 * Math.random());
      ctx.globalAlpha = 0.9; ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(px - ux * half, py - uy * half, px - ux * (half + fl2), py - uy * (half + fl2));
      g.addColorStop(0, "rgba(255,245,200,1)"); g.addColorStop(0.4, "rgba(255,160,50,0.7)"); g.addColorStop(1, "rgba(255,90,20,0)");
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, half * 0.35);
      ctx.beginPath(); ctx.moveTo(px - ux * half, py - uy * half); ctx.lineTo(px - ux * (half + fl2), py - uy * (half + fl2)); ctx.stroke();
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      drawAirframe(ctx, key, px, py, s, ang, 0, 0);
    } else {
      // tracer streak: its length in cells, its width by caliber
      const Lc = sh.cls === SHOT_SNIPER ? 3 : sh.cls === SHOT_CANNON ? 1.4 : 1.1;
      const L = Math.min(len, Lc * s);
      const hx = x0 + ux * (L + (len - L) * k), hy = y0 + uy * (L + (len - L) * k); // the head: out of the muzzle at once, into the target at the end
      const wpx = sh.cls === SHOT_CANNON ? Math.max(1.6, Math.min(4, s * 0.1)) : sh.cls === SHOT_SNIPER ? 1 : Math.max(1, Math.min(2, s * 0.045));
      ctx.globalAlpha = sh.cls === SHOT_SNIPER ? 0.75 : 0.95;
      ctx.strokeStyle = sh.cls === SHOT_CANNON ? "#ffcf70" : sh.cls === SHOT_SNIPER ? "#fffbe8" : "#ffe9a0";
      ctx.lineWidth = wpx;
      ctx.beginPath(); ctx.moveTo(hx - ux * L, hy - uy * L); ctx.lineTo(hx, hy); ctx.stroke();
    }
  }
  ctx.restore();
}

/** 0.32: bombs and shells on their way down from aircraft and off-map guns, drawn the last moment before they hit:
 *  the bomb above its shadow, the two meeting at the impact. */
const FALL_KEY: Partial<Record<string, string>> = { airstrike: "jdam", bomb: "jdam", firebomb: "napalm", cluster: "cbu97", moab: "moab", nuke: "b61", shell: "shell" };
function drawOrdnance(s: number, now: number) {
  if (s < 1.5 || sim.phase !== "battle") return;
  const t = sim.time + Math.min(Math.max(0, acc), 0.1);
  const one = (key: string, gx: number, gy: number, land: number, fall: number, head: number, tumble = 0, from?: [number, number]) => {
    const left = land - t; if (left < 0 || left > fall) return;
    const k = 1 - left / fall, X = cam.x + gx * s, Y = cam.y + gy * s;
    const lift = (1 - k) * Math.min(90, Math.max(30, s * 10));
    let bx = X, by = Y - lift;
    if (from) { bx = X - from[0] * (1 - k) * s * 12; by = Y - from[1] * (1 - k) * s * 12 - lift * 0.6; } // a shell coming in from its battery
    const r = Math.max(2, airHalfPx(key, s) * (0.4 + 0.6 * k));
    ctx.globalAlpha = 0.25 + 0.3 * k; ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(X, Y, r, r * 0.4, head, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    drawAirframe(ctx, key, bx, by, s * (0.8 + 0.2 * k), head + tumble * (now / 1000) * 4, 0, 0);
  };
  for (const p of sim.pending) {
    const key = FALL_KEY[p.kind]; if (!key) continue;
    const head = Math.atan2(p.y2 - p.y, p.x2 - p.x) || 0;
    if (p.kind === "airstrike") { // the stick leaves the jet a moment before the first bomb hits
      const l = Math.hypot(p.x2 - p.x, p.y2 - p.y), n = Math.max(2, Math.round(l / 5));
      for (let i = 0; i <= n; i++) one(key, p.x + (p.x2 - p.x) * i / n, p.y + (p.y2 - p.y) * i / n, p.at + i * 0.08, 1.2, head);
    } else if (p.kind === "shell") one(key, p.x, p.y, p.at, 1.1, Math.atan2(0.6, 0.8), 0, [0.8, 0.6]); // the battery is off the map to the north-west
    else if (p.kind === "bomb") one(key, p.x, p.y, p.at, 1.2, 0);
    else one(key, p.x, p.y, p.at, p.kind === "moab" ? 2.5 : p.kind === "nuke" ? 2 : 1.4, p.kind === "firebomb" ? 0.4 : 0, p.kind === "firebomb" ? 1 : 0);
  }
}

/** Draw a sprite: the 64 px art is shrunk smoothly (nearest-neighbor shrinking makes it shimmer), 16 px grids stay crisp. */
function spr(img: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const smooth = img.width > 16 && w < img.width;
  if (smooth) ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x, y, w, h);
  if (smooth) ctx.imageSmoothingEnabled = false;
}

function label(t: string, x: number, y: number) {
  ctx.font = `${12 * devicePixelRatio}px system-ui, sans-serif`;
  const w = ctx.measureText(t).width;
  if (x + w + 8 > ctx.canvas.width) x = Math.max(4, x - w - 40); // flip to the left near the right edge instead of clipping
  ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(x - 4, y - 14 * devicePixelRatio, w + 8, 18 * devicePixelRatio);
  ctx.fillStyle = "#fff"; ctx.fillText(t, x, y);
}

/** Render descending parachutes (paratroopers, GPS supply crates, heavy APC extraction rigs) and aircraft/helicopters/drones. */
/** 0.23: while placing, a faint cell grid near the cursor, the footprints already standing there,
 *  and this unit's footprint: green where it fits, red where it can't go. */
function drawPlacementGrid(hx: number, hy: number, foot: number, ok: boolean, s: number) {
  const R = 10, rect = (x0: number, y0: number, x1: number, y1: number) => [cam.x + x0 * s, cam.y + y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s] as const;
  if (s >= 4) {
    ctx.lineWidth = 1;
    for (let y = hy - R; y <= hy + R; y++) for (let x = hx - R; x <= hx + R; x++) {
      const d = Math.hypot(x - hx, y - hy); if (d > R) continue;
      ctx.strokeStyle = `rgba(255,255,255,${(0.16 * (1 - d / R)).toFixed(3)})`;
      ctx.strokeRect(cam.x + x * s + 0.5, cam.y + y * s + 0.5, s, s);
    }
  }
  ctx.lineWidth = Math.max(1, s * 0.08);
  const near = (x: number, y: number) => Math.abs(x - hx) <= R + 3 && Math.abs(y - hy) <= R + 3;
  ctx.strokeStyle = "rgba(226,232,240,0.35)";
  for (const u of sim.units) if (near(u.x, u.y)) ctx.strokeRect(...rect(...sim.footRect(C.UNITS[u.kind].foot, u.x, u.y)));
  for (const b of sim.supports) if (near(b.x, b.y)) ctx.strokeRect(...rect(...sim.footRect(C.SUPPORTS[b.kind].foot, b.x, b.y)));
  const r = rect(...sim.footRect(foot, hx, hy));
  ctx.fillStyle = ok ? "rgba(74,222,128,0.30)" : "rgba(239,68,68,0.32)"; ctx.fillRect(...r);
  ctx.strokeStyle = ok ? "#4ade80" : "#ef4444"; ctx.lineWidth = Math.max(1.5, s * 0.12); ctx.strokeRect(...r);
}
let lastAirT = 0;
function drawTransports(now: number, s: number) {
  const airDt = Math.min(0.1, Math.max(0, (now - lastAirT) / 1000)); lastAirT = now;
  // 1. Descending parachutes
  for (const ch of sim.chutes) {
    const gx = cam.x + ch.x * s, gy = cam.y + ch.y * s;
    const altPx = ch.z * Math.max(22, s * 14);
    const py = gy - altPx;
    const r = Math.max(5, s * (ch.kind === "apc" ? 2.1 : ch.kind === "supply" ? 1.5 : 1.25));
    // Ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath(); ctx.ellipse(gx, gy, r * (0.4 + 0.5 * (1 - ch.z)), r * 0.25, 0, 0, 7); ctx.fill();
    if (ch.kind === "apc") {
      // APC chassis + 3 heavy extraction canopies
      ctx.fillStyle = "#80cbc4"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
      ctx.fillRect(gx - r * 0.65, py + r * 0.4, r * 1.3, r * 0.75);
      ctx.strokeRect(gx - r * 0.65, py + r * 0.4, r * 1.3, r * 0.75);
      for (const ox of [-r * 0.9, 0, r * 0.9]) {
        const cy = py - (ox === 0 ? r * 0.55 : r * 0.25);
        ctx.strokeStyle = "rgba(230,230,230,0.65)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx + ox - r * 0.5, cy); ctx.lineTo(gx, py + r * 0.4); ctx.moveTo(gx + ox + r * 0.5, cy); ctx.lineTo(gx, py + r * 0.4); ctx.stroke();
        ctx.fillStyle = "#689f38"; ctx.strokeStyle = "#1b2614"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(gx + ox, cy, r * 0.6, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else {
      // Suspension lines + payload + canopy dome
      ctx.strokeStyle = "rgba(220,225,230,0.65)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - r * 0.7, py - r * 0.3); ctx.lineTo(gx, py + r * 0.55); ctx.moveTo(gx + r * 0.7, py - r * 0.3); ctx.lineTo(gx, py + r * 0.55); ctx.stroke();
      ctx.fillStyle = ch.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.2;
      if (ch.kind === "supply") {
        ctx.fillRect(gx - r * 0.38, py + r * 0.4, r * 0.76, r * 0.65);
        ctx.strokeRect(gx - r * 0.38, py + r * 0.4, r * 0.76, r * 0.65);
      } else {
        ctx.beginPath(); ctx.arc(gx, py + r * 0.55, Math.max(2.5, r * 0.28), 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = ch.kind === "supply" ? "#29b6f6" : "#7cb342";
      ctx.beginPath(); ctx.arc(gx, py - r * 0.3, r * 0.8, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  // 2. Aircraft, helicopters, and resupply drones
  for (const tr of sim.transports) {
    const px = cam.x + tr.x * s, py = cam.y + tr.y * s;
    const isDrone = tr.kind === "drone_supply";
    const isHelo = tr.kind === "helo_uh60" || tr.kind === "helo_ch47" || tr.kind === "helo_extract";
    const isJet = tr.kind === "jet_strike";
    const r = Math.max(isDrone ? 4 : 8, s * (isDrone ? 1.1 : isHelo ? 2.4 : isJet ? 2.8 : 3.6));
    // Rotor wash ring & fast-ropes / sling-load cable when helicopter is hovering at target
    if (isHelo && tr.hoverS > 0) {
      const leg = (tr.dur - tr.hoverS) / 2;
      if (tr.t >= leg * 0.85 && tr.t <= leg + tr.hoverS * 1.1) {
        const tx = cam.x + tr.tx * s, ty = cam.y + tr.ty * s;
        const pulse = 0.5 + 0.5 * Math.sin(now / 75);
        ctx.strokeStyle = `rgba(210,220,230,${(0.25 + 0.25 * pulse).toFixed(2)})`;
        ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(tx, ty, r * (1.2 + 0.35 * pulse), 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }
    // 0.29: real-size airframes; helicopters settle low over the drop point and climb out again
    const air = tr.air ?? (isDrone ? "quad" : tr.kind === "helo_ch47" ? "ch47" : isHelo ? "uh60" : isJet ? "f15e" : "c130");
    let alt = 1;
    if (tr.hoverS > 0) {
      const leg = (tr.dur - tr.hoverS) / 2, ease = (v: number) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
      alt = tr.t < leg ? 1 - 0.7 * ease((tr.t / leg - 0.7) / 0.3) : tr.t < leg + tr.hoverS ? 0.3 : 0.3 + 0.7 * ease((tr.t - leg - tr.hoverS) / (leg * 0.5));
    }
    const head = smoothHeading(tr, tr.angle, airDt, isHelo || isDrone ? 2.5 : 1.2);
    drawAirframe(ctx, air, px, py, s, head, alt, now / 1000 * (isDrone ? 30 : 12));
    if (tr.label && s > 1.1) label(tr.label, px + airHalfPx(air, s) + 5, py - 4);
  }

  // 3. Mass Transit Evacuation Trains (4-car articulated commuter/metro consists on rail lines)
  for (const mt of sim.trains) {
    const px = cam.x + mt.x * s, py = cam.y + mt.y * s;
    const carLen = Math.max(7, s * 2.8), carW = Math.max(4, s * 1.45);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(mt.angle);
    // Headlight beam
    ctx.fillStyle = "rgba(255,245,180,0.28)";
    ctx.beginPath(); ctx.moveTo(carLen * 0.5, 0); ctx.lineTo(carLen * 2.2, -carW * 1.3); ctx.lineTo(carLen * 2.2, carW * 1.3); ctx.closePath(); ctx.fill();
    for (let c = 0; c < 4; c++) {
      const ox = -c * (carLen + 2);
      ctx.fillStyle = c === 0 ? "#e2e8f0" : "#cbd5e1";
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(ox - carLen / 2, -carW / 2, carLen, carW, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(ox - carLen * 0.35, -carW * 0.22, carLen * 0.7, carW * 0.44);
    }
    ctx.restore();
    if (s > 1.0) label(`TRANSIT · ${mt.boarded}/${C.TRAIN_CAPACITY} evacuated`, px + carLen * 0.6, py - 6);
  }
}

let lastInfoHtml = "", infoFloat = false, lastInfoKey = ""; // 0.52.1: infoFloat/lastInfoKey: the growing hover card
/** 0.51: where the info panel looks for the selection: the first selected unit or building. */
function selProbe(): { at: [number, number]; ent?: import("./sim").Unit } | null {
  const e = sel.find(x => !("orbit" in x)); // an AC-130 has no card here; the first unit or building does
  if (!e || !selAlive()) return null;
  if ("unit" in e) return { at: [e.unit.x + 0.5, e.unit.y + 0.5], ent: e.unit };
  if ("support" in e) return { at: [e.support.x + 0.5, e.support.y + 0.5] };
  return null;
}
/** 0.51: the info panel with nothing selected or hovered: the zone you clicked, or what to do next. */
function idleInfo() {
  if (selZone >= 0 && sim.zones[selZone]) {
    setInfoPanel(`<div class="ip-head"><span class="ip-title">Safe zone ${selZone + 1}</span></div><div class="ip-desc">${sim.phase === "battle" ? "Buy Troops or a Sniper team here: they deploy in this zone (command card)." : "Place Troops on its roofs or streets, build Evac Points and support buildings inside it."} Ctrl+1-0 puts it on a group key.</div>`, "#80cbc4");
    return;
  }
  const nextT = sim.phase === "battle" && Number.isFinite(sim.nextWaveT) ? Math.max(0, Math.round(sim.nextWaveT - sim.time)) : null;
  setInfoPanel(`<div class="ip-head"><span class="ip-title">${sim.phase === "plan" ? "Planning" : sim.phase === "battle" ? "Battle" : "Round over"}</span>${nextT !== null ? `<span class="ip-cost">Next horde ${nextT} s</span>` : ""}</div>`
    + `<div class="ip-desc">${sim.phase === "plan" ? "Draw a safe zone, place units from the build panel, then Start Battle." : "Click a unit, a person or a safe zone to see it here. Drag a box to select several."}</div>`, "#64748b");
}
function setInfoPanel(html: string | null, accent = "#7cfc9a") {
  const box = $("infocard");
  if (!html || mode !== "game" || !stack.every(() => false)) {
    if (!box.hidden) { box.hidden = true; lastInfoHtml = ""; }
    return;
  }
  box.hidden = false;
  box.style.borderLeftColor = accent;
  const key = html + (infoFloat ? "|f" : "");
  if (html !== lastInfoHtml) { box.innerHTML = stripCodexLinks(html); lastInfoHtml = html; } // the hover panel takes no clicks
  if (key !== lastInfoKey) { lastInfoKey = key; layoutInfoCard(); }
}
/** 0.52.1: a hovered card too long for the info cell grows upward over the map (fixed, anchored to the cell's bottom,
 *  same width) so all of it reads without scrolling; it drops back into the cell when the hover ends (design ruling). */
function layoutInfoCard() {
  const box = $("infocard"), cell = $("hud-info");
  box.classList.remove("float"); box.style.left = box.style.width = box.style.bottom = "";
  if (!infoFloat || box.hidden || box.scrollHeight <= cell.clientHeight - 4) return;
  const r = cell.getBoundingClientRect();
  box.classList.add("float");
  box.style.left = `${r.left}px`; box.style.width = `${r.width}px`; box.style.bottom = `${innerHeight - r.bottom}px`;
}
addEventListener("resize", () => { lastInfoKey = ""; });

/** Info HTML for a tool: shown in the info panel when hovering a build tile or a command card tool (0.19; 0.51). */
function toolInfoHtml(t: string): { html: string; accent: string } | null {
  const out = (html: string, accent = "#7cfc9a") => ({ html, accent });
  if ((C.BUILDABLE as string[]).includes(t)) {
    const k = t as C.UnitKind;
    const spec = C.UNITS[k], info = C.UNIT_INFO[k];
    const cost = sim.unitCost(k);
    const dps = Math.round(spec.damage * spec.rate);
    const activeCount = sim.units.filter(u => u.kind === k).length;
    const classKills = sim.units.filter(u => u.kind === k).reduce((a, u) => a + u.kills, 0);
    const placeStr = spec.on === "building" ? "Building Rooftop" : spec.on === "water" ? "River / Canal" : spec.roof ? "Street / Park / Rooftop" : "Street / Park";
    const rangeStr = `${spec.minRange ? `${spec.minRange * C.CELL_M}-` : ""}${spec.range * C.CELL_M} m${spec.roofBonus ? ` (+${spec.roofBonus * C.CELL_M}m/flr)` : ""}`;
    const ammoStr = spec.ammo === Infinity ? "Unlimited" : `${spec.ammo.toLocaleString()} rds${spec.reloadsInZone ? " (∞ in Zone)" : ""}`;
    const spUrl = SPRITE_URL[k];
    return out(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}${cxLink("unit-" + k)}</span><span class="ip-cost">${C.money(cost)}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · ${placeStr}</div></div></div>` +
      `<div class="ip-desc">${info.desc}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Damage</span><b>${spec.damage.toLocaleString()}${spec.splash ? ` (${(spec.splash * C.CELL_M).toFixed(1)}m splash)` : ""}</b></div>` +
        `<div><span>Fire Rate</span><b>${spec.rate}/s (${dps.toLocaleString()} DPS)</b></div>` +
        `<div><span>Range</span><b>${rangeStr}</b></div>` +
        `<div><span>Ammo</span><b>${ammoStr}</b></div>` +
        `<div><span>Deployment</span><b>${spec.deploy}s (${info.transport.split(" ")[0]})</b></div>` +
        `<div><span>Struct. Dmg</span><b>${info.structDmg.split(" ")[0]}</b></div>` +
        (spec.mobile ? `<div><span>Armor / Speed</span><b>${spec.mobile.hp === Infinity ? "Invulnerable" : `${spec.mobile.hp} HP`} · ${(spec.mobile.speed * C.CELL_M).toFixed(1)}m/s</b></div>` : spec.hp ? `<div><span>Armor</span><b>${spec.hp} HP · blocks the street</b></div>` : "") +
        (sim.phase !== "plan" ? `<div><span>Active / Kills</span><b>${activeCount} deployed · ${classKills.toLocaleString()} kills</b></div>` : "") +
      `</div>` +
      `<div class="ip-tags">${info.specials.map(s => `<div>${withKeys(s)}</div>`).join("")}</div>`,
      spec.color
    );
  }
  if (isSupport(t as Tool)) {
    const k = t as C.SupportKind;
    const spec = C.SUPPORTS[k], info = C.SUPPORT_INFO[k];
    const cost = sim.supportCost(k);
    const count = sim.supports.filter(b => b.kind === k).length;
    const spUrl = SPRITE_URL[supportSpriteKey(k)];
    return out(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}${cxLink("support-" + k)}</span><span class="ip-cost">${C.money(cost)}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · Safe Zone Building</div></div></div>` +
      `<div class="ip-desc">${spec.hint}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Effect Radius</span><b>${spec.radius * C.CELL_M} m</b></div>` +
        `<div><span>Deploy Time</span><b>${spec.deploy}s (${info.transport})</b></div>` +
        `<div style="grid-column:1/-1"><span>Primary Effect</span><b>${info.effect}</b></div>` +
        (count > 0 ? `<div style="grid-column:1/-1"><span>Active in Zone</span><b>${count} operational</b></div>` : "") +
      `</div>` +
      `<div class="ip-tags">${info.specials.map(s => `<div>${withKeys(s)}</div>`).join("")}</div>`,
      spec.color
    );
  }
  if (isAbility(t as Tool)) {
    const k = t as C.AbilityKind;
    const spec = C.ABILITIES[k];
    const platforms: Record<C.AbilityKind, string> = {
      airstrike: "F-15E Strike Eagle (Bombs)",
      firebomb: "Strike Jet (Incendiary)",
      para: "C-130J Hercules (6 Chutes)",
      supply_drop: "C-130J Hercules (4 Crates)",
      barrage: "M777 Howitzer Battery (16 Shells)",
      moab: "MC-130J (GBU-43/B MOAB)",
      nuke: "Tactical Nuclear Warhead (Missile)",
      a10: "A-10C Thunderbolt II (GAU-8 30 mm)",
      cluster: "Strike Jet (CBU-97, 50 Bomblets)",
      tomahawk: "Destroyer (BGM-109 Tomahawk)",
      gunship: "AC-130U (25 mm, 40 mm, 105 mm; 40 s Orbit)",
    };
    const struct: Record<C.AbilityKind, string> = {
      airstrike: "Heavy (Demolishes Buildings & Roads)",
      firebomb: "Medium (Scorches Terrain & Roofs)",
      para: "None (Infantry Insertion)",
      supply_drop: "Repairs +2,500 Wall HP & Resupplies",
      barrage: "Heavy (Craters & Collapses Across 56 m)",
      moab: "Massive (Flattens 56 m, Batters Walls)",
      nuke: "Total (160 m Erased, 130 m Fallout 90 s, -500 XP)",
      a10: "Light (Narrow 30 mm Path)",
      cluster: "Light (Shreds Crowds Across 64 m)",
      tomahawk: "Total (Destroys One Spot, 14 m)",
      gunship: "Medium (Infected Only, 60 m Orbit)",
    };
    const spUrl = SPRITE_URL[k];
    return out(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}${cxLink("ability-" + k)}</span><span class="ip-cost">${C.money(sim.abilityCost(k))} (${sim.charges[k]} ready)</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">Tactical Air Support · ${platforms[k]}</div></div></div>` +
      `<div class="ip-desc">${spec.hint}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Arrival Delay</span><b>${k === "gunship" ? "Flies in from the nearest edge" : `${spec.delay} s`}</b></div>` +
        `<div><span>Aircraft</span><b>${platforms[k].split(" (")[0]}</b></div>` +
        `<div style="grid-column:1/-1"><span>Structure / Field Effect</span><b>${struct[k]}</b></div>` +
      `</div>`,
      spec.color
    );
  }
  if (t === "zone" || t === "gate" || t === "c4" || t === "depot" || t === "remove" || t === "pan" || t === "order" || t === "heatmap" || t === "closegates" || t === "clear") {
    const meta: Record<string, [string, string, string, string, SpriteKey]> = {
      zone: ["Safe Zone Perimeter", `${C.money(C.ZONE_BASE_COST)} base`, "Engineering · Quarantine Perimeter", "Click polygon corners around city blocks, then click the first corner (or press Enter) to close. Road crossings become guarded Gates; interior buildings can host Support Facilities.", "zone"],
      gate: ["Gate / Wall Toggle [G]", `${sim.gateMaxHp()} / ${sim.wallMaxHp()} HP`, "Fortification · Access Control", "Gates (blue, 3,000 HP) let fleeing civilians enter while blocking infected. Walls (white, 8,000 HP) block everyone and withstand 2.6x more punishment. Close gates once civilians are inside.", "gate"],
      c4: ["Bridge Demolition Charge", `${C.money(C.C4_COST)}`, "Combat Engineering · River Denial", "Plant charges on river bridges or buildings during planning or battle, then detonate during battle. A bridge drops into the river (Swimmer mutants still swim across). A building comes down in a controlled demolition: rubble fills its footprint and spills into the street, slowing everyone. Block a road or clear a sight line. Not on safe zone buildings or roofs you hold.", "c4"],
      depot: ["Fuel Depot Detonation", `${sim.depots.filter(d => !d.used).length} remaining`, "Environmental Hazard · Massive Blast", "Pre-existing industrial fuel tanks (orange triangles). Click during battle for a 22 m explosion (5,000 dmg) that levels adjacent buildings into rubble and ignites fires.", "depot"],
      remove: ["Remove / Helicopter Extraction", "100% Refund", "Logistics · Redeployment", "In Planning, removes a unit or support building immediately for a full refund. In Battle, dispatches an extraction helicopter (1.5x deploy time; Troops 10 s) to pull the unit out and refund its cost.", "remove"],
      order: ["Unit Orders", "Free", "Command & Control", "Select mobile units with Move/Aim (click, Shift-click or drag a box). Right-click: move (straight there, shooting on the way). A: attack-move. P: patrol. E: escort a person and their family. S: stop. D: stand by (hold fire). Shift queues orders.", "order"],
      pan: ["Move/Aim: Select & Command", "Click / Drag", "Command & Control", "Right-drag to pan, wheel to zoom. Click a unit or building to select it, drag a box to select mobile units. Right-click sends selected units (Q attack-move, R patrol, E escort, F stop, G stand by; Shift queues) or a selected AC-130. T cycles target priority (Nearest, Wall Biters, Infected Chasing Civilians); Delete removes it (full refund in Planning, extraction in Battle).", "pan"],
      heatmap: ["Spatial Kill Heatmap [H]", `${sim.kills.toLocaleString()} kills`, "Battlefield Intelligence", "Overlays a smoothed thermal density map of every infected kill. Hover a unit in the build panel during battle to isolate kills made by that unit class.", "heatmap"],
      recall: ["Recall Units [Q]", sim.recalled ? "Recalled" : "Instant", "Command & Control", "Every APC, tank, squad, paratrooper and aircraft falls back to the nearest safe zone and holds there. Boats and street emplacements stay put. Press again to send them all back to their posts; a strike order sends one unit out on its own.", "order"],
      closegates: ["Lock Down All Gates", "Instant", "Emergency Perimeter Seal", "Immediately converts every intact blue Gate across all Safe Zones into a reinforced white Wall (scaling current HP proportionally).", "gate"],
      clear: ["Clear Safe Zone", "Full Refund", "Planning Reset", "Removes your drawn Safe Zone polygon and refunds its cost so you can redraw your perimeter from scratch (available during Planning phase).", "remove"],
    };
    const m = meta[t];
    if (m) {
      const spUrl = SPRITE_URL[m[4]];
      return out(
        `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${m[0]}</span><span class="ip-cost">${m[1]}</span></div>` +
        `<div class="ip-role">${m[2]}</div></div></div>` +
        `<div class="ip-desc">${m[3]}</div>`,
        "#7cfc9a"
      );
    }
  }
  return null;
}

/** Populate the Tactical Hover Info Panel (#infocard) from either a hovered sidebar button or a hovered map entity. */
function updateInfoPanel(probe?: [number, number], prefer?: import("./sim").Unit) {
  if (mode !== "game" || stack.length > 0) { setInfoPanel(null); return; }
  if (selPerson >= 0 && !probe) { setInfoPanel(null); return; } // 0.51: the person window has the info panel
  // 0.51: the info panel (B) shows a hovered build item, else what's under the cursor, else the selection, else round status
  const navInfo = !probe && hoverNavTool ? toolInfoHtml(hoverNavTool) : null;
  const src = probe ? "selection" : infoSource(navInfo ? hoverNavTool : null, !!hover, sel.length > 0);
  infoFloat = !probe && (src === "hover-item" || src === "hover-entity"); // 0.52.1: hover cards may grow over the map
  if (src === "hover-item") { setInfoPanel(navInfo!.html, navInfo!.accent); return; }
  if (src === "idle") { idleInfo(); return; }
  const sp = !probe && src === "selection" ? selProbe() : null;
  const pt = probe ?? (src === "hover-entity" ? hover! : sp?.at);
  if (!pt) { idleInfo(); return; }
  prefer ??= sp?.ent ?? (src === "hover-entity" && hoverSquad ? hoverSquad : undefined); // 0.51 review: the selected unit itself (0.52.1: or the hovered squad), not whatever stands nearest that point
  const [hx, hy] = pt;
  const u = prefer ?? sim.units.find(u => Math.abs(u.x + 0.5 - hx) < 1.6 && Math.abs(u.y + 0.5 - hy) < 1.6);
  if (u) {
    const spec = C.UNITS[u.kind], info = C.UNIT_INFO[u.kind];
    const effRate = spec.rate * (u.rateMul ?? 1);
    const dps = Math.round(spec.damage * effRate);
    const status = u.extractT !== undefined ? `EXTRACTING (${Math.max(0, u.extractT).toFixed(1)}s)`
      : u.deployT && u.deployT > 0 ? `DEPLOYING (${u.deployT.toFixed(1)}s)`
      : u.fort === "climb" ? `FORTIFYING (${Math.max(0, u.fortT ?? 0).toFixed(1)}s)` : u.fort === "descend" ? `COMING DOWN (${Math.max(0, u.fortT ?? 0).toFixed(1)}s)` : u.fort === "up" ? "FORTIFIED" // 0.50
      : u.ai ? u.ai.toUpperCase() : u.ammo < 1 ? "OUT OF AMMO" : "ACTIVE";
    const ammoCap = sim.mutators.has("supply_shortage") && spec.reloadsInZone && sim.unitInZone(u) ? spec.ammo * 2 : spec.ammo;
    const ammoPct = u.ammo === Infinity ? 100 : Math.min(100, Math.round((u.ammo / ammoCap) * 100));
    const ammoText = u.ammo === Infinity ? "Unlimited (In Safe Zone)" : `${Math.floor(u.ammo).toLocaleString()} / ${ammoCap.toLocaleString()} (${ammoPct}%)`;
    const hpMax = C.maxHp(spec), hpPct = u.hp !== undefined && hpMax !== undefined ? Math.max(0, Math.round((u.hp / hpMax) * 100)) : null;
    const buffs: string[] = [];
    if (u.rangeBoosted) buffs.push("+40% Range (Radio Tower)");
    if (u.rateMul && u.rateMul > 1) buffs.push("+30% Fire Rate (Command Post)");
    if (u.supplied) buffs.push("Drone Resupply (Supply Depot)");
    const cellIdx = sim.idx(u.x | 0, u.y | 0);
    const flr = sim.map.height[cellIdx];
    if (spec.roofBonus && flr > 0) buffs.push(`+${Math.round(spec.roofBonus * Math.min(flr, C.ROOF_BONUS_MAX_LV) * C.CELL_M)}m Elevation (${flr} floors)`);
    const spUrl = SPRITE_URL[u.kind];
    setInfoPanel(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}</span><span class="ip-cost">${status}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · Kills: ${u.kills.toLocaleString()}</div></div></div>` +
      `<div class="ip-grid">` +
        `<div><span>Eff. Range</span><b>${Math.round(u.range * C.CELL_M)} m</b></div>` +
        `<div><span>Fire Rate / DPS</span><b>${effRate.toFixed(1)}/s (${dps.toLocaleString()})</b></div>` +
        `<div><span>Damage</span><b>${spec.damage.toLocaleString()}${spec.splash ? ` (${(spec.splash * C.CELL_M).toFixed(1)}m)` : ""}</b></div>` +
        `<div><span>Target Mode</span><b>${C.TARGET_LABEL[u.mode ?? "near"]}</b></div>` +
        `<div style="grid-column:1/-1"><span>Ammunition</span><b>${ammoText}</b></div>` +
      `</div>` +
      `<div class="ip-bar"><i style="width:${ammoPct}%;background:${u.supplied ? "#ffb74d" : "#4fc3f7"}"></i></div>` +
      (hpPct !== null ? `<div class="ip-grid"><div style="grid-column:1/-1"><span>Hull / Squad Health</span><b>${Math.max(0, Math.round(u.hp!))} / ${hpMax} HP (${hpPct}%)</b></div></div><div class="ip-bar"><i style="width:${hpPct}%;background:${hpPct > 50 ? "#7cfc9a" : hpPct > 25 ? "#ffd54f" : "#ff5252"}"></i></div>` : "") +
      `<div class="ip-tags">${(buffs.length ? buffs : [info.specials[0]]).map(s => `<div>${withKeys(s)}</div>`).join("")}</div>`,
      spec.color
    );
    return;
  }

  const b = sim.supports.find(b => Math.abs(b.x + 0.5 - hx) < 1.6 && Math.abs(b.y + 0.5 - hy) < 1.6);
  if (b) {
    const spec = C.SUPPORTS[b.kind], info = C.SUPPORT_INFO[b.kind];
    const status = b.extractT !== undefined ? `EXTRACTING (${Math.max(0, b.extractT).toFixed(1)}s)`
      : b.deployT && b.deployT > 0 ? `DEPLOYING (${b.deployT.toFixed(1)}s)` : "OPERATIONAL";
    const spUrl = SPRITE_URL[supportSpriteKey(b.kind)];
    setInfoPanel(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}</span><span class="ip-cost">${status}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · Paid ${C.money(b.paid)}</div></div></div>` +
      `<div class="ip-desc">${info.effect}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Aura Radius</span><b>${spec.radius * C.CELL_M} m</b></div>` +
        `<div><span>Transport</span><b>${info.transport}</b></div>` +
      `</div>`,
      spec.color
    );
    return;
  }

  const sc = sim.supplyCrates.find(c => Math.abs(c.x - hx) < 2.2 && Math.abs(c.y - hy) < 2.2);
  if (sc) {
    const left = Math.max(0, sc.until - sim.time);
    const spUrl = SPRITE_URL.supply_drop;
    setInfoPanel(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">Air-Dropped Supply Crate</span><span class="ip-cost">${left.toFixed(0)}s left</span></div>` +
      `<div class="ip-role" style="color:#4fc3f7">Field Resupply Point · Radius ${C.SUPPLY_CRATE_RADIUS * C.CELL_M} m</div></div></div>` +
      `<div class="ip-desc">Continuously feeds +12% magazine/s and heals +20 HP/s to all friendly units within ${C.SUPPLY_CRATE_RADIUS * C.CELL_M} m.</div>`,
      "#4fc3f7"
    );
    return;
  }

  // Inspect active Mass Transit Train, armed civilian (when zoomed in), collapsed building rubble, damaged structures, Highways, or Mass Transit infrastructure under cursor
  const mt = sim.trains.find(t => Math.abs(t.x - hx) < 3.5 && Math.abs(t.y - hy) < 3.5);
  if (mt) {
    setInfoPanel(
      `<div class="ip-head"><span class="ip-title">Mass Transit Evacuation Train</span><span class="ip-cost">${mt.boarded} / ${C.TRAIN_CAPACITY} Aboard</span></div>` +
      `<div class="ip-role" style="color:#38bdf8">Commuter / Metro Consist · Speed ${C.TRAIN_SPEED * C.CELL_M} m/s</div>` +
      `<div class="ip-desc">Sweeps along intact rail corridors every ${C.TRAIN_EVERY_S}s, crushing infected on the tracks (${C.TRAIN_CRUSH_DMG.toLocaleString()} dmg) and evacuating up to ${C.TRAIN_CAPACITY} fleeing civilians (+${C.money(C.TRAIN_BONUS_PER_CIV)}/passenger).</div>`,
      "#38bdf8"
    );
    return;
  }

  if (cam.scale >= 3.5) {
    const ac = sim.armedCivAt(hx, hy, 2.0);
    if (ac >= 0) {
      const wep = C.CIV_WEAPONS[sim.civWep[ac] as C.CivWeaponId];
      const militia = sim.civMilitia[ac] === 1;
      const lead = sim.famLead[ac], fSize = lead >= 0 ? sim.famSize[ac] : 1;
      let famAlive = 1;
      if (lead >= 0) {
        famAlive = 0;
        for (let m = lead; m < lead + fSize; m++) if (sim.state[m] === CIV || sim.state[m] === SAFE_CIV) famAlive++;
      }
      const fearPct = Math.round(sim.fear[ac] * 100);
      const effAcc = Math.round(wep.accuracy * (1 - C.CIV_FEAR_AIM_PENALTY * sim.fear[ac]) * 100);
      const maxAmmo = wep.mag * wep.mags[1];
      const ammoPct = maxAmmo > 0 ? Math.min(100, Math.round((sim.civAmmo[ac] / maxAmmo) * 100)) : 0;
      const status = sim.state[ac] === SAFE_CIV ? "IN SAFE ZONE" : sim.civAmmo[ac] === 0 ? "OUT OF AMMO" : sim.time - sim.civShotT[ac] < 0.6 ? "FIRING" : "EVACUATING";
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">${militia ? "Militia Family Member" : "Armed Civilian"}</span><span class="ip-cost">${status}</span></div>` +
        `<div class="ip-role" style="color:${militia ? "#aed581" : wep.color}">${wep.name} · ${fSize > 1 ? `Household (${famAlive}/${fSize} alive)` : "Solo Civilian"} · Civ Kills: ${sim.civKills.toLocaleString()}</div>` +
        `<div class="ip-desc">Armed citizen defending their household on the way to the Safe Zone. Pauses briefly to fire on close infected; panic reduces accuracy and gunfire noise draws nearby infected.</div>` +
        `<div class="ip-grid">` +
          `<div><span>Weapon</span><b>${wep.name}</b></div>` +
          `<div><span>Range / Dmg</span><b>${Math.round(wep.range * C.CELL_M)} m · ${wep.damage} dmg</b></div>` +
          `<div><span>Fire Rate</span><b>${wep.rate}/s</b></div>` +
          `<div><span>Aim / Fear</span><b>${effAcc}% acc · ${fearPct}% fear</b></div>` +
          `<div style="grid-column:1/-1"><span>Ammunition</span><b>${sim.civAmmo[ac]} rds remaining</b></div>` +
        `</div>` +
        `<div class="ip-bar"><i style="width:${ammoPct}%;background:${militia ? "#aed581" : wep.color}"></i></div>`,
        militia ? "#aed581" : wep.color
      );
      return;
    }
  }

  const cx = hx | 0, cy = hy | 0;
  if (cx >= 0 && cy >= 0 && cx < sim.w && cy < sim.h) {
    const ci = sim.idx(cx, cy);
    if (sim.rough[ci] && !sim.rubble[ci]) { // 0.23: craters are rough ground
      const pct = Math.round((1 - sim.roughMul(ci)) * 100);
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Shell Crater</span><span class="ip-cost">-${pct}% Speed</span></div>` +
        `<div class="ip-role" style="color:#bcaaa4">Broken Ground · Rough Terrain</div>` +
        `<div class="ip-desc">Cratered by heavy fire. Infected, civilians and ground vehicles all slow down crossing it, most at the bottom.</div>`,
        "#bcaaa4"
      );
      return;
    }
    if (sim.rubble[ci]) {
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Collapsed Building Rubble</span><span class="ip-cost">-30% Speed</span></div>` +
        `<div class="ip-role" style="color:#ff8a65">Demolished Structure · Passable Debris</div>` +
        `<div class="ip-desc">Leveled by heavy ordnance. Blocks no line of sight. Infected, civilians and ground vehicles crossing the rubble are slowed by 30%.</div>`,
        "#ff8a65"
      );
      return;
    }
    if (sim.map.tile[ci] === BUILDING && sim.damage[ci] >= 40) {
      const integrity = Math.max(0, Math.round((1 - sim.damage[ci] / 180) * 100));
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Damaged Structure (${sim.map.height[ci]} flr)</span><span class="ip-cost">${integrity}% Integrity</span></div>` +
        `<div class="ip-role" style="color:#ffb74d">Shell-Scarred Building</div>` +
        `<div class="ip-bar"><i style="width:${integrity}%;background:${integrity > 50 ? "#ffd54f" : "#ff5252"}"></i></div>` +
        `<div class="ip-desc">Repeated mortar, artillery, or airstrike hits strip floors and will collapse this building into walkable rubble at 0% integrity.</div>`,
        "#ffb74d"
      );
      return;
    }
    const tTile = sim.map.tile[ci], tInfra = (tTile === ROAD || tTile === BRIDGE) ? sim.map.height[ci] : 0;
    if (tInfra === INFRA_STATION) {
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Mass Transit Station</span><span class="ip-cost">${sim.trainsEvacuated} Evacuated</span></div>` +
        `<div class="ip-role" style="color:#38bdf8">Metro / Light-Rail Platform · Evacuation Hub</div>` +
        `<div class="ip-desc">Commuter trains pass every ${C.TRAIN_EVERY_S}s during battle, boarding fleeing civilians within ${C.TRAIN_BOARD_RADIUS * C.CELL_M} m to safety and awarding +${C.money(C.TRAIN_BONUS_PER_CIV)} per passenger.</div>`,
        "#38bdf8"
      );
      return;
    }
    if (tInfra === INFRA_RAIL) {
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Mass Transit Rail Corridor</span><span class="ip-cost">+12% Speed</span></div>` +
        `<div class="ip-role" style="color:#94a3b8">${tTile === BRIDGE ? "Rail Bridge (C4 Demolishable)" : "Graded Rail / Metro Track"}</div>` +
        `<div class="ip-desc">High-speed commuter trains run along intact rail lines every ${C.TRAIN_EVERY_S}s, crushing infected on the rails and rescuing nearby civilians.</div>`,
        "#94a3b8"
      );
      return;
    }
    if (tInfra === INFRA_HIGHWAY) {
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Interstate / Expressway</span><span class="ip-cost">+25% Speed</span></div>` +
        `<div class="ip-role" style="color:#facc15">${tTile === BRIDGE ? "Interstate Overpass / Bridge (C4)" : "Divided Multi-Lane Highway"}</div>` +
        `<div class="ip-desc">Wide arterial highway: APCs, fleeing civilians, and advancing hordes move 25% faster along highway lanes. Fortify crossings with heavy gates/turrets or blow highway bridges with C4.</div>`,
        "#facc15"
      );
      return;
    }
  }

  if (!probe) { const s2 = selProbe(); if (s2) { updateInfoPanel(s2.at, s2.ent); return; } } // nothing under the cursor: back to the selection
  idleInfo();
}

// ---------- Sound events: read what changed in the sim since last frame ----------
const lastShot = new WeakMap<object, number>();
let soundSim: Sim | null = null, lastBlastT = -1, lastCivShotT = -1, ambT = 0, lastCollapsed = 0, lastFires = 0;
const heardTransports = new WeakSet<object>(), ackedTransports = new WeakSet<object>();
function soundEvents() {
  if (sim !== soundSim) { soundSim = sim; lastBlastT = -1; lastCivShotT = -1; lastCollapsed = sim.buildingsCollapsed; lastFires = sim.fires.length; }
  const W = canvas.width, s = cam.scale;
  const where = (x: number, y: number): [number, number] => {
    const px = cam.x + x * s, py = cam.y + y * s;
    const on = px > -50 && py > -50 && px < W + 50 && py < canvas.height + 50;
    return [Math.max(-1, Math.min(1, (px / W) * 2 - 1)) * 0.8, on ? Math.min(1, 0.25 + s / 8) : 0.08];
  };
  const quiet = mode === "attract";
  if (!quiet) for (const u of sim.units) {
    if (u.shotT < 0 || lastShot.get(u) === u.shotT) continue;
    lastShot.set(u, u.shotT);
    const [pan, near] = where(u.x + 0.5, u.y + 0.5);
    snd.shot(u.kind, pan, near, zoomGain("shot", 0, s));
  }
  if (!quiet && s >= 3.5 && sim.lastCivShotT > lastCivShotT + 0.08) {
    lastCivShotT = sim.lastCivShotT;
    const [pan, near] = where(sim.lastCivShotX, sim.lastCivShotY);
    if (near > 0.15) snd.shot("militia", pan, near * 0.7, zoomGain("shot", 0, s) * 0.75);
  }
  for (const b of sim.blasts) if (b.t > lastBlastT) {
    const [pan, near] = where(b.x, b.y);
    if (quiet) continue;
    const zb = zoomGain("boom", b.r, s); // 0.19.1: zoomed out, only the big blasts carry
    if (b.color === C.UNITS.apc.color && b.r < 2) snd.event("autocannon", pan, near, zoomGain("event", 0, s)); // the APC's 25 mm
    else if (b.color === C.UNITS.tank.color) { snd.event("tankgun", pan, near, zoomGain("event", 0, s)); snd.boom(b.r, pan, near, zb); } // 120 mm
    else if (b.color === "#ffcc80" && b.r < 1.2) snd.event("autocannon", pan, near, zoomGain("event", 0, s)); // 0.46: the AC-130's 40 mm
    else if (b.r >= 1.2) snd.boom(b.r, pan, near, zb);
  }
  for (const b of sim.blasts) lastBlastT = Math.max(lastBlastT, b.t);
  if (!quiet) {
    if (sim.buildingsCollapsed > lastCollapsed) snd.event("collapse", 0, 0.8, zoomGain("boom", 5, s));
    for (const tr of sim.transports) if (!ackedTransports.has(tr)) {
      ackedTransports.add(tr); // order received: radio reply right away, even paused (not the automatic drones / evac lift)
      if (tr.kind !== "drone_supply" && tr.label !== "EVAC LIFT") snd.radio();
    }
    for (const o of sim.orbits) { // 0.46: the AC-130 has no delivery flight: radio when ordered, engines as it arrives
      if (!ackedTransports.has(o)) { ackedTransports.add(o); snd.radio(); }
      if (!heardTransports.has(o) && o.inbound && Math.hypot(o.x - o.fx, o.y - o.fy) - C.GUNSHIP_RADIUS * 1.15 < C.GUNSHIP_SPEED * 2.5 * Math.max(speed, 0.5)) {
        heardTransports.add(o);
        const [pan, near] = where(o.x, o.y);
        snd.event("plane", pan, Math.max(0.4, near), zoomGain("air", 0, s));
      }
    }
    for (const tr of sim.transports) if (!heardTransports.has(tr)) {
      const lbl = tr.label ?? "";
      // 0.19.1: the sound starts as the aircraft arrives, not when it is ordered (paused = silent). Lead = real
      // seconds before arrival, about half of each clip so its loudest part lands on the target.
      const lead = lbl.startsWith("A-10") || lbl.startsWith("CBU") ? 0.3 : tr.kind === "jet_strike" ? 1.8 : 2.5;
      if (!soundDue(tr, speed, lead)) continue;
      heardTransports.add(tr);
      const [pan, near] = where(tr.tx, tr.ty);
      const za = zoomGain("air", 0, s);
      if (lbl.startsWith("A-10")) snd.event("brrt", pan, Math.max(0.5, near), za);
      else if (lbl.startsWith("CBU")) snd.event("cluster", pan, Math.max(0.5, near), za);
      else if (tr.kind === "jet_strike") snd.event("jet", pan, Math.max(0.4, near), za);
      else if (tr.kind.startsWith("helo")) snd.event("heli", pan, Math.max(0.3, near), za);
      else if (tr.kind.startsWith("c130")) snd.event("plane", pan, Math.max(0.4, near), za);
    }
    if (sim.fires.length > lastFires) { const f = sim.fires[sim.fires.length - 1]; const [pan, near] = where(f.x, f.y); snd.event("flame", pan, near, zoomGain("event", 0, s)); }
  }
  lastCollapsed = sim.buildingsCollapsed; lastFires = sim.fires.length;
  const now = performance.now();
  if (now - ambT > 250) { // how much horde is on screen (sampled), and how much fire
    ambT = now;
    let n = 0;
    const x0 = -cam.x / s, y0 = -cam.y / s, x1 = x0 + W / s, y1 = y0 + canvas.height / s;
    for (let k = 0; k < sim.n; k += 16) if (sim.state[k] === INF) { const x = sim.ax[k], y = sim.ay[k]; if (x > x0 && y > y0 && x < x1 && y < y1) n++; }
    const horde = (n * 16) / (600 * sim.popMul + 600) * (quiet ? 0.3 : 1);
    let fire = 0;
    for (const f of sim.fires) { const [, near] = where(f.x, f.y); fire += near; }
    // panicked people on screen (civilians whose panic timer is running) and a lone snarl or scream up close
    let panicN = 0, nearInf = -1, nearCiv = -1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let k = 0; k < sim.civN; k += 16) if (sim.state[k] === CIV && sim.hp[k] > 0) { const x = sim.ax[k], y = sim.ay[k]; if (x > x0 && y > y0 && x < x1 && y < y1) { panicN++; nearCiv = k; } }
    for (let k = sim.civN; k < sim.n && nearInf < 0; k += 7) if (sim.state[k] === INF && Math.abs(sim.ax[k] - cx) < (x1 - x0) / 4 && Math.abs(sim.ay[k] - cy) < (y1 - y0) / 4) nearInf = k;
    const zoom = Math.max(0, Math.min(1, (s - 1) / 7));
    const panic = (panicN * 16) / 300;
    // 0.22: zombie and people sounds only when zoomed in close; silent past SOUND_NEAR_ZOOM
    const near = Math.max(0, Math.min(1, (zoom - C.SOUND_NEAR_ZOOM) / Math.max(0.01, 1 - C.SOUND_NEAR_ZOOM)));
    if (!quiet && near > 0 && nearInf >= 0 && Math.random() < 0.25) { const [pan] = where(sim.ax[nearInf], sim.ay[nearInf]); snd.event("zombie", pan, near); }
    if (!quiet && near > 0 && nearCiv >= 0 && Math.random() < 0.15) { const [pan] = where(sim.ax[nearCiv], sim.ay[nearCiv]); snd.event("scream", pan, near * 0.8); }
    snd.ambience(horde, fire, quiet ? 0.2 : zoom, quiet ? 0 : panic, !quiet && sim.phase === "battle" && !sim.outbreak && sim.time < SIREN_S, !quiet && sim.phase === "battle", quiet ? 0 : near);
  }
}
function applyVolumes() {
  const v = save.settings.vol ?? { master: 0.8, sfx: 0.8, music: 0.5 };
  snd.setVolumes(v.master, v.sfx, v.music);
}

// ---------- Loop ----------
let acc = 0, last = performance.now(), drawErrors = 0, slowWarned = 0, slowTipShown = false;
let frameTick = 0;
function frame(now: number) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  if (++frameTick % 30 === 0) renderGroupbar(); // 0.50: counts and health (about twice a second)
  // keyboard panning
  const pan = 600 * real * devicePixelRatio;
  const ord = orderable().length > 0, held = (k: string) => keys.has(k) && cameraKeysActive(k, ord); // 0.45: A/S/D are commands while units are selected
  const hb = (id: string) => { const k = keyFor(id); return !!k && held(k); }; // 0.55: the camera bindings (arrows always)
  if (hb("camera.left") || held("arrowleft")) cam.x += pan;
  if (hb("camera.right") || held("arrowright")) cam.x -= pan;
  if (hb("camera.up") || held("arrowup")) cam.y += pan;
  if (hb("camera.down") || held("arrowdown")) cam.y -= pan;
  if (following && [keyFor("camera.left"), keyFor("camera.right"), keyFor("camera.up"), keyFor("camera.down"), "arrowleft", "arrowright", "arrowup", "arrowdown"].some(k => !!k && keys.has(k))) following = false; // 0.39: panning by hand stops a follow
  if (mode === "game" && !following && !stack.length && save.settings.edgeScroll && mouse && document.hasFocus()) {
    const m = 6;
    if (mouse[0] <= m) cam.x += pan; else if (mouse[0] >= innerWidth - 1 - m) cam.x -= pan;
    if (mouse[1] <= m) cam.y += pan; else if (mouse[1] >= innerHeight - 1 - m) cam.y -= pan;
  }
  if (following && mode === "game") followTick();
  if (mode === "attract") {
    // The title screen: a city with no safe zone falls; start another one after a while.
    acc += real * 2;
    let n = 0;
    while (acc >= C.DT && n++ < 4) { sim.step(C.DT); acc -= C.DT; }
    if (n >= 4) acc = 0;
    if (sim.phase !== "battle" || sim.time > 170) { seed = Math.floor(Math.random() * 1e9); sim = new Sim(seed); sim.startBattle(); buildBase(); buildZone(); fitCamera(); }
  } else if (sim.phase === "battle" && speed && !SHOTS) { // 0.47: shot mode steps the sim itself
    // Big crowds step 10 times a second instead of 20; fast speeds take fewer, longer steps.
    const base = sim.civN >= 50000 ? C.DT * 2 : C.DT;
    const tickDt = speed >= 8 ? base * 4 : speed >= 4 ? base * 2 : base;
    acc += real * speed;
    let n = 0;
    const f0 = performance.now();
    while (acc >= tickDt && n++ < 8 && performance.now() - f0 < 28) { const t0 = performance.now(); sim.step(tickDt); perf.tick(performance.now() - t0); acc -= tickDt; }
    if (acc > tickDt * 3) { acc = 0; perf.dropped++; } // can't keep up: the game slows down rather than spiral
  }
  const d0 = performance.now();
  try { soundEvents(); } catch { /* sound must never break the game */ }
  try { draw(now); hud(now); minimap(now); stepPings(); } catch (err) {
    if (drawErrors++ < 5) log("error", "frame-error", { stack: String((err as Error)?.stack ?? err), phase: sim.phase, t: sim.time });
  }
  if (mode === "game") {
    perf.frame(real * 1000);
    if (now - d0 > 100 && slowWarned++ < 20) log("warn", "slow-draw", { ms: Math.round(now - d0 + (performance.now() - now)), zoom: +cam.scale.toFixed(2) });
    if (perf.due(now)) {
      const fps = perf.frames / ((now - perf.since) / 1000);
      if (fps < 24 && sim.civN > C.CIVILIANS && !slowTipShown) { slowTipShown = true; notify("The game is running slowly on this PC. A smaller crowd size in Settings will help."); }
      const c = sim.counts(); perf.report(now, { crowd: sim.civN, phase: sim.phase, speed, t: +sim.time.toFixed(0), agents: c.civ + c.safe + c.inf, inf: c.inf, zoom: +cam.scale.toFixed(2) });
      // 0.22.1: infected that ended up inside a wall or gate since the last report (put back on the street)
      if (sim.wallEjects > loggedEjects) { log("warn", "inf-in-wall", { n: sim.wallEjects - loggedEjects, total: sim.wallEjects, t: +sim.time.toFixed(0) }); loggedEjects = sim.wallEjects; }
      if (sim.wallEjects < loggedEjects) loggedEjects = sim.wallEjects; // new sim
    }
  }
  requestAnimationFrame(frame);
}

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}
addEventListener("resize", () => { resize(); if (mode === "attract") fitCamera(); });
let mouse: [number, number] | null = null;
addEventListener("pointermove", e => { mouse = [e.clientX, e.clientY]; });
document.addEventListener("pointerleave", () => { mouse = null; });
addEventListener("blur", () => { mouse = null; });

// Wire buttons.
function abilityButton(k: C.AbilityKind) {
  if (!isOpen(k)) { say(`${C.ABILITIES[k].name} unlocks at ${P.UNLOCK_XP[k].toLocaleString()} XP. You have ${(save.xp ?? 0).toLocaleString()}.`, 3500); return; }
  if (sim.phase === "plan") {
    const e = sim.buyAbility(k);
    say(e ?? `Bought a ${C.ABILITIES[k].name.toLowerCase()} (${sim.charges[k]} ready). Right-click the button to sell one back.`, 3000);
    refreshUi(); return;
  }
  if (sim.phase !== "battle") return;
  if (tool === k) { setTool("pan"); return; } // 0.22.1: second pick puts it down
  if (sim.charges[k] <= 0) { // buy one on the spot
    const e = sim.buyAbility(k);
    if (e) { say(e, 2500); return; }
    log("info", "bought-in-battle", { kind: k, left: sim.remaining() });
    refreshUi();
  }
  setTool(k);
}
// ---- Picker (0.19): a class button opens a see-through browser of that class over the map. The game keeps running. ----
const toolCard = (t: string) => document.querySelector<HTMLButtonElement>(`#tool-cards [data-tool="${t}"]`);
const catTools: Record<string, string[]> = {};
document.querySelectorAll<HTMLElement>("#tool-cards .dock-group[data-cat]").forEach(g => {
  catTools[g.dataset.cat!] = Array.from(g.querySelectorAll<HTMLElement>("[data-tool]")).map(b => b.dataset.tool!);
});
const catOf = (t: string) => Object.keys(catTools).find(c => catTools[c].includes(t)) ?? null;
let buildCat: string | null = null; // 0.51: the build panel's open tab (null until first drawn: the first category)
function sellAbility(k: C.AbilityKind) { if (sim.sellAbility(k)) { say(`Sold a ${C.ABILITIES[k].name.toLowerCase()}.`, 2000); refreshUi(); } }
/** 0.51: one build tile: the tool's icon, lock and hotkey; name and price or charges go in its tooltip (0.51.1). From its hidden source card. */
function buildTile(t: string) {
  const c = toolCard(t)!, img = c.querySelector("img")?.getAttribute("src") ?? "";
  const name = c.querySelector(".tc-name")?.textContent ?? toolName(t), sm = c.querySelector("small")?.textContent ?? "";
  const hk = keyLabel(keyFor(`build.${t}`)), m = menuOfTool(t), mk = m ? keyLabel(keyFor(`menu.${m}`)) : ""; // 0.55: menu key + letter
  const cls = ["btile", c.classList.contains("locked") ? "locked" : "", c.disabled ? "off" : "", tool === t ? "on" : "", m && armedMenu === m ? "armed" : ""].join(" ");
  // 0.51.1: picture only; name, hotkey and price or charges show in the hover tooltip (full details in the info panel)
  return `<button class="${cls}" data-ptool="${t}" data-tip="${esc(name)}" data-tipkey="${hk ? (mk ? `${mk} then ${hk}` : hk) : ""}" data-tipsub="${esc(sm)}"><img src="${img}" alt="${esc(name)}" draggable="false">${hk ? `<span class="hk">${hk}</span>` : ""}</button>`;
}
/** 0.51: the build panel: category tabs over the open category's tiles (always shown; replaces the pop-up picker). */
function renderBuild() {
  const bt = buildTabs(catTools, buildCat); buildCat = bt.open;
  const armedCat = armedMenu ? MENU_NAME[armedMenu] : null;
  const tabs = bt.cats.map(c => { const m = (Object.keys(MENU_NAME) as MenuId[]).find(x => MENU_NAME[x] === c), mk = m ? keyLabel(keyFor(`menu.${m}`)) : "";
    return `<button data-cat="${c}" class="${[c === buildCat ? "on" : "", c === armedCat ? "armed" : ""].join(" ").trim()}"${mk ? ` title="${mk}"` : ""}>${c}${mk ? ` <span class="tk">${mk}</span>` : ""}</button>`; }).join("");
  const grid = catTools[buildCat].map(buildTile).join("");
  if ($("btabs").innerHTML !== tabs) $("btabs").innerHTML = tabs;
  if ($("bgrid").innerHTML !== grid) $("bgrid").innerHTML = grid;
  if (tipEl) updateTip();
}
/** 0.55: the build menu waiting for its letter (null: none). Its tab lights up and its letters turn gold. */
var armedMenu: MenuId | null = null; // var: newSim/pause can run before this line
function setMenu(m: MenuId | null) { armedMenu = m; if (m) setBuildTab(MENU_NAME[m]); else renderBuild(); }
function setBuildTab(cat: string) { if (catTools[cat]) { buildCat = cat; tip("build"); renderBuild(); } }
/** setTool() calls this: open the tab of the tool picked (a key or a tile) so its tile shows as on. */
function openCatFor(t: string) { const c = catOf(t); if (c && c !== buildCat) buildCat = c; renderBuild(); }
function pickTool(t: string) {
  if (isAbility(t as Tool)) { abilityButton(t as C.AbilityKind); renderBuild(); return; }
  toggleTool(t as Tool);
}
$("btabs").addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cat]"); if (b) setBuildTab(b.dataset.cat!); });
{
  const box = $("bgrid");
  box.addEventListener("pointerover", e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>(".btile"); if (!r) return;
    const t = r.dataset.ptool!;
    hoverNavTool = t as Tool; // the info panel shows it
    hoverUnitHeatmap = (C.BUILDABLE as string[]).includes(t) && sim.phase !== "plan" ? t as C.UnitKind : null;
  });
  box.addEventListener("pointerleave", () => { hoverNavTool = null; hoverUnitHeatmap = null; });
  box.addEventListener("click", e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>(".btile");
    if (r && !dragJustEnded()) pickTool(r.dataset.ptool!);
  });
  box.addEventListener("contextmenu", e => {
    e.preventDefault();
    const r = (e.target as HTMLElement).closest<HTMLElement>(".btile");
    if (r && isAbility(r.dataset.ptool as Tool)) { sellAbility(r.dataset.ptool as C.AbilityKind); renderBuild(); }
  });
}

// 0.54.1: the panels redraw their buttons as the battle changes (squad states, health, prices). A redraw between the
// press and the release swallowed the click (Chrome sends none once the pressed button is gone). On the release, hand
// it to the button that now sits under the pointer.
{
  const PANEL_BTN = "#hud button, #grouptabs button";
  let downBtn: HTMLElement | null = null;
  addEventListener("pointerdown", e => { downBtn = e.button === 0 ? (e.target as HTMLElement).closest?.<HTMLElement>(PANEL_BTN) ?? null : null; }, true);
  addEventListener("pointerup", e => {
    const was = downBtn; downBtn = null;
    if (!was || was.isConnected || e.button !== 0) return; // still there: the browser sends the click itself
    const b = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(PANEL_BTN);
    if (!b || (b as HTMLButtonElement).disabled) return;
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey }));
  }, true);
}
let dragEndT = 0;
function dragJustEnded() { return performance.now() - dragEndT < 50; }

// ---- Quick bar (0.19; back in 0.54: 5 slots under the build grid, keys 6-0 by default, every key rebindable). Saved in the profile. ----
var quick: Slots = cleanQuickbar(save.settings.quickbar, t => buildToolSet().has(t)); // var: refreshUi() can run before this line
var rebindSlot: number | null = null; // a slot waiting for its new key (right-click it, press a key)
var quickReady = true;
function buildToolSet() { return new Set(Object.values(catTools).flat()); }
/** 0.55: use these bindings everywhere and save them (only what differs from the defaults). */
function applyBinds(b: Binds) {
  setBinds(b);
  const ov = overrides(b);
  if (Object.keys(ov).length) save.settings.keys = ov; else delete save.settings.keys;
  delete save.settings.quickKeys; // folded into settings.keys
  Save.store(save);
  labelToolCards(); labelSpeedKeys(); renderHelpKeys(); renderQuickbar(); refreshUi(); codex?.refresh(); // review #4: every key label follows
}
/** The context the keyboard is in right now (which actions a key can mean). */
/** 0.55 review #4: the speed and pause buttons, the Save game button and the slots line show the live keys. */
function labelSpeedKeys() {
  const ids: Record<string, string> = { "0.5": "speed.half", "1": "speed.normal", "2": "speed.fast", "0": "pause" };
  document.querySelectorAll<HTMLElement>("#topctl [data-speed]").forEach(b => { const k = b.querySelector(".k"), lbl = keyLabel(keyFor(ids[b.dataset.speed!] ?? "")); if (k) k.textContent = lbl; b.dataset.key = lbl; });
  const qs = keyLabel(keyFor("quicksave")), ps = document.getElementById("p-save"), sub = document.getElementById("slots-sub");
  if (ps) ps.textContent = qs ? `Save game (${qs})` : "Save game";
  if (sub) sub.textContent = `Each slot is its own player: rank, medals, unlocks and plans, plus one saved battle (${qs ? qs + " or " : ""}Save game in the Esc menu).`;
}
function ctxNow(): Ctx { return sel.length ? "selected" : "idle"; }
function renderHelpKeys() { // the help line under the panel (function scope: applyBinds can run before module consts)
  const el = document.getElementById("helpkeys"); if (el) el.textContent = withKeys("{key:tool.zone} zone · {key:tool.remove} sell · {key:tool.order} order · {key:tool.pan} move/aim · {key:menu.units} {key:menu.actions} {key:menu.support} build menus · {key:group.1}-{key:group.5} groups · quick bar {key:quick.1}-{key:quick.5} · {key:view.heights} heights · {key:view.ranges} ranges · {key:view.heatmap} heatmap · {key:camera.up}{key:camera.left}{key:camera.down}{key:camera.right} move");
}
// ---- 0.55: Settings > Controls: every key settable (rules in keymap.ts bindProblem) ----
var promptAct: string | null = null; // the action waiting for its new key
const FIXED_ROWS: [string, string][] = [["Menu / cancel", "Esc"], ["Move the map", "Arrow keys"], ["Close the safe zone", "Enter"], ["Remove the selection", "Delete, Backspace"], ["Select, place, aim", "Left mouse"], ["Move, put a tool down", "Right mouse"]];
function renderControls() {
  const list = $("controls-list");
  let html = "";
  for (const g of controlsRows(binds())) {
    html += `<section><h3>${g.group}<button class="greset" data-greset="${esc(g.group)}">Reset</button></h3>`;
    let sub = "";
    for (const r of g.rows) {
      if (r.sub && r.sub !== sub) { sub = r.sub; html += `<h4>${esc(sub)} menu</h4>`; }
      const wait = promptAct === r.id;
      html += `<div class="crow"><span>${esc(r.label)}</span><button class="keybox${wait ? " wait" : ""}${!r.key && !wait ? " none" : ""}" data-act="${r.id}">${wait ? "Press a key" : r.key ? esc(r.key) : "none"}</button></div>`;
    }
    html += `</section>`;
  }
  html += `<section class="fixed"><h3>Fixed keys</h3>${FIXED_ROWS.map(([l, k]) => `<div class="crow"><span>${l}</span><span>${k}</span></div>`).join("")}</section>`;
  list.innerHTML = html;
}
function setControlsMsg(text: string, swapWith?: { id: string; other: string; key: string }) {
  const m = $("controls-msg"); m.textContent = text;
  if (swapWith) {
    const b = document.createElement("button"); b.textContent = "Swap";
    b.addEventListener("click", () => { // the action takes the key; the other gets the old key if it fits there, else none
      const b0 = binds(), { id, other, key } = swapWith, nb: Binds = { ...b0, [id]: key, [other]: null }, old = b0[id];
      if (old && !bindProblem(other, old, nb)) nb[other] = old;
      applyBinds(nb); promptAct = null; renderControls(); setControlsMsg(nb[other] ? "Swapped." : "Done. The other action has no key now (the old one doesn't fit there).");
    });
    m.appendChild(b);
  }
}
$("controls-list").addEventListener("click", e => {
  const t = e.target as HTMLElement, box = t.closest<HTMLElement>("[data-act]"), gr = t.closest<HTMLElement>("[data-greset]");
  if (box) { promptAct = promptAct === box.dataset.act ? null : box.dataset.act!; setControlsMsg(promptAct ? "Press the new key (Esc keeps the old one, Backspace clears it)." : ""); renderControls(); }
  else if (gr) { applyBinds(resetGroup(gr.dataset.greset as Group, binds())); promptAct = null; renderControls(); setControlsMsg(`${gr.dataset.greset}: back to the default keys.`); }
});
$("controls-reset").addEventListener("click", () => { applyBinds(defaultBinds()); promptAct = null; renderControls(); setControlsMsg("Every key is back to its default."); });
// the next key press goes to the action being rebound (captured before everything else, including Esc = Back)
addEventListener("keydown", e => {
  if (promptAct === null || $("s-controls").hidden) return;
  const k = keyOf(e);
  if (["shift", "control", "alt", "meta"].includes(k)) return; // a modifier on its own: keep waiting
  e.preventDefault(); e.stopImmediatePropagation();
  const id = promptAct;
  if (k === "escape") { promptAct = null; renderControls(); setControlsMsg(""); return; }
  if (k === "backspace" || k === "delete") { promptAct = null; applyBinds({ ...binds(), [id]: null }); renderControls(); setControlsMsg("Cleared: that action has no key now."); return; }
  const p = bindProblem(id, k, binds());
  if (p && !p.other) { setControlsMsg(p.why); return; }
  if (p && p.other) { setControlsMsg(p.why, p.others?.length === 1 ? { id, other: p.other, key: k } : undefined); return; } // review #1: Swap trades with one action only
  promptAct = null; applyBinds({ ...binds(), [id]: k }); renderControls(); setControlsMsg(`Set to ${keyLabel(k)}.`);
}, { capture: true });
function storeQuickbar() { save.settings.quickbar = quick; Save.store(save); }
function renderQuickbar() {
  if (!quickReady || typeof quick === "undefined") return;
  document.querySelectorAll<HTMLButtonElement>("#quickbar .qslot").forEach(b => {
    const i = Number(b.dataset.slot), t = quick[i], c = t ? toolCard(t) : null, key = keyLabel(keyFor(`quick.${i + 1}`));
    b.classList.toggle("full", !!c);
    b.classList.toggle("locked", !!c && (c.classList.contains("locked") || c.disabled));
    b.classList.toggle("on", !!t && tool === t);
    b.classList.toggle("rebind", rebindSlot === i);
    const html = `${c ? `<img src="${c.querySelector("img")?.getAttribute("src") ?? ""}" alt="" draggable="false">` : ""}<span class="hk">${rebindSlot === i ? "?" : key}</span>`;
    if (b.innerHTML !== html) b.innerHTML = html;
    b.dataset.tip = rebindSlot === i ? "Press a key for this slot" : t ? toolName(t) : `Quick bar slot ${i + 1}`;
    b.dataset.tipkey = key;
    b.dataset.tipsub = c ? c.querySelector("small")?.textContent ?? "" : "";
    b.dataset.tipdesc = rebindSlot === i ? "Esc keeps the old key, Backspace clears it." : t ? "Click or press its key. Drag it off the bar to clear. Right-click: change its key." : "Drag a tile here from the build grid. Right-click: change its key.";
  });
  if (tipEl) updateTip();
}
function useSlot(i: number) {
  const t = quick[i];
  if (!t) return;
  if (isAbility(t as Tool)) abilityButton(t as C.AbilityKind); else toggleTool(t as Tool);
  renderQuickbar();
}
document.querySelectorAll<HTMLButtonElement>("#quickbar .qslot").forEach(b => {
  const i = Number(b.dataset.slot);
  b.addEventListener("click", () => { if (!dragJustEnded() && rebindSlot === null) useSlot(i); });
  b.addEventListener("contextmenu", e => { e.preventDefault(); rebindSlot = rebindSlot === i ? null : i; renderQuickbar(); }); // 0.54: rebind its key
});
// 0.54: the next key press goes to the slot being rebound (captured before the game's own keys)
addEventListener("keydown", e => {
  if (rebindSlot === null) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const i = rebindSlot, k = keyOf(e), id = `quick.${i + 1}`;
  if (k === "escape") { rebindSlot = null; renderQuickbar(); return; }
  if (k === "backspace" || k === "delete") { rebindSlot = null; applyBinds({ ...binds(), [id]: null }); return; }
  if (["shift", "control", "alt", "meta"].includes(k)) return; // a modifier on its own: keep waiting
  const why = bindProblem(id, k, binds()); // 0.55: the same rules as Settings > Controls
  if (why) { say(why.why, 2200); return; }
  rebindSlot = null; applyBinds({ ...binds(), [id]: k }); say(`Slot ${i + 1}: ${keyLabel(k)}.`, 1500);
}, { capture: true });
// Drag: from a build tile (put it in a slot) or from a slot (swap, or drop off the bar to clear). Pointer events, so
// the browser and the Windows app behave the same. A drag never counts as a click.
{
  let drag: { t: string; from: number | null; x: number; y: number; ghost: HTMLImageElement | null } | null = null;
  const slotAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("#quickbar .qslot") ?? null;
  addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>("#bgrid .btile"), slot = el.closest<HTMLElement>("#quickbar .qslot");
    const t = row ? row.dataset.ptool! : slot ? quick[Number(slot.dataset.slot)] : null;
    if (!t || (row && !isOpen(t))) return;
    drag = { t, from: slot ? Number(slot.dataset.slot) : null, x: e.clientX, y: e.clientY, ghost: null };
  });
  addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const g = document.createElement("img");
      g.src = toolCard(drag.t)?.querySelector("img")?.getAttribute("src") ?? "";
      g.className = "dragghost";
      document.body.appendChild(g);
      drag.ghost = g;
    }
    drag.ghost.style.left = `${e.clientX - 24}px`; drag.ghost.style.top = `${e.clientY - 24}px`;
    const over = slotAt(e.clientX, e.clientY);
    document.querySelectorAll("#quickbar .qslot").forEach(s => s.classList.toggle("drop", s === over));
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.ghost) return; // a plain click
    d.ghost.remove();
    document.querySelectorAll("#quickbar .qslot").forEach(s => s.classList.remove("drop"));
    dragEndT = performance.now();
    const over = e.type === "pointerup" ? slotAt(e.clientX, e.clientY) : null;
    if (over) {
      const i = Number(over.dataset.slot);
      quick = d.from === null ? setSlot(quick, i, d.t) : swapSlots(quick, d.from, i);
    } else if (d.from !== null && e.type === "pointerup" && !(document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("#quickbar")) {
      quick = clearSlot(quick, d.from);
    } else return;
    storeQuickbar(); renderQuickbar();
  };
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
}
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
  const t = b.dataset.tool as Tool;
  if (isAbility(t)) {
    b.addEventListener("click", () => abilityButton(t));
    b.addEventListener("contextmenu", e => { e.preventDefault(); sellAbility(t); });
  } else b.addEventListener("click", () => toggleTool(t));
  b.addEventListener("pointerenter", () => {
    hoverNavTool = t;
    if ((C.BUILDABLE as string[]).includes(t) && sim.phase !== "plan") hoverUnitHeatmap = t as C.UnitKind;
  });
  b.addEventListener("pointerleave", () => {
    if (hoverNavTool === t) hoverNavTool = null;
    if (hoverUnitHeatmap === t) hoverUnitHeatmap = null;
  });
});
// 0.22.1: anything picked from the command section closes the units window
$("recall").addEventListener("click", () => { // 0.24
  if (sim.phase !== "battle") { say("Recall works during the battle."); return; }
  const n = sim.recallAll();
  log("info", "recall", { recalled: sim.recalled, units: n, t: +sim.time.toFixed(1) });
  say(!n ? "No units to recall." : sim.recalled ? `${n} unit${n > 1 ? "s" : ""} falling back to the safe zone. Press Recall again to send them back out.` : `${n} unit${n > 1 ? "s" : ""} heading back to their posts.`, 3500);
  refreshUi();
});
for (const [id, key] of [["heatmapbtn", "heatmap"], ["closegates", "closegates"], ["recall", "recall"], ["clear", "clear"]] as const) {
  $(id).addEventListener("pointerenter", () => { hoverNavTool = key; });
  $(id).addEventListener("pointerleave", () => { if (hoverNavTool === key) hoverNavTool = null; });
}
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(b => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
// One button for Start and Restart: never keep focus (Enter or Space would press it again) and ignore clicks for a
// moment after its label flips, so a double-click on Start can't restart the battle it just began.
var startLabelT = 0; // var: refreshUi() writes it and may run before this line
$("startbtn").addEventListener("click", () => {
  $("startbtn").blur();
  if (performance.now() - startLabelT < 750) return;
  if (sim.phase === "plan") startBattle(); else newSim(true);
});
$("heatmapbtn").addEventListener("click", () => { showHeatmap = !showHeatmap; refreshUi(); });
$("end-heatmap").addEventListener("click", () => { showHeatmap = true; $("end").hidden = true; endDismissed = sim.phase === "over"; refreshUi(); say(withKeys("Showing kill heatmap. Press {key:view.heatmap} or Menu when done."), 5000); });
$("closegates").addEventListener("click", () => { const n = sim.closeAllGates(); buildZone(); log("info", "close-all-gates", { closed: n, t: +sim.time.toFixed(1), phase: sim.phase }); say(n ? (sim.phase === "battle" ? `Closing ${n} gate cells (${C.GATE_CLOSE_S}s).` : "All gates closed.") : "No open gates left."); });
$("grouptabs").addEventListener("click", e => { // 0.50: click a slot = its key; twice quickly jumps there
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".gslot"); if (!b) return;
  runGroup({ k: keys.has("shift") ? "addsel" : "select", n: Number(b.dataset.n) }); renderGroupbar();
});
$("hud-sel").addEventListener("click", e => { // 0.51: the selection panel
  const t = e.target as HTMLElement, row = t.closest<HTMLButtonElement>("[data-so]"), tile = t.closest<HTMLButtonElement>("[data-idx]");
  const live = sel.filter(x => !("orbit" in x));
  if (row && live[0] && "unit" in live[0]) { const so = live[0].unit.soldiers?.[Number(row.dataset.so)]; selSoldier = so && so.alive ? so : null; renderActions(); }
  else if (tile) { const it = live[Number(tile.dataset.idx)]; if (!it) return; sel = keys.has("shift") || e.shiftKey ? sel.filter(x => x !== it) : [it]; renderActions(); }
  else { const r = t.closest<HTMLButtonElement>("[data-ru]"), u = r ? sim.units[Number(r.dataset.ru)] : undefined; if (u) { sel = [{ unit: u }]; selZone = -1; selSoldier = null; renderActions(); } } // 0.52: roster
});
$("hud-sel").addEventListener("dblclick", e => { // 0.52: roster double-click jumps there
  const r = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ru]"), u = r ? sim.units[Number(r.dataset.ru)] : undefined;
  if (u) { const [x, y] = sim.squadCenter(u); centerOn(x, y); following = false; }
});
$("cmdorders").addEventListener("click", e => { // 0.51: the orders page of the command card
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cmd]"); if (!b) return;
  const k = b.dataset.cmd!;
  if (k === "move") say("Right-click on the map where to send them (Shift queues).", 2500);
  else if (k === "topup") topUpSelected(); // 0.49
  else if ((k === "buytroops" || k === "buysniper") && selZone >= 0) { const e = sim.placeFromZone(k === "buytroops" ? "garrison" : "sniper", selZone); if (e) say(e); else { snd.radio(); refreshUi(); renderActions(); } } // 0.50
  else if (k === "remove") removeSelected(); else if (k === "target") cycleSelected();
  else if (k === "fortify") { // Dismount when they're all up; otherwise the next click on a roof fortifies it
    const troops = orderable().filter(u => u.kind === "garrison" || u.kind === "sniper");
    if (troops.length && troops.every(u => u.fort === "up")) { for (const u of troops) { const err = sim.dismount(u); if (err) say(err); } renderActions(); }
    else runIntent({ k: "arm", cmd: "fortify" });
  }
  else if (k === "amove" || k === "patrol" || k === "escort") runIntent({ k: "arm", cmd: k });
  else if (k === "stop" || k === "standby") runIntent({ k, queue: false });
});
$("clear").addEventListener("click", () => { if (sim.phase === "plan") { sim.clearZone(); draft = []; buildZone(); refreshUi(); } });
$("end-retry").addEventListener("click", () => newSim(true));
$("end-continue").addEventListener("click", () => { $("end").hidden = true; sim.markKeepFighting(); /* 0.57 */ speed = battleSpeed(); log("info", "round-continue", { t: +sim.time.toFixed(1) }); refreshUi(); });
$("end-stop").addEventListener("click", () => { $("end").hidden = true; sim.callIt(); });
$("end-new").addEventListener("click", () => newSim(false, true));
$("end-next").addEventListener("click", () => { const i = city ? C.CITIES.indexOf(city) : -1; if (C.CITIES[i + 1]) { dailyDate = null; customMap = null; playCity(C.CITIES[i + 1]); } });
$("end-cities").addEventListener("click", () => { startAttract(); go("cities"); });
$("end-title").addEventListener("click", startAttract);
$("menubtn").addEventListener("click", pause);
document.querySelectorAll<HTMLButtonElement>("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go!)));
document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach(b => b.addEventListener("click", back));
document.querySelectorAll<HTMLButtonElement>("button[data-diff]").forEach(b => b.addEventListener("click", () => {
  const d = b.dataset.diff as C.Difficulty;
  if (!C.DIFFICULTY[d]) return;
  save.settings.difficulty = d;
  Save.store(save);
  syncDifficultyButtons();
  renderCities();
}));
$("quick").addEventListener("click", () => { dailyDate = null; customMap = null; playCity(null); });
$("daily").addEventListener("click", playDaily);
async function loadLiveOsm() {
  const inp = $<HTMLInputElement>("osm-query"), btn = $<HTMLButtonElement>("osm-load");
  const q = inp.value.trim();
  if (!q) return;
  btn.disabled = true; btn.textContent = "Loading OSM...";
  try {
    const s = Math.floor(Math.random() * 1e9);
    const res = await fetchLiveOsmCity(q, s);
    dailyDate = null; customMap = res;
    playCity(null, s);
  } catch (err) {
    alert((err as Error).message || "Could not load OpenStreetMap data.");
  } finally {
    btn.disabled = false; btn.textContent = "Load OSM Map";
  }
}
$("osm-load").addEventListener("click", loadLiveOsm);
$("osm-query").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); loadLiveOsm(); } });
$("resume").addEventListener("click", resume);
$("p-restart").addEventListener("click", () => { resume(); newSim(true); });
$("p-reset").addEventListener("click", () => { // fresh map: same city, nothing placed, full budget
  if (!confirm("Restart this city with an empty map? Your zone, walls and units will be removed.")) return;
  resume(); newSim(false);
});
// 0.30.1: End round (stats bar button, rebuilt every HUD refresh, so delegated)
const endRoundNow = () => {
  if (sim.phase !== "battle" || sim.roundDone) return;
  const c = sim.counts();
  if (!confirm(`End the round now? ${c.safe.toLocaleString()} people in the zone count as saved; ${c.civ.toLocaleString()} still outside are left behind.`)) return;
  const e = sim.endRoundNow(); if (e) { say(e); return; }
  log("info", "end-round", { t: +sim.time.toFixed(1), safe: c.safe, left: c.civ, evacuated: sim.evacuated });
};
$("stats").addEventListener("click", ev => { if ((ev.target as HTMLElement).closest("[data-act=endround]")) endRoundNow(); });
$("p-endround").addEventListener("click", () => { resume(); endRoundNow(); });
$("p-withdraw").addEventListener("click", () => {
  if (sim.phase !== "battle") { resume(); return; }
  log("info", "withdraw", { t: +sim.time.toFixed(1), evacuated: sim.evacuated });
  sim.withdraw(); resume();
});
$("p-title").addEventListener("click", () => { log("info", "quit-to-menu", { phase: sim.phase, t: +sim.time.toFixed(1) }); startAttract(); });
const quitDesktop = async () => { // 0.57: record a battle in progress, give the history write a moment, then quit
  log("info", "quit-to-desktop", { mode, phase: sim.phase });
  closeOutBattle();
  await Promise.race([recQueue, new Promise(r => setTimeout(r, 3000))]);
  Save.desktop?.quit();
};
Save.desktop?.onClosing?.(() => { void quitDesktop(); }); // 0.57 review: the window's X / Alt+F4 records the battle first
window.addEventListener("beforeunload", () => closeOutBattle()); // browser tab closed: the record is queued, but the tab may close before it is written
$("p-quit").addEventListener("click", quitDesktop);
$("p-quit").hidden = !Save.desktop;
$("logs").addEventListener("click", () => {
  if (Save.desktop?.openLogs) { Save.desktop.openLogs(); return; }
  const a = document.createElement("a"); // browser: download what this session logged
  a.href = URL.createObjectURL(new Blob([recentLog()], { type: "text/plain" }));
  a.download = `horde-log-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`; a.click();
});
$("logs").textContent = Save.desktop ? "Open log folder" : "Save log file";
// ---- mods + save file ----
function download(name: string, text: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click();
}
function renderMods() {
  const el = $("mod-status");
  el.innerHTML = modReports.length
    ? modReports.map(r => `<div><b>${r.name.replace(/</g, "&lt;")}</b> (${r.file.replace(/</g, "&lt;")}): ${r.changes} change${r.changes === 1 ? "" : "s"}${r.problems.length ? ` · <span style="color:#fca5a5">${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}: ${r.problems.slice(0, 4).join("; ").replace(/</g, "&lt;")}${r.problems.length > 4 ? "..." : ""}</span>` : ""}</div>`).join("")
    : `No mods active. ${Save.desktop ? "Put .json mod files in the mods folder and restart." : "Load a .json mod file."} Start from "Export default stats".`;
  $("mod-open").hidden = !Save.desktop?.openMods;
  $("mod-clear").hidden = !browserMods().length;
}
$("mod-open").addEventListener("click", () => Save.desktop?.openMods?.());
$("mod-load").addEventListener("click", () => $<HTMLInputElement>("mod-file").click());
$("mod-file").addEventListener("change", async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  const text = await f.text();
  try { JSON.parse(text); } catch { alert("That file is not valid JSON."); return; }
  const list = browserMods().filter(m => m.file !== f.name); list.push({ file: f.name, text });
  try { localStorage.setItem(BROWSER_MODS, JSON.stringify(list)); } catch { alert("This browser blocks storage, so the mod can't be kept."); return; }
  log("info", "mod-added", { file: f.name }); location.reload();
});
$("mod-clear").addEventListener("click", () => { try { localStorage.removeItem(BROWSER_MODS); } catch { /* blocked */ } location.reload(); });
$("mod-template").addEventListener("click", () => download("horde-default-stats.json", Mods.toJson(Mods.defaults())));
$("save-export").addEventListener("click", () => download("horde-save.json", JSON.stringify(save, null, 1)));
$("save-import").addEventListener("click", () => $<HTMLInputElement>("save-file").click());
$("save-file").addEventListener("change", async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || typeof d !== "object" || !d.settings || !d.best) throw new Error("not a Horde save");
    if (!confirm("Replace your progress with this save file?")) return;
    Save.store(Save.clean({ ...Save.load(), ...d, settings: { ...save.settings, ...(typeof d.settings === "object" ? d.settings : {}) } })); location.reload();
  } catch (err) { alert(`Could not import: ${(err as Error).message}`); }
});
if (modReports.length) log("info", "mods", { mods: modReports.map(r => ({ file: r.file, changes: r.changes, problems: r.problems.length })) });
if (Save.desktop) { $("quit").hidden = false; $("quit").addEventListener("click", quitDesktop); }
else $("opt-fs-row").hidden = true; // in a browser, F11 is the browser's own fullscreen
$("opt-fs").addEventListener("change", e => { save.settings.fullscreen = (e.target as HTMLInputElement).checked; Save.store(save); applyFullscreen(); });
$("opt-edge").addEventListener("change", e => { save.settings.edgeScroll = (e.target as HTMLInputElement).checked; Save.store(save); log("info", "setting", { edgeScroll: save.settings.edgeScroll }); });
$("opt-checkupd").addEventListener("change", e => { save.settings.checkUpdates = (e.target as HTMLInputElement).checked; Save.store(save); }); // 0.26
$("opt-autoupd").addEventListener("change", e => { save.settings.autoUpdate = (e.target as HTMLInputElement).checked; Save.store(save); });
$("opt-ranges").addEventListener("change", e => { save.settings.showRanges = showRanges = (e.target as HTMLInputElement).checked; Save.store(save); });
$("opt-tips").addEventListener("change", e => { save.settings.tips = (e.target as HTMLInputElement).checked; if (save.settings.tips) save.settings.tipsSeen = []; Save.store(save); }); // 0.41: on again = see them again

// ---------- Developer mode ----------
const DEV_SWITCHES: [keyof Sim["dev"], string][] = [
  ["income", "Income"], ["waves", "Hordes"], ["bites", "Bites"], ["wallDamage", "Walls take damage"],
  ["unitDamage", "Units take damage"], ["friendlyFire", "Bombs hurt civilians"], ["instantDeploy", "Instant deploy"],
  ["unlimitedMoney", "Unlimited money"], ["noStockpileLimits", "No ordnance limits"],
];
const devState: Record<string, boolean> = {}; // survives restarts within this session
let devGoals = false, devField = false, devFieldImg: HTMLCanvasElement | null = null, devFieldT = 0;
function devLog(what: string, data: Record<string, unknown> = {}) { log("warn", "dev", { what, t: +sim.time.toFixed(1), ...data }); }
function syncDev() {
  const on = !!save.settings.devMode;
  if (on) Object.assign(sim.dev, devState);
  $("devbtn").hidden = !on;
  if (!on) $("devpanel").hidden = true;
  const box = $("dev-switches");
  box.innerHTML = "";
  for (const [k, name] of DEV_SWITCHES) {
    const l = document.createElement("label");
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!sim.dev[k];
    c.addEventListener("change", () => { (sim.dev as any)[k] = c.checked; devState[k] = c.checked; devLog("switch", { [k]: c.checked }); });
    l.append(c, " " + name); box.appendChild(l);
  }
}
function toggleDevPanel() { if (!save.settings.devMode || mode !== "game") return; $("devpanel").hidden = !$("devpanel").hidden; syncDev(); }
for (const k of ["master", "sfx", "music"] as const) $(`vol-${k}`).addEventListener("input", e => {
  const v = save.settings.vol ?? { master: 0.8, sfx: 0.8, music: 0.5 };
  v[k] = Number((e.target as HTMLInputElement).value) / 100; save.settings.vol = v; Save.store(save); applyVolumes();
});
$("opt-crowd").addEventListener("change", e => {
  save.settings.crowd = Number((e.target as HTMLSelectElement).value); Save.store(save);
  log("info", "setting", { crowd: save.settings.crowd });
  if (mode === "game") say("The new crowd size applies from the next battle you start.", 4000);
});
$("opt-dev").addEventListener("change", e => { save.settings.devMode = (e.target as HTMLInputElement).checked; Save.store(save);
  if (save.settings.devMode && mode === "game" && sim.phase !== "plan" && sim.stats.flags) sim.stats.flags.dev = true; // 0.57: sticks for this battle
  log("info", "setting", { devMode: save.settings.devMode }); syncDev(); });
$("devbtn").addEventListener("click", toggleDevPanel);
document.querySelectorAll<HTMLButtonElement>("[data-dspeed]").forEach(b => b.addEventListener("click", () => { setSpeed(Number(b.dataset.dspeed), true); devLog("speed", { speed }); }));
$("dev-money").addEventListener("click", () => { sim.budget += 100_000_000; devLog("money", { money: sim.remaining() }); refreshUi(); });
const devXp = (d: number | null) => { save.xp = d === null ? 0 : Math.max(0, (save.xp ?? 0) + d); Save.store(save); devLog("xp", { xp: save.xp }); say(`XP: ${save.xp.toLocaleString()} (${P.rankFor(save.xp).name}).`, 2500); refreshUi(); };
$("dev-xp1").addEventListener("click", () => devXp(1000));
$("dev-xp10").addEventListener("click", () => devXp(10000));
$("dev-xpmax").addEventListener("click", () => devXp(Math.max(...Object.values(P.UNLOCK_XP)) + 10000 - (save.xp ?? 0)));
$("dev-xp0").addEventListener("click", () => devXp(null));
$("dev-wave").addEventListener("click", () => { sim.devWaveNow(); devLog("wave-now"); });
$("dev-clear").addEventListener("click", () => { const n = sim.devClearInfected(); devLog("clear-infected", { n }); say(`Removed ${n.toLocaleString()} infected.`); });
$("dev-end").addEventListener("click", () => { if (sim.phase !== "battle") return; sim.devEndNow(); sim.step(C.DT); devLog("end-now"); });
$("dev-goals").addEventListener("change", e => { devGoals = (e.target as HTMLInputElement).checked; });
$("dev-field").addEventListener("change", e => { devField = (e.target as HTMLInputElement).checked; devFieldT = 0; });
function drawDev(now: number) {
  if (!save.settings.devMode || $("devpanel").hidden) return;
  const s = cam.scale;
  if (devField) {
    if (!devFieldImg || now - devFieldT > 2000) { // the infected's distance-to-zone map, blue near, red far
      devFieldT = now;
      devFieldImg = devFieldImg ?? document.createElement("canvas");
      devFieldImg.width = sim.w; devFieldImg.height = sim.h;
      const g = devFieldImg.getContext("2d")!, d = g.createImageData(sim.w, sim.h);
      let max = 1;
      for (const v of sim.infField) if (v !== 65535 && v > max) max = v;
      sim.infField.forEach((v, i) => { if (v === 65535) return; const k = v / max; d.data.set([255 * k, 60, 255 * (1 - k), 110], i * 4); });
      g.putImageData(d, 0, 0);
    }
    ctx.drawImage(devFieldImg, cam.x, cam.y, sim.w * s, sim.h * s);
  }
  if (devGoals) for (const u of sim.units) {
    if (u.goal === undefined || !u.ai) continue;
    const gx = (u.goal % sim.w) + 0.5, gy = Math.floor(u.goal / sim.w) + 0.5;
    ctx.strokeStyle = "#e040fb"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cam.x + (u.x + 0.5) * s, cam.y + (u.y + 0.5) * s); ctx.lineTo(cam.x + gx * s, cam.y + gy * s); ctx.stroke(); ctx.setLineDash([]);
    label(u.ai, cam.x + gx * s + 4, cam.y + gy * s);
  }
  if (sim.tick % 10 === 0) {
    const c = sim.counts(), d = sim.diff;
    const nextStr = Number.isFinite(sim.nextWaveT) ? `${Math.max(0, sim.nextWaveT - sim.time).toFixed(0)}s` : "-";
    $("dev-info").textContent = `tick ${sim.tick}  t ${sim.time.toFixed(1)}s  heat ${sim.heatNow().toFixed(2)}\n` +
      `diff ${sim.difficulty} (${d.name}): gap ${d.gapMin}-${d.gapMax}s (floor ${d.gapFloor}s, gapHeat ${d.gapHeat}) size x${d.sizeMul} ramp ${d.rampPerMin}/m empty ${d.emptyHeat} tough x${d.toughMul} sites x${d.sitesMul} xp x${d.xpMul}\n` +
      `horde pow ${C.HORDE_SIZE_POW} jitter ${C.HORDE_SIZE_JITTER} big ${C.HORDE_BIG_CHANCE}x${C.HORDE_BIG_MUL} routeHeat ${C.HORDE_ROUTE_HEAT} siteDist ${C.OUTBREAK_MIN_ZONE_DIST}\n` +
      `wave ${sim.wave}  next ${nextStr}\ncivilians out ${c.civ}  safe ${c.safe}\ninfected ${c.inf}  breaches ${sim.breaches}\nearned ${C.money(sim.earned)}  units ${sim.units.length} (lost ${sim.unitsLost})` +
      `\nscore weights saved ${C.SCORE_W_SAVED} speed ${C.SCORE_W_SPEED} city ${C.SCORE_W_CITY} kills ${C.SCORE_W_KILLS}\npar ${C.EVAC_PAR_S}s  min saved ${C.MEDAL_MIN_SAVED_PCT}%  pad x${C.EVAC_COST_MUL}\nstall ${C.ROUND_STRAGGLERS_PCT}% / ${C.ROUND_STALL_S}s  mayhem $${C.MAYHEM_DAMAGE_PER_POINT.toLocaleString()}/pt  ${C.MAYHEM_XP_PER_KILL} XP/kill${sim.roundDone ? `\nround done at ${sim.roundAt!.toFixed(0)}s` : ""}`;
  }
}
$("reset").addEventListener("click", () => {
  if (!confirm("Erase all medals and saved plans? Settings are kept.")) return;
  const keep = save.settings; save = Save.reset(); save.settings = keep; Save.store(save); renderCities();
});
document.querySelector("#s-title .ver")!.textContent = `v${C.VERSION}`;
for (const k of C.BUILDABLE) $(`cost-${k}`).textContent = `${C.money(C.UNITS[k].cost)}`;
for (const k of C.SUPPORT_KINDS) $(`cost-${k}`).textContent = C.money(C.SUPPORTS[k].cost);

// ---------- 0.33: save slots and battle saves ----------
let saving = false;
const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const fmtMB = (b: number) => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
function esc(t: string) { return t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); } // hoisted: the command card uses it at startup
/** Everything the page needs besides the Sim to carry on a saved battle (plain data). */
function pageState(): Snap.PageState {
  return { cityId: city?.id ?? null, dailyDate, customName: customMap?.name ?? null, customStreets: customMap?.streets ?? null, mutators: [...activeMutators], seed, xpGiven, roundShown,
    tipGates, lastWave, warnedWave, warnShown, outbreakShown, lastBreaches, lastEarned, cam: { x: cam.x, y: cam.y, scale: cam.scale } };
}
async function saveGame() {
  if (mode !== "game") { say("Start a city first, then save the battle.", 2500); return; }
  if (sim.phase === "over") { say("This battle is over; there's nothing to save.", 2500); return; }
  const n = Save.activeSlot();
  if (!n) { say("Pick a save slot first.", 2500); go("slots"); return; }
  if (saving) return;
  saving = true;
  const label = $("cityname").textContent ?? "Battle", t0 = performance.now(), at = sim.time, phase = sim.phase;
  say(`Saving to Slot ${n}...`, 60000);
  try {
    const bytes = await Snap.pack(C.VERSION, label, sim, pageState()); // the battle is copied before this awaits
    if (!(await Save.writeBattle(n, bytes))) throw new Error("the file couldn't be written");
    save.battle = { version: C.VERSION, savedAt: new Date().toISOString(), label, t: at, phase, bytes: bytes.length };
    Save.store(save);
    say(`Saved to Slot ${n} (${fmtMB(bytes.length)}).`, 2500);
    log("info", "battle-saved", { slot: n, bytes: bytes.length, ms: Math.round(performance.now() - t0), t: +at.toFixed(1), phase });
  } catch (err) {
    say(`Couldn't save: ${(err as Error).message}`, 6000);
    log("error", "battle-save-failed", { slot: n, error: String((err as Error)?.stack ?? err) });
  } finally { saving = false; if (!stack.length || stack[stack.length - 1] === "slots") renderSlots(); }
}
/** Bring a battle back from the active slot. It loads paused. */
async function loadBattle(n: number) {
  const gz = await Save.readBattle(n);
  if (!gz) { say("No battle saved in this slot.", 3000); return; }
  const meta = await Snap.peek(gz);
  if (!meta) { say("That battle file is damaged.", 4000); return; }
  if (meta.version !== C.VERSION) { say(`That battle was saved in version ${meta.version}; it only loads in ${meta.version}.`, 5000); return; }
  let snap: Snap.Snapshot;
  try { snap = await Snap.unpack(gz); } catch (err) { say("That battle file is damaged.", 4000); log("error", "battle-load-failed", { slot: n, error: String(err) }); return; }
  const p = snap.page as Record<string, any>;
  closeOutBattle(); // 0.57: the battle being left is recorded, only once the saved one has unpacked (review I3)
  loadSeq++; // 0.36: drop any area load still pending
  const areaKey = typeof p.cityId === "string" && p.cityId.includes("/") ? p.cityId : null;
  if (areaKey) { try { await loadRealArea(areaKey); } catch { /* the snapshot carries its own map; Retry needs the area */ } } // review #2: Retry/Restart build a new Sim from it
  clearTicker();
  mode = "game"; showHeatmap = false;
  city = typeof p.cityId === "string" ? C.cityById(p.cityId) ?? null : null; // 0.35: daily cities too
  dailyDate = typeof p.dailyDate === "string" ? p.dailyDate : null;
  customMap = typeof p.customName === "string" ? { name: p.customName, map: snap.sim.map } : null;
  activeMutators.clear(); for (const m of Array.isArray(p.mutators) ? p.mutators : []) if (m in C.MUTATORS) activeMutators.add(m);
  seed = Number(p.seed) || 0;
  if (customMap && Array.isArray(p.customStreets)) customMap.streets = p.customStreets; // 0.57
  sim = snap.sim; recordDone = false; lastRecord = null; lastBroken = []; placesCache = null; endDismissed = false;
  closePerson(); $("timepick").hidden = true; startMin = sim.startMin; // 0.39: the loaded battle's clock; no window or follow carried over
  document.body.classList.remove("attract");
  stack.length = 0; show(null);
  $("osm-credit").hidden = !(city?.real || customMap);
  Object.assign(perf, new Perf());
  draft = []; pings = []; strikeStart = null; orderSel = null; nukeArm = null;
  xpGiven = Number(p.xpGiven) || 0; roundShown = !!p.roundShown; tipGates = !!p.tipGates; lastWave = Number(p.lastWave) || 0; warnedWave = Number(p.warnedWave ?? -1);
  warnShown = !!p.warnShown; outbreakShown = !!p.outbreakShown; lastBreaches = Number(p.lastBreaches) || 0; lastEarned = Number(p.lastEarned) || 0;
  showRanges = save.settings.showRanges;
  resize(); buildBase(); buildZone(); fitCamera();
  if (p.cam && Number.isFinite(p.cam.x) && Number.isFinite(p.cam.y) && Number.isFinite(p.cam.scale)) Object.assign(cam, { x: p.cam.x, y: p.cam.y, scale: p.cam.scale });
  $("end").hidden = true;
  $("cityname").textContent = snap.label;
  syncDev();
  setTool(sim.phase === "plan" ? "zone" : "pan");
  speed = 0; refreshUi();
  if (sim.phase === "battle") snd.music("battle");
  say(`Loaded the battle from Slot ${n} (${fmtT(Math.max(0, sim.time))} in). ${sim.phase === "battle" ? "Paused: press Space to carry on." : ""}`, 6000);
  log("info", "battle-loaded", { slot: n, ...cityTag(), t: +sim.time.toFixed(1), phase: sim.phase });
}
/** The slot's profile is now the game's: settings, quick bar and speed follow it. */
function applyProfile() {
  if (save.xp == null) { save.xp = P.grandfatherXp(save.best); Save.store(save); }
  quick = cleanQuickbar(save.settings.quickbar, t => buildToolSet().has(t)); applyBinds(cleanKeys(save.settings.keys, save.settings.quickKeys)); // 0.54 (0.55: all keys)
  pausedSpeed = save.settings.speed ?? 1;
  showRanges = save.settings.showRanges;
  applyVolumes(); applyFullscreen(); updateDailyButton(); syncDifficultyButtons(); syncDev();
  $("title-slots").textContent = Save.activeSlot() ? `Save Slots (Slot ${Save.activeSlot()})` : "Save Slots";
}
function pickSlot(n: number) {
  const empty = !Save.listSlots()[n - 1]?.data, keep = save.settings;
  save = Save.selectSlot(n);
  if (empty) { save.settings = { ...keep }; save.gameVersion = C.VERSION; Save.store(save); } // a new player keeps this computer's settings; 0.56.1: stamped so the next start sees this version
  log("info", "slot-picked", { slot: n, empty });
  applyProfile();
}
// a delete needs a second click within 3 s
let armed: { key: string; t: number } | null = null;
const confirmed = (key: string) => { const ok = armed?.key === key && performance.now() - armed.t < 3000; armed = ok ? null : { key, t: performance.now() }; return ok; };
function renderSlots() {
  const act = Save.activeSlot(), inGame = mode === "game";
  $("slots-back").hidden = !act;
  $("slots-sub").textContent = act ? "Each slot is its own player: rank, medals, unlocks and plans, plus one saved battle (F5 or Save game in the Esc menu)."
    : "Pick a slot to play in. Each slot is its own player: rank, medals, unlocks and plans, plus one saved battle (F5 or Save game in the Esc menu).";
  $("slots-folder").hidden = !Save.canOpenFolder();
  const box = $("slot-list"); box.innerHTML = "";
  for (const sl of Save.listSlots()) {
    const d = sl.data, card = document.createElement("div");
    card.className = "slot" + (sl.n === act ? " active" : "");
    let html = `<h3>SLOT ${sl.n}${sl.n === act ? " · PLAYING" : ""}</h3>`;
    if (!d) html += `<div class="meta">Empty</div>`;
    else {
      const xp = d.xp ?? P.grandfatherXp(d.best), medals = Object.values(d.best).filter(b => b.medal).length;
      html += `<div class="meta"><b>${esc(P.rankFor(xp).name)}</b> · ${xp.toLocaleString()} XP<br>${medals} medal${medals === 1 ? "" : "s"} · ${Object.keys(d.plans).length} saved plan${Object.keys(d.plans).length === 1 ? "" : "s"}</div>`;
      const b = d.battle;
      if (b && sl.battleBytes) html += `<div class="meta">Battle: <b>${esc(b.label)}</b><br>${b.phase === "plan" ? "planning" : fmtT(b.t) + " in"} · saved ${esc(new Date(b.savedAt).toLocaleString())} · ${fmtMB(sl.battleBytes)}${b.version !== C.VERSION ? `<br>Made in ${esc(b.version)}: can't load in ${C.VERSION}` : ""}</div>`;
      else html += `<div class="meta">No saved battle</div>`;
    }
    html += `<div class="acts"></div>`;
    card.innerHTML = html;
    const acts = card.querySelector(".acts")!;
    const btn = (text: string, fn: () => void, cls = "") => { const e = document.createElement("button"); e.textContent = text; if (cls) e.className = cls; e.addEventListener("click", fn); acts.appendChild(e); return e; };
    if (sl.n !== act) btn(d ? "Play this slot" : "New game here", () => {
      if (inGame) { say("Quit to the menu to switch slots.", 3000); return; }
      pickSlot(sl.n); stack.length = 0; go("title");
    }).disabled = inGame;
    const b = d?.battle;
    if (d && b && sl.battleBytes && b.version === C.VERSION) btn("Load battle", () => {
      if (sl.n !== act) { if (inGame) { say("Quit to the menu to switch slots.", 3000); return; } pickSlot(sl.n); }
      void loadBattle(sl.n);
    }).disabled = inGame && sl.n !== act;
    if (d && sl.battleBytes) btn("Delete battle", () => {
      const key = `b${sl.n}`; if (!confirmed(key)) { say("Click Delete battle again to confirm.", 3000); return; }
      Save.deleteBattle(sl.n);
      if (sl.n === act) { delete save.battle; Save.store(save); }
      log("info", "battle-deleted", { slot: sl.n }); renderSlots();
    }, "danger");
    if (d) btn("Delete slot", () => {
      if (inGame && sl.n === act) { say("Quit to the menu to delete the slot you're playing.", 3500); return; }
      const key = `s${sl.n}`; if (!confirmed(key)) { say(`Click Delete slot again to delete Slot ${sl.n} (rank, medals, plans and its battle).`, 3000); return; }
      Save.deleteSlot(sl.n);
      log("info", "slot-deleted", { slot: sl.n });
      if (sl.n === act) { save = Save.load(); applyProfile(); stack.length = 0; go("slots"); return; }
      renderSlots();
    }, "danger");
    box.appendChild(card);
  }
}
$("p-save").addEventListener("click", () => void saveGame());
$("slots-folder").addEventListener("click", () => Save.openFolder());
$("save-folder").addEventListener("click", () => Save.openFolder());
$("save-folder").hidden = !Save.canOpenFolder();
$("title-slots").textContent = Save.activeSlot() ? `Save Slots (Slot ${Save.activeSlot()})` : "Save Slots";

resize();
applyVolumes();
log("info", "app-start", { version: C.VERSION, renderer: glv.ok ? "webgl" : "2d", desktop: !!Save.desktop, screen: [screen.width, screen.height], window: [innerWidth, innerHeight], dpr: devicePixelRatio, ua: navigator.userAgent, cores: navigator.hardwareConcurrency, settings: save.settings, citiesWon: Object.keys(save.best).length });
applyFullscreen();
setTool("zone");
startAttract();
if (!Save.activeSlot()) go("slots"); // 0.33: first time: pick a slot (an old save is already in Slot 1)
initUpdater({ save: () => save, go, say, log: (ev, d) => log("info", ev, d), inGame: () => mode === "game" }); // 0.26: Windows app only
requestAnimationFrame(frame);

// Exposed for automated checks.
// ---------- 0.47: shot mode (?shots=1) for tools/shots: scripted scenes, frame-exact stepping, no overlays ----------
const SHOTS = typeof location !== "undefined" && shotsAllowed(location.href); // local file only (final review #1)
if (SHOTS) {
  let rs = 1;
  const seedRandom = (n: number) => { rs = n >>> 0 || 1; Math.random = () => { rs = (rs + 0x6d2b79f5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const px = (x: number, y: number): [number, number] => [cam.x + x * cam.scale, cam.y + y * cam.scale];
  const key = (k: string) => { // 0.50: "Ctrl+1" / "Shift+2": modifiers, and digits carry their code (group keys read e.code)
    const parts = k.split("+"), base = parts.pop()!, ctrlKey = parts.includes("Ctrl"), shiftKey = parts.includes("Shift");
    const code = /^[0-9]$/.test(base) ? "Digit" + base : /^F\d+$/.test(base) ? base : /^[a-z]$/i.test(base) ? "Key" + base.toUpperCase() : base;
    dispatchEvent(new KeyboardEvent("keydown", { key: base, code, ctrlKey, shiftKey })); dispatchEvent(new KeyboardEvent("keyup", { key: base, code, ctrlKey, shiftKey }));
  };
  // a drawn mouse pointer: headless screenshots have none, and clips need to show where the clicks land
  const cur = document.createElement("div");
  cur.id = "shot-cursor"; cur.hidden = true;
  cur.innerHTML = `<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 23 L8 17.5 L12 26 L15.5 24.5 L11.5 16 L19 16 Z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(cur);
  const pointAt = (x: number, y: number) => {
    const [mx, my] = px(x + 0.5, y + 0.5), r = canvas.getBoundingClientRect();
    hover = [x + 0.5, y + 0.5]; mouse = [r.left + mx / devicePixelRatio, r.top + my / devicePixelRatio];
    cur.style.left = mouse[0] + "px"; cur.style.top = mouse[1] + "px"; cur.hidden = false;
  };
  const apply = (op: ShotOp) => {
    // the pointer shows only for what a player would point at; placements in a setup leave no cursor behind
    if (op.op === "click" || op.op === "select" || op.op === "hover" || op.op === "person") pointAt(op.x, op.y);
    if (op.op === "click") hover = null; // a click shows the pointer but not the hover panel (clips stay readable)
    else if (op.op === "place" || op.op === "gate" || op.op === "zone") { cur.hidden = true; hover = null; mouse = null; }
    switch (op.op) {
      case "zone": setTool("zone"); for (const [x, y] of op.pts) click(x + 0.5, y + 0.5); click(op.pts[0][0] + 0.5, op.pts[0][1] + 0.5); cur.hidden = true; break;
      case "place": setTool(op.kind as Tool); click(op.x + 0.5, op.y + 0.5); break;
      case "gate": setTool("gate"); click(op.x + 0.5, op.y + 0.5); break;
      case "ability": { const e = sim.buyAbility(op.kind as C.AbilityKind); if (e) throw new Error(`ability ${op.kind}: ${e}`); refreshUi(); break; }
      case "time": startMin = op.min; sim.setStartTime(op.min); buildZone(); refreshUi(); break;
      case "battle": startBattle(); speed = 1; break;
      case "select": setTool("pan"); click(op.x + 0.5, op.y + 0.5); break;
      case "boxselect": { setTool("pan"); const [a, b] = px(op.x0, op.y0), [c, d] = px(op.x1, op.y1); boxSelect([a, b, c, d]); break; }
      case "key": key(op.key); break;
      case "click":
        if (op.button === "left") click(op.x + 0.5, op.y + 0.5);
        else if (armedCmd) { armedCmd = null; renderActions(); }
        else if (tool === "pan" && (orderable().length || selOrbits().length)) moveOrder(op.x + 0.5, op.y + 0.5);
        else setTool("pan");
        break;
      case "tool": setTool(op.tool as Tool); break;
      case "hover": break; // pointAt above
      case "cursor": cur.hidden = true; hover = null; mouse = null; break;
      case "person": { const k = sim.civAt(op.x, op.y, 14); if (k < 0) throw new Error(`no person near ${op.x},${op.y}`); setTool("pan"); selectPerson(k); pointAt(sim.ax[k] - 0.5, sim.ay[k] - 0.5); break; }
      case "camera": cam.scale = op.scale; centerOn(op.x, op.y); following = false; break;
      case "endround": { const e = sim.endRoundNow(); if (e) throw new Error(`endround: ${e}`); if (sim.roundResult && !roundShown) { roundShown = true; speed = 0; showEnd(sim.roundResult, true); } break; } // 0.57: as hud() would
      case "report": erTab = op.tab as Tab; renderReport(); break;
    }
  };
  const step = (s: number) => { const n = Math.round(s / C.DT); for (let i = 0; i < n && sim.phase === "battle"; i++) sim.step(C.DT); };
  document.body.classList.add("shots");
  save.settings.tips = false; save.settings.edgeScroll = false; save.xp = 1e9; // every tool unlocked (memory only)
  (window as any).hordeShot = {
    load(cityId: string, seedN: number, min: number) {
      const c = C.CITIES.find(x => x.id === cityId);
      if (!c) throw new Error(`unknown city ${cityId}`);
      save.plans = {}; save.battle = undefined; // every recipe starts clean: no plan saved by an earlier recipe in this profile
      seedRandom(seedN); playCityNow(c, seedN);
      $("timepick").hidden = true; clearTicker();
      startMin = min; sim.setStartTime(min); buildZone(); setTool("pan"); refreshUi();
    },
    run(ops: string[]) { runOps({ apply, step }, ops); },
    step,
    ready: () => mode === "game",
  };
}
(window as any).horde = { get lastRecord() { return lastRecord; }, openCodex, get codex() { return codex; }, get sim() { return sim; }, get mode() { return mode; }, get save() { return save; }, cities: C.CITIES, recentLog, click, closeDraft, startBattle, setTool, setSpeed, cam, playCity, startAttract, pause, resume, saveGame, loadBattle, get startMin() { return startMin; }, get selPerson() { return selPerson; }, get following() { return following; } };
