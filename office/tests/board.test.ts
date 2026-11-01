import { describe, it, expect } from "vitest";
import stateRaw from "../public/sample-state.json?raw";
import { TaskBoard, normalizeStatus } from "../src/board";
import type { ForgeEvent } from "../src/director";

const state = JSON.parse(stateRaw);
const ev = (o: Partial<ForgeEvent>): ForgeEvent => ({ ts: 0, run: "r", phase: "build", kind: "tool", ...o });

describe("TaskBoard", () => {
  it("loads sample state rows", () => {
    const b = new TaskBoard();
    b.load(state);
    expect(b.tasks().length).toBe(state.tasks.length);
    expect(b.tasks()[0]).toEqual({ id: "T1", title: "FORGE proxy + replay server", status: "merged", attempts: 1 });
  });
  it("ignores malformed state", () => {
    const b = new TaskBoard();
    b.load({ tasks: [{ id: "A", title: "a", status: "backlog", attempts: 0 }] });
    b.load({ nope: 1 });
    b.load(null);
    expect(b.tasks().length).toBe(1);
  });
  it("task_status updates in place", () => {
    const b = new TaskBoard();
    b.load(state);
    expect(b.apply(ev({ kind: "task_status", taskId: "T1", status: "parked" }))).toBe(true);
    expect(b.tasks()[0].status).toBe("parked");
    expect(b.apply(ev({ kind: "task_status", taskId: "T1", status: "parked" }))).toBe(false);
  });
  it("normalizes unknown statuses", () => {
    expect(normalizeStatus("ready")).toBe("backlog");
    expect(normalizeStatus(undefined)).toBe("backlog");
    expect(normalizeStatus("merged")).toBe("merged");
  });
  it("returns false for unrelated events and counts failures", () => {
    const b = new TaskBoard();
    b.load(state);
    expect(b.apply(ev({ kind: "tool", taskId: "T1" }))).toBe(false);
    expect(b.apply(ev({ kind: "tool" }))).toBe(false);
    expect(b.apply(ev({ kind: "task_fail", taskId: "T1" }))).toBe(true);
    expect(b.tasks()[0].attempts).toBe(2);
  });
});
