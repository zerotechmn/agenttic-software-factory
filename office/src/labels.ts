import { Container, Graphics, Text } from "pixi.js";

/**
 * Screen-space text: never scaled with the pixel world, so letters stay crisp at any DPI.
 * Each label follows a world point; positions are synced every frame from the world transform.
 */
/** Left edge for a width-`w` label so it stays inside [lo, hi]; the start wins when it cannot fit. */
export function clampSpan(left: number, w: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(left, hi - w));
}

/** Which sign boxes (priority order) to show: hidden if clipped by its room span or overlapping an earlier shown one. */
export interface Box { x: number; y: number; w: number; h: number; room: number }
export function visibleBoxes(boxes: Box[]): boolean[] {
  const shown: Box[] = [];
  return boxes.map((b) => {
    const ok = b.room >= b.w && !shown.some((o) => b.x < o.x + o.w + 4 && o.x < b.x + b.w + 4 && b.y < o.y + o.h && o.y < b.y + b.h);
    if (ok) shown.push(b);
    return ok;
  });
}

/** World-px horizontal extent of the room a label belongs to; its text is kept inside the visible part. */
export interface Span { x0: number; x1: number }

export class Labels {
  readonly layer = new Container();
  private items: { view: Container; at: () => { x: number; y: number }; span?: Span }[] = [];
  scale = 3;
  origin = { x: 0, y: 0 };
  viewWidth = Infinity;

  add(view: Container, at: () => { x: number; y: number }, span?: Span) {
    this.items.push({ view, at, span });
    this.layer.addChild(view);
    return view;
  }

  remove(view: Container) {
    this.items = this.items.filter((i) => i.view !== view);
    view.destroy({ children: true });
  }

  sync() {
    const boxes: Box[] = [];
    const spanned: Container[] = [];
    for (const i of this.items) {
      const p = i.at();
      let x = Math.round(this.origin.x + p.x * this.scale);
      if (i.span) {
        const w = i.view.width, ax = (i.view as Text).anchor?.x ?? 0;
        const lo = Math.max(0, this.origin.x + i.span.x0 * this.scale);
        const hi = Math.min(this.viewWidth, this.origin.x + i.span.x1 * this.scale);
        x = Math.round(clampSpan(x - ax * w, w, lo, hi) + ax * w);
        boxes.push({ x: x - ax * w, y: Math.round(this.origin.y + p.y * this.scale), w, h: i.view.height, room: hi - lo });
        spanned.push(i.view);
      }
      i.view.position.set(x, Math.round(this.origin.y + p.y * this.scale));
    }
    const vis = visibleBoxes(boxes);
    spanned.forEach((v, k) => { v.visible = vis[k]; });
  }
}

const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));

export function pixelText(text: string, size: number, fill: number, stroke?: number): Text {
  const t = new Text({ text, style: { fontFamily: "Press Start 2P", fontSize: size, fill, ...(stroke !== undefined ? { stroke: { color: stroke, width: Math.max(2, size / 4) } } : {}), letterSpacing: 1 } });
  t.resolution = RES;
  return t;
}

export function bodyText(text: string, size: number, fill: number, stroke?: number): Text {
  const t = new Text({ text, style: { fontFamily: "VT323", fontSize: size, fill, ...(stroke !== undefined ? { stroke: { color: stroke, width: 4 } } : {}) } });
  t.resolution = RES;
  return t;
}

/** A speech bubble with a hard pixel border and a tail, drawn in screen space. */
export function bubble(text: string, tone: "info" | "bad" | "good" = "info"): Container {
  const c = new Container();
  const t = bodyText(text, 22, 0x2a1a10);
  const pad = 8;
  const w = Math.ceil(t.width) + pad * 2, h = Math.ceil(t.height) + pad - 2;
  const edge = tone === "bad" ? 0xb3261e : tone === "good" ? 0x2e7d32 : 0x2a1a10;
  const g = new Graphics()
    .rect(-w / 2 + 3, -h - 12, w - 6, h).fill(0xfff6e0)
    .rect(-w / 2, -h - 9, w, h - 6).fill(0xfff6e0)
    .rect(-w / 2 + 3, -h - 15, w - 6, 3).fill(edge).rect(-w / 2 + 3, -12, w - 6, 3).fill(edge)
    .rect(-w / 2 - 3, -h - 9, 3, h - 6).fill(edge).rect(w / 2, -h - 9, 3, h - 6).fill(edge)
    .rect(-w / 2, -h - 12, 3, 3).fill(edge).rect(w / 2 - 3, -h - 12, 3, 3).fill(edge).rect(-w / 2, -15, 3, 3).fill(edge).rect(w / 2 - 3, -15, 3, 3).fill(edge)
    .rect(-6, -12, 9, 3).fill(0xfff6e0).rect(-3, -9, 6, 3).fill(0xfff6e0).rect(-9, -12, 3, 3).fill(edge).rect(3, -12, 3, 3).fill(edge).rect(-6, -9, 3, 3).fill(edge).rect(3, -9, 3, 3).fill(edge).rect(-3, -6, 6, 3).fill(edge);
  t.anchor.set(0.5, 0);
  t.position.set(0, -h - 10);
  c.addChild(g, t);
  return c;
}
