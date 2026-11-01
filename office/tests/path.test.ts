import { describe, it, expect } from "vitest";
import { buildGrid, findPath, seatCell } from "../src/path";
import { SEATS } from "../src/map";

describe("walkable grid + A*", () => {
  const grid = buildGrid();
  it("connects every seat to every other seat through doors and the corridor", () => {
    const seats = Object.values(SEATS);
    for (const a of seats) for (const b of seats) {
      const p = findPath(grid, seatCell(a), seatCell(b));
      expect(p, `${a.room} → ${b.room}`).not.toBeNull();
    }
  });
  it("never walks through walls or furniture", () => {
    const p = findPath(grid, { x: 3, y: 16 }, { x: 36, y: 18 })!;
    for (const step of p) expect(grid.walkable(step.x, step.y)).toBe(true);
    expect(p.some((s) => s.y >= 9 && s.y <= 10)).toBe(true); // via the corridor
  });
  it("returns a short straight path inside one room", () => {
    const p = findPath(grid, { x: 2, y: 18 }, { x: 6, y: 18 })!;
    expect(p).toHaveLength(5);
  });
});
