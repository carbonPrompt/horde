// 0.47: the Codex screen. Sections and entries are <details>; media loads when an entry first opens; clips play
// only while on screen; numbered callouts sit over the picture with their text listed underneath.
import { SECTIONS, allEntries, badgeFor, filterEntries, renderBody, type CodexEntry, type SectionId } from "./codex";
import { statRows } from "./codexStats";

export type CodexOpts = {
  media: Record<string, string>; // media id -> data URL (build.ts embeds assets/codex)
  seen?: string; open?: string[];
  diagrams: Record<string, () => string>;
  onOpenChange(ids: string[]): void;
  log(what: string, data: object): void;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The toolbar hover panel takes no pointer events, so a Codex link there could never be clicked. */
export function stripCodexLinks(html: string): string { return html.replace(/<a class="cx-link"[^>]*>\?<\/a>/g, ""); }

export function sectionCounts(list: CodexEntry[], seen: string | undefined): Partial<Record<SectionId, number>> {
  const c: Partial<Record<SectionId, number>> = {};
  for (const e of list) if (badgeFor(e, seen)) c[e.section] = (c[e.section] ?? 0) + 1;
  return c;
}

function mediaHtml(e: CodexEntry, o: CodexOpts): string {
  const m = e.media;
  if (!m) return "";
  const calls = m.callouts ?? [];
  let inner: string;
  if (m.kind === "diagram") {
    const d = o.diagrams[m.id];
    inner = d ? `<div class="cx-svg" role="img" aria-label="${esc(m.alt)}">${d()}</div>` : `<div class="cx-alt">${esc(m.alt)}</div>`;
  } else {
    // the data URL is attached on first open (loadMedia); keeping megabytes of base64 out of innerHTML keeps search fast
    if (!o.media[m.id]) inner = `<div class="cx-alt">${esc(m.alt)}</div>`;
    else if (m.kind === "clip") inner = `<video class="cx-clip" data-media="${esc(m.id)}" muted loop playsinline aria-label="${esc(m.alt)}"></video>`;
    else inner = `<img class="cx-shot" data-media="${esc(m.id)}" alt="${esc(m.alt)}">`;
  }
  const dots = calls.map(c => `<span class="cx-dot" style="left:${(c.x * 100).toFixed(1)}%;top:${(c.y * 100).toFixed(1)}%">${c.n}</span>`).join("");
  const list = calls.length ? `<ol class="cx-calls">${calls.map(c => `<li value="${c.n}">${esc(c.text)}</li>`).join("")}</ol>` : "";
  return `<figure class="cx-fig"><div class="cx-frame">${inner}${dots}</div>${list}</figure>`;
}

export function renderEntry(e: CodexEntry, o: CodexOpts): string {
  const b = badgeFor(e, o.seen);
  const rows = e.stats ? statRows(e.stats) : [];
  return `<details class="cx-entry" id="cx-${esc(e.id)}" data-id="${esc(e.id)}"><summary><b>${esc(e.title)}</b>` +
    (b ? `<span class="cx-badge cx-${b}">${b === "new" ? "NEW" : "UPDATED"}</span>` : "") +
    `<span class="cx-sum">${esc(e.summary)}</span></summary><div class="cx-body">` +
    mediaHtml(e, o) + renderBody(e.body) +
    (rows.length ? `<table class="cx-stats">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : "") +
    (e.keys?.length ? `<div class="cx-keys">${e.keys.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</div>` : "") +
    `</div></details>`;
}

/** Fills root (the #codex box) and wires search, lazy media, clip playback and deep links. */
export function mountCodex(root: HTMLElement, search: HTMLInputElement, o: CodexOpts): { open(id: string): void; refresh(): void } {
  const all = allEntries();
  let io: IntersectionObserver | null = null;
  const render = () => {
    const list = filterEntries(search.value, all), q = search.value.trim() !== "";
    const counts = sectionCounts(all, o.seen), openSet = new Set(o.open ?? ["start"]);
    root.innerHTML = list.length ? SECTIONS.map(s => {
      const es = list.filter(e => e.section === s.id);
      if (!es.length) return "";
      const n = counts[s.id];
      return `<details class="cx-sec" data-sec="${s.id}"${q || openSet.has(s.id) ? " open" : ""}><summary>${esc(s.title)}${n ? ` <span class="cx-count">(${n} new)</span>` : ""}</summary>${es.map(e => renderEntry(e, o)).join("")}</details>`;
    }).join("") : `<p class="cx-none">No entries match "${esc(search.value.trim())}".</p>`;
    wire();
  };
  const loadMedia = (d: Element) => d.querySelectorAll<HTMLImageElement | HTMLVideoElement>("[data-media]").forEach(el => {
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
      d.addEventListener("toggle", () => { if (d.open) loadMedia(d); });
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
    open(id: string) {
      if (search.value) { search.value = ""; render(); }
      const d = root.querySelector<HTMLDetailsElement>(`#cx-${CSS.escape(id)}`);
      if (!d) { o.log("unknown-id", { id }); root.parentElement?.scrollTo?.({ top: 0 }); return; }
      (d.closest("details.cx-sec") as HTMLDetailsElement).open = true;
      d.open = true; loadMedia(d);
      d.scrollIntoView({ block: "start", behavior: "smooth" });
      d.classList.add("cx-flash"); setTimeout(() => d.classList.remove("cx-flash"), 1600);
    },
  };
}
