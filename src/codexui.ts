// 0.47: the Codex screen. Sections and entries are <details>; media loads when an entry first opens; clips play
// only while on screen; numbered callouts sit over the picture with their text listed underneath.
import { withKeys } from "./keymap";
import { SECTIONS, allEntries, badgeFor, filterEntries, renderBody, type CodexEntry, type SectionId, type Media } from "./codex";
import { statRows } from "./codexStats";

export type CodexOpts = {
  media: Record<string, string>; // media id -> data URL (build.ts embeds assets/codex)
  seen?: string; open?: string[];
  canPlayClip?: boolean; // false = this browser can't play WebM/VP9 (old iOS Safari): clips show their alt text
  diagrams: Record<string, () => string>;
  onOpenChange(ids: string[]): void;
  log(what: string, data: object): void;
};

/** 0.55: the entry with every {key:id} token replaced by the live binding. */
export function liveKeys(e: CodexEntry): CodexEntry {
  return { ...e, title: withKeys(e.title), summary: withKeys(e.summary), body: withKeys(e.body), ...(e.keys ? { keys: e.keys.map(k => withKeys(k)) } : {}),
    ...(e.media ? { media: liveMedia(e.media) } : {}), ...(e.figs ? { figs: e.figs.map(liveMedia) } : {}) }; // 0.56 review: lead pictures too
}
const liveMedia = (m: Media): Media => ({ ...m, alt: withKeys(m.alt), ...(m.callouts ? { callouts: m.callouts.map(c => ({ ...c, text: withKeys(c.text) })) } : {}) });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The toolbar hover panel takes no pointer events, so a Codex link there could never be clicked. */
export function stripCodexLinks(html: string): string { return html.replace(/<a class="cx-link"[^>]*>\?<\/a>/g, ""); }

export type BadgeCount = { new: number; updated: number };
export function sectionCounts(list: CodexEntry[], seen: string | undefined): Partial<Record<SectionId, BadgeCount>> {
  const c: Partial<Record<SectionId, BadgeCount>> = {};
  for (const e of list) { const b = badgeFor(e, seen); if (b) (c[e.section] ??= { new: 0, updated: 0 })[b]++; }
  return c;
}

/** The note after a section title: "(1 new, 2 updated)", or "" when nothing changed. */
export function sectionLabel(n: BadgeCount | undefined): string {
  const parts = [n?.new ? `${n.new} new` : "", n?.updated ? `${n.updated} updated` : ""].filter(Boolean);
  return parts.length ? `(${parts.join(", ")})` : "";
}

const altBox = (alt: string) => `<div class="cx-alt">${esc(alt)}</div>`;

function mediaHtml(e: CodexEntry, o: CodexOpts): string { return e.media ? figHtml(e.media, o) : ""; }
/** One picture, clip or diagram with its callouts (the lead picture and 0.56 figures in the text alike). */
export function figHtml(m: Media, o: CodexOpts): string {
  const calls = m.callouts ?? [];
  let inner: string;
  if (m.kind === "diagram") {
    const d = o.diagrams[m.id];
    inner = d ? `<div class="cx-svg" role="img" aria-label="${esc(m.alt)}">${d()}</div>` : `<div class="cx-alt">${esc(m.alt)}</div>`;
  } else {
    // the data URL is attached on first open (loadMedia); keeping megabytes of base64 out of innerHTML keeps search fast
    if (!o.media[m.id] || (m.kind === "clip" && o.canPlayClip === false)) inner = altBox(m.alt);
    else if (m.kind === "clip") inner = `<video class="cx-clip" data-media="${esc(m.id)}" muted loop playsinline aria-label="${esc(m.alt)}"></video>`;
    else inner = `<img class="cx-shot" data-media="${esc(m.id)}" alt="${esc(m.alt)}">`;
  }
  const dots = calls.map(c => `<span class="cx-dot" style="left:${(c.x * 100).toFixed(1)}%;top:${(c.y * 100).toFixed(1)}%">${c.n}</span>`).join("");
  const list = calls.length ? `<ol class="cx-calls">${calls.map(c => `<li value="${c.n}">${esc(c.text)}</li>`).join("")}</ol>` : "";
  return `<figure class="cx-fig"><div class="cx-frame">${inner}${dots}</div>${list}</figure>`;
}

