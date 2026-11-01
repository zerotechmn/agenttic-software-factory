import { describe, expect, it } from "vitest";
import { visibleBoxes } from "../../src/labels";

describe("visibleBoxes on narrow screens", () => {
  it("hides signs whose room is off-screen or too narrow, and overlapping ones", () => {
    const vis = visibleBoxes([
      { x: 0, y: 10, w: 60, h: 10, room: 120 },
      { x: 30, y: 10, w: 60, h: 10, room: 120 }, // overlaps the first
      { x: 400, y: 10, w: 60, h: 10, room: -200 }, // room entirely off-screen
      { x: 0, y: 40, w: 60, h: 10, room: 30 }, // room cropped narrower than text
    ]);
    expect(vis).toEqual([true, false, false, false]);
  });
});
