import { describe, expect, it } from "vitest";
import { Director, type ForgeEvent } from "../../src/director";

const ev = (ts: number, kind: string, role: string): ForgeEvent => ({ ts, run: "r", phase: "build", kind, role });

describe("coffee bubble", () => {
  it("says coffee when leaving, and not when going home", () => {
    const d = new Director(() => 0);
    d.handle(ev(0, "agent_start", "architect"));
    d.handle(ev(1000, "agent_done", "architect"));
    const out = d.tick(21_500);
    expect(out.some((c) => c.type === "walk" && c.reason === "coffee")).toBe(true);
    const b = out.find((c) => c.type === "bubble");
    expect(b).toMatchObject({ agent: "architect" });
    expect((b as { text: string }).text).toMatch(/☕.*coffee/);
    const back = d.tick(60_000);
    expect(back.some((c) => c.type === "home")).toBe(true);
    expect(back.some((c) => c.type === "bubble")).toBe(false);
  });
});
