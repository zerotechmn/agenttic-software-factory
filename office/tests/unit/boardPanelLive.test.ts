import { describe, it, expect, beforeAll } from "vitest";
import { TaskBoard } from "../../src/board";
import { BoardPanel } from "../../src/boardPanel";
import type { ForgeEvent } from "../../src/director";

// Minimal DOM stand-in (no jsdom in this project): just what BoardPanel touches.
class El {
  children: El[] = [];
  parentElement: El | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  className = "";
  textContent = "";
  title = "";
  value = "";
  placeholder = "";
  rows = 0;
  type = "";
  disabled = false;
  isConnected = true;
  constructor(public tag: string) {}
  set innerHTML(_v: string) { this.children.forEach((c) => (c.parentElement = null)); this.children = []; }
  append(...cs: El[]) { for (const c of cs) { c.parentElement = this; this.children.push(c); } }
  get lastElementChild() { return this.children[this.children.length - 1] ?? null; }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.parentElement = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener() {}
  find(cls: string): El[] {
    return this.children.flatMap((c) => [...(c.className === cls ? [c] : []), ...c.find(cls)]);
  }
}

const ev = (e: Partial<ForgeEvent>) => e as ForgeEvent;

describe("BoardPanel live updates", () => {
  beforeAll(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (t: string) => new El(t) };
  });

  it("shows tasks added after opening, updates chips in place, keeps typed form text", () => {
    const board = new TaskBoard();
    board.load({ tasks: [{ id: "T1", title: "One", status: "backlog", attempts: 0 }] });
    const panel = new BoardPanel(board, () => "replay", async () => true);
    const body = new El("div");
    panel.render(body as unknown as HTMLElement);
    const rows = body.find("board-rows")[0];
    expect(rows.children).toHaveLength(1);
    const firstRow = rows.children[0];

    const input = body.children[2].children[0];
    input.value = "half typed";

    board.apply(ev({ kind: "task_status", taskId: "T2", status: "running" }));
    board.apply(ev({ kind: "task_status", taskId: "T1", status: "running" }));
    board.apply(ev({ kind: "task_fail", taskId: "T1" }));
    panel.refresh();

    expect(rows.children).toHaveLength(2);
    expect(rows.children[0]).toBe(firstRow); // same node: no re-render
    expect(rows.children[1].dataset.task).toBe("T2");
    expect(firstRow.children[3].textContent).toBe("running");
    expect(firstRow.children[2].textContent).toBe("×1");
    expect(input.value).toBe("half typed");
  });
});
