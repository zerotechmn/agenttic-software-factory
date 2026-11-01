import { describe, it, expect } from "vitest";
import { TaskBoard } from "../../src/board";
import { boardResetEvents, replayGap } from "../../src/feed";
import type { ForgeEvent } from "../../src/director";

const ev = (o: Partial<ForgeEvent>): ForgeEvent => ({ ts: 0, run: "r", phase: "build", kind: "task_status", ...o });
const state = { tasks: [{ id: "T1", title: "One", status: "merged", attempts: 1 }, { id: "T2", title: "Two", status: "merged", attempts: 1 }] };
const events = [ev({ taskId: "T1", status: "running" }), ev({ taskId: "T1", status: "review" }), ev({ taskId: "T1", status: "merged" }), ev({ taskId: "T2", status: "running" })];

describe("replay board", () => {
  it("rewinding then replaying changes rows as the run progresses", () => {
    const b = new TaskBoard();
    b.load(state);
    for (const e of boardResetEvents(state)) b.apply(e);
    expect(b.tasks().every((r) => r.status === "backlog")).toBe(true);
    const seen = new Set<string>();
    for (const e of events) if (b.apply(e)) seen.add(JSON.stringify(b.tasks().map((r) => r.status)));
    expect(seen.size).toBeGreaterThan(2);
  });
  it("the research prelude is paced faster than the rest", () => {
    const a = { ts: 0 } as ForgeEvent, z = { ts: 60000 } as ForgeEvent;
    expect(replayGap(a, z, false)).toBe(500);
    expect(replayGap(a, z, true)).toBe(2500);
  });
});
