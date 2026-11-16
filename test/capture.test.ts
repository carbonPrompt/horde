import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOverpass } from "../tools/capture/overpass";

function rig(statuses: number[]) {
  let t = 0; const slept: number[] = [], calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, init: any) => {
    calls.push({ url, headers: init.headers });
    const status = statuses.length ? statuses.shift()! : 200;
    return new Response(status === 200 ? JSON.stringify({ elements: [{ type: "node", id: 1 }] }) : "busy", { status });
  };
  const dir = mkdtempSync(join(tmpdir(), "ovp-"));
  const c = createOverpass({ fetch: fetch as any, now: () => t, sleep: async ms => { slept.push(ms); t += ms; }, minGapMs: 15000 });
  return { c, slept, calls, dir, advance: (ms: number) => { t += ms; } };
}

test("two queries in a row are at least 15 s apart", async () => {
  const r = rig([]);
  await r.c.query("a", join(r.dir, "a.json"));
  await r.c.query("b", join(r.dir, "b.json"));
  expect(r.slept.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(15000);
});

test("a 429 then a 200 succeeds and writes the cache once", async () => {
  const r = rig([429, 200]);
  const j = await r.c.query("q", join(r.dir, "q.json"));
  expect(j.elements.length).toBe(1);
  expect(r.calls.length).toBe(2);
  expect(r.slept).toContain(60000);
  expect(readdirSync(r.dir)).toEqual(["q.json"]);
});

test("504s every time: it throws after 7 tries and leaves no file", async () => {
  const r = rig([504, 504, 504, 504, 504, 504, 504]);
  await expect(r.c.query("q", join(r.dir, "q.json"))).rejects.toThrow();
  expect(r.calls.length).toBe(7);
  expect(readdirSync(r.dir)).toEqual([]);
});

test("a cached query makes no network call", async () => {
  const r = rig([]);
  await r.c.query("q", join(r.dir, "q.json"));
  const n = r.calls.length;
  await r.c.query("q", join(r.dir, "q.json"));
  expect(r.calls.length).toBe(n);
});

test("requests carry the generic User-Agent and nothing personal", async () => {
  const r = rig([]);
  await r.c.query("q", join(r.dir, "q.json"));
  expect(r.calls[0].headers["User-Agent"]).toBe("horde-capture/1.0");
  const all = JSON.stringify(r.calls);
  const me = (process.env.USER ?? process.env.USERNAME ?? "").toLowerCase(); // the local account name, never hard-coded
  for (const bad of ["gmail", "noreply", "@", me].filter(b => b.length >= 3 || b === "@")) expect(all.toLowerCase()).not.toContain(bad);
  expect(existsSync(join(r.dir, "q.json"))).toBe(true);
});

test("bake refuses a city whose fetch is incomplete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "osmcache-"));
  process.env.HORDE_OSM_CACHE = dir;
  const { missingFiles } = await import("../tools/capture/bake");
  const { CATALOGUE } = await import("../src/realcity/catalogue");
  const c = CATALOGUE.find(x => x.id === "castle-rock")!;
  expect(missingFiles(c)).toEqual(["meta.json"]);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(dir, c.id), { recursive: true });
  writeFileSync(join(dir, c.id, "meta.json"), JSON.stringify({ files: ["boundary.json", "overview-0.json"], tiles: [{}] }));
  writeFileSync(join(dir, c.id, "boundary.json"), "{}");
  const miss = missingFiles(c);
  expect(miss).toContain("overview-0.json");
  expect(miss).toContain("area-rock-park.json");
  expect(miss).not.toContain("boundary.json");
});

test("every request carries a timeout so a hung server can't stall the fetch", async () => {
  let sig: any = null;
  const c = createOverpass({ fetch: (async (_u: string, init: any) => { sig = init.signal; return new Response("{}"); }) as any, now: () => 0, sleep: async () => {}, minGapMs: 0 });
  await c.query("q", join(mkdtempSync(join(tmpdir(), "ovp-")), "q.json"));
  expect(sig).toBeInstanceOf(AbortSignal);
});

test("a query can be limited to fewer tries (dense buildings fall back to quarters)", async () => {
  const r = rig([504, 504, 504, 504]);
  await expect(r.c.query("q", join(r.dir, "q.json"), { tries: 2 })).rejects.toThrow();
  expect(r.calls.length).toBe(2);
});
