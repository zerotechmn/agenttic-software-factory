import { describe, it, expect } from "vitest";
import { Director } from "../../src/director";

const ev = (o: Record<string, unknown>) => ({ ts: 1, run: "r", phase: "design", kind: "tool", ...o }) as never;

describe("stale agents", () => {
  it("no bubbles from idle agents; phase change idles leftovers", () => {
    const d = new Director(() => 0.99);
    d.handle(ev({ kind: "agent_start", role: "architect" }));
    expect(d.handle(ev({ role: "architect", text: "Read a.ts" })).some((c) => c.type === "bubble")).toBe(true);
    const cmds = d.handle(ev({ kind: "phase_start", phase: "qa" }));
    expect(cmds).toContainEqual({ type: "work", agent: "architect", on: false });
    expect(d.handle(ev({ role: "architect", text: "Read a.ts" })).some((c) => c.type === "bubble")).toBe(false);
  });
});
