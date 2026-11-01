import { describe, expect, it } from "vitest";
import { visibleBoxes } from "../../src/labels";

describe("visibleBoxes", () => {
  it("hides a sign that collides with an earlier one", () => {
    const a = { x: 0, y: 10, w: 100, h: 24, room: 300 };
    expect(visibleBoxes([a, { ...a, x: 90 }, { ...a, x: 200 }])).toEqual([true, false, true]);
  });
  it("hides a sign clipped by a narrow visible room span", () => {
    expect(visibleBoxes([{ x: 0, y: 0, w: 100, h: 24, room: 60 }])).toEqual([false]);
  });
});
