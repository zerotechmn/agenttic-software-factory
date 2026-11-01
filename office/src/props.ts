import { Container, Graphics } from "pixi.js";
import { T } from "./map";

const STATUS_COLOR: Record<string, number> = { backlog: 0xb8b0a0, ready: 0xb8b0a0, running: 0xf2a541, review: 0x5fa8d3, merged: 0x6cc36a, parked: 0xd9534f, blocked: 0xd9534f };

/** Live, animated set dressing: task board, whiteboard, QA dial, server LEDs, coffee steam, confetti. */
export class Props {
  readonly layer = new Container();
  /** The cork board graphic (main.ts makes it clickable). */
  readonly board = new Graphics();
  private white = new Graphics();
  private scribbles = new Graphics();
  private dial = new Graphics();
  private leds = new Graphics();
  private steam = new Container();
  private t = 0;
  private qaScore = -1;
  private deployed = false;
  private scribbleT = 0;

  constructor() {
    // cork task board on the dev floor wall band (left of the sign)
    this.layer.addChild(this.board);
    this.drawBoard([]);
    // freestanding whiteboard in architecture (against the back wall)
    this.white.rect(0, 0, 26, 15).fill(0x6e4429).rect(1, 1, 24, 13).fill(0xf4f6f2).rect(3, 15, 1, 5).fill(0x6e4429).rect(22, 15, 1, 5).fill(0x6e4429).rect(1, 13, 24, 1).fill(0xc9cdc4);
    this.white.position.set(25 * T - 2, 2 * T + 1);
    this.scribbles.position.copyFrom(this.white.position);
    this.layer.addChild(this.white, this.scribbles);
    // QA dial on the QA lab wall band, right of the sign
    this.dial.position.set(32.3 * T, 11 * T + 16);
    this.layer.addChild(this.dial);
    this.drawDial();
    this.layer.addChild(this.leds, this.steam);
  }

  drawBoard(tasks: { id: string; status: string }[]) {
    const g = this.board.clear();
    const x = 0.6 * T, y = 11 * T + 6, w = 4.2 * T, h = 20;
    g.rect(x - 1, y - 1, w + 2, h + 2).fill(0x5b3a24).rect(x, y, w, h).fill(0xb8875a);
    for (let i = 0; i < 6; i++) g.rect(x + 3 + i * 11, y + 2, 1, 1).fill(0x9a6e45);
    tasks.slice(0, 24).forEach((t, i) => {
      const cx = x + 2 + (i % 12) * 5.5, cy = y + 3 + Math.floor(i / 12) * 8;
      g.rect(Math.round(cx), Math.round(cy), 4, 5).fill(STATUS_COLOR[t.status] ?? 0xb8b0a0).rect(Math.round(cx) + 1, Math.round(cy), 2, 1).fill(0xd94a4a);
    });
  }

  setQa(score: number) {
    this.qaScore = score;
    this.drawDial();
  }

  private drawDial() {
    const g = this.dial.clear();
    g.circle(0, 0, 9).fill(0x3b2618).circle(0, 0, 8).fill(0xfdf8ec);
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (0.75 + 1.5 * (i / 10));
      g.rect(Math.round(Math.cos(a) * 6), Math.round(Math.sin(a) * 6), 1, 1).fill(i >= 7 ? 0x2e7d32 : 0x8f8a7e);
    }
    const v = this.qaScore < 0 ? 0 : this.qaScore;
    const a = Math.PI * (0.75 + 1.5 * (v / 10));
    for (let r = 0; r <= 5; r++) g.rect(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), 1, 1).fill(this.qaScore >= 7 ? 0x2e7d32 : 0xb3261e);
    g.rect(-1, -1, 2, 2).fill(0x3b2618);
  }

  setDeployed(ok: boolean) {
    this.deployed = ok;
  }

  /** Animate per frame. `architectBusy` scribbles on the whiteboard. */
  update(dtMs: number, architectBusy: boolean) {
    this.t += dtMs;
    // server LEDs: random blink, steady green once deployed
    const g = this.leds.clear();
    for (const rx of [34, 38, 39]) {
      for (let i = 0; i < 4; i++) {
        const on = this.deployed || ((Math.floor(this.t / 180) + i * 7 + rx) % 5) !== 0;
        g.rect(rx * T + 11, 13 * T + 4 + i * 5, 1, 1).fill(on ? (this.deployed || i % 2 ? 0x4ade80 : 0xffb347) : 0x2a2d33);
      }
    }
    // coffee steam from the stove
    if (Math.floor(this.t / 420) !== Math.floor((this.t - dtMs) / 420)) {
      const p = new Graphics().rect(0, 0, 1, 1).fill(0xffffff);
      p.alpha = 0.7;
      p.position.set(36 * T + 6 + Math.floor(Math.random() * 5), 2 * T + 2);
      this.steam.addChild(p);
    }
    for (const p of [...this.steam.children]) {
      p.y -= dtMs * 0.012;
      p.alpha -= dtMs * 0.0012;
      if (Math.random() < 0.05) p.x += Math.random() < 0.5 ? -1 : 1;
      p.y = Math.round(p.y);
      if (p.alpha <= 0) p.destroy();
    }
    // whiteboard scribbles grow while the architect works
    if (architectBusy) {
      this.scribbleT += dtMs;
      if (this.scribbleT > 260) {
        this.scribbleT = 0;
        const c = this.scribbles;
        if (c.children.length > 40) c.removeChildren();
        const colors = [0x2a6fb5, 0xb3261e, 0x2e7d32, 0x2a1a10];
        const line = new Graphics().rect(0, 0, 2 + Math.floor(Math.random() * 7), 1).fill(colors[Math.floor(Math.random() * colors.length)]);
        line.position.set(3 + Math.floor(Math.random() * 18), 3 + Math.floor(Math.random() * 9));
        c.addChild(line);
      }
    }
  }

  confetti(world: Container, width: number) {
    const colors = [0xffd166, 0xef476f, 0x06d6a0, 0x118ab2, 0xf78c6b];
    for (let i = 0; i < 140; i++) {
      const p = new Graphics().rect(0, 0, 2, 2).fill(colors[i % colors.length]);
      p.position.set(Math.floor(Math.random() * width), -Math.floor(Math.random() * 80));
      world.addChild(p);
      const vy = 25 + Math.random() * 40, vx = (Math.random() - 0.5) * 20;
      let life = 0;
      const tick = () => {
        life += 16;
        p.y = Math.round(p.y + (vy * 16) / 1000);
        p.x = Math.round(p.x + (vx * 16) / 1000 + Math.sin(life / 120));
        if (life > 4500) p.destroy();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }
}
