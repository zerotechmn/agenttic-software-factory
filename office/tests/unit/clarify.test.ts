import { describe, it, expect } from "vitest";
import { Director, type ForgeEvent } from "../../src/director";

const ev = (o: Partial<ForgeEvent>): ForgeEvent => ({ ts: 1, run: "r", phase: "product", kind: "note", ...o }) as ForgeEvent;

describe("clarify in the office", () => {
  it("Product walks to the lobby with a question tag, and goes back once answered", () => {
    const d = new Director();
    const asked = d.handle(ev({ kind: "clarify", status: "asked", role: "product", data: [{ id: "Q1" }, { id: "Q2" }] as never }));
    expect(asked).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "walk", agent: "product", reason: "client" }),
      expect.objectContaining({ type: "tag", agent: "product", text: "❓ 2 questions · click me" }),
      expect.objectContaining({ type: "bubble", agent: "product", text: "I have 2 questions for you!" }),
    ]));
    const answered = d.handle(ev({ kind: "clarify", status: "answered", role: "product" }));
    expect(answered).toEqual(expect.arrayContaining([{ type: "tag", agent: "product", text: null }, { type: "home", agent: "product", work: true }]));
  });

  it("clears the tag when the window closes and the next phase starts", () => {
    const d = new Director();
    d.handle(ev({ kind: "clarify", status: "asked", role: "product", data: [{ id: "Q1" }] as never }));
    expect(d.handle(ev({ kind: "phase_start", phase: "research" }))).toEqual(expect.arrayContaining([{ type: "tag", agent: "product", text: null }]));
  });
});

describe("handoff scenes", () => {
  it("plays PRD → design, plan → devs (once), review results and the ship moment", () => {
    const d = new Director();
    d.handle(ev({ kind: "agent_done", role: "product", status: "ok", text: '{"summary":"Yoga booking PRD, 8 features"}' }));
    const design = d.handle(ev({ kind: "phase_start", phase: "design" }));
    expect(design).toEqual(expect.arrayContaining([expect.objectContaining({ type: "dialogue", key: "prd-design", speakers: ["product", "architect", "uiux"], facts: "Yoga booking PRD, 8 features" })]));
    expect(d.handle(ev({ kind: "phase_start", phase: "build" })).filter((c) => c.type === "dialogue")).toHaveLength(1);
    expect(d.handle(ev({ kind: "phase_start", phase: "build" })).filter((c) => c.type === "dialogue")).toHaveLength(0);
    const reject = d.handle(ev({ kind: "review", taskId: "T1", status: "reject", text: "missing tests", ts: 5 }));
    expect(reject).toEqual(expect.arrayContaining([expect.objectContaining({ type: "dialogue", key: "review-T1-5" })]));
    const ship = d.handle(ev({ kind: "review", status: "approve", text: "final review: 0 blocking" }));
    expect(ship).toEqual(expect.arrayContaining([expect.objectContaining({ type: "dialogue", key: "ship", speakers: ["final_reviewer", "devops"] })]));
  });
});

describe("moods", () => {
  it("QA gets annoyed, then angry, as bugs keep coming; repeat rejections escalate too", () => {
    const d = new Director();
    const qa = (ts: number) => d.handle(ev({ kind: "qa_result", status: "6", text: "score 6, 2 failures", ts })).find((c) => c.type === "dialogue") as { moment: string } | undefined;
    expect(qa(1)?.moment).toMatch(/calmly/);
    expect(qa(2)?.moment).toMatch(/annoyed/);
    expect(qa(3)?.moment).toMatch(/angry/);
    const rej = (ts: number) => d.handle(ev({ kind: "review", taskId: "T2", status: "reject", ts })).find((c) => c.type === "dialogue") as { moment: string } | undefined;
    expect(rej(4)?.moment).toMatch(/kindly/);
    expect(rej(5)?.moment).toMatch(/annoyed/);
    expect(rej(6)?.moment).toMatch(/patience/);
  });
});
