// 0.47: takes the Codex pictures and clips. Builds the game, opens dist/horde.html?shots=1 in headless Chrome, runs
// each recipe through window.hordeShot, encodes with ffmpeg and writes assets/codex/<id>.png|webm + manifest.json.
//   bun tools/shots/run.ts             reshoot what is missing or stale (and drop orphans)
//   bun tools/shots/run.ts --list      say what is stale and why
//   bun tools/shots/run.ts --all       reshoot everything
//   bun tools/shots/run.ts --id <id>   reshoot one
//   bun tools/shots/run.ts --changelog <version>   Codex entries new or changed in that version (release notes)
// Build-machine tools only: google-chrome and ffmpeg. Nothing here ships in the game.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VERSION } from "../../src/config";
import { allEntries } from "../../src/codex";
import { recipeHash, staleReport, mediaFile, type Recipe, type ManifestRow } from "./stale";

export interface Cdp { send(method: string, params?: object): Promise<any>; eval(expression: string, timeoutMs?: number): Promise<any> }

const FPS = 15;
const ROOT = resolve(import.meta.dir, "../..");
const sh = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" }); // build.ts reads src/ relative to the repo root
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${p.stderr.toString().slice(-400)}`);
};
/** 0.47.1: copy next to the target, then rename over it, so a crash never leaves half a picture in assets/codex.
 * (A plain rename can't cross disks: tmp and assets may be on different ones.) */
export function atomicCopy(src: string, dst: string) {
  const part = `${dst}.part`;
  try { copyFileSync(src, part); renameSync(part, dst); } finally { rmSync(part, { force: true }); }
}
const frames2 = "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))";

async function capture(cdp: Cdp, r: Recipe, file: string) {
  const clip = r.crop ? { x: r.crop[0], y: r.crop[1], width: r.crop[2], height: r.crop[3], scale: 1 } : undefined;
  const res = await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
  writeFileSync(file, Buffer.from(res.data, "base64"));
}

/** Runs one recipe on an already-open page; returns its manifest row. Writes into outDir only at the very end. */
export async function runRecipe(cdp: Cdp, r: Recipe, outDir: string, pageUrl = ""): Promise<ManifestRow> {
  const tmp = mkdtempSync(join(tmpdir(), `shot-${r.id}-`));
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: r.size[0], height: r.size[1], deviceScaleFactor: 1, mobile: false });
    if (pageUrl) {
      await cdp.send("Page.navigate", { url: pageUrl });
      for (let i = 0; i < 100 && !(await cdp.eval("!!(window.hordeShot && document.readyState === 'complete')")); i++) await Bun.sleep(100);
    }
    const J = JSON.stringify;
    await cdp.eval(`hordeShot.load(${J(r.city)}, ${r.seed}, ${r.startMin}, ${J(r.mutators ?? [])}); hordeShot.run([${J(`camera ${r.camera.x},${r.camera.y} ${r.camera.scale}`)}]); hordeShot.run(${J(r.setup)}); ${frames2}`, 300000); // 0.58: a setup can play two battles
    const out = join(outDir, mediaFile(r).replace(/^assets\/codex\//, ""));
    if (r.kind === "shot") {
      const raw = join(tmp, "raw.png"), small = join(tmp, "small.png");
      await capture(cdp, r, raw);
      sh(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-vf", "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none", small]);
      mkdirSync(outDir, { recursive: true }); atomicCopy(small, out);
    } else {
      let n = 0;
      const shoot = async () => { await capture(cdp, r, join(tmp, `f${String(n++).padStart(4, "0")}.png`)); };
      const tick = async () => { await cdp.eval(`hordeShot.step(${1 / FPS}); ${frames2}`); await shoot(); };
      await shoot();
      for (const line of r.action ?? []) {
        const m = line.match(/^advance\s+([\d.]+)$/);
        if (m) for (let i = Math.round(Number(m[1]) * FPS); i > 0; i--) await tick();
        else { await cdp.eval(`hordeShot.run(${J([line])}); ${frames2}`); await shoot(); }
      }
      while (n < Math.round((r.seconds ?? 4) * FPS)) await tick();
      const webm = join(tmp, "out.webm");
      sh(["ffmpeg", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(tmp, "f%04d.png"),
        "-vf", "scale=800:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "47", "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", webm]); // under 400 KB
      mkdirSync(outDir, { recursive: true }); atomicCopy(webm, out);
    }
    const cw = r.crop ? r.crop[2] : r.size[0], ch = r.crop ? r.crop[3] : r.size[1];
    const w = r.kind === "clip" ? 800 : cw, h = r.kind === "clip" ? 2 * Math.round(ch * 800 / cw / 2) : ch; // clips are scaled to 800 wide
    return { version: VERSION, rev: r.rev, recipeHash: recipeHash(r), bytes: statSync(out).size, w, h };
  } catch (e) {
    throw new Error(`recipe ${r.id}: ${(e as Error).message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- CLI ----------
async function main() {
  const { RECIPES } = await import("./recipes");
  const { CdpClient } = await import("./cdp");
  const args = process.argv.slice(2), dir = join(ROOT, "assets/codex"), mfile = join(dir, "manifest.json");
  const manifest: Record<string, ManifestRow> = existsSync(mfile) ? JSON.parse(readFileSync(mfile, "utf8")) : {};
  const exists = (f: string) => existsSync(join(ROOT, f));
  const report = staleReport(RECIPES, manifest, allEntries(), exists);
  if (args[0] === "--changelog") {
    const v = args[1] ?? VERSION;
    for (const e of allEntries()) if (e.since === v || e.updated === v) console.log(`- **${e.title}**${e.since === v ? " (new)" : ""}: ${e.summary}`);
    return;
  }
  if (args[0] === "--list") { for (const x of report) console.log(`${x.id}\t${x.why}`); if (!report.length) console.log("Codex media is up to date."); return; }
  // orphans: delete their files and rows
  for (const x of report.filter(x => x.why === "orphan")) {
    for (const ext of ["png", "webm"]) { const f = join(dir, `${x.id}.${ext}`); if (existsSync(f)) unlinkSync(f); }
    delete manifest[x.id]; console.log(`removed orphan ${x.id}`);
  }
  const todo = args[0] === "--all" ? RECIPES : args[0] === "--id" ? RECIPES.filter(r => r.id === args[1])
    : RECIPES.filter(r => report.some(x => x.id === r.id && x.why !== "orphan"));
  if (args[0] === "--id" && !todo.length) throw new Error(`no recipe ${args[1]}`);
  if (!todo.length) { writeFileSync(mfile, JSON.stringify(sortKeys(manifest), null, 1) + "\n"); console.log("Nothing to shoot."); return; }
  sh(["bun", join(ROOT, "build.ts")]);
  const port = 9300 + Math.floor(Math.random() * 500), prof = mkdtempSync(join(tmpdir(), "shots-chrome-"));
  const chrome = Bun.spawn(["google-chrome", "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    "--no-first-run", "--mute-audio", "--hide-scrollbars", "--window-size=960,540", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let failed = 0;
  try {
    let ws = "";
    for (let i = 0; i < 100 && !ws; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]; ws = t.find(x => x.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* starting */ } if (!ws) await Bun.sleep(100); }
    if (!ws) throw new Error("headless Chrome did not start");
    const cdp = await CdpClient.connect(ws);
    await cdp.send("Page.enable");
    const url = "file://" + join(ROOT, "dist/horde.html") + "?shots=1";
    for (const r of todo) {
      const t0 = performance.now();
      try {
        manifest[r.id] = await runRecipe(cdp, r, dir, url);
        console.log(`${r.id}\t${(manifest[r.id].bytes / 1024).toFixed(0)} KB\t${((performance.now() - t0) / 1000).toFixed(1)} s`);
      } catch (e) { failed++; console.error(String((e as Error).message)); }
      writeFileSync(mfile, JSON.stringify(sortKeys(manifest), null, 1) + "\n");
      if (cdp.closed || chrome.exitCode !== null) { // 0.47.1: Chrome died; the rest would only time out one by one
        const left = todo.length - todo.indexOf(r) - 1; failed += left;
        console.error(`headless Chrome stopped; ${left} recipe(s) not shot. Run again to finish.`); break;
      }
    }
    cdp.close();
  } finally {
    chrome.kill(); rmSync(prof, { recursive: true, force: true });
  }
  if (failed) { console.error(`${failed} recipe(s) failed`); process.exit(1); }
}
const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

if (import.meta.main) main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
