import { describe, it, expect } from "vitest";
import { currentRun, runFromUrl, runParam, withRun, API_PATHS } from "../../src/shared/contracts";

describe("run param contract", () => {
  it("absent ?run= appends nothing", () => {
    expect(runParam("")).toBe("");
    expect(withRun("/events", "")).toBe("/events");
  });
  it("passes ?run= through, URL-encoded", () => {
    expect(runParam("?run=todo")).toBe("run=todo");
    expect(withRun("/say", "?run=my%20run")).toBe("/say?run=my%20run");
    expect(withRun("/x?a=1", "?run=todo")).toBe("/x?a=1&run=todo");
    expect(runFromUrl("?run=a%2Fb")).toBe("a/b");
  });
  it("current run falls back to newest", () => {
    const r = [{ name: "new", run: "", phase: "", usd: 0, budget: 1, product: "", startedAt: 0, active: true }];
    expect(currentRun(r, "")).toBe("new");
    expect(currentRun(r, "?run=old")).toBe("old");
    expect(currentRun([], "")).toBeNull();
  });
  it("encodes path names", () => {
    expect(API_PATHS.runAction("a b", "stop")).toBe("/api/runs/a%20b/stop");
  });
});
