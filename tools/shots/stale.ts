// 0.47: which Codex pictures and clips are missing or out of date. Pure, so test/codex.test.ts and run.ts share it.
import { createHash } from "node:crypto";
import { verCmp, type CodexEntry } from "../../src/codex";

export type Recipe = {
  id: string; kind: "shot" | "clip"; city: string; seed: number; startMin: number;
  size: [number, number]; // browser window, CSS px
  setup: string[]; // shot ops (src/shotmode.ts) run before the picture / before recording
  action?: string[]; // clips: ops run while recording, one per frame step unless "advance"
  camera: { x: number; y: number; scale: number };
  seconds?: number; // clips: recording length
  crop?: [number, number, number, number]; // x, y, w, h in CSS px
  rev: number; // bump to force a reshoot with no other change
};
export type ManifestRow = { version: string; rev: number; recipeHash: string; bytes: number; w: number; h: number };
export type StaleWhy = "missing" | "recipe-changed" | "older-than-entry" | "no-recipe" | "orphan";

const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, stable((v as Record<string, unknown>)[k])])) : v;
export function recipeHash(r: Recipe): string {
  return createHash("sha256").update(JSON.stringify(stable(r))).digest("hex").slice(0, 12);
}
export const mediaFile = (r: Pick<Recipe, "id" | "kind">) => `assets/codex/${r.id}.${r.kind === "clip" ? "webm" : "png"}`;

export function staleReport(recipes: Recipe[], manifest: Record<string, ManifestRow>, entries: CodexEntry[],
  exists: (f: string) => boolean): { id: string; why: StaleWhy }[] {
  const out: { id: string; why: StaleWhy }[] = [], byId = new Map(recipes.map(r => [r.id, r])), used = new Set<string>();
  for (const e of entries) for (const m of [...(e.media ? [e.media] : []), ...(e.figs ?? [])]) { // 0.56: figures in the text too
    if (m.kind === "diagram") continue;
    used.add(m.id);
    const r = byId.get(m.id), row = manifest[m.id];
    if (!r) out.push({ id: m.id, why: "no-recipe" });
    else if (!row || !exists(mediaFile(r))) out.push({ id: m.id, why: "missing" });
    else if (row.recipeHash !== recipeHash(r) || row.rev !== r.rev) out.push({ id: m.id, why: "recipe-changed" });
    else if (verCmp(row.version, e.updated) < 0) out.push({ id: m.id, why: "older-than-entry" });
  }
  for (const r of recipes) if (!used.has(r.id)) out.push({ id: r.id, why: "orphan" });
  for (const id of Object.keys(manifest)) if (!byId.has(id)) out.push({ id, why: "orphan" });
  return out;
}
