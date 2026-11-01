import { describe, it, expect } from "vitest";
import { Director } from "../src/director";

const ev = (o: Record<string, unknown>) => ({ ts: 0, run: "r", phase: "build", kind: "note", ...o });

describe("Director", () => {
  it("assigns developers to pods by task and frees the pod when the task merges", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T1", agentId: "dev:T1#1" }))).toContainEqual({ type: "work", agent: "dev:1", on: true, text: expect.any(String) });
    expect(d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T2", agentId: "dev:T2#2" }))).toContainEqual(expect.objectContaining({ type: "work", agent: "dev:2" }));
    d.handle(ev({ kind: "task_status", taskId: "T1", status: "merged" }));
    expect(d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T3", agentId: "dev:T3#3" }))).toContainEqual(expect.objectContaining({ type: "work", agent: "dev:1" }));
  });

  it("remembers which desk worked a task after it merges (board avatars)", () => {
    const d = new Director();
    d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T1" }));
    d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T2" }));
    d.handle(ev({ kind: "task_status", taskId: "T1", status: "merged" }));
    expect(d.deskOf("T1")).toBe("dev:1");
    expect(d.deskOf("T2")).toBe("dev:2");
    expect(d.deskOf("T9")).toBeUndefined();
  });

  it("a task going to review walks the paper from its dev to the reviewer", () => {
    const d = new Director();
    d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T1" }));
    expect(d.handle(ev({ kind: "task_status", taskId: "T1", status: "review" }))).toContainEqual({ type: "handoff", from: "dev:1", to: "reviewer", item: "paper", label: "T1" });
  });

  it("a rejected review throws the paper back and flags the dev", () => {
    const d = new Director();
    d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T1" }));
    const cmds = d.handle(ev({ kind: "review", taskId: "T1", status: "reject" }));
    expect(cmds).toContainEqual({ type: "throw", from: "reviewer", to: "dev:1", label: "T1" });
    expect(cmds).toContainEqual({ type: "alert", agent: "dev:1", mood: "bad" });
  });

  it("a gate failure flags the dev; a merge files the paper in the vault and bumps the counter", () => {
    const d = new Director();
    d.handle(ev({ kind: "agent_start", role: "dev", taskId: "T1" }));
    expect(d.handle(ev({ kind: "gate", taskId: "T1", status: "fail", text: "lint failed" }))).toContainEqual({ type: "alert", agent: "dev:1", mood: "bad" });
    const m = d.handle(ev({ kind: "task_status", taskId: "T1", status: "merged" }));
    expect(m).toContainEqual({ type: "handoff", from: "reviewer", to: "integrator", item: "paper", label: "T1" });
    expect(m).toContainEqual({ type: "merged", count: 1 });
  });

  it("tool and say events become short speech bubbles for the right agent", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "tool", role: "architect", text: "Write /x/src/shared/contracts.ts" }))).toEqual([{ type: "bubble", agent: "architect", text: "✏️ contracts.ts" }]);
    expect(d.handle(ev({ kind: "tool", role: "qa", text: "Bash npx playwright test --reporter=line" }))).toEqual([{ type: "bubble", agent: "qa", text: "▶ npx playwright test" }]);
  });

  it("maps the run's phases, QA score and spend into HUD updates", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "phase_start", phase: "qa" }))).toContainEqual({ type: "phase", phase: "qa" });
    expect(d.handle(ev({ kind: "qa_result", status: "8" }))).toContainEqual({ type: "qa", score: 8 });
    expect(d.handle(ev({ kind: "agent_done", role: "product", usd: 0.5 }))).toContainEqual({ type: "spend", usd: 0.5 });
  });
});

describe("shell bubbles", () => {
  it("drops the cd prefix and paths so the bubble shows the actual command", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "tool", role: "qa", text: "Bash cd /Users/x/forge-runs/b/.forge/wt/T1; npm run check 2>&1 | tail" }))).toEqual([{ type: "bubble", agent: "qa", text: "▶ npm run check" }]);
  });
});

describe("scene props", () => {
  it("keeps a live task board from task status events", () => {
    const d = new Director();
    d.handle(ev({ kind: "task_status", taskId: "T1", status: "running" }));
    const c = d.handle(ev({ kind: "task_status", taskId: "T2", status: "merged" }));
    expect(c).toContainEqual({ type: "board", tasks: [{ id: "T1", status: "running" }, { id: "T2", status: "merged" }] });
  });
  it("celebrates when the run finishes and lights the deploy dock on deploy", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "run_done" }))).toContainEqual({ type: "celebrate" });
    expect(d.handle(ev({ kind: "deploy", status: "ok", text: "http://localhost:8800" }))).toContainEqual({ type: "deployed", ok: true });
  });
});

describe("internal tools", () => {
  it("never shows the StructuredOutput tool as a speech bubble", () => {
    const d = new Director();
    expect(d.handle(ev({ kind: "tool", role: "dev", text: "StructuredOutput" }))).toEqual([]);
  });
});
