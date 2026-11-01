import { COLS, ROOMS, ROWS, T } from "./map";

export const ZOOMS = [2, 3, 4] as const;
/** Screen pixels reserved at the top for the HUD bar + ticker. */
export const TOP_INSET = 76;
/** Viewports narrower than this open at zoom 1 so more of the office is visible. */
export const NARROW = 700;

/** World container transform: integer scale and integer screen position. */
export interface View { scale: number; x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; w: number; h: number } // world px

export const OFFICE: Rect = { x: 0, y: 0, w: COLS * T, h: ROWS * T };

/** Largest zoom in ZOOMS at which `r` fits the viewport (below TOP_INSET), else 2; centred and clamped. Pure. */
export function fitView(r: Rect, screen: Size): View {
  let s: number = ZOOMS[0];
  for (const z of ZOOMS) if (r.w * z <= screen.width && r.h * z <= screen.height - TOP_INSET) s = z;
  return clampView({
    scale: s,
    x: Math.round(screen.width / 2 - (r.x + r.w / 2) * s),
    y: Math.round(TOP_INSET + (screen.height - TOP_INSET) / 2 - (r.y + r.h / 2) * s),
  }, screen);
}

/**
 * Whole-office fit that fills the screen: largest zoom whose width fits and whose height
 * overflows the usable area by at most 5% (the rest is reachable by panning). Pure.
 */
export function fillView(screen: Size): View {
  let s: number = ZOOMS[0];
  // Phones: the whole office can't fit; stay at zoom 2 (fills the height, pan sideways) instead of a tiny strip.
  if (screen.width < NARROW) return clampView({ scale: s, x: Math.round(screen.width / 2 - (OFFICE.w * s) / 2), y: 0 }, screen);
  for (const z of ZOOMS) if (OFFICE.w * z <= screen.width && OFFICE.h * z <= (screen.height - TOP_INSET) * 1.05) s = z;
  return clampView({ scale: s, x: 0, y: 0 }, screen);
}

/** Step zoom by dir (+1 in / -1 out) keeping the world point under screen point `at` fixed, then clamp. Pure. */
export function zoomAt(v: View, at: { x: number; y: number }, dir: 1 | -1, screen: Size): View {
  const i = ZOOMS.indexOf(v.scale as (typeof ZOOMS)[number]);
  const next = i < 0 ? (dir > 0 ? ZOOMS[0] : v.scale) : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
  const wx = (at.x - v.x) / v.scale;
  const wy = (at.y - v.y) / v.scale;
  return clampView({ scale: next, x: Math.round(at.x - wx * next), y: Math.round(at.y - wy * next) }, screen);
}

function clampAxis(pos: number, content: number, view: number, start: number): number {
  if (content <= view) return Math.round(start + (view - content) / 2);
  return Math.round(Math.min(start, Math.max(start + view - content, pos)));
}

/** Keep the view inside the office bounds (centre an axis when the office is smaller than the viewport). Pure. */
export function clampView(v: View, screen: Size): View {
  return {
    scale: v.scale,
    x: clampAxis(v.x, OFFICE.w * v.scale, screen.width, 0),
    y: clampAxis(v.y, OFFICE.h * v.scale, screen.height - TOP_INSET, TOP_INSET),
  };
}

/**
 * Owns the camera input: wheel zoom, drag pan, double-click room focus, F to fit.
 * `apply` receives every new view; main.ts sets world + labels from it.
 */
export class Camera {
  private view: View = { scale: 2, x: 0, y: 0 };
  private down: { x: number; y: number; view: View } | null = null;
  private moved = false;
  private lastWasDrag = false;

  constructor(private canvas: HTMLCanvasElement, private screen: () => Size, private apply: (v: View) => void) {
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const rect = canvas.getBoundingClientRect();
      this.set(zoomAt(this.view, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY < 0 ? 1 : -1, this.screen()));
    }, { passive: false });
    canvas.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, view: this.view };
      this.moved = false;
      this.lastWasDrag = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.down) return;
      const dx = e.clientX - this.down.x;
      const dy = e.clientY - this.down.y;
      if (!this.moved && Math.hypot(dx, dy) <= 5) return;
      this.moved = true;
      const v = this.down.view;
      this.set(clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, this.screen()));
    });
    const up = () => {
      if (!this.down) return;
      this.lastWasDrag = this.moved;
      this.down = null;
      this.moved = false;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", (e) => {
      const rect = canvas.getBoundingClientRect();
      const w = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const r = ROOMS.find((x) => w.x >= x.x * T && w.x < (x.x + x.w) * T && w.y >= x.y * T && w.y < (x.y + x.h) * T);
      if (r) this.focusRoom(r.id);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      this.fit();
    });
  }

  zoom(): number { return this.view.scale; }
  current(): View { return { ...this.view }; }

  set(v: View): void {
    this.view = v;
    this.apply(v);
  }

  /** Fit the whole office (F key, initial view, window resize). */
  fit(): void { this.set(fillView(this.screen())); }

  /** Centre and zoom onto a room by id. */
  focusRoom(id: string): void {
    const r = ROOMS.find((x) => x.id === id);
    if (r) this.set(fitView({ x: r.x * T, y: r.y * T, w: r.w * T, h: r.h * T }, this.screen()));
  }

  /** Screen (CSS px) → world px. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale };
  }

  /** True while the pointer is down and has moved > 5 px. */
  dragging(): boolean { return this.down !== null && this.moved; }

  /** True if the most recent pointerup ended a drag > 5 px; click handlers must ignore that click. */
  wasDrag(): boolean { return this.lastWasDrag; }
}
