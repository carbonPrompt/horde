// The only things the game page can ask of Windows: fullscreen on/off, quit, its save file and its log.
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
});
