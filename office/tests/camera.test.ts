import { describe, expect, it } from "vitest";
import { clampView, fitView, OFFICE, TOP_INSET, zoomAt, type View } from "../src/camera";

const S = { width: 1920, height: 1080 };
const ints = (v: View) => [v.scale, v.x, v.y].every(Number.isInteger);

describe("camera", () => {
  it("fitView picks the largest fitting scale, integers", () => {
    const v = fitView(OFFICE, S);
    expect(v.scale).toBe(2);
    expect(ints(v)).toBe(true);
    expect(fitView(OFFICE, { width: 2800, height: 1500 }).scale).toBe(4);
    expect(fitView(OFFICE, { width: 300, height: 300 }).scale).toBe(2);
  });
  it("zoomAt steps and saturates", () => {
    let v = fitView(OFFICE, S);
    const at = { x: 900, y: 500 };
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) { v = zoomAt(v, at, 1, S); seen.push(v.scale); }
    expect(seen).toEqual([3, 4, 4]);
    seen.length = 0;
    for (let i = 0; i < 3; i++) { v = zoomAt(v, at, -1, S); seen.push(v.scale); }
    expect(seen).toEqual([3, 2, 2]);
  });
  it("keeps the point under the cursor (within 1px) when not clamped", () => {
    const M = { width: 1000, height: 700 };
    const v0 = fitView(OFFICE, M);
    const at = { x: 500, y: 76 + 312 };
    const v1 = zoomAt(v0, at, 1, M);
    const w0 = { x: (at.x - v0.x) / v0.scale, y: (at.y - v0.y) / v0.scale };
    const w1 = { x: (at.x - v1.x) / v1.scale, y: (at.y - v1.y) / v1.scale };
    expect(Math.abs(w0.x - w1.x) * v1.scale).toBeLessThanOrEqual(1);
    expect(Math.abs(w0.y - w1.y) * v1.scale).toBeLessThanOrEqual(1);
    expect(ints(v1)).toBe(true);
  });
  it("clampView never exposes outside the office", () => {
    const small = { width: 800, height: 600 };
    for (const scale of [2, 3, 4]) for (const x of [-5000, 0, 5000]) for (const y of [-5000, 0, 5000]) {
      const v = clampView({ scale, x, y }, small);
      expect(ints(v)).toBe(true);
      expect(v.x).toBeLessThanOrEqual(0);
      expect(v.x + OFFICE.w * scale).toBeGreaterThanOrEqual(small.width);
      expect(v.y).toBeLessThanOrEqual(TOP_INSET);
      expect(v.y + OFFICE.h * scale).toBeGreaterThanOrEqual(small.height);
    }
  });
  it("centres when smaller than the viewport", () => {
    const v = clampView({ scale: 2, x: 0, y: 0 }, S);
    expect(v.x).toBe((1920 - OFFICE.w * 2) / 2);
  });
});
