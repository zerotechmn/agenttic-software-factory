import { describe, it, expect } from "vitest";
import { Director } from "../src/director";
import { NoteBook, noteRecipient } from "../src/notes";

const note = (text: string) => ({ ts: 1, kind: "note", text }) as never;

describe("director.notes", () => {
  it("emits noteDelivered for operator notes", () => {
    const d = new Director(() => 0.5);
    expect(d.handle(note("operator → qa: hello")).filter((c) => c.type === "noteDelivered")).toEqual([{ type: "noteDelivered", role: "qa" }]);
    expect(noteRecipient("operator -> dev: x")).toBe("dev");
  });
  it("ignores unrelated text", () => {
    const d = new Director(() => 0.5);
    expect(d.handle(note("architect: plan")).filter((c) => c.type === "noteDelivered")).toEqual([]);
    expect(noteRecipient("hi operator → qa")).toBeUndefined();
  });
  it("delivers only the oldest queued note for the role", () => {
    const b = new NoteBook();
    const a = b.add("qa", "1");
    const c = b.add("qa", "2");
    b.add("dev", "3");
    expect(b.deliver("qa")).toBe(a);
    expect(a.status).toBe("delivered");
    expect(c.status).toBe("queued");
    expect(b.deliver("qa")).toBe(c);
    expect(b.deliver("qa")).toBeUndefined();
  });
});
