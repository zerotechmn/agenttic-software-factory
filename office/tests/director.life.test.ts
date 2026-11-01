import { describe, expect, it } from "vitest";
import { Director, type Command, type ForgeEvent } from "../src/director";
import { BOOKSHELF_TILES, COFFEE_TILES } from "../src/life";
import { buildGrid } from "../src/path";
import { ROOMS } from "../src/map";

const ev = (ts: number, kind: string, role: string): ForgeEvent => ({ ts, run: "r", phase: "build", kind, role });
const start = (ts: number, role: string) => ev(ts, "agent_start", role);
const done = (ts: number, role: string) => ev(ts, "agent_done", role);
const walks = (cmds: Command[], reason: string) => cmds.filter((c) => c.type === "walk" && c.reason === reason);

function idleDirector(roles: string[]) {
  const d = new Director(() => 0);
  for (const r of roles) { d.handle(start(0, r)); d.handle(done(1000, r)); }
  return d;
}

describe("director.life", () => {
  it("no coffee walk at <= 20 s idle, walk to a Coffee tile after", () => {
    const d = idleDirector(["architect"]);
    expect(walks(d.tick(21_000), "coffee")).toHaveLength(0);
    const w = walks(d.tick(21_500), "coffee");
    expect(w).toHaveLength(1);
    const to = (w[0] as { to: { x: number; y: number } }).to;
    const room = ROOMS.find((r) => r.id === "coffee")!;
    expect(to.x >= room.x && to.x < room.x + room.w).toBe(true);
  });

  it("never more than 1 concurrent coffee runner", () => {
    const d = idleDirector(["final_reviewer", "uiux", "architect", "qa"]);
    expect(walks(d.tick(30_000), "coffee")).toHaveLength(1);
    expect(walks(d.tick(30_500), "coffee")).toHaveLength(0);
  });

  it("only about 25% chance when eligible", () => {
    const d = new Director(() => 0.3);
    d.handle(start(0, "architect")); d.handle(done(1000, "architect"));
    expect(walks(d.tick(30_000), "coffee")).toHaveLength(0);
  });

  it("at most one coffee break per 120 s per agent", () => {
    const d = idleDirector(["architect"]);
    expect(walks(d.tick(30_000), "coffee")).toHaveLength(1);
    d.tick(50_000); // back home
    expect(walks(d.tick(100_000), "coffee")).toHaveLength(0);
    expect(walks(d.tick(150_500), "coffee")).toHaveLength(1);
  });

  it("work during a run sends the agent home with work:true", () => {
    const d = idleDirector(["architect"]);
    d.tick(30_000);
    expect(d.handle(start(31_000, "architect"))).toContainEqual({ type: "home", agent: "architect", work: true });
  });

  it("returns home after the stay", () => {
    const d = idleDirector(["architect"]);
    d.tick(30_000);
    expect(d.tick(31_000)).toHaveLength(0);
    expect(d.tick(50_000)).toContainEqual({ type: "home", agent: "architect", work: false });
  });

  it("working researcher visits a bookshelf and returns to work", () => {
    const d = new Director(() => 0);
    d.handle(start(0, "researcher"));
    expect(walks(d.tick(60_000), "bookshelf")).toHaveLength(1);
    expect(d.tick(61_000)).toHaveLength(0);
    expect(d.tick(70_000)).toContainEqual({ type: "home", agent: "researcher", work: true });
  });

  it("target tiles are walkable", () => {
    const g = buildGrid();
    for (const t of [...COFFEE_TILES, ...BOOKSHELF_TILES]) expect(g.walkable(t.x, t.y), `${t.x},${t.y}`).toBe(true);
  });
});

describe("beer runs", () => {
  it("Erka sneaks out through the lobby instead of coffee and comes back with a beer and its sound", async () => {
    const { EXIT_TILE } = await import("../src/life");
    const d = idleDirector(["product"]);
    const out = d.tick(21_500);
    expect(out).toEqual(expect.arrayContaining([{ type: "bubble", agent: "product", text: "🤫 brb…" }, { type: "beerOut", agent: "product" }]));
    expect(walks(out, "coffee")).toHaveLength(0);
    expect(EXIT_TILE).toEqual({ x: 0, y: 10 });
    expect(d.tick(23_000).some((c) => c.type === "beerReturn")).toBe(false);
    expect(d.tick(24_600)).toEqual(expect.arrayContaining([{ type: "beerReturn", agent: "product", work: false }]));
  });
});
