import { describe, it, expect } from "vitest";
import { Budget } from "../src/budget.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { newState } from "../src/state.ts";

const cfg = (o = {}) => ({ ...DEFAULT_CONFIG, budgetUsd: 10, ...o });

describe("Budget", () => {
  it("records spend by role and local vs remote", () => {
    const s = newState("r");
    const b = new Budget(cfg(), s);
    b.record("dev", 1.5);
    b.record("reporter", 0, true);
    expect(s.spend.usd).toBe(1.5);
    expect(s.spend.byRole.dev).toBe(1.5);
    expect(s.spend.local).toBe(1);
    expect(s.spend.remote).toBe(1);
    expect(b.remaining()).toBe(8.5);
  });

  it("does not land below 80% spend and lands at 80%", () => {
    const s = newState("r");
    const b = new Budget(cfg(), s);
    b.record("dev", 7.9);
    expect(b.shouldLand()).toBe(false);
    b.record("dev", 0.1);
    expect(b.shouldLand()).toBe(true);
  });

  it("lands when within landingMinutes of the deadline", () => {
    const now = new Date("2026-10-24T08:00:00Z");
    const b = new Budget(cfg({ deadline: "2026-10-24T09:00:00Z", landingMinutes: 90 }), newState("r"));
    expect(b.shouldLand(now)).toBe(true);
    expect(b.shouldLand(new Date("2026-10-24T07:00:00Z"))).toBe(false);
  });

  it("caps a single call at 8% of total but never below $0.05", () => {
    const b = new Budget(cfg({ budgetUsd: 100 }), newState("r"));
    expect(b.perCallCap("dev", "build")).toBe(8);
    const tiny = new Budget(cfg({ budgetUsd: 0.1 }), newState("r"));
    expect(tiny.perCallCap("reporter", "build")).toBe(0.05);
  });

  it("phaseRemaining subtracts spend recorded during that phase", () => {
    const s = newState("r");
    const b = new Budget(cfg({ budgetUsd: 100 }), s);
    b.record("dev", 10, false, "build");
    expect(b.phaseRemaining("build")).toBe(36); // 46% of 100 minus 10 spent
  });
});

describe("Budget role floors", () => {
  it("gives heavy roles a minimum per-call cap even on a small budget", () => {
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 8 }, newState("r"));
    expect(b.perCallCap("architect", "design")).toBe(1.5);
    expect(b.perCallCap("dev", "build")).toBe(1);
  });
  it("never lets a call exceed what remains", () => {
    const s = newState("r");
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 8 }, s);
    b.record("dev", 7.5);
    expect(b.perCallCap("architect", "deploy")).toBe(0.5);
  });
});

describe("Budget reserve and holds", () => {
  it("keeps a reserve for deploy and report", () => {
    const s = newState("r");
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 20 }, s);
    b.record("dev", 19.3);
    expect(b.exhausted("build")).toBe(true);
    expect(b.exhausted("deploy")).toBe(false);
  });
  it("subtracts in-flight holds from what the next call may spend", () => {
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 10 }, newState("r"));
    b.hold(9);
    expect(b.perCallCap("architect", "deploy")).toBe(1);
    b.release(9);
    expect(b.perCallCap("architect", "deploy")).toBe(1.5);
  });
});

describe("Budget reserve in caps", () => {
  it("a build-phase call cannot eat into the deploy/report reserve", () => {
    const s = newState("r");
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 8 }, s);
    b.record("dev", 7.0);
    expect(b.perCallCap("dev", "build")).toBe(0.5);
  });
});

describe("Budget per model", () => {
  it("keeps exact model ids, tokens and cost per model from the SDK's modelUsage", async () => {
    const { renderModelUsage } = await import("../src/phases/report.ts");
    const s = newState("r");
    const b = new Budget(cfg(), s);
    const byModel = [
      { model: "claude-sonnet-5-5", in: 10, out: 200, cacheRead: 5000, cacheWrite: 900, usd: 0.4 },
      { model: "claude-haiku-5-5", in: 3, out: 20, cacheRead: 0, cacheWrite: 100, usd: 0.01 },
    ];
    b.record("dev", 0.41, false, "build", { in: 13, out: 220, cacheRead: 5000, cacheWrite: 1000, model: "sonnet", byModel });
    b.record("dev", 0.4, false, "build", { in: 10, out: 200, cacheRead: 5000, cacheWrite: 900, model: "sonnet", byModel: byModel.slice(0, 1) });
    const m = s.spend.tokens!.byModel!;
    expect(m["claude-sonnet-5-5"]).toMatchObject({ calls: 2, out: 400, cacheWrite: 1800, usd: 0.8 });
    expect(m["claude-haiku-5-5"].calls).toBe(1);
    expect(s.spend.tokens!.models.dev).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    const table = renderModelUsage(m).join("\n");
    expect(table).toContain("| claude-sonnet-5-5 | 2 | 20 | 1,800 | 10,000 | 400 | 0.80 |");
  });
});
