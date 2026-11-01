import { Container, Graphics } from "pixi.js";
import { character, CHARACTERS } from "./sprites";

export let SPEED = 1;
export const setSpeed = (s: number) => (SPEED = s);
import { findPath, seatCell, type Cell, type Grid } from "./path";
import { T } from "./map";

export type Mode = "idle" | "working" | "walking";
const WALK_PX_PER_S = 52;
/** Handoff errands (carrying work, and the walk back) move faster than idle wandering. */
export const ERRAND_BOOST = 1.6;
export const walkMultiplier = (errand: boolean) => (errand ? ERRAND_BOOST : 1);

/** One office worker. All motion is snapped to whole world pixels (no sub-pixel shimmer at 3× scale). */
export class Agent {
  readonly view = new Container();
  private body: Container;
  readonly name: string;
  shakeMs = 0;
  mode: Mode = "idle";
  private seat: { x: number; y: number };
  private path: { x: number; y: number }[] = [];
  private pos: { x: number; y: number };
  private t = Math.random() * 1000;
  private walked = 0;
  private onArrive?: () => void;
  carry?: Container;
  errand = false;

  constructor(readonly key: string, role: string, seat: { x: number; y: number }, private grid: Grid, private fx: Container, label?: string) {
    this.seat = seat;
    this.body = character(role);
    this.view.addChild(this.body);
    this.name = label ?? CHARACTERS[role]?.name ?? role;
    this.pos = this.seatPos();
    this.place();
  }

  /** Feet position while seated: just behind the desk so it hides the legs. */
  private seatPos() {
    return { x: Math.round(this.seat.x * T), y: Math.round(this.seat.y * T) + 3 };
  }

  private cellCenter(c: Cell) {
    return { x: c.x * T + 8, y: c.y * T + 13 };
  }

  get cell(): Cell {
    return seatCell(this.seat);
  }

  private atSeat() {
    return Math.abs(this.pos.y - this.seatPos().y) < 1 && Math.abs(this.pos.x - this.seatPos().x) < 1;
  }

  /** Walk to a tile (via A*), run `then`, optionally walk back to the seat. */
  walkTo(target: Cell, then?: () => void) {
    const here = { x: Math.floor(this.pos.x / T), y: Math.floor(this.pos.y / T) };
    // start from where we stand (after a handoff that is far from the seat), not from the seat cell
    const from = (this.mode === "walking" && this.path.length) || (this.grid.walkable(here.x, here.y) && !this.atSeat()) ? here : this.cell;
    const route = findPath(this.grid, from, target);
    if (!route) return then?.();
    this.path = [...route.map((c) => this.cellCenter(c))];
    this.mode = "walking";
    this.onArrive = then;
  }

  goHome(then?: () => void) {
    this.walkTo(this.cell, () => {
      this.path = [this.seatPos()];
      this.mode = "walking";
      this.onArrive = () => {
        this.mode = "idle";
        then?.();
      };
    });
  }

  setWorking(on: boolean) {
    if (this.mode !== "walking") this.mode = on ? "working" : "idle";
  }

  update(dtMs: number) {
    this.t += dtMs;
    let bob = 0;
    if (this.mode === "walking" && this.path.length) {
      const next = this.path[0];
      const dx = next.x - this.pos.x, dy = next.y - this.pos.y;
      const dist = Math.hypot(dx, dy);
      const step = (WALK_PX_PER_S * walkMultiplier(this.errand) * Math.min(SPEED, 6) * dtMs) / 1000;
      if (dist <= step) {
        this.pos = { ...next };
        this.path.shift();
      } else {
        this.pos = { x: this.pos.x + (dx / dist) * step, y: this.pos.y + (dy / dist) * step };
      }
      if (Math.abs(dx) > 0.5) this.body.scale.x = dx < 0 ? -1 : 1;
      const before = Math.floor(this.walked / 6);
      this.walked += Math.min(step, dist);
      if (Math.floor(this.walked / 6) !== before && Math.floor(this.walked / 6) % 2 === 0) this.puff();
      bob = Math.floor(this.walked / 6) % 2 ? -1 : 0;
      if (!this.path.length) {
        this.mode = "idle";
        const cb = this.onArrive;
        this.onArrive = undefined;
        cb?.();
      }
    } else if (this.mode === "working") {
      bob = Math.floor(this.t / 140) % 2 ? -1 : 0; // quick "typing" pulse
    } else {
      bob = Math.floor(this.t / 650) % 2 ? -1 : 0; // slow breathing
    }
    this.place(bob);
  }

  /** World point just above the head (for screen-space labels and bubbles). */
  head(): { x: number; y: number } {
    return { x: Math.round(this.pos.x), y: Math.round(this.pos.y) - 17 };
  }

  private place(bob = 0) {
    let shake = 0;
    if (this.shakeMs > 0) {
      this.shakeMs -= 16;
      shake = Math.floor(this.shakeMs / 50) % 2 ? 1 : -1;
    }
    this.view.position.set(Math.round(this.pos.x) + shake, Math.round(this.pos.y));
    this.body.position.y = bob;
    if (this.carry) this.carry.position.set(Math.round(this.body.scale.x * 5 - this.carry.width / 2), Math.round(-14 - this.carry.height / 2 + bob)); // in front, chest height
    const seated = this.mode !== "walking" && this.atSeat();
    this.view.zIndex = seated ? this.view.y : this.view.y + 20;
  }

  private puff() {
    const g = new Graphics().rect(0, 0, 2, 2).fill(0xe8dcc4);
    g.position.set(Math.round(this.pos.x) - 1 + (Math.random() < 0.5 ? -3 : 3), Math.round(this.pos.y) - 1);
    g.alpha = 0.8;
    this.fx.addChild(g);
    let life = 0;
    const tick = () => {
      life += 16;
      g.alpha = 0.8 * (1 - life / 350);
      g.y -= life % 64 === 0 ? 1 : 0;
      if (life >= 350) g.destroy();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
