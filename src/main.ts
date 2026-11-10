import * as C from "./config";
import { BRIDGE, BUILDING, CityMap, INFRA_HIGHWAY, INFRA_RAIL, INFRA_STATION, PARK, ROAD, WATER } from "./map";
import { fetchLiveOsmCity } from "./osm";
import { CIV, INF, SAFE_CIV, Sim } from "./sim";
import type { Score } from "./sim";
import * as Save from "./save";
import * as P from "./progress";
import * as Mods from "./mods";
// Mods first: they change numbers that everything below reads. Desktop: <userData>\mods\*.json; browser: stored copies.
const BROWSER_MODS = "horde.mods";
function browserMods(): Mods.ModFile[] { try { return JSON.parse(localStorage.getItem(BROWSER_MODS) ?? "[]"); } catch { return []; } }
const modReports: Mods.ModReport[] = [...(Save.desktop?.readMods?.() ?? []), ...browserMods()].map(Mods.applyMod);
import type { Plan } from "./save";
import { log, installErrorHooks, recentLog, Perf } from "./log";
import { GLView } from "./gl";
import { Sound } from "./audio";
import { initSprites, SPRITE_CANVAS, SPRITE_URL, SpriteKey, supportSpriteKey } from "./sprites";
import { AlertQueue } from "./ticker";
import { partPoints, mergeBest, bestKey, anyMedal, difficultyFor } from "./scoring";
import { soundDue, zoomGain } from "./audiotiming";
import { cleanQuickbar, setSlot, swapSlots, clearSlot, type Slots } from "./quickbar";
import { drawDepot, drawModel, drawSquad, drawSupport, drawWrecks, hasModel, hasSquad, MODEL_ZOOM, noteUnits, SQUAD_ZOOM } from "./models";

installErrorHooks();
initSprites();
document.querySelectorAll<HTMLImageElement>("img[data-sprite]").forEach(img => {
  const k = img.dataset.sprite as SpriteKey;
  if (SPRITE_URL[k]) img.src = SPRITE_URL[k];
});
const perf = new Perf();

type Tool = "pan" | "order" | "zone" | "gate" | C.UnitKind | C.SupportKind | "remove" | C.AbilityKind | "c4" | "depot";
const ABILITY_KINDS = Object.keys(C.ABILITIES) as C.AbilityKind[];
const isAbility = (t: Tool): t is C.AbilityKind => t in C.ABILITIES;
const isSupport = (t: Tool): t is C.SupportKind => t in C.SUPPORTS;
let strikeStart: [number, number] | null = null; // first click of an airstrike run
let mapVersion = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;
const glv = new GLView($<HTMLCanvasElement>("gl"));
const snd = new Sound();
addEventListener("pointerdown", () => snd.unlock());
addEventListener("keydown", () => snd.unlock());
document.addEventListener("click", e => { if ((e.target as HTMLElement).closest("button")) snd.click(); }); // map + agents on the graphics card; 2D canvas on top for the rest

let save = Save.load();
if (save.xp == null) { save.xp = P.grandfatherXp(save.best); Save.store(save); } // players from before XP keep their access
/** Unlocked by XP, lent by the current campaign city, or everything in developer mode. */
const isOpen = (t: string) => P.unlocked(t, save.xp ?? 0, city?.trial, !!save.settings.devMode);
const toolName = (t: string) => (C.UNITS as Record<string, { name: string }>)[t]?.name ?? (C.SUPPORTS as Record<string, { name: string }>)[t]?.name ?? (C.ABILITIES as Record<string, { name: string }>)[t]?.name ?? t;
let mode: "attract" | "game" = "attract"; // attract = the title screen with a city falling in the background
let city: C.CityDef | null = null; // null = quick battle on a random city
let customMap: { name: string; map: CityMap } | null = null;
let dailyDate: string | null = null;
const activeMutators = new Set<C.MutatorId>();
let seed = Math.floor(Math.random() * 1e9);
const simOpts = () => ({
  civilians: save.settings.crowd ?? C.CIVILIANS,
  realCityId: city?.real ? city.id : undefined,
  customMap: customMap?.map,
  mutators: [...activeMutators],
  difficulty: difficultyFor(!!dailyDate, save.settings.difficulty),
  ...(city ? { budget: city.budget, waveMul: city.waveMul, sites: city.sites, speedMul: city.speedMul } : {}),
});
let sim = new Sim(seed);
let pausedSpeed = 1;
let tool: Tool = "zone";
let speed = 1; // 0 paused
let draft: [number, number][] = []; // zone being drawn
let hover: [number, number] | null = null; // cell under the mouse
let showHeights = false;
let showRanges = false;
let showHeatmap = false;
let hoverUnitHeatmap: C.UnitKind | null = null;
let hoverNavTool: Tool | "heatmap" | "closegates" | "clear" | null = null;
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
          const k = lv / 14;
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
function exportPlan(): Plan {
  const walls: number[] = [];
  sim.inZone.forEach((z, i) => { if (z === 2) walls.push(i); });
  return {
    poly: sim.zones[0] ?? [], zones: sim.zones.map(z => z.slice()), walls,
    units: sim.units.filter(u => u.kind !== "para" && u.kind !== "police" && u.kind !== "militia").map(u => [u.kind, u.x, u.y, u.mode ?? "near"]),
    supports: sim.supports.map(b => [b.kind, b.x, b.y]),
    abilities: { ...sim.bought }, c4: [...sim.c4],
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
  for (const z of p.zones ?? (p.poly.length ? [p.poly] : [])) sim.addZone(z);
  for (const i of p.walls) if (sim.inZone[i] === 3) { sim.inZone[i] = 2; sim.wallHp[i] = sim.wallMaxHp(); }
  sim.fieldDirty = true;
  for (const [k, x, y] of p.supports ?? []) if (k === "budget") sim.placeSupport(k, x, y);
  for (const [k, x, y] of p.supports ?? []) if (k !== "budget") sim.placeSupport(k, x, y);
  for (const [k, x, y, m] of p.units) { if (!sim.place(k, x, y) && m) sim.units[sim.units.length - 1].mode = m; }
  for (const k of ABILITY_KINDS) for (let n = p.abilities?.[k] ?? 0; n > 0; n--) sim.buyAbility(k);
  for (const b of p.c4 ?? []) if (sim.bridges[b] && sim.remaining() >= C.C4_COST) sim.c4.add(b);
}
function newSim(keepPlan: boolean, newSeed = false) {
  openPicker(null); clearTicker();
  const plan = keepPlan ? exportPlan() : null;
  if (newSeed) seed = Math.floor(Math.random() * 1e9);
  sim = new Sim(seed, simOpts());
  if (plan) importPlan(plan);
  log("info", "restart", { ...cityTag(), keptPlan: keepPlan });
  draft = []; speed = 1; tipGates = false; lastWave = 0; warnedWave = -1; warnShown = false; outbreakShown = false; xpGiven = 0; roundShown = false;
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
  if (id === "settings") { syncSettings(); renderMods(); }
  if (id === "record") renderRecord();
}
function go(id: string) { stack.push(id); show(id); }
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

function cityUnlocked(i: number) { return i === 0 || anyMedal(save.best, C.CITIES[i - 1].id); }
function cityBestHtml(cityId: string, lockedMsg: string | null, unplayed: string) {
  if (lockedMsg) return `<span class="best" style="color:#8a919c">${lockedMsg}</span>`;
  const cur = difficultyFor(false, save.settings.difficulty);
  const marks = C.DIFFICULTY_IDS.map(d => {
    const b = save.best[bestKey(cityId, d)];
    const m = b?.medal && C.MEDALS.find(x => x[0] === b.medal);
    const ch = d[0].toUpperCase();
    return `<b class="dmark" data-diff="${d}" title="${C.DIFFICULTY[d].name}: ${b?.medal ?? "No medal"}" style="color:${m ? m[2] : "#555c66"};margin-right:4px">${ch}</b>`;
  }).join("");
  const best = save.best[bestKey(cityId, cur)];
  const medal = best && C.MEDALS.find(m => m[0] === best.medal);
  const txt = best ? `${best.medal ?? "No medal"} · ${best.pct.toFixed(0)} pts${best.mayhem ? ` · Mayhem ${best.mayhem.toLocaleString()}` : ""}` : unplayed;
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
      cityBestHtml(c.id, null, "OpenStreetMap · Ready");
    b.addEventListener("click", () => { dailyDate = null; customMap = null; playCity(c); });
    rlist.appendChild(b);
  });
}

