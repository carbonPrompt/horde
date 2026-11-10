// Horde updater (Windows app, main process).
// Finds published versions in this repo's GitHub releases, downloads the chosen installer, checks GitHub's sha256,
// backs up the save, then runs the installer and lets the game quit. The game page never sees a URL or a path.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "carbonPrompt/horde";
const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const VER = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

const isVersion = v => typeof v === "string" && VER.test(v);
function cmpVersion(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** GitHub's release list -> [{version, url, sha256, size, notes, date}], newest first. A release counts only if it is
 *  published (not a draft or pre-release), tagged v<x.y.z>, and has exactly one installer Horde-Setup-<same>.exe
 *  hosted in this repo's releases with GitHub's sha256 digest. Anything else is ignored. */
function filterReleases(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const r of json) {
    if (!r || typeof r !== "object" || r.draft || r.prerelease) continue;
    const m = /^v(\d+\.\d+\.\d+)$/.exec(String(r.tag_name || ""));
    if (!m || !isVersion(m[1])) continue;
    const v = m[1];
    const inst = (Array.isArray(r.assets) ? r.assets : []).filter(a => a && /^Horde-Setup-\d+\.\d+\.\d+\.exe$/.test(String(a.name)));
    if (inst.length !== 1) continue;
    const a = inst[0];
    const digest = String(a.digest || "");
    if (a.name !== `Horde-Setup-${v}.exe` || !String(a.browser_download_url || "").startsWith(DOWNLOAD_PREFIX) || !/^sha256:[0-9a-f]{64}$/.test(digest)) continue;
    out.push({ version: v, url: a.browser_download_url, sha256: digest.slice(7), size: Number(a.size) || 0,
      notes: String(r.body || "").slice(0, 4000), date: String(r.published_at || "").slice(0, 10) });
  }
  return out.sort((p, q) => cmpVersion(q.version, p.version));
}

// ---------- save backups: %APPDATA%\Horde\save-backups\save-<version>-<yyyymmdd-hhmmss>.json ----------
const pad = n => String(n).padStart(2, "0");
function backupName(version, d = new Date()) {
  return `save-${version}-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.json`;
}
function parseBackup(name) {
  const m = /^save-(\d+\.\d+\.\d+)-(\d{8}-\d{6})\.json$/.exec(String(name));
  return m && isVersion(m[1]) ? { name: String(name), version: m[1], stamp: m[2] } : null;
}
/** Names to delete so only the newest `keep` backups stay. */
function backupsToPrune(names, keep = 20) {
  const list = names.map(parseBackup).filter(Boolean).sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  return list.slice(keep).map(b => b.name);
}
/** Coming back up from an older version: the newest backup made by a version newer than the one that wrote the
 *  current save (and not newer than the running game). null when there is nothing to offer. */
function restoreOffer(saveVersion, current, backups) {
  const from = isVersion(saveVersion) ? saveVersion : "0.0.0";
  const c = backups.filter(b => b && isVersion(b.version) && cmpVersion(b.version, from) > 0 && cmpVersion(b.version, current) <= 0);
  if (!c.length) return null;
  c.sort((a, b) => cmpVersion(b.version, a.version) || (a.stamp < b.stamp ? 1 : -1));
  return c[0];
}

// ---------- I/O (main process) ----------
/** Published versions, or {error}. fetchFn: Electron's net.fetch (or global fetch in tests). */
async function listVersions(fetchFn, appVersion) {
  try {
    const r = await fetchFn(API_URL, { headers: { "User-Agent": `Horde/${appVersion}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) return { error: r.status === 403 ? "GitHub is limiting requests right now. Try again in a while." : `GitHub answered ${r.status}.` };
    return { versions: filterReleases(await r.json()) };
  } catch {
    return { error: "Couldn't reach GitHub." };
  }
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", d => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}
/** Download rel's installer into dir, check size and sha256. Returns the file path, or throws with a plain message. */
async function download(fetchFn, rel, dir, appVersion, onProgress) {
  if (!rel.url.startsWith(DOWNLOAD_PREFIX)) throw new Error("Not one of Horde's own releases.");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `Horde-Setup-${rel.version}.exe`), part = file + ".part";
  const r = await fetchFn(rel.url, { headers: { "User-Agent": `Horde/${appVersion}` } });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status}).`);
  const total = Number(r.headers.get("content-length")) || rel.size || 0;
  const out = fs.createWriteStream(part);
  let got = 0, last = -1;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(res => out.once("drain", res));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== last) { last = pct; onProgress && onProgress(pct); }
    }
  } finally { await new Promise(res => out.end(res)); }
  if (rel.size && got !== rel.size) { fs.rmSync(part, { force: true }); throw new Error("The download was incomplete. Nothing was installed."); }
  if ((await sha256File(part)) !== rel.sha256) { fs.rmSync(part, { force: true }); throw new Error("The download didn't match GitHub's fingerprint, so it was deleted. Nothing was installed."); }
  fs.renameSync(part, file);
  return file;
}
/** Copy the save into save-backups (if there is one) and keep the newest 20. Returns the backup name or null. */
function backupSave(saveFile, backupDir, version) {
  if (!fs.existsSync(saveFile)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const name = backupName(version);
  fs.copyFileSync(saveFile, path.join(backupDir, name));
  for (const n of backupsToPrune(fs.readdirSync(backupDir), 20)) fs.rmSync(path.join(backupDir, n), { force: true });
  return name;
}
function listBackups(backupDir) {
  try { return fs.readdirSync(backupDir).map(parseBackup).filter(Boolean); } catch { return []; }
}

module.exports = { REPO, API_URL, DOWNLOAD_PREFIX, isVersion, cmpVersion, filterReleases, backupName, parseBackup, backupsToPrune, restoreOffer, listVersions, download, backupSave, listBackups, sha256File };
