import { describe, expect, it } from "vitest";
import { fillView, OFFICE, TOP_INSET } from "../../src/camera";

describe("fillView", () => {
  it("uses zoom 3 at 1920x1080 so the office fills the width", () => {
    const v = fillView({ width: 1920, height: 1080 });
    expect(v.scale).toBe(3);
    expect(OFFICE.w * v.scale).toBe(1920);
    expect(v.y).toBeLessThanOrEqual(TOP_INSET);
    expect(v.y + OFFICE.h * v.scale).toBeGreaterThanOrEqual(1080);
  });
  it("keeps zoom 2 on small screens", () => {
    expect(fillView({ width: 1280, height: 720 }).scale).toBe(2);
  });
});

describe("fillView narrow", () => {
  it("uses zoom 2 on a 390px phone so the office is not a tiny strip", () => {
    const v = fillView({ width: 390, height: 844 });
    expect(v.scale).toBe(2);
    expect(OFFICE.h * v.scale).toBeGreaterThan((844 - TOP_INSET) * 0.85);
    expect(Number.isInteger(v.x) && Number.isInteger(v.y)).toBe(true);
  });
});
