import { ROOMS, T, type Room } from "./map";

export interface Worker { name: string; working: boolean; on?: string }

/** The room containing a world-pixel point (corridor / outside → undefined). */
export function roomAt(wx: number, wy: number): Room | undefined {
  const x = wx / T, y = wy / T;
  return ROOMS.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && !(y >= 9 && y < 11));
}

/** Tooltip text: room label, then one line per worker ("<name>: working on X" / "<name>: idle"), or "nobody here". */
export function roomText(room: Room, workers: Worker[]): string {
  if (!workers.length) return `${room.label}\nnobody here`;
  const lines = workers.map((w) => (w.working ? `${w.name}: working on ${w.on ?? "task"}` : `${w.name}: idle`));
  return [room.label, ...lines].join("\n");
}

const GAP = 18;

/** Pixel-framed DOM tooltip that follows the cursor, clamped inside the viewport. */
export class Tooltip {
  readonly el = document.createElement("div");

  constructor() {
    this.el.id = "room-tip";
    this.el.style.cssText =
      "position:fixed;display:none;pointer-events:none;z-index:20;left:0;top:0;max-width:320px;" +
      'font-family:"VT323",monospace;font-size:20px;line-height:22px;white-space:pre;color:#fff6e0;' +
      "background:rgba(42,26,16,.95);border:3px solid #000;box-shadow:inset 0 0 0 3px #6e4429,0 4px 0 rgba(0,0,0,.35);padding:8px 12px";
    document.body.appendChild(this.el);
  }

  /** Show `text` near screen point (sx, sy): right/below of the cursor, flipped when it would overflow. */
  show(text: string, sx: number, sy: number): void {
    const el = this.el;
    const [head, ...rest] = text.split("\n");
    el.textContent = "";
    const h = document.createElement("div");
    h.textContent = head;
    h.style.cssText = 'font-family:"Press Start 2P",monospace;font-size:10px;line-height:16px;color:#ffd166;margin-bottom:4px';
    el.appendChild(h);
    for (const l of rest) {
      const d = document.createElement("div");
      d.textContent = l;
      el.appendChild(d);
    }
    el.style.display = "block";
    const w = el.offsetWidth, ht = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = sx + GAP, y = sy + GAP;
    if (x + w > vw) x = sx - GAP - w;
    if (y + ht > vh) y = sy - GAP - ht;
    x = Math.max(0, Math.min(x, vw - w));
    y = Math.max(0, Math.min(y, vh - ht));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }

  hide(): void {
    this.el.style.display = "none";
  }
}
