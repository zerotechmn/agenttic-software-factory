import { describe, expect, it } from "vitest";
import { withTimeout } from "../../src/stage";

describe("withTimeout", () => {
  it("falls back when the promise is too slow", async () => {
    expect(await withTimeout(new Promise<number>(() => {}), 10, -1)).toBe(-1);
  });
  it("falls back when the promise rejects", async () => {
    expect(await withTimeout(Promise.reject(new Error("x")), 50, 0)).toBe(0);
  });
  it("passes through a fast value", async () => {
    expect(await withTimeout(Promise.resolve(7), 50, 0)).toBe(7);
  });
});
