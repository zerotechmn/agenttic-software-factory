import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLearning, lessonsFor, promotable, promote, runEvidence, type Lesson } from "../src/lessons.ts";

const L = (o: Partial<Lesson>): Lesson => ({ id: "x", role: "dev", trigger: "t", lesson: "do y", confidence: 0.5, runs: ["r0"], status: "active", source: "seed", updatedAt: "", ...o });

describe("lessons (ECC-style instincts)", () => {
  it("adds candidates at 0.3, reinforces once per run, activates at 0.5 and retires below 0.2", () => {
    const ls = [L({ id: "a", confidence: 0.4, status: "candidate" }), L({ id: "b", confidence: 0.35 })];
    const r = applyLearning(ls, {
      reinforce: [{ id: "a", evidence: "e" }, { id: "a", evidence: "dup" }, { id: "nope", evidence: "e" }],
      contradict: [{ id: "b", evidence: "e" }],
      add: [{ id: "new-one", role: "qa", trigger: "when", lesson: "do", evidence: "e" }, { id: "a", role: "qa", trigger: "", lesson: "", evidence: "" }],
    }, "r1");
    expect(r).toEqual({ added: ["new-one"], reinforced: ["a"], contradicted: ["b"] });
    expect(ls.find((l) => l.id === "a")).toMatchObject({ confidence: 0.55, status: "active", runs: ["r0", "r1"] });
    expect(ls.find((l) => l.id === "b")).toMatchObject({ confidence: 0.15, status: "retired" });
    expect(ls.find((l) => l.id === "new-one")).toMatchObject({ confidence: 0.3, status: "candidate", source: "learned" });
    applyLearning(ls, { reinforce: [{ id: "a", evidence: "again" }], contradict: [], add: [] }, "r1");
    expect(ls.find((l) => l.id === "a")?.confidence).toBe(0.55);
  });

  it("injects only active lessons for the role, and promotes proven ones into the role file", () => {
    const ls = [L({ id: "on", confidence: 0.9, runs: ["1", "2", "3"] }), L({ id: "weak", confidence: 0.3, status: "candidate" }), L({ id: "qa", role: "qa" })];
    const block = lessonsFor("dev", ls);
    expect(block).toContain("## Lessons from earlier FORGE runs");
    expect(block).toContain("t: do y");
    expect(lessonsFor("dev", ls).match(/^- /gm)).toHaveLength(1);
    expect(lessonsFor("architect", ls)).toBe("");
    expect(promotable(ls).map((l) => l.id)).toEqual(["on"]);
    const roles = mkdtempSync(join(tmpdir(), "roles-"));
    writeFileSync(join(roles, "dev.md"), "# Role: DEV\n");
    promote("on", ls, roles);
    expect(readFileSync(join(roles, "dev.md"), "utf8")).toContain("## Learned rules\n- t: do y <!-- lesson:on -->");
    expect(ls[0].status).toBe("promoted");
    expect(lessonsFor("dev", ls)).toBe("");
  });

  it("collects a run's mistakes as evidence and ignores clean events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    mkdirSync(join(dir, ".forge"));
    const ev = (o: object) => JSON.stringify({ ts: 1, run: "r", phase: "build", ...o });
    writeFileSync(join(dir, ".forge", "events.jsonl"), [
      ev({ kind: "gate", status: "pass", taskId: "T1" }),
      ev({ kind: "gate", status: "fail", taskId: "T2", text: "1 failed" }),
      ev({ kind: "review", status: "reject", taskId: "T2", text: "missing e2e" }),
      ev({ kind: "qa_result", status: "9", text: "score 9, 0 failures" }),
      ev({ kind: "qa_result", status: "6", text: "score 6, 2 failures" }),
    ].join("\n") + "\n");
    const e = runEvidence(dir);
    expect(e).toContain("gate/fail");
    expect(e).toContain("review/reject");
    expect(e).toContain("2 failures");
    expect(e).not.toContain("gate/pass");
    expect(e).not.toContain("0 failures");
  });

  it("ships valid seed lessons", () => {
    const seed = JSON.parse(readFileSync(join(__dirname, "..", "lessons", "lessons.json"), "utf8")) as Lesson[];
    expect(seed.length).toBeGreaterThan(3);
    for (const l of seed) expect(l.status === "active" ? l.confidence >= 0.5 : true).toBe(true);
  });
});
