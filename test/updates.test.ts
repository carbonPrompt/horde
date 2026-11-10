import { expect, test } from "bun:test";
// desktop/updates.js is the Windows app's update logic (CommonJS, no Electron needed for these parts)
const U = require("../desktop/updates.js");

const asset = (v: string, extra: Record<string, unknown> = {}) => ({
  name: `Horde-Setup-${v}.exe`, size: 100,
  browser_download_url: `https://github.com/carbonPrompt/horde/releases/download/v${v}/Horde-Setup-${v}.exe`,
  digest: "sha256:" + "a".repeat(64), ...extra,
});
const rel = (v: string, extra: Record<string, unknown> = {}) => ({ tag_name: `v${v}`, draft: false, prerelease: false, body: `notes ${v}`, published_at: "2026-11-10T00:00:00Z", assets: [asset(v)], ...extra });

test("only this repo's published, verifiable installers count; newest first", () => {
  const list = U.filterReleases([
    rel("0.26.0"), rel("0.21.1"), rel("0.27.0", { draft: true }), rel("0.28.0", { prerelease: true }),
    rel("0.25.5", { assets: [asset("0.25.5", { browser_download_url: "https://evil.example/Horde-Setup-0.25.5.exe" })] }),
    rel("0.25.6", { assets: [asset("0.25.6", { digest: undefined })] }),
    rel("0.25.7", { assets: [asset("0.25.8")] }), // asset version doesn't match the tag
    rel("0.25.9", { assets: [asset("0.25.9"), asset("0.25.9", { name: "Horde-Setup-0.25.9.exe" })] }), // two installers
    { tag_name: "latest", assets: [] }, null, 5,
  ]);
  expect(list.map((r: any) => r.version)).toEqual(["0.26.0", "0.21.1"]);
  expect(list[0]).toMatchObject({ sha256: "a".repeat(64), size: 100, notes: "notes 0.26.0" });
  expect(U.filterReleases("junk")).toEqual([]);
});

test("version compare", () => {
  expect(U.cmpVersion("0.26.0", "0.25.10")).toBeGreaterThan(0);
  expect(U.cmpVersion("1.0.0", "1.0.0")).toBe(0);
  expect(U.cmpVersion("0.9.9", "0.10.0")).toBeLessThan(0);
  expect(U.isVersion("0.26.0")).toBe(true);
  expect(U.isVersion("../x")).toBe(false);
});

test("backup names and pruning keep the newest 20", () => {
  const n = U.backupName("0.26.0", new Date("2026-11-10T22:31:42Z"));
  expect(n).toBe("save-0.26.0-20261110-223142.json");
  expect(U.parseBackup(n)).toEqual({ name: n, version: "0.26.0", stamp: "20261110-223142" });
  expect(U.parseBackup("notes.txt")).toBeNull();
  const names = Array.from({ length: 25 }, (_, i) => `save-0.26.0-202611${String(10 + (i % 20)).padStart(2, "0")}-0000${String(i).padStart(2, "0")}.json`);
  const del = U.backupsToPrune(names, 20);
  expect(del.length).toBe(5);
  const keep = names.filter(x => !del.includes(x)).map(x => U.parseBackup(x)!.stamp).sort();
  for (const d of del) expect(U.parseBackup(d)!.stamp <= keep[0]).toBe(true);
});

test("restore is offered only after coming back up from an older version", () => {
  const b = (v: string, s: string) => ({ name: `save-${v}-${s}.json`, version: v, stamp: s });
  // went 0.27 -> 0.26 (0.26 saved), then back up to 0.27: offer the 0.27 backup
  expect(U.restoreOffer("0.26.0", "0.27.0", [b("0.27.0", "20261110-100000"), b("0.26.0", "20261110-110000")])?.version).toBe("0.27.0");
  // normal update 0.26 -> 0.27: the save is from 0.26, the only backup is 0.26: nothing to offer
  expect(U.restoreOffer("0.26.0", "0.27.0", [b("0.26.0", "20261110-100000")])).toBeNull();
  // running an older version: never offer a backup from a newer one
  expect(U.restoreOffer("0.27.0", "0.26.0", [b("0.27.0", "20261110-100000")])).toBeNull();
  // a save with no version (written by 0.25 or older after a trip back): newest backup not above this version
  expect(U.restoreOffer(undefined, "0.27.0", [b("0.26.0", "20261110-090000"), b("0.27.0", "20261110-100000")])?.version).toBe("0.27.0");
  expect(U.restoreOffer(undefined, "0.27.0", [])).toBeNull();
});

test("download: a good file is kept, a tampered or short one is deleted and never kept", async () => {
  const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "horde-upd-"));
  const body = new Uint8Array(5000).map((_, i) => i % 251);
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const url = `${U.DOWNLOAD_PREFIX}v0.26.0/Horde-Setup-0.26.0.exe`;
  const serve = (bytes: Uint8Array) => async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } });
  const rel = { version: "0.26.0", url, sha256: sha, size: body.length };
  const pcts: number[] = [];
  const f = await U.download(serve(body), rel, dir, "0.26.0", (p: number) => pcts.push(p));
  expect(fs.existsSync(f)).toBe(true);
  expect(pcts[pcts.length - 1]).toBe(100);
  const bad = body.slice(); bad[10] ^= 1;
  await expect(U.download(serve(bad), { ...rel, version: "0.26.1" }, dir, "0.26.0")).rejects.toThrow("fingerprint");
  expect(fs.existsSync(path.join(dir, "Horde-Setup-0.26.1.exe"))).toBe(false);
  await expect(U.download(serve(body.slice(0, 100)), { ...rel, version: "0.26.2" }, dir, "0.26.0")).rejects.toThrow("incomplete");
  await expect(U.download(serve(body), { ...rel, url: "https://evil.example/x.exe" }, dir, "0.26.0")).rejects.toThrow("own releases");
  // backups: copy + prune
  const save = path.join(dir, "save.json"); fs.writeFileSync(save, "{}");
  const name = U.backupSave(save, path.join(dir, "save-backups"), "0.26.0");
  expect(U.listBackups(path.join(dir, "save-backups")).map((b: any) => b.name)).toEqual([name]);
  fs.rmSync(dir, { recursive: true, force: true });
});
