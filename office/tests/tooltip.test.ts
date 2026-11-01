import { describe, it, expect } from "vitest";
import { roomAt, roomText } from "../src/tooltip";
import { ROOMS, T } from "../src/map";

const room = (id: string) => ROOMS.find((r) => r.id === id)!;

describe("roomAt", () => {
  it("maps world points to rooms", () => {
    expect(roomAt(9 * T, 4 * T)?.id).toBe("product");
    expect(roomAt(2 * T, 2 * T)?.id).toBe("lobby");
    expect(roomAt(5 * T, 15 * T)?.id).toBe("dev");
    expect(roomAt(18 * T, 15 * T)?.id).toBe("review");
  });
  it("returns undefined in the corridor and outside", () => {
    expect(roomAt(9 * T, 9.5 * T)).toBeUndefined();
    expect(roomAt(9 * T, 10.5 * T)).toBeUndefined();
    expect(roomAt(-5, -5)).toBeUndefined();
  });
});

describe("roomText", () => {
  it("single worker", () => {
    expect(roomText(room("product"), [{ name: "Pia", working: true, on: "T1" }])).toBe("Product\nPia: working on T1");
  });
  it("idle worker", () => {
    expect(roomText(room("product"), [{ name: "Pia", working: false }])).toBe("Product\nPia: idle");
  });
  it("multiple workers", () => {
    const t = roomText(room("dev"), [
      { name: "A", working: true, on: "x" },
      { name: "B", working: false },
      { name: "C", working: true, on: "y" },
    ]);
    expect(t.split("\n")).toEqual(["Dev Floor", "A: working on x", "B: idle", "C: working on y"]);
    expect(roomText(room("review"), [{ name: "R", working: false }, { name: "F", working: false }])).toBe("Review\nR: idle\nF: idle");
  });
  it("nobody here", () => {
    expect(roomText(room("lobby"), [])).toBe("Lobby\nnobody here");
    expect(roomText(room("coffee"), [])).toBe("Coffee\nnobody here");
  });
});
