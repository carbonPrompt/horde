// Horde for Windows: a plain Electron window around the same single-file game the browser build uses.
const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;

// ---------- Log file: %APPDATA%\Horde\logs\horde-YYYY-MM-DD.log, newest 14 kept ----------
const fs = require("fs");
const os = require("os");
const logDir = () => path.join(app.getPath("userData"), "logs");
function writeLog(line) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    fs.appendFileSync(path.join(logDir(), `horde-${new Date().toISOString().slice(0, 10)}.log`), String(line).slice(0, 20000) + "\n");
  } catch { /* disk full or locked: the game keeps running */ }
}
const mlog = (level, event, data) => writeLog(`${new Date().toISOString()} ${level.padEnd(5)} main:${event}${data ? " " + JSON.stringify(data) : ""}`);
function pruneLogs() {
  try {
    const files = fs.readdirSync(logDir()).filter(f => /^horde-.*\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(logDir(), f));
  } catch { /* no folder yet */ }
}
process.on("uncaughtException", err => mlog("ERROR", "uncaught-exception", { stack: String(err && err.stack || err) }));
process.on("unhandledRejection", err => mlog("ERROR", "unhandled-rejection", { reason: String(err && err.stack || err) }));

function create() {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 640,
    backgroundColor: "#0d0f12", title: "Horde", icon: path.join(__dirname, "icon.ico"),
    show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.removeMenu(); // also drops the reload / dev tools shortcuts
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.once("ready-to-show", () => { if (!win.isFullScreen()) win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, "horde.html"));
  const wc = win.webContents;
  wc.on("render-process-gone", (_e, d) => { mlog("ERROR", "renderer-gone", d); if (d.reason !== "clean-exit") setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000); });
  wc.on("did-fail-load", (_e, code, desc) => mlog("ERROR", "load-failed", { code, desc }));
  wc.on("preload-error", (_e, p, err) => mlog("ERROR", "preload-error", { stack: String(err && err.stack) }));
  win.on("unresponsive", () => mlog("WARN", "window-unresponsive"));
  win.on("responsive", () => mlog("INFO", "window-responsive"));
}
app.on("child-process-gone", (_e, d) => mlog(d.reason === "clean-exit" ? "INFO" : "ERROR", "child-process-gone", d));

ipcMain.on("log", (_e, line) => writeLog(line));
ipcMain.on("open-logs", () => { fs.mkdirSync(logDir(), { recursive: true }); shell.openPath(logDir()); });

