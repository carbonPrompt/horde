// 0.57: headless check of the battle record. Plays Fairhaven in headless Chrome (shot mode, Slot 1), ends the
// round, and prints the record the page built and the history it stored. With --shots <dir>, also saves the end
// report's tabs as PNGs. Usage: bun build.ts && bun tools/recordcheck.ts [--shots dir]
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CdpClient } from "./shots/cdp";

const ROOT = new URL("..", import.meta.url).pathname;
const shotsDir = process.argv[2] === "--shots" ? process.argv[3] : null;
const port = 9800 + Math.floor(Math.random() * 100), prof = mkdtempSync(join(tmpdir(), "reccheck-"));
const chrome = Bun.spawn(["google-chrome", "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--mute-audio",
  "--window-size=1600,900", "about:blank"], { stdout: "ignore", stderr: "ignore" });
try {
  let ws = "";
  for (let i = 0; i < 100 && !ws; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]; ws = t.find(x => x.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* starting */ } if (!ws) await Bun.sleep(100); }
  const cdp = await CdpClient.connect(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = "file://" + join(ROOT, "dist/horde.html") + "?shots=1";
  const ready = async () => { for (let i = 0; i < 150 && !(await cdp.eval("!!(window.hordeShot && document.readyState === 'complete')")); i++) await Bun.sleep(100); };
  await cdp.send("Page.navigate", { url }); await ready();
  await cdp.eval(`localStorage.setItem("horde.slots", JSON.stringify({ active: 1 })); true`);
  await cdp.send("Page.navigate", { url }); await ready();
  const ops = ["zone 165,82 217,82 217,130 165,130", "gate 217,98", "place sniper 186,78", "place garrison 172,78", "place turret 178,72", "place evac 191,106", "ability airstrike", "battle"];
  await cdp.eval(`hordeShot.load("fairhaven", 101, 600); hordeShot.run(${JSON.stringify(ops)}); true`);
  for (let i = 0; i < 24; i++) await cdp.eval(`hordeShot.step(10); true`);
  await cdp.eval(`horde.sim.endRoundNow(); hordeShot.step(0.5); true`);
  await Bun.sleep(1500);
  const rec = await cdp.eval(`JSON.stringify(horde.lastRecord)`);
  if (!rec || rec === "null") throw new Error("no record after the round ended");
  const r = JSON.parse(rec);
  const units = r.units.reduce((n: number, u: any) => n + u.kills, 0), strikes = r.strikes.reduce((n: number, s: any) => n + s.kills, 0);
  const other = Object.values(r.other).reduce((n: number, v: any) => n + v, 0) as number;
  console.log(JSON.stringify({ id: r.meta.id, kind: r.meta.kind, city: r.meta.cityName, roundComplete: r.outcome.roundComplete, medal: r.outcome.medal, saved: r.totals.saved,
    kills: r.totals.kills, bucketSum: units + strikes + other, samples: r.samples?.t.length, events: r.events?.t.length, stories: r.town?.stories.length, paragraph: r.town?.paragraph }, null, 1));
  if (r.town?.stories?.length) console.log("first story:", r.town.stories[0].title, "|", r.town.stories[0].text);
  const hist = await cdp.eval(`new Promise(res => { const q = indexedDB.open("horde", 2); q.onsuccess = () => { const g = q.result.transaction("history").objectStore("history").get(1); g.onsuccess = () => res(g.result ? JSON.parse(g.result).battles.length : 0); g.onerror = () => res(-1); }; q.onerror = () => res(-2); })`);
  const career = await cdp.eval(`JSON.stringify(horde.save.career ? { battles: horde.save.career.battles, saved: horde.save.career.saved, kills: horde.save.career.kills } : null)`);
  console.log("history battles in slot 1:", hist, " career:", career);
  if (shotsDir) {
    const tabs = await cdp.eval(`JSON.stringify([...document.querySelectorAll("#end [data-tab]")].map(b => b.dataset.tab))`);
    for (const t of JSON.parse(tabs ?? "[]") as string[]) {
      await cdp.eval(`document.querySelector('#end [data-tab="${t}"]').click(); true`); await Bun.sleep(400);
      const png = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shotsDir, `end-${t}.png`), Buffer.from(png.data, "base64")); console.log("shot", t);
    }
  }
  // review I4: after End here, the heatmap button must keep the report closed until Menu
  await cdp.eval(`document.getElementById("end-stop").click(); true`); await Bun.sleep(800);
  await cdp.eval(`document.getElementById("end-heatmap").click(); true`); await Bun.sleep(1200);
  const hidden = await cdp.eval(`document.getElementById("end").hidden`);
  await cdp.eval(`horde.pause(); true`); await Bun.sleep(800);
  const back = await cdp.eval(`!document.getElementById("end").hidden`);
  const recs = await cdp.eval(`new Promise(res => { const q = indexedDB.open("horde", 2); q.onsuccess = () => { const g = q.result.transaction("history").objectStore("history").get(1); g.onsuccess = () => res(g.result ? JSON.parse(g.result).battles.length : 0); }; })`);
  console.log(`heatmap keeps the report closed: ${hidden} · Menu brings it back: ${back} · history battles after End here: ${recs}`);
  if (!hidden || !back) process.exitCode = 1;
  cdp.close();
} finally { chrome.kill(); rmSync(prof, { recursive: true, force: true }); }
