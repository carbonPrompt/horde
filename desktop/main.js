// Horde for Windows: a plain Electron window around the same single-file game the browser build uses.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
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
const saveFile = () => path.join(app.getPath("userData"), "save.json");
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
ipcMain.on("save-read", e => { try { e.returnValue = fs.readFileSync(saveFile(), "utf8"); } catch { e.returnValue = null; } });
ipcMain.on("save-write", (_e, text) => {
  if (typeof text !== "string" || text.length > 5e6) return;
  try { const tmp = saveFile() + ".tmp"; fs.writeFileSync(tmp, text); fs.renameSync(tmp, saveFile()); } catch (err) { mlog("ERROR", "save-failed", { stack: String(err && err.stack) }); }
});
ipcMain.on("fullscreen", (_e, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on("quit", () => { mlog("INFO", "quit"); app.quit(); });
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  pruneLogs();
  let gpu = null;
  try { const g = await app.getGPUInfo("basic"); gpu = (g.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, active: d.active, driver: d.driverVersion })); } catch { /* not available */ }
  mlog("INFO", "start", { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0] && os.cpus()[0].model, cores: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu });
  create();
});
app.on("window-all-closed", () => app.quit());
