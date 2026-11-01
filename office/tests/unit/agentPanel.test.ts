// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { AgentPanel } from "../../src/agentPanel";
import type { ForgeEvent } from "../../src/shared/contracts";

const ev = (n: number, extra: Partial<ForgeEvent> = {}): ForgeEvent => ({ ts: 1700000000 + n, run: "r", phase: "build", kind: "say", text: `msg ${n}`, ...extra });
const notes = { add() {}, list: () => [] } as never;

function open(events: ForgeEvent[] = []) {
  const body = document.createElement("div");
  document.body.appendChild(body);
  const p = new AgentPanel(notes, () => "live", async () => true);
  p.render(body, { key: "dev1", role: "dev", title: "Dev", meta: "m", events });
  const list = () => body.querySelector("[data-testid=activity-list]") as HTMLElement;
  return { body, p, list };
}

describe("AgentPanel", () => {
  it("prepends as first child, keeps textarea value/focus and expansion", () => {
    const { body, p, list } = open([ev(1), ev(2)]);
    const ta = body.querySelector("textarea")!;
    ta.value = "draft msg";
    ta.focus();
    (list().children[0] as HTMLElement).click();
    p.prepend("dev1", ev(3));
    expect(list().children.length).toBe(3);
    expect(list().children[0].textContent).toContain("msg 3");
    expect(list().children[1].getAttribute("aria-expanded")).toBe("true");
    expect(body.querySelector("textarea")).toBe(ta);
    expect(ta.value).toBe("draft msg");
    expect(document.activeElement).toBe(ta);
  });

  it("ignores other keys and caps at 50", () => {
    const { p, list } = open([ev(1)]);
    p.prepend("other", ev(2));
    expect(list().children.length).toBe(1);
    for (let i = 0; i < 51; i++) p.prepend("dev1", ev(10 + i));
    expect(list().children.length).toBe(50);
  });

  it("toggles detail on click and Enter", () => {
    const { list } = open([ev(1)]);
    const li = list().children[0] as HTMLElement;
    li.click();
    expect(li.getAttribute("aria-expanded")).toBe("true");
    expect(li.querySelector("[data-testid=event-detail]")).not.toBeNull();
    li.click();
    expect(li.getAttribute("aria-expanded")).toBe("false");
    expect(li.querySelector("[data-testid=event-detail]")).toBeNull();
    li.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(li.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows tool input and labelled rows", () => {
    const input = { path: "a.ts" };
    const { list } = open([ev(1, { kind: "tool", text: "Read a.ts", data: { tool: "Read", input } })]);
    (list().children[0] as HTMLElement).click();
    const d = list().querySelector("[data-testid=event-detail]")!;
    expect(d.querySelector("pre")!.textContent).toBe(JSON.stringify(input, null, 2));
    const t = d.textContent!;
    expect(t).toContain("Time");
    expect(t).toContain("Phase");
    expect(t).toMatch(/Task-/);
    expect(t).toContain("Read");
  });

  it("omits pre without input and never creates elements from text", () => {
    const { list } = open([ev(1, { kind: "tool", text: "<img src=x onerror=alert(1)>" })]);
    (list().children[0] as HTMLElement).click();
    expect(list().querySelector("pre")).toBeNull();
    expect(list().querySelector("img")).toBeNull();
  });
});

describe("visitor panel", () => {
  it("hides the note form for an interactive Claude session (view only)", async () => {
    const { AgentPanel } = await import("../../src/agentPanel");
    const { NoteBook } = await import("../../src/notes");
    const body = document.createElement("div");
    new AgentPanel(new NoteBook(), () => "live", async () => true).render(body, { key: "claude:1", role: "claude", title: "Claude · factory", meta: "", events: [] } as any);
    expect((body.querySelector(".notebox") as HTMLElement).hidden).toBe(true);
    const dev = document.createElement("div");
    new AgentPanel(new NoteBook(), () => "live", async () => true).render(dev, { key: "dev:1", role: "dev", title: "Dev 1", meta: "", events: [] } as any);
    expect((dev.querySelector(".notebox") as HTMLElement).hidden).toBe(false);
  });
});