export function renderEntry(e0: CodexEntry, o: CodexOpts, open = false): string {
  const e = liveKeys(e0); // 0.55: keys as the player has them (Settings > Controls)
  const b = badgeFor(e, o.seen);
  const rows = e.stats ? statRows(e.stats) : [];
  return `<details class="cx-entry" id="cx-${esc(e.id)}" data-id="${esc(e.id)}"${open ? " open" : ""}><summary><b>${esc(e.title)}</b>` +
    (b ? `<span class="cx-badge cx-${b}">${b === "new" ? "NEW" : "UPDATED"}</span>` : "") +
    `<span class="cx-sum">${esc(e.summary)}</span></summary><div class="cx-body">` +
    mediaHtml(e, o) + renderBody(e.body, id => { const f = e.figs?.find(x => x.id === id); return f ? figHtml(f, o) : ""; }) +
    (rows.length ? `<table class="cx-stats">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : "") +
    (e.keys?.length ? `<div class="cx-keys">${e.keys.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</div>` : "") +
    `</div></details>`;
}

/** Fills root (the #codex box) and wires search, lazy media, clip playback and deep links. */
export function mountCodex(root: HTMLElement, search: HTMLInputElement, o: CodexOpts): { open(id: string): void; refresh(): void; setProfile(seen: string | undefined, open: string[] | undefined): void } {
  const all = allEntries();
  const openEntries = new Set<string>(); // entries the reader has open; a search rebuild keeps them open
  let io: IntersectionObserver | null = null;
  // 0.56: a reader whose saved open sections predate How to Play sees it open while it has NEW chapters; applied once
  // per profile (mount, setProfile), not on every render, so closing it sticks (review #3)
  const howtoOpen = () => { if (sectionCounts(all, o.seen).howto?.new && o.open && !o.open.includes("howto")) o.open = [...o.open, "howto"]; };
  howtoOpen();
  const render = () => {
    const list = filterEntries(search.value, all), q = search.value.trim() !== "";
    const counts = sectionCounts(all, o.seen), openSet = new Set(o.open ?? ["howto"]); // 0.56: the manual first
    root.innerHTML = list.length ? SECTIONS.map(s => {
      const es = list.filter(e => e.section === s.id);
      if (!es.length) return "";
      const n = sectionLabel(counts[s.id]);
      return `<details class="cx-sec" data-sec="${s.id}"${q || openSet.has(s.id) ? " open" : ""}><summary>${esc(s.title)}${n ? ` <span class="cx-count">${n}</span>` : ""}</summary>${es.map(e => renderEntry(e, o, openEntries.has(e.id))).join("")}</details>`;
    }).join("") : `<p class="cx-none">No entries match "${esc(search.value.trim())}".</p>`;
    wire();
  };
  const loadMedia = (d: Element) => d.querySelectorAll<HTMLImageElement | HTMLVideoElement>("[data-media]").forEach(el => {
    const alt = el instanceof HTMLImageElement ? el.alt : el.getAttribute("aria-label") ?? "";
    el.addEventListener("error", () => { io?.unobserve(el); el.outerHTML = altBox(alt); o.log("media-failed", { alt }); }, { once: true });
    el.src = o.media[el.dataset.media!] ?? ""; el.removeAttribute("data-media");
    if (el instanceof HTMLVideoElement) io?.observe(el);
  });
  const wire = () => {
    io?.disconnect();
    io = typeof IntersectionObserver === "function" ? new IntersectionObserver(es => es.forEach(x => {
      const v = x.target as HTMLVideoElement;
      if (x.isIntersecting && !v.dataset.paused) v.play().catch(() => {}); else v.pause();
    })) : null;
    root.querySelectorAll<HTMLDetailsElement>("details.cx-entry").forEach(d => {
      if (d.open) loadMedia(d);
      d.addEventListener("toggle", () => {
        if (d.open) { openEntries.add(d.dataset.id!); loadMedia(d); } else openEntries.delete(d.dataset.id!);
      });
    });
    root.querySelectorAll<HTMLDetailsElement>("details.cx-sec").forEach(d => d.addEventListener("toggle", () => {
      if (search.value.trim()) return; // searching opens everything; don't save that
      o.open = Array.from(root.querySelectorAll<HTMLDetailsElement>("details.cx-sec[open]")).map(x => x.dataset.sec!);
      o.onOpenChange(o.open);
    }));
    root.querySelectorAll<HTMLVideoElement>("video.cx-clip").forEach(v => v.addEventListener("click", () => {
      if (v.paused) { delete v.dataset.paused; v.play().catch(() => {}); } else { v.dataset.paused = "1"; v.pause(); }
    }));
  };
  let deb = 0; // a short pause after typing before the list rebuilds
  search.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(render, 120) as unknown as number; });
  render();
  return {
    refresh: render,
    /** Another save slot took over: its badges and open sections; nothing the last player had open stays open. */
    setProfile(seen, open) { o.seen = seen; o.open = open; howtoOpen(); openEntries.clear(); search.value = ""; render(); },
    open(id: string) {
      if (search.value) { search.value = ""; render(); }
      const d = root.querySelector<HTMLDetailsElement>(`#cx-${CSS.escape(id)}`);
      if (!d) { o.log("unknown-id", { id }); root.parentElement?.scrollTo?.({ top: 0 }); return; }
      (d.closest("details.cx-sec") as HTMLDetailsElement).open = true;
      d.open = true; openEntries.add(id); loadMedia(d);
      d.scrollIntoView({ block: "start", behavior: "smooth" });
      d.classList.add("cx-flash"); setTimeout(() => d.classList.remove("cx-flash"), 1600);
    },
  };
}
