import { EXIT_TILE, HALL_TILE } from "./life";
import { Container, Graphics } from "pixi.js";
import type { Agent } from "./agent";
import { SPEED } from "./agent";
import type { Command } from "./director";
import { bodyText, bubble, Labels, pixelText } from "./labels";
import type { Grid } from "./path";
import { T, COLS } from "./map";
import type { Props } from "./props";

type Hud = (c: Command) => void;

/** A pixel beer mug like 🍺 (7 × 8 world px): foam on top, amber beer, glass edge and a handle. */
export function beerMug(): Graphics {
  return new Graphics()
    .rect(0, 0, 5, 2).fill(0xfdf8ec)          // foam
    .rect(1, -1, 2, 1).fill(0xfdf8ec)         // foam bubble on top
    .rect(0, 2, 5, 6).fill(0xe8a33a)          // beer
    .rect(1, 3, 1, 4).fill(0xf6c55e)          // highlight
    .rect(0, 7, 5, 1).fill(0xc9852b)          // base
    .rect(5, 3, 2, 1).fill(0xd8e2e8)          // handle top
    .rect(6, 4, 1, 2).fill(0xd8e2e8)          // handle side
    .rect(5, 6, 2, 1).fill(0xd8e2e8);         // handle bottom
}

export function item(kind: "paper" | "folder" | "bug"): Graphics {
  const g = new Graphics();
  if (kind === "paper") g.rect(0, 0, 6, 8).fill(0xfdfbf5).rect(0, 0, 6, 1).fill(0xc9c2b2).rect(1, 2, 4, 1).fill(0x8f8a7e).rect(1, 4, 4, 1).fill(0x8f8a7e).rect(1, 6, 3, 1).fill(0x8f8a7e);
  else if (kind === "folder") g.rect(0, 1, 8, 6).fill(0xe0a64a).rect(0, 0, 3, 1).fill(0xe0a64a).rect(0, 6, 8, 1).fill(0xa8732a).rect(1, 2, 6, 1).fill(0xf1c27a);
  else g.rect(2, 1, 6, 5).fill(0x3f9b3a).rect(3, 0, 1, 1).fill(0x2a1a10).rect(6, 0, 1, 1).fill(0x2a1a10).rect(0, 1, 2, 1).fill(0x2a1a10).rect(8, 1, 2, 1).fill(0x2a1a10).rect(0, 3, 2, 1).fill(0x2a1a10).rect(8, 3, 2, 1).fill(0x2a1a10).rect(0, 5, 2, 1).fill(0x2a1a10).rect(8, 5, 2, 1).fill(0x2a1a10).rect(3, 2, 1, 1).fill(0xb3261e).rect(6, 2, 1, 1).fill(0xb3261e);
  g.scale.set(2); // whole-pixel 2x so carried items read at a glance
  return g;
}

const animate = (ms: number, fn: (t: number) => void, done?: () => void) => {
  const start = performance.now();
  const total = ms / Math.min(SPEED, 6);
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / total);
    fn(t);
    if (t < 1) requestAnimationFrame(tick);
    else done?.();
  };
  requestAnimationFrame(tick);
};

/** Executes director commands on the pixel stage. Each agent runs its errands one at a time. */
export class Stage {
  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();
  private bubbles = new Map<string, { view: Container; until: number }>();
  private vault?: Container;
  private tagViews = new Map<string, Container>();

  /** Current text tag per agent key ("SENIOR"), maintained by the `tag` command. */
  readonly tags = new Map<string, string>();

  /** While true (catching up on a live run's history) only state updates apply, no animations. */
  instant = false;

  constructor(private agents: Map<string, Agent>, private grid: Grid, private props: Container, private fx: Container, private labels: Labels, private hud: Hud, private set: Props, private world: Container) {
    for (const a of agents.values()) this.nameTag(a);
    const v = pixelText("0 FILED", 16, 0xfff4dc, 0x2a1a10);
    v.anchor.set(0.5, 1);
    this.vault = labels.add(v, () => ({ x: 23.5 * T, y: 20.6 * T }));
  }

  private nameTags = new Map<string, Container>();

  private nameTag(a: Agent) {
    const tag = bodyText(a.name, 22, 0xfff4dc, 0x2a1a10);
    tag.anchor.set(0.5, 1);
    this.nameTags.set(a.key, this.labels.add(tag, () => a.head()));
  }

  /** Add a character after boot (a Claude Code visitor). */
  addAgent(a: Agent) {
    this.agents.set(a.key, a);
    this.props.addChild(a.view);
    this.nameTag(a);
  }

