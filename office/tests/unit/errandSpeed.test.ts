import { describe, expect, it } from "vitest";
import { ERRAND_BOOST, walkMultiplier } from "../../src/agent";

describe("errand walking speed", () => {
  it("is 1.6x on handoff errands and 1x when idle wandering", () => {
    expect(ERRAND_BOOST).toBe(1.6);
    expect(walkMultiplier(true)).toBe(1.6);
    expect(walkMultiplier(false)).toBe(1);
  });
});
