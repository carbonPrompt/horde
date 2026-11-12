// The only things the game page can ask of Windows: fullscreen on/off, quit, its save slots, its log, mods, and updates.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("hordeDesktop", {
  setFullscreen: on => ipcRenderer.send("fullscreen", !!on),
  quit: () => ipcRenderer.send("quit"),
  readSave: () => ipcRenderer.sendSync("save-read"),
  writeSave: text => ipcRenderer.send("save-write", String(text)),
  log: line => ipcRenderer.send("log", String(line)),
  openLogs: () => ipcRenderer.send("open-logs"),
  readMods: () => ipcRenderer.sendSync("mods-read"),
  openMods: () => ipcRenderer.send("open-mods"),
  // 0.26 updater: the page names a version; the main process looks it up on GitHub, verifies and installs it
  updatesList: () => ipcRenderer.invoke("updates-list"),
  updatesInstall: version => ipcRenderer.invoke("updates-install", String(version)),
  onUpdateProgress: cb => { ipcRenderer.removeAllListeners("updates-progress"); ipcRenderer.on("updates-progress", (_e, pct) => cb(Number(pct))); },
  restoreOffer: saveVersion => ipcRenderer.sendSync("restore-offer", saveVersion == null ? null : String(saveVersion)),
  restoreBackup: name => ipcRenderer.sendSync("backup-restore", String(name)),
  openReleases: () => ipcRenderer.send("open-releases"),
  // 0.33 save slots
  slotsList: () => ipcRenderer.sendSync("slots-list"),
  slotSelect: n => ipcRenderer.sendSync("slot-select", Number(n)),
  slotDelete: n => ipcRenderer.sendSync("slot-delete", Number(n)),
  battleWrite: (n, bytes) => ipcRenderer.invoke("battle-write", Number(n), bytes),
  battleRead: n => ipcRenderer.invoke("battle-read", Number(n)),
  battleDelete: n => ipcRenderer.sendSync("battle-delete", Number(n)),
  openSaves: () => ipcRenderer.send("open-saves"),
});