  /** Remove a character added with addAgent, with its name tag, bubble and tag. */
  removeAgent(key: string) {
    const a = this.agents.get(key);
    if (!a) return;
    for (const m of [this.nameTags, this.tagViews] as Map<string, Container>[]) {
      const v = m.get(key);
      if (v) { this.labels.remove(v); m.delete(key); }
    }
    const b = this.bubbles.get(key);
    if (b) { this.labels.remove(b.view); this.bubbles.delete(key); }
    this.queues.delete(key);
    this.pending.delete(key);
    this.agents.delete(key);
    a.view.destroy({ children: true });
  }

  update() {
    const now = performance.now();
    for (const [k, b] of this.bubbles) if (now > b.until) { this.labels.remove(b.view); this.bubbles.delete(k); }
  }

  private enqueue(agent: string, job: () => Promise<void>) {
    const n = this.pending.get(agent) ?? 0;
    if (n > 2) return; // falling behind (fast replay): skip the animation, keep the HUD in sync
    this.pending.set(agent, n + 1);
    const prev = this.queues.get(agent) ?? Promise.resolve();
    this.queues.set(agent, prev.then(job).catch(() => undefined).finally(() => this.pending.set(agent, (this.pending.get(agent) ?? 1) - 1)));
  }

  /** A walkable tile next to someone's desk, preferring the front. */
  private meet(a: Agent) {
    const c = a.cell;
    for (const d of [{ x: 0, y: 2 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 3 }, { x: -1, y: 1 }, { x: 1, y: 1 }]) {
      const p = { x: c.x + d.x, y: c.y + d.y };
      if (this.grid.walkable(p.x, p.y)) return p;
    }
    return c;
  }

  private say(a: Agent, text: string, ms = 2200, tone: "info" | "bad" | "good" = "info") {
    const old = this.bubbles.get(a.key);
    if (old) this.labels.remove(old.view);
    const b = bubble(text, tone);
    this.labels.add(b, () => ({ x: a.head().x, y: a.head().y - 8 })); // above the name tag
    this.bubbles.set(a.key, { view: b, until: performance.now() + ms / Math.min(SPEED, 4) });
  }

  private pop(at: { x: number; y: number }, text: string, color: number) {
    const t = pixelText(text, 24, color, 0x2a1a10);
    t.anchor.set(0.5, 1);
    const base = { ...at };
    const view = this.labels.add(t, () => base);
    animate(900, (k) => { base.y = at.y - 6 - k * 8; t.alpha = 1 - Math.max(0, k - 0.6) / 0.4; }, () => this.labels.remove(view));
  }

