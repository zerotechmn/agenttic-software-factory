import { describe, expect, it } from "vitest";
import { FURNITURE, ROOMS, signSpot } from "../../src/map";
import { clampSpan } from "../../src/labels";

describe("clampSpan", () => {
  it("keeps text inside the visible room span", () => {
    expect(clampSpan(-40, 100, 0, 400)).toBe(0);
    expect(clampSpan(350, 100, 0, 400)).toBe(300);
    expect(clampSpan(50, 100, 0, 400)).toBe(50);
    expect(clampSpan(10, 100, 0, 60)).toBe(0);
  });
});

// Press Start 2P: 8 px glyph + 1 px letter spacing
const textWidth = (s: string) => s.length * 9;

describe("room signs", () => {
  it("do not overlap wall icons", () => {
    const painting = FURNITURE.find((f) => f.sprite === "painting" && f.x > 27 && f.x < 34)!;
    const iconLeft: Record<string, number> = { design: painting.x * 16, qa: 32.3 * 16 - 6 };
    for (const id of ["design", "qa"]) {
      const r = ROOMS.find((q) => q.id === id)!;
      const { x, left } = signSpot(r);
      const w = textWidth(r.label.toUpperCase());
      expect(left ? x + w : x + w / 2).toBeLessThan(iconLeft[id]);
    }
  });
});
