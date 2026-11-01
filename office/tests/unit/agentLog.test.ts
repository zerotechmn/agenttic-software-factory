import { describe, expect, it } from "vitest";
import { AgentLog } from "../../src/agentLog";
import { AGENT_LOG_CAP } from "../../src/shared/contracts";

const ev = (n: number) => ({ ts: n, run: "r", phase: "build", kind: "tool", text: `e${n}` });

describe("AgentLog", () => {
  it("is newest first and returns copies", () => {
    const l = new AgentLog();
    l.push("a", ev(1)); l.push("a", ev(2));
    expect(l.get("a").map((e) => e.ts)).toEqual([2, 1]);
    l.get("a").pop();
    expect(l.get("a")).toHaveLength(2);
  });
  it("caps at AGENT_LOG_CAP, dropping the oldest", () => {
    const l = new AgentLog();
    for (let i = 0; i < AGENT_LOG_CAP + 5; i++) l.push("a", ev(i));
    expect(l.get("a")).toHaveLength(AGENT_LOG_CAP);
    expect(l.get("a")[0].ts).toBe(AGENT_LOG_CAP + 4);
  });
  it("unknown key → []", () => { expect(new AgentLog().get("nope")).toEqual([]); });
});