  exec(c: Command) {
    const A = (k: string) => this.agents.get(k);
    if (this.instant && ["bubble", "alert", "stamp", "handoff", "throw", "celebrate"].includes(c.type)) return;
    switch (c.type) {
      case "board":
        this.set.drawBoard(c.tasks);
        break;
      case "sfx":
        break;
      case "beerOut": {
        const a = A(c.agent);
        if (!a || this.instant) break;
        this.enqueue(c.agent, () => new Promise<void>((done) => {
          a.errand = true;
          // through the hall by the lobby, to the building's edge, then out of sight
          a.walkTo(HALL_TILE, () => a.walkTo(EXIT_TILE, () => animate(300, (k) => { a.view.alpha = 1 - k; }, () => done())));
        }));
        break;
      }
      case "beerReturn": {
        const a = A(c.agent);
        if (!a) break;
        if (this.instant) { a.view.alpha = 1; a.goHome(); a.setWorking(c.work); break; }
        this.enqueue(c.agent, () => new Promise<void>((done) => {
          // back in through the same door, a bottle in hand
          const bottle = beerMug();
          bottle.scale.set(1.4);
          a.carry = bottle;
          a.view.addChild(bottle);
          animate(300, (k) => { a.view.alpha = k; });
          a.goHome(() => {
            a.errand = false;
            a.view.removeChild(bottle);
            a.carry = undefined;
            const h = a.head();
            const rest = { x: h.x + 5, y: h.y + 9 };
            bottle.pivot.set(3, 4);
            bottle.position.set(rest.x, rest.y);
            this.fx.addChild(bottle);
            // open it (hiss and pop), then three sips timed with the gulps in the sound effect
            this.hud({ type: "sfx", name: "beer" });
            this.pop({ x: rest.x, y: rest.y - 6 }, "fsss", 0xfdf8ec);
            const sip = (atMs: number) => setTimeout(() => animate(300, (k) => {
              const up = Math.sin(Math.PI * k);
              bottle.rotation = -1.1 * up;
              bottle.position.set(Math.round(rest.x - 3 * up), Math.round(rest.y - 6 * up));
            }), atMs);
            [1000, 1380, 1760].forEach(sip);
            setTimeout(() => {
              this.say(a, "🍺 aaah…", 2200, "good");
              a.setWorking(c.work);
              done();
            }, 2300);
            // the empty bottle stays on the desk for a bit, then fades
            setTimeout(() => animate(800, (k) => { bottle.alpha = 1 - k; }, () => bottle.destroy()), 9000);
          });
        }));
        break;
      }
      case "deployed":
        this.set.setDeployed(c.ok);
        this.hud({ type: "ticker", who: "deploy", text: c.ok ? "live ✓" : "failed", tone: c.ok ? "good" : "bad" });
        break;
      case "celebrate": {
        this.set.confetti(this.world, COLS * T);
        const spots = [...Array(COLS - 4).keys()].map((x) => ({ x: x + 2, y: 9 + (x % 2) }));
        let i = 0;
        for (const a of this.agents.values()) {
          const spot = spots[(i++ * 3) % spots.length];
          this.enqueue(a.key, () => new Promise<void>((done) => a.walkTo(spot, () => { this.say(a, "🎉", 3000, "good"); setTimeout(() => a.goHome(() => done()), 3500); })));
        }
        break;
      }
      case "qa":
        this.set.setQa(c.score);
        this.hud(c);
        break;
      case "work": {
        const a = A(c.agent);
        if (a) a.setWorking(c.on);
        break;
      }
      case "bubble": {
        const a = A(c.agent);
        if (a) this.say(a, c.text);
        break;
      }
      case "alert": {
        const a = A(c.agent);
        if (!a) break;
        a.shakeMs = 450;
        this.pop(a.head(), c.mood === "bad" ? "!" : "★", c.mood === "bad" ? 0xff5a4e : 0x7ee081);
        break;
      }
      case "stamp": {
        const a = A(c.agent);
        if (a) this.pop(a.head(), c.ok ? "✓" : "✗", c.ok ? 0x7ee081 : 0xff5a4e);
        break;
      }
      case "handoff": {
        const from = A(c.from), to = A(c.to);
        if (!from || !to || from === to) break;
        this.enqueue(c.from, () => new Promise<void>((done) => {
          const g = item(c.item);
          from.carry = g;
          from.errand = true;
          from.view.addChild(g);
          from.walkTo(this.meet(to), () => {
            from.view.removeChild(g);
            from.carry = undefined;
            g.position.set(to.head().x - 3, to.head().y + 10);
            this.fx.addChild(g);
            animate(500, (k) => { g.alpha = 1 - k; }, () => g.destroy());
            this.pop(to.head(), "+1", 0xffd166);
            setTimeout(() => from.goHome(() => { from.errand = false; done(); }), 350 / Math.min(SPEED, 6));
          });
        }));
        break;
      }
      case "throw": {
        const from = A(c.from), to = A(c.to);
        if (!from || !to) break;
        const g = item("paper");
        this.fx.addChild(g);
        const a = from.head(), b = to.head();
        animate(700, (k) => {
          g.position.set(Math.round(a.x + (b.x - a.x) * k), Math.round(a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 28));
          g.rotation = k * 6;
        }, () => { g.destroy(); this.say(to, "argh, rejected", 1800, "bad"); });
        break;
      }
      case "merged": {
        if (this.vault) (this.vault as unknown as { text: string }).text = `${c.count} FILED`;
        this.pop({ x: 23.5 * T, y: 13 * T }, "★", 0xffd166);
        this.hud(c);
        break;
      }
      case "walk": {
        const a = A(c.agent);
        if (!a || this.instant) break;
        this.enqueue(c.agent, () => new Promise<void>((done) => a.walkTo(c.to, done)));
        break;
      }
      case "home": {
        const a = A(c.agent);
        if (!a) break;
        a.view.alpha = 1; // called back mid beer run: reappear
        if (this.instant) { a.setWorking(c.work); break; }
        this.enqueue(c.agent, () => new Promise<void>((done) => a.goHome(() => { a.setWorking(c.work); done(); })));
        break;
      }
      case "tag": {
        const a = A(c.agent);
        const old = this.tagViews.get(c.agent);
        if (old) { this.labels.remove(old); this.tagViews.delete(c.agent); }
        this.tags.delete(c.agent);
        if (!a || c.text === null) break;
        const t = pixelText(c.text, 16, 0x2a1a10, 0xffd166);
        t.anchor.set(0.5, 0);
        this.tagViews.set(c.agent, this.labels.add(t, () => ({ x: a.head().x, y: a.head().y + 19 })));
        this.tags.set(c.agent, c.text);
        break;
      }
      default:
        this.hud(c);
    }
  }
}

/** Resolve with `p`, or with `fallback` after `ms`, so a slow dependency can never stall boot. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