function syncSettings() {
  $<HTMLInputElement>("opt-fs").checked = save.settings.fullscreen;
  $<HTMLInputElement>("opt-edge").checked = save.settings.edgeScroll;
  $<HTMLInputElement>("opt-ranges").checked = save.settings.showRanges;
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

function startAttract() {
  openPicker(null); clearTicker();
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

function playCity(c: C.CityDef | null, seedOverride?: number) {
  clearTicker();
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
  if (c?.trial && !P.unlocked(c.trial, save.xp ?? 0)) setTimeout(() => say(`Field trial: ${toolName(c.trial!)} is on loan to you in ${c.name}. Earn ${P.UNLOCK_XP[c.trial!].toLocaleString()} XP to keep it everywhere.`, 9000), 600);
  Object.assign(perf, new Perf()); // perf numbers cover play time only
  draft = []; speed = 1; tipGates = false; lastWave = 0; warnedWave = -1; warnShown = false; outbreakShown = false; xpGiven = 0; roundShown = false;
  showRanges = save.settings.showRanges;
  resize(); buildBase(); buildZone(); fitCamera();
  $("end").hidden = true;
  const baseName = dailyDate ? `Daily (${dailyDate}): ${c?.name ?? ""}` : customMap ? `OSM: ${customMap.name}` : c ? c.name : "Quick battle";
  $("cityname").textContent = `${baseName} · ${sim.diff.name}`;
  syncDev();
  setTool(saved ? "sniper" : "zone"); refreshUi();
  const mutStr = activeMutators.size ? ` Active mutators: ${[...activeMutators].map(m => C.MUTATORS[m].name).join(", ")}.` : "";
  say((saved ? `Your last plan is loaded. Change it or press Start.`
    : "Plan your defense: draw a safe zone, add gates, place units, then Start.") + mutStr, 6000);
}

function playDaily() {
  const dc = C.dailyChallengeFor();
  dailyDate = dc.date;
  customMap = null;
  activeMutators.clear();
  for (const m of dc.mutators) activeMutators.add(m);
  playCity(dc.city, dc.seed);
}

function pause() {
  if (mode !== "game") return;
  openPicker(null);
  log("info", "pause", { phase: sim.phase, t: +sim.time.toFixed(1) });
  pausedSpeed = speed || pausedSpeed; speed = 0; refreshUi();
  stack.length = 0; go("pause");
}
function resume() {
  stack.length = 0; show(null);
  if (sim.phase === "battle") speed = pausedSpeed || 1;
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
  const key = bestKey(city.id, sim.difficulty);
  const prev = save.best[key];
  // 0.20: pct holds the round score (0..100); old entries were "% evacuated" and only go when beaten
  save.best[key] = mergeBest(prev, r.score, r.medal ?? null); // never drops a medal (final review #1)
  if (r.mayhem !== undefined && r.mayhem > (save.best[key].mayhem ?? -1)) save.best[key] = { ...save.best[key], mayhem: r.mayhem };
  Save.store(save);
}

// ---------- Input ----------
// Alert ticker (0.19): hordes, breaches, losses and tips scroll along the top bar. say() is for replies to a click.
const alerts = new AlertQueue();
let tickerBusy = false;
/** until: sim time after which the alert is stale and skipped (horde warnings). */
function notify(text: string, urgent = false, until?: number) { alerts.push(text, urgent, until); runTicker(); }
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

function setTool(t: Tool) {
  if (!isOpen(t)) { say(`${toolName(t)} unlocks at ${P.UNLOCK_XP[t].toLocaleString()} XP. You have ${(save.xp ?? 0).toLocaleString()}.`, 3500); return; }
  orderSel = null; nukeArm = null;
  openCatFor(t);
  tool = t; strikeStart = null;
  if (t !== "zone") draft = [];
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  renderQuickbar();
  const hints: Record<Tool, string> = {
    pan: "Drag to move the map. Wheel to zoom. Click a unit to change what it shoots first.",
    order: "Click an APC, squad, paratroopers or boat, then click where to send it. It clears that area and holds it.",
    barrage: C.ABILITIES.barrage.hint, moab: C.ABILITIES.moab.hint, nuke: C.ABILITIES.nuke.hint,
    a10: C.ABILITIES.a10.hint, cluster: C.ABILITIES.cluster.hint, tomahawk: C.ABILITIES.tomahawk.hint, gunship: C.ABILITIES.gunship.hint,
    himars: "Click a street or park, ideally inside your zone (free reloads). Ripples 6 rockets at the thickest crowd up to 460 m away. Nothing closer than 60 m.",
    tank: "Click a street. An M1 Abrams: machine gun plus a 120 mm main gun, 3,000 HP armor. Patrols, kites, drives home to rearm. Takes strike orders [O].",
    apache: "Click anywhere inside your safe zone. An AH-64 flies over everything, hunting infected near its post with a 30 mm gun and rockets. Takes strike orders [O] anywhere.",
    reaper: "Click anywhere inside your safe zone. An MQ-9 drone loiters over a wide area firing Hellfires at the densest packs. Takes strike orders [O] anywhere.",
    howitzer: "Click a street or park inside your zone. Howitzers shell the thickest crowds far away, slowly. Can't hit anything close.",
    apc: "Click a street, even outside the zone. The APC guards that spot; out of ammo it drives into the zone, reloads and comes back.",
    depot: "Click a fuel depot (orange) to set it off: a huge blast that kills everyone near it, civilians too.",
    gunboat: "Click the river. The gunboat patrols the water near where you put it and shoots crowds by the banks. Infected can't reach it.",
    zone: "Click corners of your safe zone. Click the first corner (or press Enter) to close it. Esc cancels.",
    gate: "Click a crossing to switch gate (blue: civilians get in, weaker) / wall (white: nobody gets in, stronger). In battle you can still close gates.",
    garrison: "Click a building. Garrisons fire fast at short range.",
    sniper: "Click a building. Taller buildings give snipers more range (press V to see heights).",
    turret: "Click a street. Turrets fire very fast but never reload.",
    remove: "Planning: click a unit or support building to remove it for a full refund. Battle: it stops working and is pulled out after a while, then refunds.",
    battleship: "Click the river. A slow, heavy warship whose guns shell crowds far inland. Set its target (Move map, click it) to cover your walls or civilians on the run.",
    mortar: "Click a street or park. Mortars lob shells far into crowds of infected, but can't hit anything close.",
    evac: C.SUPPORTS.evac.hint, police: C.SUPPORTS.police.hint, militia: C.SUPPORTS.militia.hint,
    budget: C.SUPPORTS.budget.hint, repair: C.SUPPORTS.repair.hint, radio: C.SUPPORTS.radio.hint,
    supply: C.SUPPORTS.supply.hint, command: C.SUPPORTS.command.hint,
    para: C.ABILITIES.para.hint, airstrike: C.ABILITIES.airstrike.hint, firebomb: C.ABILITIES.firebomb.hint,
    supply_drop: C.ABILITIES.supply_drop.hint,
    c4: "Planning: click a bridge to plant a charge ($500), click again to remove it. Battle: click a charged bridge to blow it.",
  };
  $("hint").textContent = hints[t];
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
    const m = sim.cycleTarget(cx, cy);
    if (m) { say(`This unit now shoots ${C.TARGET_LABEL[m]} first.`, 2500); log("info", "target-mode", { mode: m, x, y }); }
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
    if (typeof r === "string") say(r); else { say(`Pulling the unit out: ${r.toFixed(0)} s. It won't fight meanwhile; you get its cost back when it's out.`, 4000); log("info", "sell-in-battle", { x, y, secs: r }); }
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
    case "gate": { const e = sim.toggleGate(x, y); if (e) say(e); else buildZone(); break; }
    case "remove": if (!sim.removeAt(x, y)) say("No unit or support building there (or removing a Budget Office would exceed your budget)."); break;
    case "depot": {
      if (planning) { say("Fuel depots go off during the battle. Plan around them."); break; }
      const e = sim.blowDepot(x, y);
      if (e) say(e); else { say("Boom."); log("info", "depot-blown", { x, y, t: +sim.time.toFixed(1) }); }
      break;
    }
    case "garrison": case "sniper": case "turret": case "mortar": case "howitzer": case "apc": case "gunboat": case "battleship": case "himars": case "tank": case "apache": case "reaper": {
      if (!planning) { const e = sim.place(tool, x, y); if (e) say(e); else { say(`${C.UNITS[tool].name} deploying (${C.UNITS[tool].deploy} s).`, 2000); log("info", "bought-in-battle", { kind: tool, x, y, left: sim.remaining() }); } break; } const e = sim.place(tool, x, y); if (e) say(e); break; }
    case "evac": case "budget": case "repair": case "radio": case "supply": case "command": case "police": case "militia": {
      const e = sim.placeSupport(tool, x, y);
      if (e) say(e);
      else if (!planning) { say(`${C.SUPPORTS[tool].name} deploying (${C.SUPPORTS[tool].deploy} s).`, 2000); log("info", "bought-in-battle", { kind: tool, x, y, left: sim.remaining() }); }
      break;
    }
    case "c4": {
      const b = sim.bridgeAt(x, y);
      const e = planning || (b >= 0 && !sim.c4.has(b)) ? sim.toggleC4(x, y) : sim.blowBridge(x, y);
      if (!e && !planning && b >= 0 && !sim.blown.has(b)) { say("Charge planted. Click the bridge again to blow it.", 3000); refreshUi(); break; }
      if (e) say(e); else if (!planning) { say("Bridge down!"); log("info", "bridge-blown", { x, y, t: +sim.time.toFixed(1) }); }
      break;
    }
    case "airstrike": case "firebomb": case "para": case "supply_drop": case "barrage": case "moab": case "nuke": case "a10": case "cluster": case "tomahawk": case "gunship": {
      if (planning) { say("Buy abilities with their buttons now; aim them during the battle."); break; }
      if (tool === "nuke" && (!nukeArm || Math.hypot(nukeArm[0] - cx, nukeArm[1] - cy) > 4)) { nukeArm = [cx, cy]; say("Nuclear strike: everything within 160 m dies, people in your zone too. Click the same spot again to confirm.", 6000); break; }
      nukeArm = null;
      const line = tool === "airstrike" || tool === "a10";
      if (line && !strikeStart) { strikeStart = [cx, cy]; say("Now click where the run ends."); break; }
      const [sx, sy] = line ? strikeStart! : [cx, cy];
      const e = sim.useAbility(tool, sx, sy, cx, cy);
      strikeStart = null;
      if (e) { say(e); break; }
      log("info", "ability", { kind: tool, x: Math.round(sx), y: Math.round(sy), t: +sim.time.toFixed(1), left: sim.charges[tool] });
      say(`${C.ABILITIES[tool].name} inbound.`, 2500);
      if (!sim.charges[tool]) setTool("pan");
      break;
    }
  }
  refreshUi();
}

let drag: { x: number; y: number; moved: boolean; pan: boolean } | null = null;
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => {
  if (mode !== "game") return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 || tool === "pan" };
});
canvas.addEventListener("pointermove", e => {
  const dpr = devicePixelRatio;
  const [cx, cy] = toCell(e.offsetX * dpr, e.offsetY * dpr);
  hover = cx >= 0 && cy >= 0 && cx < sim.w && cy < sim.h ? [cx, cy] : null;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.pan && drag.moved) { cam.x += dx * dpr; cam.y += dy * dpr; drag.x = e.clientX; drag.y = e.clientY; }
  }
});
canvas.addEventListener("pointerup", e => {
  if (drag && !drag.moved && e.button === 0 && hover) click(hover[0], hover[1]);
  if (drag && !drag.moved && e.button === 2) {
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
addEventListener("keydown", e => {
  keys.add(e.key.toLowerCase());
  const k = e.key;
  if (k === "F10") { e.preventDefault(); toggleDevPanel(); return; }
  if (k === "F11") { e.preventDefault(); save.settings.fullscreen = !save.settings.fullscreen; Save.store(save); applyFullscreen(); return; }
  if (k === "Escape") {
    if (stack.length) { if (stack[stack.length - 1] !== "title") back(); return; }
    if (mode === "game" && pickerCat) { openPicker(null); return; }
    if (mode === "game" && draft.length) { draft = []; return; }
    if (mode === "game" && strikeStart) { strikeStart = null; return; }
    if (mode === "game" && $("end").hidden) pause();
    return;
  }
  if (mode !== "game" || stack.length) return;
  if (k === " ") { e.preventDefault(); if (sim.phase === "battle") setSpeed(speed ? 0 : 1); }
  else if (k === "v" || k === "V") showHeights = !showHeights;
  else if (k === "r" || k === "R") showRanges = !showRanges;
  else if (k === "h" || k === "H") { showHeatmap = !showHeatmap; refreshUi(); }
  else if (k === "Enter" && tool === "zone" && draft.length) closeDraft();
  else if (k === "1") setSpeed(1); else if (k === "2") setSpeed(2); else if (k === "3") setSpeed(3);
  else if (k === "l" || k === "L") $("closegates").click(); else if (k === "k" || k === "K") $("clear").click();
  else if (k === "m" || k === "M") setTool("pan"); else if (k === "n" || k === "N") setTool("remove");
  else if (k === "z" || k === "Z") setTool("zone"); else if (k === "g" || k === "G") setTool("gate");
  else if (k === "q" || k === "Q") abilityButton("airstrike"); else if (k === "e" || k === "E") abilityButton("firebomb");
  else if (k === "f" || k === "F") abilityButton("para"); else if (k === "c" || k === "C") abilityButton("supply_drop");
  else if (k === "b" || k === "B") setTool("c4");
  else if (k === "t" || k === "T") abilityButton("barrage"); else if (k === "o" || k === "O") setTool("order");
  else if (k === "x" || k === "X") setTool("depot");
});
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

function setSpeed(s: number) { speed = s === 4 ? 3 : s; refreshUi(); } // 0.19: 1x 2x 3x; 4 is gone (dev tools keep 8x/16x)
function startBattle() {
  if (sim.phase !== "plan") return;
  if (!sim.zoneClosed) { say("Draw a safe zone first."); return; }
  if (draft.length) { say("Finish or cancel (Esc) the zone you're drawing first."); return; }
  const planKey = dailyDate ? `daily:${dailyDate}` : city ? city.id : null;
  if (planKey) { save.plans[planKey] = exportPlan(); Save.store(save); }
  sim.startBattle(); speed = 1; setTool("pan"); refreshUi();
  snd.music("battle");
  log("info", "battle-start", { ...cityTag(), ...planSummary(), sites: sim.sites.map(([x, y]) => [Math.round(x), Math.round(y)]) });
  messageT = -1e9; // the planning tip goes; battle news runs in the ticker
}

// ---------- HUD ----------
function refreshUi() {
  const planning = sim.phase === "plan";
  $("budget").textContent = C.money(sim.remaining());
  $("phase").textContent = planning ? "PLANNING" : sim.phase === "battle" ? "BATTLE" : "OVER";
  const sb = $("startbtn"), label = planning ? "Start Battle" : "Restart";
  if (sb.textContent !== label) { sb.textContent = label; startLabelT = performance.now(); }
  sb.classList.toggle("restart", !planning);
  $<HTMLButtonElement>("closegates").disabled = sim.phase === "over";
  $("heatmapbtn").classList.toggle("on", showHeatmap);
  $("mut-badges").innerHTML = [...sim.mutators].map(m => `<span style="border-color:${C.MUTATORS[m].color};color:${C.MUTATORS[m].color}" title="${C.MUTATORS[m].desc}">${C.MUTATORS[m].name}</span>`).join("");
  for (const k of C.BUILDABLE) $(`cost-${k}`).textContent = C.money(sim.unitCost(k));
  for (const k of C.SUPPORT_KINDS) $(`cost-${k}`).textContent = C.money(sim.supportCost(k));
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(b => {
    b.disabled = planning; b.classList.toggle("on", !planning && Number(b.dataset.speed) === speed);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    const t = b.dataset.tool as Tool;
    if (t === "depot") b.disabled = sim.phase !== "battle" || sim.depots.every(d => d.used);
    else if (t === "c4") b.disabled = sim.phase === "over";
    else if (isAbility(t)) b.disabled = sim.phase === "over";
    else if (t === "remove") b.disabled = sim.phase === "over";
    else if (t !== "pan" && t !== "gate") b.disabled = sim.phase === "over";
  });
  for (const k of ABILITY_KINDS) $(`n-${k}`).textContent = `${C.money(C.ABILITIES[k].cost)}${sim.charges[k] ? ` ×${sim.charges[k]}` : ` (${C.ABILITIES[k].max - sim.bought[k]})`}`;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => {
    const t = b.dataset.tool!, lock = !isOpen(t);
    b.classList.toggle("locked", lock);
    if (lock) { b.disabled = true; const sm = b.querySelector("small"); if (sm) sm.textContent = `${(P.UNLOCK_XP[t] / 1000).toFixed(1)}k XP`; b.title = `Unlocks at ${P.UNLOCK_XP[t].toLocaleString()} XP`; }
    else if (b.title.startsWith("Unlocks at")) b.title = "";
  });
  $("n-depot").textContent = `×${sim.depots.filter(d => !d.used).length}`;
  if (pickerCat) renderPicker();
  renderQuickbar();
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
  if (mode !== "game" || now - lastHud < 200) return;
  lastHud = now;
  runTicker(); // picks up alerts queued while the strip was hidden
  const c = sim.counts();
  const m = Math.floor(sim.time / 60), s = Math.floor(sim.time % 60);
  $("stats").innerHTML =
    `<span class="civ">Outside ${c.civ.toLocaleString()}</span>` +
    `<span class="safe">Safe ${c.safe.toLocaleString()}</span>` +
    `<span class="evac">Evacuated ${sim.evacuated.toLocaleString()}</span>` +
    `<span class="inf">Infected ${c.inf.toLocaleString()}</span>` +
    `<span>Killed ${sim.kills.toLocaleString()}</span>` +
    `<span>${m}:${String(s).padStart(2, "0")}</span>`;
  $("budget").textContent = C.money(sim.remaining());
  if (sim.phase === "battle" && sim.lastIncome) $("budget").textContent += `  +${C.money(sim.lastIncome)}/10s`;
  if (tool === "zone" && draft.length) $("budget").textContent += `  (zone ≈ ${C.money(draftCost())})`;
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
      notify(`Horde #${sim.wave} (${sim.lastWaveCount.toLocaleString()}) coming in ${routes}!`, true, sim.time + 20);
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
  if (sim.roundResult && !roundShown && sim.phase === "battle") { roundShown = true; pausedSpeed = speed || 1; speed = 0; showEnd(sim.roundResult, true); }
  if (sim.phase === "over" && sim.result && ($("end").hidden || !$("end-round-row").hidden)) showEnd(sim.result, false);
}

let roundShown = false;
function showEnd(r: Score, round: boolean) {
  openPicker(null);
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
  $("end-pct").textContent = `${r.pct.toFixed(1)}% evacuated (${r.saved.toLocaleString()} of ${sim.civN.toLocaleString()}) · held ${hm}:${String(hs).padStart(2, "0")} after the outbreak · ${sim.wave} hordes · ${sim.liftsFlown} lifts flown${sim.liftsAborted ? `, ${sim.liftsAborted} waved off` : ""}`;
  const by = new Map<C.UnitKind, [number, number]>();
  for (const u of sim.units) { const v = by.get(u.kind) ?? [0, 0]; by.set(u.kind, [v[0] + 1, v[1] + u.kills]); }
  const rows = [...by].map(([k, [n, kills]]) => `${n} ${C.UNITS[k].name}${n > 1 ? "s" : ""}: ${kills.toLocaleString()}`).join(" · ");
  const swStr = sim.swimmersKilled ? ` (${sim.swimmersKilled.toLocaleString()} swimmers)` : "";
  $("end-kills").textContent = `Killed ${sim.kills.toLocaleString()} infected${swStr}. ${rows}` +
    (sim.civKilledByUs ? ` · Civilians lost to our own fire: ${sim.civKilledByUs.toLocaleString()}` : "");
  $("end-tiers").textContent = C.MEDALS.map(([n, p]) => `${n} ${p}`).join("  ·  ") + ` points (needs ${C.MEDAL_MIN_SAVED_PCT}% saved)`;
  recordResult(r);
  const rk = P.rankFor(save.xp ?? 0);
  $("end-xp").textContent = `Damage bill ${C.money(r.damage)} · spent ${C.money(r.spent)} · city ${r.intact.toFixed(0)}% intact${r.bonus ? ` · ${r.bonus} bonus +${C.BONUS_XP} XP` : ""} · ${round ? "this round" : "this battle"} +${r.xp.toLocaleString()} XP · ${rk.name}, ${(save.xp ?? 0).toLocaleString()} XP${rk.next ? ` (${rk.next[0]} at ${rk.next[1].toLocaleString()})` : ""}${lastNews ? ` · ${lastNews}` : ""}`;
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
  if (sim.phase === "battle" && sim.tick % 10 === 0) buildZone();
  if (!glv.ok) ctx.drawImage(zoneImg, cam.x, cam.y, sim.w * s, sim.h * s);
  else glv.draw(cam, W, H, sim.w, sim.h, showHeights, sim.n, sim.ax, sim.ay, sim.state, Math.max(1, s * 0.55), sim.mutant);
  drawHeatmap(now, s);

  // Shell craters & scorched impact pits.
  for (const c of sim.craters) {
    const px = cam.x + c.x * s, py = cam.y + c.y * s, R = Math.max(2, c.r * s);
    if (px < -R || py < -R || px > W + R || py > H + R) continue;
    ctx.fillStyle = "rgba(18,16,14,0.68)";
    ctx.beginPath(); ctx.arc(px, py, R, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(95,82,68,0.55)"; ctx.lineWidth = Math.max(1, s * 0.35);
    ctx.beginPath(); ctx.arc(px, py, R * 0.85, 0, 7); ctx.stroke();
    const age = sim.time - c.t;
    if (age >= 0 && age < 6) {
      const smokeA = (1 - age / 6) * 0.35;
      ctx.fillStyle = `rgba(170,165,158,${smokeA.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(px + Math.sin(now / 300 + c.x) * s, py - age * s * 0.6, R * (0.5 + age * 0.12), 0, 7); ctx.fill();
    }
  }

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
      if (hov) label("Fuel depot: set it off during the battle (X)", px + r + 6, py);
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

  // Agents.
  const dot = Math.max(1, s * 0.3); // grains of sand: each person a speck
  const x0 = -cam.x / s - 1, y0 = -cam.y / s - 1, x1 = x0 + W / s + 2, y1 = y0 + H / s + 2;
  if (!glv.ok) {
    for (const [want, mut, color, sz] of [[CIV, 0, "#f5f1e6", dot], [SAFE_CIV, 0, "#9be7a8", dot], [INF, 0, "#ff3b3b", dot], [INF, 1, "#ff66d1", dot * 1.35]] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < sim.n; k++) {
        if (sim.state[k] !== want || (want === INF && (sim.mutant[k] === 1) !== (mut === 1))) continue;
        const ax = sim.ax[k], ay = sim.ay[k];
        if (ax < x0 || ay < y0 || ax > x1 || ay > y1) continue;
        ctx.rect(cam.x + ax * s - sz / 2, cam.y + ay * s - sz / 2, sz, sz);
      }
      ctx.fill();
    }
  }

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
    ctx.strokeStyle = "rgba(206,147,216,0.5)"; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(ox, oy, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const px = ox + Math.cos(o.angle) * R * 1.15, py = oy + Math.sin(o.angle) * R * 1.15;
    const gSp = SPRITE_CANVAS.gunship;
    if (gSp) { ctx.save(); ctx.translate(px, py); ctx.rotate(o.angle + Math.PI); spr(gSp, -12, -12, 24, 24); ctx.restore(); }
    label(`AC-130 ${Math.ceil(o.until - sim.time)}s`, px + 14, py - 10);
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
  if (nukeArm && tool === "nuke") { ctx.strokeStyle = "rgba(118,255,3,0.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cam.x + nukeArm[0] * s, cam.y + nukeArm[1] * s, C.NUKE_RADIUS * s, 0, 7); ctx.stroke(); }

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
  for (const u of sim.units) {
    const spec = C.UNITS[u.kind];
    const px = cam.x + (u.x + 0.5) * s, py = cam.y + (u.y + 0.5) * s;
    const hov = hover && Math.abs(hover[0] - u.x - 0.5) < 1.5 && Math.abs(hover[1] - u.y - 0.5) < 1.5;
    if (showRanges || hov || sim.phase === "plan") {
      ctx.strokeStyle = spec.color + (hov ? "cc" : "44"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, u.range * s, 0, 7); ctx.stroke();
    }
    if (u.shotT >= 0 && sim.time - u.shotT < 0.08) {
      ctx.strokeStyle = spec.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cam.x + u.shotX * s, cam.y + u.shotY * s); ctx.stroke();
    }
    const r = Math.max(5, s * 1.3);
    const uSp = SPRITE_CANVAS[u.kind];
    if ((u.deployT && u.deployT > 0) || u.extractT !== undefined) ctx.globalAlpha = 0.4;
    else if (u.ammo < 1) ctx.globalAlpha = 0.55;
    const model = hasModel(u.kind) && s >= MODEL_ZOOM, squad = hasSquad(u.kind) && s >= SQUAD_ZOOM;
    if (model || squad) {
      if (hov) { ctx.strokeStyle = spec.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r * 1.6, 0, 7); ctx.stroke(); }
      if (model) drawModel(ctx, u, px, py, s, frameDt, now);
      else drawSquad(ctx, u, px, py, s, u.ammo >= 1 ? spec.color : "#777", frameDt, sim.time);
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
    if (u.hp !== undefined && spec.mobile && spec.mobile.hp !== Infinity && u.hp < spec.mobile.hp) {
      const k = Math.max(0, u.hp / spec.mobile.hp);
      ctx.fillStyle = "#000"; ctx.fillRect(px - r, py - r - 6, 2 * r, 3);
      ctx.fillStyle = k > 0.5 ? "#7cfc9a" : k > 0.25 ? "#ffd54f" : "#ff5252"; ctx.fillRect(px - r, py - r - 6, 2 * r * k, 3);
    }
    if (u.ammo !== Infinity && u.ammo < spec.ammo) {
      const k = Math.max(0, u.ammo / spec.ammo);
      ctx.fillStyle = "#000"; ctx.fillRect(px - r, py + r + 3, 2 * r, 2.5);
      ctx.fillStyle = u.supplied ? "#ffb74d" : "#90caf9"; ctx.fillRect(px - r, py + r + 3, 2 * r * k, 2.5);
    }
    if (hov) {
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

  drawTransports(now, s);
  drawDev(now);
  updateInfoPanel();

  // Placement preview.
  if (hover && sim.phase !== "over" && (C.BUILDABLE as string[]).includes(tool)) {
    const kind = tool as C.UnitKind;
    const [hx, hy] = [Math.floor(hover[0]), Math.floor(hover[1])];
    const spec = C.UNITS[kind];
    const ok = !sim.canPlace(kind, hx, hy);
    const lvl = sim.map.height[sim.idx(hx, hy)];
    const range = (spec.range + spec.roofBonus * lvl) * (sim.hasActiveSupport("radio", hx, hy) ? C.RADIO_RANGE_MUL : 1);
    const cost = sim.unitCost(kind, hx, hy);
    ctx.strokeStyle = ok ? spec.color : "#ff4444"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(cam.x + (hx + 0.5) * s, cam.y + (hy + 0.5) * s, range * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    label(`${spec.name} ${C.money(cost)}${cost < spec.cost ? " (-20%)" : ""} · ${Math.round(range * C.CELL_M)} m${lvl ? ` · ${lvl} floors` : ""}`, cam.x + (hx + 1) * s + 8, cam.y + hy * s);
  } else if (hover && sim.phase !== "over" && isSupport(tool)) {
    const kind = tool;
    const [hx, hy] = [Math.floor(hover[0]), Math.floor(hover[1])];
    const spec = C.SUPPORTS[kind];
    const ok = !sim.canPlaceSupport(kind, hx, hy);
    const cost = sim.supportCost(kind, hx, hy);
    ctx.strokeStyle = ok ? spec.color : "#ff4444"; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(cam.x + (hx + 0.5) * s, cam.y + (hy + 0.5) * s, spec.radius * s, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    label(`${spec.name} ${C.money(cost)}${cost < spec.cost ? " (-20%)" : ""} · radius ${Math.round(spec.radius * C.CELL_M)} m`, cam.x + (hx + 1) * s + 8, cam.y + hy * s);
  }

  // Aiming an ability.
  if (hover && sim.phase === "battle" && isAbility(tool)) {
    const [hx, hy] = hover, col = C.ABILITIES[tool].color;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    if ((tool === "airstrike" || tool === "a10") && strikeStart) {
      let [ex, ey] = [hx, hy];
      const dx = ex - strikeStart[0], dy = ey - strikeStart[1], l = Math.hypot(dx, dy);
      if (l > C.AIRSTRIKE_LEN) { ex = strikeStart[0] + dx / l * C.AIRSTRIKE_LEN; ey = strikeStart[1] + dy / l * C.AIRSTRIKE_LEN; }
      ctx.globalAlpha = 0.3; ctx.lineWidth = C.AIRSTRIKE_RADIUS * 2 * s; ctx.setLineDash([]); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cam.x + strikeStart[0] * s, cam.y + strikeStart[1] * s); ctx.lineTo(cam.x + ex * s, cam.y + ey * s); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = "butt";
    } else {
      const R = tool === "firebomb" ? (sim.map.tile[sim.idx(hx | 0, hy | 0)] === PARK ? C.FIRE_RADIUS_PARK : C.FIRE_RADIUS) : tool === "para" ? C.UNITS.para.range : tool === "supply_drop" ? C.SUPPLY_DROP_RADIUS : tool === "barrage" ? C.BARRAGE_RADIUS : tool === "moab" ? C.MOAB_RADIUS : tool === "nuke" ? C.NUKE_RADIUS : tool === "cluster" ? C.CLUSTER_RADIUS : tool === "tomahawk" ? C.TOMAHAWK_RADIUS : tool === "gunship" ? C.GUNSHIP_RADIUS : tool === "a10" ? C.A10_WIDTH : C.AIRSTRIKE_RADIUS;
      ctx.beginPath(); ctx.arc(cam.x + hx * s, cam.y + hy * s, R * s, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

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
function drawTransports(now: number, s: number) {
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
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tr.angle);
    // Ground shadow offset
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(-r * 0.8 + 6, -r * 0.25 + 8, r * 1.6, r * 0.5);

    if (isDrone) {
      ctx.strokeStyle = "#ffb74d"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(-r, r); ctx.lineTo(r, -r); ctx.stroke();
      ctx.fillStyle = "#ffb74d"; ctx.fillRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7);
      ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 1;
      for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        ctx.beginPath(); ctx.arc(dx, dy, r * 0.45, 0, 7); ctx.stroke();
      }
    } else if (tr.kind === "helo_ch47") {
      // CH-47 Chinook tandem twin-rotor heavy-lift helo
      ctx.fillStyle = "#37474f"; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(-r * 1.15, -r * 0.34, r * 2.3, r * 0.68, r * 0.25); ctx.fill(); ctx.stroke();
      const rot = now / 28;
      for (const ox of [-r * 0.85, r * 0.85]) {
        ctx.strokeStyle = "rgba(220,235,245,0.45)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(ox, 0, r * 1.05, 0, 7); ctx.stroke();
        ctx.strokeStyle = "#eceff1"; ctx.lineWidth = 1.8;
        for (let b = 0; b < 3; b++) {
          const a = (ox < 0 ? -rot : rot) + (b * Math.PI * 2) / 3;
          ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox + Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02); ctx.stroke();
        }
      }
    } else if (isHelo) {
      // UH-60 Black Hawk tactical helicopter
      ctx.fillStyle = tr.kind === "helo_extract" ? "#455a64" : "#263238";
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.95, 0);
      ctx.lineTo(r * 0.35, -r * 0.32);
      ctx.lineTo(-r * 0.45, -r * 0.26);
      ctx.lineTo(-r * 1.25, -r * 0.08);
      ctx.lineTo(-r * 1.25, r * 0.08);
      ctx.lineTo(-r * 0.45, r * 0.26);
      ctx.lineTo(r * 0.35, r * 0.32);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Spinning 4-blade main rotor
      ctx.strokeStyle = "rgba(220,235,245,0.4)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 1.15, 0, 7); ctx.stroke();
      const rot = now / 25;
      ctx.strokeStyle = "#cfd8dc"; ctx.lineWidth = 1.6;
      for (let b = 0; b < 2; b++) {
        const a = rot + (b * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(r * 0.1 - Math.cos(a) * r * 1.1, -Math.sin(a) * r * 1.1);
        ctx.lineTo(r * 0.1 + Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
        ctx.stroke();
      }
    } else if (isJet) {
      // F-15E Strike Eagle swept-wing fighter with twin afterburners
      ctx.fillStyle = "#ff9100";
      ctx.beginPath(); ctx.moveTo(-r * 0.95, -r * 0.14); ctx.lineTo(-r * 1.65, 0); ctx.lineTo(-r * 0.95, r * 0.14); ctx.fill();
      ctx.fillStyle = "#37474f"; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 1.35, 0);
      ctx.lineTo(r * 0.25, -r * 0.22);
      ctx.lineTo(-r * 0.55, -r * 1.05);
      ctx.lineTo(-r * 0.85, -r * 1.05);
      ctx.lineTo(-r * 0.65, -r * 0.25);
      ctx.lineTo(-r * 1.0, -r * 0.42);
      ctx.lineTo(-r * 1.0, r * 0.42);
      ctx.lineTo(-r * 0.65, r * 0.25);
      ctx.lineTo(-r * 0.85, r * 1.05);
      ctx.lineTo(-r * 0.55, r * 1.05);
      ctx.lineTo(r * 0.25, r * 0.22);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      // C-130J Super Hercules 4-turboprop heavy airlifter
      ctx.fillStyle = "#37474f"; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.6;
      // Straight high wing
      ctx.beginPath(); ctx.roundRect(-r * 0.2, -r * 1.35, r * 0.52, r * 2.7, 2); ctx.fill(); ctx.stroke();
      // Tailplane
      ctx.beginPath(); ctx.roundRect(-r * 1.18, -r * 0.58, r * 0.28, r * 1.16, 2); ctx.fill(); ctx.stroke();
      // Fuselage
      ctx.beginPath(); ctx.roundRect(-r * 1.2, -r * 0.26, r * 2.35, r * 0.52, r * 0.24); ctx.fill(); ctx.stroke();
      // 4 spinning prop discs on the leading edge
      ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 1.4;
      for (const wy of [-r * 0.95, -r * 0.52, r * 0.52, r * 0.95]) {
        ctx.beginPath(); ctx.moveTo(r * 0.36, wy - r * 0.14); ctx.lineTo(r * 0.36, wy + r * 0.14); ctx.stroke();
      }
    }
    ctx.restore();
    if (tr.label && s > 1.1) label(tr.label, px + r + 5, py - 4);
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

let lastInfoHtml = "";
function setInfoPanel(html: string | null, accent = "#7cfc9a") {
  const box = $("infopanel");
  if (!html || mode !== "game" || !stack.every(() => false)) {
    if (!box.hidden) { box.hidden = true; lastInfoHtml = ""; }
    return;
  }
  box.hidden = false;
  box.style.borderLeftColor = accent;
  if (html !== lastInfoHtml) { box.innerHTML = html; lastInfoHtml = html; }
}

/** Info HTML for a tool: used by the picker detail column and by hovering a bottom-bar control (0.19). */
function toolInfoHtml(t: string): { html: string; accent: string } | null {
  const out = (html: string, accent = "#7cfc9a") => ({ html, accent });
  if ((C.BUILDABLE as string[]).includes(t)) {
    const k = t as C.UnitKind;
    const spec = C.UNITS[k], info = C.UNIT_INFO[k];
    const cost = sim.unitCost(k);
    const dps = Math.round(spec.damage * spec.rate);
    const activeCount = sim.units.filter(u => u.kind === k).length;
    const classKills = sim.units.filter(u => u.kind === k).reduce((a, u) => a + u.kills, 0);
    const placeStr = spec.on === "building" ? "Building Rooftop" : spec.on === "water" ? "River / Canal" : "Street / Park";
    const rangeStr = `${spec.minRange ? `${spec.minRange * C.CELL_M}-` : ""}${spec.range * C.CELL_M} m${spec.roofBonus ? ` (+${spec.roofBonus * C.CELL_M}m/flr)` : ""}`;
    const ammoStr = spec.ammo === Infinity ? "Unlimited" : `${spec.ammo.toLocaleString()} rds${spec.reloadsInZone ? " (∞ in Zone)" : ""}`;
    const spUrl = SPRITE_URL[k];
    return out(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}</span><span class="ip-cost">${C.money(cost)}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · ${placeStr}</div></div></div>` +
      `<div class="ip-desc">${info.desc}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Damage</span><b>${spec.damage.toLocaleString()}${spec.splash ? ` (${(spec.splash * C.CELL_M).toFixed(1)}m splash)` : ""}</b></div>` +
        `<div><span>Fire Rate</span><b>${spec.rate}/s (${dps.toLocaleString()} DPS)</b></div>` +
        `<div><span>Range</span><b>${rangeStr}</b></div>` +
        `<div><span>Ammo</span><b>${ammoStr}</b></div>` +
        `<div><span>Deployment</span><b>${spec.deploy}s (${info.transport.split(" ")[0]})</b></div>` +
        `<div><span>Struct. Dmg</span><b>${info.structDmg.split(" ")[0]}</b></div>` +
        (spec.mobile ? `<div><span>Armor / Speed</span><b>${spec.mobile.hp === Infinity ? "Invulnerable" : `${spec.mobile.hp} HP`} · ${(spec.mobile.speed * C.CELL_M).toFixed(1)}m/s</b></div>` : "") +
        (sim.phase !== "plan" ? `<div><span>Active / Kills</span><b>${activeCount} deployed · ${classKills.toLocaleString()} kills</b></div>` : "") +
      `</div>` +
      `<div class="ip-tags">${info.specials.map(s => `<div>${s}</div>`).join("")}</div>`,
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
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}</span><span class="ip-cost">${C.money(cost)}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · Safe Zone Building</div></div></div>` +
      `<div class="ip-desc">${spec.hint}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Effect Radius</span><b>${spec.radius * C.CELL_M} m</b></div>` +
        `<div><span>Deploy Time</span><b>${spec.deploy}s (${info.transport})</b></div>` +
        `<div style="grid-column:1/3"><span>Primary Effect</span><b>${info.effect}</b></div>` +
        (count > 0 ? `<div style="grid-column:1/3"><span>Active in Zone</span><b>${count} operational</b></div>` : "") +
      `</div>` +
      `<div class="ip-tags">${info.specials.map(s => `<div>${s}</div>`).join("")}</div>`,
      spec.color
    );
  }
  if (isAbility(t as Tool)) {
    const k = t as C.AbilityKind;
    const spec = C.ABILITIES[k];
    const hotkeys: Record<C.AbilityKind, string> = { airstrike: "Q", firebomb: "E", para: "F", supply_drop: "C", barrage: "T", moab: "-", nuke: "-", a10: "-", cluster: "-", tomahawk: "-", gunship: "-" };
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
      gunship: "AC-130J Ghostrider (40 s Orbit)",
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
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name} [${hotkeys[k]}]</span><span class="ip-cost">${C.money(spec.cost)} (${sim.charges[k]} ready)</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">Tactical Air Support · ${platforms[k]}</div></div></div>` +
      `<div class="ip-desc">${spec.hint}</div>` +
      `<div class="ip-grid">` +
        `<div><span>Arrival Delay</span><b>${spec.delay} s</b></div>` +
        `<div><span>Aircraft</span><b>${platforms[k].split(" (")[0]}</b></div>` +
        `<div style="grid-column:1/3"><span>Structure / Field Effect</span><b>${struct[k]}</b></div>` +
      `</div>`,
      spec.color
    );
  }
  if (t === "zone" || t === "gate" || t === "c4" || t === "depot" || t === "remove" || t === "pan" || t === "order" || t === "heatmap" || t === "closegates" || t === "clear") {
    const meta: Record<string, [string, string, string, string, SpriteKey]> = {
      zone: ["Safe Zone Perimeter [Z]", `${C.money(C.ZONE_BASE_COST)} base`, "Engineering · Quarantine Perimeter", "Click polygon corners around city blocks, then click the first corner (or press Enter) to close. Road crossings become guarded Gates; interior buildings can host Support Facilities.", "zone"],
      gate: ["Gate / Wall Toggle [G]", `${sim.gateMaxHp()} / ${sim.wallMaxHp()} HP`, "Fortification · Access Control", "Gates (blue, 3,000 HP) let fleeing civilians enter while blocking infected. Walls (white, 8,000 HP) block everyone and withstand 2.6x more punishment. Close gates once civilians are inside.", "gate"],
      c4: ["Bridge Demolition Charge [B]", `${C.money(C.C4_COST)}`, "Combat Engineering · River Denial", "Plant C4 charges on river bridges during planning or battle, then detonate during battle to drop the span into the river. Blocks standard infected (Swimmer mutants can still swim across).", "c4"],
      depot: ["Fuel Depot Detonation [X]", `${sim.depots.filter(d => !d.used).length} remaining`, "Environmental Hazard · Massive Blast", "Pre-existing industrial fuel tanks (orange triangles). Click during battle for a 22 m explosion (5,000 dmg) that levels adjacent buildings into rubble and ignites fires.", "depot"],
      remove: ["Remove / Helicopter Extraction", "100% Refund", "Logistics · Redeployment", "In Planning, removes a unit or support building immediately for a full refund. In Battle, dispatches an extraction helicopter (1.5x deploy time) to pull the unit out and refund its cost.", "remove"],
      order: ["Strike Order [O]", "Free", "Command & Control", "Click an APC, police or militia squad, paratroopers or a boat, then click a destination. The unit moves out, clears infected around that spot and holds it: guard an evac route or a road a horde comes in on.", "order"],
      pan: ["Move Map & Target Priority", "Left-Click Unit", "Command & Control", "Drag to pan the map, scroll wheel to zoom. Click any placed combat unit to cycle its target priority between Nearest, Wall Biters, and Infected Chasing Civilians.", "pan"],
      heatmap: ["Spatial Kill Heatmap [H]", `${sim.kills.toLocaleString()} kills`, "Battlefield Intelligence", "Overlays a smoothed thermal density map of every infected kill. Hover a unit in the picker during battle to isolate kills made by that unit class.", "heatmap"],
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

/** Populate the Tactical Hover Info Panel (#infopanel) from either a hovered sidebar button or a hovered map entity. */
function updateInfoPanel() {
  if (mode !== "game" || stack.length > 0) { setInfoPanel(null); return; }

  // 1. Bottom-bar control hover (the picker has its own detail column)
  if (hoverNavTool) { const i = toolInfoHtml(hoverNavTool); if (i) { setInfoPanel(i.html, i.accent); return; } }

  // 2. Map canvas hover: inspect placed units, support buildings, fuel depots, supply crates, or rubble/damaged structures
  if (!hover) { setInfoPanel(null); return; }
  const [hx, hy] = hover;
  const u = sim.units.find(u => Math.abs(u.x + 0.5 - hx) < 1.6 && Math.abs(u.y + 0.5 - hy) < 1.6);
  if (u) {
    const spec = C.UNITS[u.kind], info = C.UNIT_INFO[u.kind];
    const effRate = spec.rate * (u.rateMul ?? 1);
    const dps = Math.round(spec.damage * effRate);
    const status = u.extractT !== undefined ? `EXTRACTING (${Math.max(0, u.extractT).toFixed(1)}s)`
      : u.deployT && u.deployT > 0 ? `DEPLOYING (${u.deployT.toFixed(1)}s)`
      : u.ai ? u.ai.toUpperCase() : u.ammo < 1 ? "OUT OF AMMO" : "ACTIVE";
    const ammoCap = sim.mutators.has("supply_shortage") && spec.reloadsInZone && sim.unitInZone(u) ? spec.ammo * 2 : spec.ammo;
    const ammoPct = u.ammo === Infinity ? 100 : Math.min(100, Math.round((u.ammo / ammoCap) * 100));
    const ammoText = u.ammo === Infinity ? "Unlimited (In Safe Zone)" : `${Math.floor(u.ammo).toLocaleString()} / ${ammoCap.toLocaleString()} (${ammoPct}%)`;
    const hpPct = u.hp !== undefined && spec.mobile && spec.mobile.hp !== Infinity ? Math.max(0, Math.round((u.hp / spec.mobile.hp) * 100)) : null;
    const buffs: string[] = [];
    if (u.rangeBoosted) buffs.push("+40% Range (Radio Tower)");
    if (u.rateMul && u.rateMul > 1) buffs.push("+30% Fire Rate (Command Post)");
    if (u.supplied) buffs.push("Drone Resupply (Supply Depot)");
    const cellIdx = sim.idx(u.x | 0, u.y | 0);
    const flr = sim.map.height[cellIdx];
    if (spec.roofBonus && flr > 0) buffs.push(`+${Math.round(spec.roofBonus * flr * C.CELL_M)}m Elevation (${flr} floors)`);
    const spUrl = SPRITE_URL[u.kind];
    setInfoPanel(
      `<div class="ip-top">${spUrl ? `<img class="ip-portrait" src="${spUrl}" alt="" />` : ""}<div class="ip-meta"><div class="ip-head"><span class="ip-title">${spec.name}</span><span class="ip-cost">${status}</span></div>` +
      `<div class="ip-role" style="color:${spec.color}">${info.role} · Kills: ${u.kills.toLocaleString()}</div></div></div>` +
      `<div class="ip-grid">` +
        `<div><span>Eff. Range</span><b>${Math.round(u.range * C.CELL_M)} m</b></div>` +
        `<div><span>Fire Rate / DPS</span><b>${effRate.toFixed(1)}/s (${dps.toLocaleString()})</b></div>` +
        `<div><span>Damage</span><b>${spec.damage.toLocaleString()}${spec.splash ? ` (${(spec.splash * C.CELL_M).toFixed(1)}m)` : ""}</b></div>` +
        `<div><span>Target Mode</span><b>${C.TARGET_LABEL[u.mode ?? "near"]}</b></div>` +
        `<div style="grid-column:1/3"><span>Ammunition</span><b>${ammoText}</b></div>` +
      `</div>` +
      `<div class="ip-bar"><i style="width:${ammoPct}%;background:${u.supplied ? "#ffb74d" : "#4fc3f7"}"></i></div>` +
      (hpPct !== null ? `<div class="ip-grid"><div style="grid-column:1/3"><span>Hull / Squad Health</span><b>${Math.max(0, Math.round(u.hp!))} / ${spec.mobile!.hp} HP (${hpPct}%)</b></div></div><div class="ip-bar"><i style="width:${hpPct}%;background:${hpPct > 50 ? "#7cfc9a" : hpPct > 25 ? "#ffd54f" : "#ff5252"}"></i></div>` : "") +
      `<div class="ip-tags">${(buffs.length ? buffs : [info.specials[0]]).map(s => `<div>${s}</div>`).join("")}</div>`,
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

  // Inspect active Mass Transit Train, collapsed building rubble, damaged structures, Highways, or Mass Transit infrastructure under cursor
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

  const cx = hx | 0, cy = hy | 0;
  if (cx >= 0 && cy >= 0 && cx < sim.w && cy < sim.h) {
    const ci = sim.idx(cx, cy);
    if (sim.rubble[ci]) {
      setInfoPanel(
        `<div class="ip-head"><span class="ip-title">Collapsed Building Rubble</span><span class="ip-cost">-30% Speed</span></div>` +
        `<div class="ip-role" style="color:#ff8a65">Demolished Structure · Passable Debris</div>` +
        `<div class="ip-desc">Leveled by heavy ordnance. Blocks no line of sight, and ground infected stumbling through the rubble are slowed by 30%.</div>`,
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

  setInfoPanel(null);
}

// ---------- Sound events: read what changed in the sim since last frame ----------
const lastShot = new WeakMap<object, number>();
let soundSim: Sim | null = null, lastBlastT = -1, ambT = 0, lastCollapsed = 0, lastFires = 0;
const heardTransports = new WeakSet<object>(), ackedTransports = new WeakSet<object>();
function soundEvents() {
  if (sim !== soundSim) { soundSim = sim; lastBlastT = -1; lastCollapsed = sim.buildingsCollapsed; lastFires = sim.fires.length; }
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
  for (const b of sim.blasts) if (b.t > lastBlastT) {
    const [pan, near] = where(b.x, b.y);
    if (quiet) continue;
    const zb = zoomGain("boom", b.r, s); // 0.19.1: zoomed out, only the big blasts carry
    if (b.color === C.UNITS.apc.color && b.r < 2) snd.event("autocannon", pan, near, zoomGain("event", 0, s)); // the APC's 25 mm
    else if (b.color === C.UNITS.tank.color) { snd.event("tankgun", pan, near, zoomGain("event", 0, s)); snd.boom(b.r, pan, near, zb); } // 120 mm
    else if (b.r >= 1.2) snd.boom(b.r, pan, near, zb);
  }
  for (const b of sim.blasts) lastBlastT = Math.max(lastBlastT, b.t);
  if (!quiet) {
    if (sim.buildingsCollapsed > lastCollapsed) snd.event("collapse", 0, 0.8, zoomGain("boom", 5, s));
    for (const tr of sim.transports) if (!ackedTransports.has(tr)) {
      ackedTransports.add(tr); // order received: radio reply right away, even paused (not the automatic drones / evac lift)
      if (tr.kind !== "drone_supply" && tr.label !== "EVAC LIFT") snd.radio();
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
    if (!quiet && zoom > 0.45 && nearInf >= 0 && Math.random() < 0.25) { const [pan] = where(sim.ax[nearInf], sim.ay[nearInf]); snd.event("zombie", pan, zoom); }
    if (!quiet && zoom > 0.45 && nearCiv >= 0 && Math.random() < 0.15) { const [pan] = where(sim.ax[nearCiv], sim.ay[nearCiv]); snd.event("scream", pan, zoom * 0.8); }
    snd.ambience(horde, fire, quiet ? 0.2 : zoom, quiet ? 0 : panic, !quiet && sim.phase === "battle" && !sim.outbreak && sim.time < SIREN_S, !quiet && sim.phase === "battle");
  }
}
function applyVolumes() {
  const v = save.settings.vol ?? { master: 0.8, sfx: 0.8, music: 0.5 };
  snd.setVolumes(v.master, v.sfx, v.music);
}

// ---------- Loop ----------
let acc = 0, last = performance.now(), drawErrors = 0, slowWarned = 0, slowTipShown = false;
function frame(now: number) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  // keyboard panning
  const pan = 600 * real * devicePixelRatio;
  if (keys.has("a") || keys.has("arrowleft")) cam.x += pan;
  if (keys.has("d") || keys.has("arrowright")) cam.x -= pan;
  if (keys.has("w") || keys.has("arrowup")) cam.y += pan;
  if (keys.has("s") || keys.has("arrowdown")) cam.y -= pan;
  if (mode === "game" && !stack.length && save.settings.edgeScroll && mouse && document.hasFocus()) {
    const m = 6;
    if (mouse[0] <= m) cam.x += pan; else if (mouse[0] >= innerWidth - 1 - m) cam.x -= pan;
    if (mouse[1] <= m) cam.y += pan; else if (mouse[1] >= innerHeight - 1 - m) cam.y -= pan;
  }
  if (mode === "attract") {
    // The title screen: a city with no safe zone falls; start another one after a while.
    acc += real * 2;
    let n = 0;
    while (acc >= C.DT && n++ < 4) { sim.step(C.DT); acc -= C.DT; }
    if (n >= 4) acc = 0;
    if (sim.phase !== "battle" || sim.time > 170) { seed = Math.floor(Math.random() * 1e9); sim = new Sim(seed); sim.startBattle(); buildBase(); buildZone(); fitCamera(); }
  } else if (sim.phase === "battle" && speed) {
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
  try { draw(now); hud(now); } catch (err) {
    if (drawErrors++ < 5) log("error", "frame-error", { stack: String((err as Error)?.stack ?? err), phase: sim.phase, t: sim.time });
  }
  if (mode === "game") {
    perf.frame(real * 1000);
    if (now - d0 > 100 && slowWarned++ < 20) log("warn", "slow-draw", { ms: Math.round(now - d0 + (performance.now() - now)), zoom: +cam.scale.toFixed(2) });
    if (perf.due(now)) {
      const fps = perf.frames / ((now - perf.since) / 1000);
      if (fps < 24 && sim.civN > C.CIVILIANS && !slowTipShown) { slowTipShown = true; notify("The game is running slowly on this PC. A smaller crowd size in Settings will help."); }
      const c = sim.counts(); perf.report(now, { crowd: sim.civN, phase: sim.phase, speed, t: +sim.time.toFixed(0), agents: c.civ + c.safe + c.inf, inf: c.inf, zoom: +cam.scale.toFixed(2) }); }
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
const PICKER_TOOLS = new Set(Object.values(catTools).flat());
const catOf = (t: string) => Object.keys(catTools).find(c => catTools[c].includes(t)) ?? null;
let pickerCat: string | null = null;
const pickerSel: Record<string, string> = {};
function sellAbility(k: C.AbilityKind) { if (sim.sellAbility(k)) { say(`Sold a ${C.ABILITIES[k].name.toLowerCase()}.`, 2000); refreshUi(); } }
function pickerRow(t: string) {
  const c = toolCard(t)!, img = c.querySelector("img")?.getAttribute("src") ?? "";
  const name = c.querySelector(".tc-name")?.textContent ?? toolName(t), sm = c.querySelector("small")?.textContent ?? "";
  const hk = c.querySelector(".hk")?.textContent;
  const u = (C.UNITS as Record<string, C.UnitSpec | undefined>)[t];
  const range = u ? ` · ${u.minRange ? `${u.minRange * C.CELL_M}-` : ""}${u.range * C.CELL_M} m` : "";
  const cls = ["prow", c.classList.contains("locked") ? "locked" : "", c.disabled ? "off" : "", pickerSel[pickerCat!] === t ? "sel" : "", tool === t ? "on" : ""].join(" ");
  return `<div class="${cls}" data-ptool="${t}"><img src="${img}" alt="" draggable="false"><div><b>${name}${hk ? ` <span class="hk">${hk}</span>` : ""}</b><small>${sm}${range}</small></div></div>`;
}
function renderPickerDetail() {
  if (!pickerCat) return;
  const t = pickerSel[pickerCat], i = t ? toolInfoHtml(t) : null, d = document.getElementById("pdetail");
  if (!d) return;
  d.style.borderLeftColor = i?.accent ?? "#7cfc9a";
  const locked = t && !isOpen(t) ? `<div class="plock">Unlocks at ${P.UNLOCK_XP[t].toLocaleString()} XP. You have ${(save.xp ?? 0).toLocaleString()}.</div>` : "";
  const how = t && isAbility(t as Tool)
    ? (sim.phase === "plan" ? "Click to buy a charge, right-click to sell one back. Drag to the quick bar." : "Click to use it (buys one if none are left). Drag to the quick bar.")
    : "Click to place it on the map. Drag to the quick bar.";
  d.innerHTML = (i?.html ?? "") + locked + `<div class="phow">${how}</div>`;
}
function renderPicker() {
  const box = $("picker");
  if (!pickerCat) { box.hidden = true; return; }
  pickerSel[pickerCat] ??= catTools[pickerCat][0];
  box.hidden = false;
  box.innerHTML = `<div class="plist"><h3>${pickerCat}</h3>${catTools[pickerCat].map(pickerRow).join("")}</div><div id="pdetail"></div><button class="pclose" title="Esc">✕</button>`;
  renderPickerDetail();
}
function openPicker(cat: string | null) {
  pickerCat = cat && catTools[cat] ? cat : null;
  if (!pickerCat) hoverUnitHeatmap = null;
  document.querySelectorAll<HTMLButtonElement>("#classes button").forEach(b => b.classList.toggle("on", b.dataset.cat === pickerCat));
  renderPicker();
}
/** setTool() calls this: highlight the row if its class is open; never opens the picker by itself. */
function openCatFor(t: string) {
  if (pickerCat && catOf(t) === pickerCat) { pickerSel[pickerCat] = t; renderPicker(); }
}
function pickTool(t: string) {
  if (isAbility(t as Tool)) {
    const k = t as C.AbilityKind;
    abilityButton(k);
    if (sim.phase === "battle" && tool === k) openPicker(null); // buying in planning keeps it open
    else renderPicker();
    return;
  }
  setTool(t as Tool);
  if (tool === t) openPicker(null);
}
document.querySelectorAll<HTMLButtonElement>("#classes button").forEach(b => b.addEventListener("click", () => openPicker(pickerCat === b.dataset.cat ? null : b.dataset.cat!)));
{
  const box = $("picker");
  box.addEventListener("pointerover", e => {
    const r = (e.target as HTMLElement).closest<HTMLElement>(".prow"); if (!r || !pickerCat) return;
    const t = r.dataset.ptool!;
    hoverUnitHeatmap = (C.BUILDABLE as string[]).includes(t) && sim.phase !== "plan" ? t as C.UnitKind : null;
    if (pickerSel[pickerCat] === t) return;
    pickerSel[pickerCat] = t;
    box.querySelectorAll(".prow").forEach(x => x.classList.toggle("sel", x === r));
    renderPickerDetail();
  });
  box.addEventListener("pointerleave", () => { hoverUnitHeatmap = null; });
  box.addEventListener("click", e => {
    if ((e.target as HTMLElement).closest(".pclose")) { openPicker(null); return; }
    const r = (e.target as HTMLElement).closest<HTMLElement>(".prow");
    if (r && !dragJustEnded()) pickTool(r.dataset.ptool!);
  });
  box.addEventListener("contextmenu", e => {
    e.preventDefault();
    const r = (e.target as HTMLElement).closest<HTMLElement>(".prow");
    if (r && isAbility(r.dataset.ptool as Tool)) { sellAbility(r.dataset.ptool as C.AbilityKind); renderPicker(); }
  });
  box.addEventListener("wheel", e => e.stopPropagation());
}
let dragEndT = 0;
const dragJustEnded = () => performance.now() - dragEndT < 50;

// ---- Quick bar (0.19): 9 slots the player fills by dragging from the picker. Saved in save.json. ----
let quick: Slots = cleanQuickbar(save.settings.quickbar, t => PICKER_TOOLS.has(t));
var quickReady = true; // var: refreshUi() can run before this line during startup; it skips the bar until then
function storeQuickbar() { save.settings.quickbar = quick; Save.store(save); }
function renderQuickbar() {
  if (!quickReady) return;
  document.querySelectorAll<HTMLButtonElement>("#quickbar .qslot").forEach(b => {
    const t = quick[Number(b.dataset.slot)], c = t ? toolCard(t) : null;
    b.classList.toggle("full", !!c);
    b.classList.toggle("locked", !!c && (c.classList.contains("locked") || c.disabled));
    b.classList.toggle("on", !!t && tool === t);
    const html = c ? `<img src="${c.querySelector("img")?.getAttribute("src") ?? ""}" alt="" draggable="false"><small>${c.querySelector("small")?.textContent ?? ""}</small>` : "";
    if (b.innerHTML !== html) b.innerHTML = html;
    b.title = t ? toolName(t) : "Drag a unit here from the picker";
  });
}
function useSlot(i: number) {
  const t = quick[i];
  if (!t) return;
  if (isAbility(t as Tool)) abilityButton(t as C.AbilityKind); else setTool(t as Tool);
  renderQuickbar();
}
document.querySelectorAll<HTMLButtonElement>("#quickbar .qslot").forEach(b => {
  const i = Number(b.dataset.slot);
  b.addEventListener("click", () => { if (!dragJustEnded()) useSlot(i); });
  b.addEventListener("contextmenu", e => { e.preventDefault(); const t = quick[i]; if (t && isAbility(t as Tool)) { sellAbility(t as C.AbilityKind); renderQuickbar(); } });
});
// Drag: from a picker row (put it in a slot) or from a slot (swap, or drop off the bar to clear). Pointer events, so
// the browser and the Windows app behave the same. A drag never counts as a click.
{
  let drag: { t: string; from: number | null; x: number; y: number; ghost: HTMLImageElement | null } | null = null;
  const slotAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("#quickbar .qslot") ?? null;
  addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    const row = el.closest<HTMLElement>("#picker .prow"), slot = el.closest<HTMLElement>("#quickbar .qslot");
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
  } else b.addEventListener("click", () => setTool(t));
  b.addEventListener("pointerenter", () => {
    hoverNavTool = t;
    if ((C.BUILDABLE as string[]).includes(t) && sim.phase !== "plan") hoverUnitHeatmap = t as C.UnitKind;
  });
  b.addEventListener("pointerleave", () => {
    if (hoverNavTool === t) hoverNavTool = null;
    if (hoverUnitHeatmap === t) hoverUnitHeatmap = null;
  });
});
for (const [id, key] of [["heatmapbtn", "heatmap"], ["closegates", "closegates"], ["clear", "clear"]] as const) {
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
$("end-heatmap").addEventListener("click", () => { showHeatmap = true; $("end").hidden = true; refreshUi(); say("Showing kill heatmap. Press H or Menu when done.", 5000); });
$("closegates").addEventListener("click", () => { const n = sim.closeAllGates(); buildZone(); log("info", "close-all-gates", { closed: n, t: +sim.time.toFixed(1), phase: sim.phase }); say(n ? "All gates closed." : "No open gates left."); });
$("clear").addEventListener("click", () => { if (sim.phase === "plan") { sim.clearZone(); draft = []; buildZone(); refreshUi(); } });
$("end-retry").addEventListener("click", () => newSim(true));
$("end-continue").addEventListener("click", () => { $("end").hidden = true; speed = pausedSpeed || 1; log("info", "round-continue", { t: +sim.time.toFixed(1) }); refreshUi(); });
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
$("p-withdraw").addEventListener("click", () => {
  if (sim.phase !== "battle") { resume(); return; }
  log("info", "withdraw", { t: +sim.time.toFixed(1), evacuated: sim.evacuated });
  sim.withdraw(); resume();
});
$("p-title").addEventListener("click", () => { log("info", "quit-to-menu", { phase: sim.phase, t: +sim.time.toFixed(1) }); startAttract(); });
const quitDesktop = () => { log("info", "quit-to-desktop", { mode, phase: sim.phase }); Save.desktop?.quit(); };
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
$("opt-ranges").addEventListener("change", e => { save.settings.showRanges = showRanges = (e.target as HTMLInputElement).checked; Save.store(save); });

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
$("opt-dev").addEventListener("change", e => { save.settings.devMode = (e.target as HTMLInputElement).checked; Save.store(save); log("info", "setting", { devMode: save.settings.devMode }); syncDev(); });
$("devbtn").addEventListener("click", toggleDevPanel);
document.querySelectorAll<HTMLButtonElement>("[data-dspeed]").forEach(b => b.addEventListener("click", () => { setSpeed(Number(b.dataset.dspeed)); devLog("speed", { speed }); }));
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

resize();
applyVolumes();
log("info", "app-start", { version: C.VERSION, renderer: glv.ok ? "webgl" : "2d", desktop: !!Save.desktop, screen: [screen.width, screen.height], window: [innerWidth, innerHeight], dpr: devicePixelRatio, ua: navigator.userAgent, cores: navigator.hardwareConcurrency, settings: save.settings, citiesWon: Object.keys(save.best).length });
applyFullscreen();
setTool("zone");
startAttract();
requestAnimationFrame(frame);

// Exposed for automated checks.
(window as any).horde = { get sim() { return sim; }, get mode() { return mode; }, get save() { return save; }, recentLog, click, closeDraft, startBattle, setTool, setSpeed, cam, playCity, startAttract, pause, resume };
