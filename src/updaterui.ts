// 0.26 updater, the game-page side (Windows app only).
// The page never handles URLs or files: it asks the app for the published versions and names one to install.
import * as C from "./config";
import * as Save from "./save";
import type { SaveData } from "./save";

type Ver = { version: string; notes: string; date: string; size: number };
const cmp = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

export function initUpdater(o: { save: () => SaveData; go: (id: string) => void; say: (msg: string) => void; log: (ev: string, d?: Record<string, unknown>) => void }) {
  const d = Save.desktop, $ = (id: string) => document.getElementById(id)!;
  const ok = !!(d && d.updatesList && d.updatesInstall);
  for (const id of ["versions-btn", "p-versions", "opt-upd-row", "opt-autoupd-row"]) { const el = document.getElementById(id); if (el) el.hidden = !ok; }
  if (!ok) return;
  let versions: Ver[] = [], busy = false, fetchedAt = 0;
  const status = (t: string) => { $("ver-status").textContent = t; };

  // Coming back up from an older version: offer the newer progress that was backed up on the way down.
  const s0 = o.save(), wroteIt = s0.gameVersion;
  const offer = d!.restoreOffer?.(wroteIt);
  s0.gameVersion = C.VERSION; Save.store(s0);
  if (offer && confirm(`Your save was last written by an older version${wroteIt ? ` (${wroteIt})` : ""}. Restore your progress from ${offer.version} (backed up ${offer.stamp.slice(0, 4)}-${offer.stamp.slice(4, 6)}-${offer.stamp.slice(6, 8)})? Your current save is kept as a backup too.`)) {
    if (d!.restoreBackup!(offer.name)) { o.log("save-restored", { from: offer.name }); location.reload(); return; }
    alert("Couldn't restore that backup. Your current save is unchanged.");
  }

  async function refresh(force = false) {
    if (!force && Date.now() - fetchedAt < 60_000 && versions.length) return render();
    status("Checking GitHub for versions...");
    const r = await d!.updatesList!();
    fetchedAt = Date.now();
    if (r.error) { status(`${r.error} You can keep playing; try again later.`); versions = []; render(); return; }
    versions = r.versions ?? [];
    status(versions.length ? "" : "No published versions found.");
    render();
  }
  function render() {
    const list = $("ver-list"); list.textContent = "";
    const s = o.save(), latest = versions[0];
    const top = document.createElement("div"); top.className = "ver-row ver-latest";
    const tl = document.createElement("div");
    tl.innerHTML = `<b>Latest</b><small></small>`;
    tl.querySelector("small")!.textContent = latest ? ` ${latest.version}${s.settings.updatePin ? " · you're staying on an older version" : ""}` : "";
    const tb = document.createElement("button");
    tb.textContent = !latest || cmp(latest.version, C.VERSION) <= 0 ? (s.settings.updatePin ? "Follow latest" : "Up to date") : "Update";
    tb.disabled = busy || !latest || (cmp(latest.version, C.VERSION) <= 0 && !s.settings.updatePin);
    tb.addEventListener("click", () => {
      delete s.settings.updatePin; Save.store(s);
      if (latest && cmp(latest.version, C.VERSION) > 0) install(latest.version); else { status("Following the latest version again."); render(); }
    });
    top.append(tl, tb); list.append(top);
    for (const v of versions) {
      const row = document.createElement("div"); row.className = "ver-row";
      const info = document.createElement("div");
      const h = document.createElement("b"); h.textContent = `${v.version}${v.version === C.VERSION ? " (this one)" : ""}`;
      const dt = document.createElement("small"); dt.textContent = ` ${v.date} · ${(v.size / 1048576).toFixed(0)} MB`;
      const notes = document.createElement("div"); notes.className = "ver-notes"; notes.textContent = v.notes;
      info.append(h, dt, notes);
      const b = document.createElement("button");
      const c = cmp(v.version, C.VERSION);
      b.textContent = c > 0 ? "Update" : c === 0 ? "Reinstall" : "Go back to this";
      b.disabled = busy;
      b.addEventListener("click", () => {
        if (c < 0 && !confirm(`Go back to ${v.version}? Older versions may not understand your newer progress. Your save is backed up first and you'll be offered it back when you update again.${cmp(v.version, "0.26.0") < 0 ? " This version has no Versions menu: to come back, get the newest installer from the releases page." : ""}`)) return;
        if (latest && cmp(v.version, latest.version) < 0) s.settings.updatePin = v.version; else delete s.settings.updatePin; // an older pick pauses auto-update
        Save.store(s);
        install(v.version);
      });
      row.append(info, b); list.append(row);
    }
  }
  async function install(v: string) {
    if (busy) return;
    busy = true; render();
    o.log("update-start", { from: C.VERSION, to: v });
    status(`Downloading ${v}...`);
    d!.onUpdateProgress?.(p => status(`Downloading ${v}... ${p}%`));
    const r = await d!.updatesInstall!(v);
    if (r.error) { busy = false; status(`${r.error}`); o.log("update-error", { to: v, error: r.error }); render(); return; }
    status(`Installing ${v}. The game will close and reopen by itself.`);
  }

  document.getElementById("versions-btn")?.addEventListener("click", () => { o.go("versions"); refresh(); });
  document.getElementById("p-versions")?.addEventListener("click", () => { o.go("versions"); refresh(); });
  document.getElementById("ver-refresh")?.addEventListener("click", () => refresh(true));
  document.getElementById("ver-releases")?.addEventListener("click", () => d!.openReleases?.());
  $("upd-banner").addEventListener("click", () => { o.go("versions"); refresh(); });

  // On start: look once; banner when a newer version exists; install by itself if the player turned that on.
  const s = o.save();
  if (s.settings.checkUpdates === false) return;
  d!.updatesList!().then(r => {
    fetchedAt = Date.now();
    versions = r.versions ?? [];
    const latest = versions[0];
    if (!latest || cmp(latest.version, C.VERSION) <= 0) return;
    o.log("update-available", { current: C.VERSION, latest: latest.version, auto: !!s.settings.autoUpdate, pinned: s.settings.updatePin ?? null });
    const ban = $("upd-banner"); ban.textContent = `Horde ${latest.version} is out. Update`; ban.hidden = false;
    if (s.settings.autoUpdate && !s.settings.updatePin) { o.go("versions"); render(); install(latest.version); }
  }).catch(() => { /* offline: play on */ });
}
