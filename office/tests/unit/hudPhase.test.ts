import { describe, expect, it } from "vitest";
import { phaseStep } from "../../src/hud";

describe("phaseStep", () => {
  it("reports position of the active phase out of all phases", () => {
    expect(phaseStep("intake")).toBe("1/10");
    expect(phaseStep("report")).toBe("10/10");
  });
  it("is empty for an unknown phase", () => {
    expect(phaseStep("")).toBe("");
  });
});
