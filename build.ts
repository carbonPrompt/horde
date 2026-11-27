// Builds dist/horde.html: one self-contained file (no server, no internet needed).
// The same file runs in a browser and inside the Windows app (desktop/).
import { VERSION } from "./src/config";
const out = await Bun.build({ entrypoints: ["src/main.ts"], minify: true, target: "browser" });
if (!out.success) { console.error(out.logs); process.exit(1); }
const js = await out.outputs[0].text();
// Music: assets/music/title.ogg + battle-1..4.ogg (Ogg Opus), embedded as data URLs when present.
const music: Record<string, string> = {};
for (const t of ["title", "battle-1", "battle-2", "battle-3", "battle-4"]) {
  const f = Bun.file(`assets/music/${t}.ogg`);
  if (await f.exists()) music[t] = "data:audio/ogg;base64," + Buffer.from(await f.arrayBuffer()).toString("base64");
}
// Sound effects: assets/sfx/*.ogg, embedded as data URLs (names = file stems; see src/audio.ts).
const sfx: Record<string, string> = {};
for (const f of new Bun.Glob("assets/sfx/*.ogg").scanSync(".")) sfx[f.replace(/^.*[\\/]/, "").replace(/\.ogg$/, "")] = "data:audio/ogg;base64," + Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64");
// Sprites: assets/sprites/<key>.png (64 px pixel art from tools/pixelate.py), embedded as data URLs.
const sprites: Record<string, string> = {};
for (const f of new Bun.Glob("assets/sprites/*.png").scanSync(".")) sprites[f.replace(/^.*[\\/]/, "").replace(/\.png$/, "")] = "data:image/png;base64," + Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64");
// 0.47: Codex pictures and clips: assets/codex/<id>.png|webm (made by tools/shots/run.ts), embedded as data URLs.
const codex: Record<string, string> = {};
for (const f of new Bun.Glob("assets/codex/*.{png,webm}").scanSync(".")) {
  const id = f.replace(/^.*[\\/]/, "").replace(/\.(png|webm)$/, ""), mime = f.endsWith(".webm") ? "video/webm" : "image/png";
  codex[id] = `data:${mime};base64,` + Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64");
}
const icon = Buffer.from(await Bun.file("desktop/favicon.png").arrayBuffer()).toString("base64");
const html = (await Bun.file("index.html").text())
  .replace("<title>Horde</title>", `<title>Horde</title>\n<link rel="icon" href="data:image/png;base64,${icon}">`)
  .replace("/*BUNDLE*/", () => js.replace(/<\/script/g, "<\\/script"))
  .replace("/*MUSIC*/", () => `window.HORDE_MUSIC = ${JSON.stringify(music)}; window.HORDE_SFX = ${JSON.stringify(sfx)}; window.HORDE_SPRITES = ${JSON.stringify(sprites)}; window.HORDE_CODEX = ${JSON.stringify(codex)};`);
await Bun.write("dist/horde.html", html);
// Keep the Windows app's version in step with the game's.
const pkg = await Bun.file("desktop/package.json").json();
if (pkg.version !== VERSION) { pkg.version = VERSION; await Bun.write("desktop/package.json", JSON.stringify(pkg) + "\n"); }
console.log(`dist/horde.html ${(html.length / 1024).toFixed(0)} KB, v${VERSION}, ${Object.keys(sfx).length} sounds, ${Object.keys(sprites).length} sprites, ${Object.keys(codex).length} codex media`);
