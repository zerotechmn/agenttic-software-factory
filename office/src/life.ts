import type { Command } from "./director";

export type Rng = () => number;

const IDLE_MS = 20_000;
const MAX_COFFEE = 1;
const COFFEE_COOLDOWN_MS = 120_000;
const COFFEE_CHANCE = 0.25;
const COFFEE_STAY_MS = [8_000, 16_000] as const;
const BOOK_COOLDOWN_MS = 45_000;
const BOOK_CHANCE = 0.1;
const BOOK_STAY_MS = [4_000, 7_000] as const;

type Tile = { x: number; y: number };
/** Walkable floor tiles in the Coffee room and in front of the Research bookshelves (verified against buildGrid() in tests). */
export const COFFEE_TILES: Tile[] = [{ x: 35, y: 4 }, { x: 37, y: 4 }, { x: 38, y: 6 }, { x: 35, y: 7 }];
export const BOOKSHELF_TILES: Tile[] = [{ x: 13, y: 3 }, { x: 16, y: 3 }];

interface Run { kind: "coffee" | "bookshelf" | "beer"; tile: Tile; until: number }

/** Erka and Tuvshu never drink coffee: on a break they sneak out through the lobby and come back with a beer. */
export const BEER_AGENTS = new Set(["product", "dev:1"]);
/** The hall just below the lobby, and its left end: the way out of the building. */
export const HALL_TILE: Tile = { x: 4, y: 9 };
export const EXIT_TILE: Tile = { x: 0, y: 10 };
/** A quick trip: 2–3 s outside. */
const BEER_OUT_MS = [2_000, 3_000] as const;

/**
 * Pure "life in the office" decisions on run time (event ts ms, not wall time): coffee runs for agents idle
 * > 20 s (max 1 at once, once per 120 s each, 25% chance), bookshelf visits for the working researcher. Tracks idle/working from the director's
 * own commands via `observe`.
 */
export class Life {
  private working = new Map<string, boolean>();
  private idleSince = new Map<string, number>();
  private runs = new Map<string, Run>();
  private escalating = new Set<string>();
  private lastCoffee = new Map<string, number>();
  private lastBook = -Infinity;

  constructor(private rng: Rng = Math.random) {}

  /** See the commands the director just emitted for an event at `runMs`; may return extra commands (e.g. recall a coffee runner who got work). */
  observe(cmds: Command[], runMs: number): Command[] {
    const out: Command[] = [];
    for (const c of cmds) {
      if (c.type === "work") {
        this.working.set(c.agent, c.on);
        if (!c.on) this.idleSince.set(c.agent, runMs);
        else if (this.runs.has(c.agent) && !this.escalating.has(c.agent)) {
          this.runs.delete(c.agent);
          out.push({ type: "home", agent: c.agent, work: true });
        }
      } else if (c.type === "walk" && c.reason === "escalation") {
        this.escalating.add(c.agent);
        this.runs.delete(c.agent);
      } else if (c.type === "home") {
        this.escalating.delete(c.agent);
        this.runs.delete(c.agent);
        if (!c.work) this.idleSince.set(c.agent, runMs);
      }
    }
    return out;
  }

  /** Periodic tick (about every 500 ms of wall time) with the current run time. */
  tick(runMs: number): Command[] {
    const out: Command[] = [];
    for (const [agent, run] of [...this.runs]) {
      if (runMs < run.until) continue;
      this.runs.delete(agent);
      const work = this.working.get(agent) ?? false;
      if (!work) this.idleSince.set(agent, runMs);
      out.push(run.kind === "beer" ? { type: "beerReturn", agent, work } : { type: "home", agent, work });
    }

    const taken = (t: Tile) => [...this.runs.values()].some((r) => r.tile.x === t.x && r.tile.y === t.y);
    const free = (tiles: Tile[]) => tiles.filter((t) => !taken(t));
    const span = ([a, b]: readonly [number, number]) => a + this.rng() * (b - a);
    const busy = (a: string) => this.runs.has(a) || this.escalating.has(a);

    let coffee = [...this.runs.values()].filter((r) => r.kind === "coffee").length;
    for (const [agent, since] of this.idleSince) {
      if (coffee >= MAX_COFFEE) break;
      if (this.working.get(agent) !== false || busy(agent) || runMs - since <= IDLE_MS) continue;
      if (runMs - (this.lastCoffee.get(agent) ?? -Infinity) < COFFEE_COOLDOWN_MS) continue;
      if (BEER_AGENTS.has(agent)) {
        if (this.rng() >= COFFEE_CHANCE) continue;
        this.lastCoffee.set(agent, runMs);
        this.runs.set(agent, { kind: "beer", tile: EXIT_TILE, until: runMs + span(BEER_OUT_MS) });
        out.push({ type: "bubble", agent, text: "🤫 brb…" }, { type: "beerOut", agent });
        coffee++;
        continue;
      }
      const tiles = free(COFFEE_TILES);
      if (!tiles.length || this.rng() >= COFFEE_CHANCE) continue;
      const tile = tiles[Math.floor(this.rng() * tiles.length) % tiles.length];
      this.lastCoffee.set(agent, runMs);
      this.runs.set(agent, { kind: "coffee", tile, until: runMs + span(COFFEE_STAY_MS) });
      out.push({ type: "bubble", agent, text: "☕ coffee" }, { type: "walk", agent, to: tile, reason: "coffee" });
      coffee++;
    }

    const r = "researcher";
    if (this.working.get(r) && !busy(r) && runMs - this.lastBook > BOOK_COOLDOWN_MS && this.rng() < BOOK_CHANCE) {
      const tiles = free(BOOKSHELF_TILES);
      if (tiles.length) {
        const tile = tiles[Math.floor(this.rng() * tiles.length) % tiles.length];
        this.lastBook = runMs;
        this.runs.set(r, { kind: "bookshelf", tile, until: runMs + span(BOOK_STAY_MS) });
        out.push({ type: "walk", agent: r, to: tile, reason: "bookshelf" });
      }
    }
    return out;
  }
}
