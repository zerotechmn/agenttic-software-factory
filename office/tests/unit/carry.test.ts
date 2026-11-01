import { describe, expect, it } from "vitest";
import { item } from "../../src/stage";

describe("carried items", () => {
  it("are drawn 2x with whole-pixel size", () => {
    for (const k of ["paper", "folder", "bug"] as const) {
      const g = item(k);
      expect(g.scale.x).toBe(2);
      expect(Number.isInteger(g.width)).toBe(true);
      expect(g.width).toBeGreaterThanOrEqual(12);
    }
  });
});
