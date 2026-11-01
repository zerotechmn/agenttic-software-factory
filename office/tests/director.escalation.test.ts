import { describe, expect, it } from "vitest";
import { Director, type Command } from "../src/director";
import { SEATS } from "../src/map";
import { buildGrid, seatCell } from "../src/path";

let ts = 0;
const ev = (e: Record<string, unknown>) => ({ ts: ++ts, run: "r", phase: "build", kind: "note", ...e }) as Parameters<Director["handle"]>[0];
const start = (d: Director, taskId: string) => d.handle(ev({ kind: "agent_start", role: "dev", taskId }));
const tags = (cs: Command[]) => cs.filter((c) => c.type === "tag");

describe("director.escalation", () => {
  it("escalate on a running task walks final_reviewer near the pod and tags SENIOR", () => {
    const d = new Director();
    start(d, "T5");
    const cs = d.handle(ev({ text: "escalate T5 please help" }));
    const walk = cs.find((c) => c.type === "walk") as Extract<Command, { type: "walk" }>;
    expect(walk.agent).toBe("final_reviewer");
    expect(walk.reason).toBe("escalation");
    const sc = seatCell(SEATS["dev:1"]);
    expect(Math.max(Math.abs(walk.to.x - sc.x), Math.abs(walk.to.y - sc.y))).toBeLessThanOrEqual(2);
    expect(buildGrid().walkable(walk.to.x, walk.to.y)).toBe(true);
    expect(tags(cs)).toEqual([{ type: "tag", agent: "final_reviewer", text: "SENIOR" }]);
  });

  for (const status of ["merged", "parked"]) {
    it(`releases on ${status}`, () => {
      const d = new Director();
      start(d, "T5");
      d.handle(ev({ text: "escalate T5" }));
      const cs = d.handle(ev({ kind: "task_status", taskId: "T5", status }));
      expect(cs).toContainEqual({ type: "tag", agent: "final_reviewer", text: null });
      expect(cs).toContainEqual({ type: "home", agent: "final_reviewer", work: false });
    });
  }

  it("ignores unknown tasks", () => {
    const d = new Director();
    expect(d.handle(ev({ text: "escalate NOPE" })).filter((c) => c.type === "walk" || c.type === "tag")).toEqual([]);
    expect(d.handle(ev({ kind: "task_status", taskId: "NOPE", status: "merged" })).filter((c) => c.type === "home")).toEqual([]);
  });

  it("repeated escalate re-targets with at most one tag", () => {
    const d = new Director();
    start(d, "T5");
    start(d, "T6");
    const a = d.handle(ev({ text: "escalate T5" }));
    const b = d.handle(ev({ text: "escalate T6" }));
    expect(tags([...a, ...b])).toHaveLength(1);
    expect(b.filter((c) => c.type === "walk")).toHaveLength(1);
  });
});
