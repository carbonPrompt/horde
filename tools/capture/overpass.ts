// 0.36 capture tool: one Overpass (or Nominatim) request at a time, at least 15 s apart, cached on disk, retried on
// 429/504 after 60/120/240/480 s. Files land as .part and are renamed only when complete, so a cut-off run never
// leaves half a city behind. Requests carry a generic User-Agent and nothing about who runs it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const UA = "horde-capture/1.0";
export const ENDPOINTS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"]; // 2026-11-14: kumi.systems is down; mail.ru + overpass-api.de answer
export const TIMEOUT_MS = 90_000; // a hung connection used to stall the whole fetch
const BACKOFF = [60000, 120000, 240000, 480000, 600000, 600000];

export interface OverpassOpts { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; minGapMs?: number }

export function createOverpass(o: OverpassOpts = {}) {
  const f = o.fetch ?? fetch, now = o.now ?? Date.now, sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, Math.min(ms, 15000))));
  const gap = o.minGapMs ?? 15000;
  let last = -Infinity;
  const wait = async () => { const w = last + gap - now(); if (w > 0) await sleep(w); last = now(); };
  const save = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + ".part", text); renameSync(file + ".part", file); };

  /** POST an Overpass QL query; the parsed JSON, from the cache file when it exists. */
  async function query(q: string, cacheFile: string, o: { tries?: number } = {}): Promise<any> {
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
    let err = "";
    const last = Math.min(BACKOFF.length, (o.tries ?? BACKOFF.length + 1) - 1);
    for (let attempt = 0; attempt <= last; attempt++) {
      await wait();
      const url = ENDPOINTS[attempt % ENDPOINTS.length];
      try {
        const res = await f(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) { const text = await res.text(); const j = JSON.parse(text); if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark); save(cacheFile, text); return j; }
        err = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status !== 504 && res.status !== 502 && res.status !== 503) break;
        console.error(`  ${url.split("/")[2]}: ${err}, retrying`);
      } catch (e) { err = (e as Error).message; }
      if (attempt < last) await sleep(BACKOFF[attempt]);
    }
    throw new Error(`Overpass failed (${err}) for ${cacheFile}`);
  }

  /** GET a JSON URL (Nominatim), same spacing, cache and retries. */
  async function getJson(url: string, cacheFile: string): Promise<any> {
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
    let err = "";
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      await wait();
      try {
        const res = await f(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) { const text = await res.text(); JSON.parse(text); save(cacheFile, text); return JSON.parse(text); }
        err = `HTTP ${res.status}`;
      } catch (e) { err = (e as Error).message; }
      if (attempt < BACKOFF.length) await sleep(BACKOFF[attempt]);
    }
    throw new Error(`GET failed (${err}) for ${url}`);
  }
  return { query, getJson };
}
