// 0.36: the City Map screen. A real city's north-up overview with each battle area as its turned box; tap or click
// a box (or a list row) to pick it, then Play. Pointer events only, so touch works later. Pure parts are tested.
import * as C from "./config";
import { CATALOGUE } from "./realcity/catalogue";
import { REAL_DATA } from "./realcity/data";
import { areaQuad, decodeOverview, OV_BUILT, OV_LAND, OV_PARK, OV_RAIL, OV_ROAD, OV_WATER, type Overview } from "./realcity/overview";
import { bestKey } from "./scoring";

export interface CityMapArea { key: string; name: string; quad: [number, number][] }
export interface CityMapModel { cityId: string; name: string; overview: Overview; areas: CityMapArea[] }

/** Index of the quad containing (px, py), or -1 (even-odd point in polygon). */
export function areaAt(quads: [number, number][][], px: number, py: number): number {
  for (let k = 0; k < quads.length; k++) {
    const q = quads[k]; let inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, yi] = q[i], [xj, yj] = q[j];
      if ((yi > py) !== (yj > py) && px < xi + (py - yi) * (xj - xi) / (yj - yi)) inside = !inside;
    }
    if (inside) return k;
  }
  return -1;
}

const models = new Map<string, CityMapModel>();
export function cityMapModel(cityId: string): CityMapModel | null {
  const hit = models.get(cityId); if (hit) return hit;
  const spec = CATALOGUE.find(c => c.id === cityId), data = REAL_DATA[cityId];
  if (!spec || !data) return null;
  const overview = decodeOverview(data.overview);
  const areas = spec.areas.filter(a => data.areas[a.id]).map(a => ({ key: `${cityId}/${a.id}`, name: a.name, quad: areaQuad(overview, a.at, data.areas[a.id].angle) }));
  const m = { cityId, name: spec.name, overview, areas };
  models.set(cityId, m);
  return m;
}

export function areaCardInfo(key: string, best: Record<string, { pct: number; medal?: string | null }>, d: C.Difficulty) {
  const f = C.areaByKey(key), b = best[bestKey(key, d)];
  return {
    title: f?.area.name ?? key, city: f?.city.name ?? "", blurb: f?.city.blurb ?? "",
    best: b ? `${b.medal ?? "No medal"} · ${b.pct.toFixed(0)} pts` : "Not played",
    medal: b?.medal ?? null,
  };
}

// ---- DOM (browser only)
const OV_RGB: Record<number, string> = { [OV_LAND]: "#3a3c38", [OV_BUILT]: "#5a5853", [OV_PARK]: "#2f5a31", [OV_WATER]: "#1d3d66", [OV_ROAD]: "#b89a52", [OV_RAIL]: "#7a4646" };
const imgCache = new Map<string, HTMLCanvasElement>();
function overviewImage(m: CityMapModel): HTMLCanvasElement {
  const hit = imgCache.get(m.cityId); if (hit) return hit;
  const o = m.overview, cv = document.createElement("canvas"); cv.width = o.w; cv.height = o.h;
  const ctx = cv.getContext("2d")!, img = ctx.createImageData(o.w, o.h);
  const rgb = Object.fromEntries(Object.entries(OV_RGB).map(([k, hex]) => [k, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));
  for (let i = 0; i < o.px.length; i++) { const c = rgb[o.px[i]]; if (c) { img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; } }
  ctx.putImageData(img, 0, 0); imgCache.set(m.cityId, cv);
  return cv;
}

export interface CityMapView { scale: number; ox: number; oy: number }
export interface CityMapUi { model: CityMapModel; view: CityMapView; selected: number; onPick: (i: number) => void; medalColor: (key: string) => string | null }

/** Fit the overview into the canvas. */
export function fitView(m: CityMapModel, cw: number, ch: number): CityMapView {
  const scale = Math.min(cw / m.overview.w, ch / m.overview.h);
  return { scale, ox: (cw - m.overview.w * scale) / 2, oy: (ch - m.overview.h * scale) / 2 };
}

export function drawCityMap(cv: HTMLCanvasElement, ui: CityMapUi) {
  const ctx = cv.getContext("2d")!, { view: v, model: m } = ui;
  ctx.fillStyle = "#101216"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overviewImage(m), v.ox, v.oy, m.overview.w * v.scale, m.overview.h * v.scale);
  m.areas.forEach((a, i) => {
    ctx.beginPath();
    a.quad.forEach(([x, y], k) => { const px = v.ox + x * v.scale, py = v.oy + y * v.scale; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
    const medal = ui.medalColor(a.key);
    if (medal) { ctx.fillStyle = medal + "55"; ctx.fill(); }
    ctx.lineWidth = i === ui.selected ? 3 * devicePixelRatio : 1.5 * devicePixelRatio;
    ctx.strokeStyle = i === ui.selected ? "#ffffff" : "#ffd54f"; ctx.stroke();
  });
}

/** Pointer handling: a tap (moved under 8 px) picks; a drag pans; wheel or two-finger pinch zooms. */
export function bindCityMap(cv: HTMLCanvasElement, getUi: () => CityMapUi | null, redraw: () => void) {
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let pinch0 = 0, scale0 = 1;
  const local = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  const zoomAt = (ui: CityMapUi, x: number, y: number, s: number) => {
    const v = ui.view, ns = Math.max(0.2, Math.min(20, s));
    v.ox = x - (x - v.ox) * ns / v.scale; v.oy = y - (y - v.oy) * ns / v.scale; v.scale = ns;
  };
  cv.addEventListener("pointerdown", e => {
    const [x, y] = local(e); pts.set(e.pointerId, { x, y, sx: x, sy: y }); cv.setPointerCapture(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); scale0 = getUi()?.view.scale ?? 1; }
  });
  cv.addEventListener("pointermove", e => {
    const p = pts.get(e.pointerId), ui = getUi(); if (!p || !ui) return;
    const [x, y] = local(e);
    if (pts.size === 1) { ui.view.ox += x - p.x; ui.view.oy += y - p.y; }
    p.x = x; p.y = y;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) zoomAt(ui, (a.x + b.x) / 2, (a.y + b.y) / 2, scale0 * d / pinch0); }
    redraw();
  });
  const up = (e: PointerEvent) => {
    const p = pts.get(e.pointerId), ui = getUi(); pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0;
    if (!p || !ui || Math.hypot(p.x - p.sx, p.y - p.sy) >= 8 * devicePixelRatio) return;
    const v = ui.view, i = areaAt(ui.model.areas.map(a => a.quad), (p.x - v.ox) / v.scale, (p.y - v.oy) / v.scale);
    if (i >= 0) ui.onPick(i);
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", e => pts.delete(e.pointerId));
  cv.addEventListener("wheel", e => { const ui = getUi(); if (!ui) return; e.preventDefault(); const [x, y] = local(e); zoomAt(ui, x, y, ui.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); redraw(); }, { passive: false });
}
