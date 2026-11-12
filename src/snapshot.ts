// 0.33: battle snapshots. A whole Sim (every person, infected, unit, wall, timer and the map) plus whatever the
// page needs to carry on, frozen into one gzip file and brought back exactly: loading and playing on gives the same
// battle as never having saved. A snapshot only loads in the game version that wrote it.
//
// Format (before gzip): "HORDSNP1", u32 length of the JSON head, the head (UTF-8), zero padding to 8 bytes, then
// every typed array's bytes, each starting on an 8-byte boundary. The head is the object graph with typed arrays
// replaced by {$ta, o, n} (offset/length into the byte section). Objects reached twice keep their identity ($id/$r).
import { Sim } from "./sim";

const MAGIC = "HORDSNP1";
type TA = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const CTORS: Record<string, new (b: ArrayBuffer, o: number, n: number) => TA> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
};

/** Encode an object graph (plain objects, arrays, Sets, Maps, typed arrays, numbers incl. Infinity/NaN, strings,
 *  booleans, null). `root` and the objects in `allow` may be class instances; anything else that isn't plain data
 *  throws, naming the path. */
export function encode(root: Record<string, unknown>, allow: Set<object> = new Set()): Uint8Array {
  const ids = new Map<object, number>();
  const blobs: TA[] = [];
  let off = 0;
  const enc = (v: unknown, path: string): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : { $n: v > 0 ? "I" : v < 0 ? "-I" : "N" };
    if (v === undefined) return { $u: 1 };
    if (typeof v !== "object") throw new Error(`snapshot: can't save ${typeof v} at ${path}`);
    const seen = ids.get(v);
    if (seen !== undefined) return { $r: seen };
    const id = ids.size; ids.set(v, id);
    if (ArrayBuffer.isView(v)) {
      const ta = v as TA, name = ta.constructor.name;
      if (!CTORS[name]) throw new Error(`snapshot: can't save ${name} at ${path}`);
      const o = off; blobs.push(ta); off += Math.ceil(ta.byteLength / 8) * 8;
      return { $id: id, $ta: name, o, n: ta.length };
    }
    if (Array.isArray(v)) return { $id: id, a: v.map((x, i) => enc(x, `${path}[${i}]`)) };
    if (v instanceof Set) return { $id: id, $s: [...v].map((x, i) => enc(x, `${path}{${i}}`)) };
    if (v instanceof Map) return { $id: id, $m: [...v].map(([k, x], i) => [enc(k, `${path}<${i}>`), enc(x, `${path}<${i}>`)]) };
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null && v !== root && !allow.has(v)) throw new Error(`snapshot: can't save a ${proto?.constructor?.name ?? "?"} at ${path}`);
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "function") throw new Error(`snapshot: can't save a function at ${path}.${k}`);
      if (x !== undefined) o[k] = enc(x, `${path}.${k}`);
    }
    return { $id: id, o };
  };
  const head = new TextEncoder().encode(JSON.stringify(enc(root, "root")));
  const start = Math.ceil((8 + 4 + head.length) / 8) * 8;
  const out = new Uint8Array(start + off);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(8, head.length, true);
  out.set(head, 12);
  let p = start;
  for (const ta of blobs) { out.set(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength), p); p += Math.ceil(ta.byteLength / 8) * 8; }
  return out;
}

/** Decode what encode() wrote (class instances come back as plain objects: set their prototype after). */
export function decode(bytes: Uint8Array): Record<string, unknown> {
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("Not a Horde snapshot.");
  const hl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hl)));
  const start = Math.ceil((12 + hl) / 8) * 8;
  // one aligned copy of the byte section; every typed array gets its own copy out of it (no shared buffers)
  const body = bytes.slice(start).buffer;
  const objs: unknown[] = [];
  const dec = (v: any): unknown => {
    if (v === null || typeof v !== "object") return v;
    if ("$n" in v) return v.$n === "I" ? Infinity : v.$n === "-I" ? -Infinity : NaN;
    if ("$u" in v) return undefined;
    if ("$r" in v) return objs[v.$r];
    if ("$ta" in v) {
      const C = CTORS[v.$ta]; if (!C) throw new Error("Bad snapshot.");
      const per = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
      const ta = new C(body.slice(v.o, v.o + v.n * per), 0, v.n);
      objs[v.$id] = ta; return ta;
    }
    if ("a" in v) { const a: unknown[] = []; objs[v.$id] = a; for (const x of v.a) a.push(dec(x)); return a; }
    if ("$s" in v) { const s = new Set(); objs[v.$id] = s; for (const x of v.$s) s.add(dec(x)); return s; }
    if ("$m" in v) { const m = new Map(); objs[v.$id] = m; for (const [k, x] of v.$m) m.set(dec(k), dec(x)); return m; }
    const o: Record<string, unknown> = {};
    objs[v.$id] = o;
    for (const [k, x] of Object.entries(v.o)) o[k] = dec(x);
    return o;
  };
  return dec(head) as Record<string, unknown>;
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream) {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** What the page keeps about a battle besides the Sim (city, daily date, camera, flags), plain data only. */
export type PageState = Record<string, unknown>;
export interface Snapshot { version: string; savedAt: string; label: string; sim: Sim; page: PageState }

/** Freeze a battle. The Sim is copied synchronously (the game can keep running while it compresses). */
export async function pack(version: string, label: string, sim: Sim, page: PageState): Promise<Uint8Array> {
  const meta = { version, savedAt: new Date().toISOString(), label };
  const raw = encode({ meta, page, sim: sim as unknown as Record<string, unknown> } as Record<string, unknown>, new Set([sim]));
  return pipe(raw, new CompressionStream("gzip"));
}

/** Just the version/label/time of a packed snapshot, without building the battle. */
export async function peek(gz: Uint8Array): Promise<{ version: string; savedAt: string; label: string } | null> {
  try {
    const raw = await pipe(gz, new DecompressionStream("gzip"));
    const hl = new DataView(raw.buffer, raw.byteOffset).getUint32(8, true);
    return JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + hl))).o.meta.o ?? null;
  } catch { return null; }
}

export async function unpack(gz: Uint8Array): Promise<Snapshot> {
  const raw = await pipe(gz, new DecompressionStream("gzip"));
  const root = decode(raw) as any;
  // the Sim is the object under "sim": rebuild it with the class's methods
  Object.setPrototypeOf(root.sim, Sim.prototype);
  return { ...(root.meta as { version: string; savedAt: string; label: string }), sim: root.sim as Sim, page: root.page as PageState };
}
