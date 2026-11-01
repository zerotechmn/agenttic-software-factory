import { describe, expect, it } from "vitest";
import { Director, type ForgeEvent } from "../../src/director";

const ev = (ts: number, kind: string, extra: Partial<ForgeEvent> = {}): ForgeEvent => ({ ts, run: "r", phase: "build", kind, ...extra });
const iter = (cs: ReturnType<Director["handle"]>) => cs.filter((c) => c.type === "ticker" && c.who.startsWith("Iteration"));

describe("iterations", () => {
  it("announces iteration 2 on a new task after run_done, once", () => {
    const d = new Director(() => 0);
    d.handle(ev(0, "task_status", { taskId: "T1", status: "merged" }));
    expect(d.handle(ev(1, "run_done")).some((c) => c.type === "celebrate")).toBe(true);
    const out = d.handle(ev(2, "task_status", { taskId: "T2", status: "running" }));
    expect(iter(out)).toEqual([{ type: "ticker", who: "Iteration 2", text: "1 new task", tone: "info" }]);
    expect(iter(d.handle(ev(3, "task_status", { taskId: "T3", status: "running" })))).toEqual([]);
  });
  it("announces on a new build phase and counts further iterations", () => {
    const d = new Director(() => 0);
    d.handle(ev(0, "run_done"));
    expect(iter(d.handle(ev(1, "phase_start")))[0]).toMatchObject({ who: "Iteration 2", text: "new build phase" });
    d.handle(ev(2, "run_done"));
    expect(iter(d.handle(ev(3, "phase_start")))[0]).toMatchObject({ who: "Iteration 3" });
  });
  it("stays silent without a prior run_done", () => {
    const d = new Director(() => 0);
    expect(iter(d.handle(ev(0, "phase_start")))).toEqual([]);
  });
});
