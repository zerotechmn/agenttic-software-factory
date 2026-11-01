import { describe, it, expect } from "vitest";
import { TaskBoard } from "../../src/board";
import type { ForgeEvent } from "../../src/director";

const ev = (o: Partial<ForgeEvent>): ForgeEvent => ({ ts: 0, run: "r", phase: "build", kind: "task_status", ...o });
const state = { tasks: [{ id: "T1", title: "One", status: "merged", attempts: 1 }, { id: "T2", title: "Two", status: "merged", attempts: 1 }] };

describe("TaskBoard replay", () => {
  it("replayed events change rows seeded from the end state", () => {
    const b = new TaskBoard();
    b.load(state);
    expect(b.apply(ev({ taskId: "T1", status: "running" }))).toBe(true);
    expect(b.tasks()[0].status).toBe("running");
  });
  it("a state that arrives after early events does not overwrite them", () => {
    const b = new TaskBoard();
    expect(b.apply(ev({ taskId: "T1", status: "running" }))).toBe(true);
    b.load(state);
    const t = b.tasks();
    expect(t.length).toBe(2);
    expect(t.find((r) => r.id === "T1")).toMatchObject({ status: "running" });
    expect(t.find((r) => r.id === "T2")).toMatchObject({ status: "merged" });
  });
});