// Saves live in a plain file (%APPDATA%\Horde\save.json), written atomically, so a crash or a hard
// shutdown never loses progress (browser storage is flushed lazily).
const oldSaveFile = () => path.join(app.getPath("userData"), "save.json");
// 0.33: three slots in <userData>\saves: slotN.json (profile) and slotN.battle (a frozen battle, gzip). slots.json
// says which one is active; the page's plain save calls go to that slot (nothing is written before one is picked).
// The first time, the old save.json is copied to Slot 1 and left in place.
const savesDir = () => path.join(app.getPath("userData"), "saves");
const slotFile = (n, ext) => path.join(savesDir(), `slot${n}.${ext}`);
const okSlot = n => Number.isInteger(n) && n >= 1 && n <= 3;
let activeSlot = null;
function initSlots() {
  try {
    if (!fs.existsSync(savesDir())) {
      fs.mkdirSync(savesDir(), { recursive: true });
      if (fs.existsSync(oldSaveFile())) fs.copyFileSync(oldSaveFile(), slotFile(1, "json"));
      writeAtomic(path.join(savesDir(), "slots.json"), JSON.stringify({ active: null }));
      mlog("INFO", "slots-created", { migrated: fs.existsSync(slotFile(1, "json")) });
    }
    const m = JSON.parse(fs.readFileSync(path.join(savesDir(), "slots.json"), "utf8"));
    activeSlot = okSlot(m.active) ? m.active : null;
  } catch (err) { mlog("ERROR", "slots-init", { stack: String(err && err.stack) }); }
}
function writeAtomic(file, data) { const tmp = file + ".tmp"; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
const saveFile = () => (activeSlot ? slotFile(activeSlot, "json") : null);
// Mods: every *.json in <userData>\mods, read once at startup (name order). Plain text only; the game validates it.
const modDir = () => path.join(app.getPath("userData"), "mods");
ipcMain.on("mods-read", e => {
  try {
    fs.mkdirSync(modDir(), { recursive: true });
    e.returnValue = fs.readdirSync(modDir()).filter(f => f.toLowerCase().endsWith(".json")).sort()
      .slice(0, 50).map(f => ({ file: f, text: fs.readFileSync(path.join(modDir(), f), "utf8").slice(0, 2000000) }));
  } catch { e.returnValue = []; }
});
ipcMain.on("open-mods", () => { fs.mkdirSync(modDir(), { recursive: true }); shell.openPath(modDir()); });
ipcMain.on("save-read", e => { try { e.returnValue = saveFile() ? fs.readFileSync(saveFile(), "utf8") : null; } catch { e.returnValue = null; } });
ipcMain.on("save-write", (_e, text) => {
  if (typeof text !== "string" || text.length > 5e6 || !saveFile()) return;
  try { writeAtomic(saveFile(), text); } catch (err) { mlog("ERROR", "save-failed", { stack: String(err && err.stack) }); }
});
ipcMain.on("slots-list", e => {
  const slots = [1, 2, 3].map(n => {
    let text = null, battle = 0;
    try { text = fs.readFileSync(slotFile(n, "json"), "utf8"); } catch { /* empty slot */ }
    try { battle = fs.statSync(slotFile(n, "battle")).size; } catch { /* no battle */ }
    return { n, text, battle };
  });
  e.returnValue = { active: activeSlot, slots };
});
ipcMain.on("slot-select", (e, n) => {
  if (okSlot(n)) { activeSlot = n; try { writeAtomic(path.join(savesDir(), "slots.json"), JSON.stringify({ active: n })); } catch (err) { mlog("ERROR", "slot-select", { stack: String(err && err.stack) }); } mlog("INFO", "slot-select", { n }); }
  e.returnValue = activeSlot;
});
// Deleting moves the slot's files to saves\deleted (a mistake can be undone by hand); nothing is erased.
ipcMain.on("slot-delete", (e, n) => {
  if (okSlot(n)) {
    const dir = path.join(savesDir(), "deleted"), stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const ext of ["json", "battle"]) if (fs.existsSync(slotFile(n, ext))) fs.renameSync(slotFile(n, ext), path.join(dir, `slot${n}-${stamp}.${ext}`));
      if (activeSlot === n) { activeSlot = null; writeAtomic(path.join(savesDir(), "slots.json"), JSON.stringify({ active: null })); }
      mlog("INFO", "slot-delete", { n });
    } catch (err) { mlog("ERROR", "slot-delete", { stack: String(err && err.stack) }); }
  }
  e.returnValue = true;
});
ipcMain.handle("battle-write", async (_e, n, bytes) => {
  if (!okSlot(n) || !(bytes instanceof Uint8Array) || bytes.length > 400e6) return false;
  try { await fs.promises.writeFile(slotFile(n, "battle") + ".tmp", bytes); await fs.promises.rename(slotFile(n, "battle") + ".tmp", slotFile(n, "battle")); return true; }
  catch (err) { mlog("ERROR", "battle-write", { stack: String(err && err.stack) }); return false; }
});
ipcMain.handle("battle-read", async (_e, n) => {
  if (!okSlot(n)) return null;
  try { return new Uint8Array(await fs.promises.readFile(slotFile(n, "battle"))); } catch { return null; }
});
ipcMain.on("battle-delete", (e, n) => { if (okSlot(n)) try { fs.rmSync(slotFile(n, "battle"), { force: true }); } catch { /* gone */ } e.returnValue = true; });
ipcMain.on("open-saves", () => { fs.mkdirSync(savesDir(), { recursive: true }); shell.openPath(savesDir()); });
// ---------- Updates (0.26): GitHub releases of this repo only; the page asks, this process does the work ----------
const updates = require("./updates.js");
const backupDir = () => path.join(app.getPath("userData"), "save-backups");
let installing = false;
ipcMain.handle("updates-list", async () => {
  const r = await updates.listVersions(net.fetch, app.getVersion());
  if (r.error) mlog("WARN", "updates-list", { error: r.error });
  return r;
});
ipcMain.handle("updates-install", async (e, version) => {
  if (installing) return { error: "Already installing." };
  if (!updates.isVersion(version)) return { error: "No such version." };
  installing = true;
  try {
    const r = await updates.listVersions(net.fetch, app.getVersion()); // look it up again here: the page only names a version
    const rel = r.versions && r.versions.find(v => v.version === version);
    if (!rel) throw new Error(r.error || "That version isn't published.");
    mlog("INFO", "update-download", { from: app.getVersion(), to: version });
    const file = await updates.download(net.fetch, rel, path.join(app.getPath("userData"), "updates"), app.getVersion(),
      pct => { if (!e.sender.isDestroyed()) e.sender.send("updates-progress", pct); });
    const backup = saveFile() ? updates.backupSave(saveFile(), backupDir(), app.getVersion()) : null;
    mlog("INFO", "update-run", { from: app.getVersion(), to: version, backup });
    const { spawn } = require("child_process");
    spawn(file, ["/SILENT", "/SUPPRESSMSGBOXES", "/CLOSEAPPLICATIONS", "/NORESTART", "/LAUNCH"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (err) {
    installing = false;
    mlog("ERROR", "update-failed", { to: version, error: String(err && err.message || err) });
    return { error: String(err && err.message || err) };
  }
});
// Coming back up from an older version: the backup to offer (or null). saveVersion = what last wrote the save.
ipcMain.on("restore-offer", (e, saveVersion) => { e.returnValue = updates.restoreOffer(saveVersion, app.getVersion(), updates.listBackups(backupDir())); });
ipcMain.on("backup-restore", (e, name) => {
  const b = updates.parseBackup(name);
  if (!b) { e.returnValue = false; return; }
  try {
    if (!saveFile()) throw new Error("no save slot picked");
    updates.backupSave(saveFile(), backupDir(), app.getVersion()); // the current save is kept too
    fs.copyFileSync(path.join(backupDir(), b.name), saveFile());
    mlog("INFO", "save-restored", { from: b.name });
    e.returnValue = true;
  } catch (err) { mlog("ERROR", "save-restore-failed", { stack: String(err && err.stack) }); e.returnValue = false; }
});
ipcMain.on("app-version", e => { e.returnValue = app.getVersion(); });
ipcMain.on("open-releases", () => shell.openExternal(`https://github.com/${updates.REPO}/releases`));
ipcMain.on("fullscreen", (_e, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on("quit", () => { mlog("INFO", "quit"); app.quit(); });
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  pruneLogs();
  initSlots();
  let gpu = null;
  try { const g = await app.getGPUInfo("basic"); gpu = (g.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, active: d.active, driver: d.driverVersion })); } catch { /* not available */ }
  mlog("INFO", "start", { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0] && os.cpus()[0].model, cores: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu });
  create();
});
app.on("window-all-closed", () => app.quit());
