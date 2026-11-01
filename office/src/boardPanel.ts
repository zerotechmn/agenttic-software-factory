import type { NewTask } from "./api";
import type { TaskBoard, TaskStatus } from "./board";
import type { Mode } from "./feed";

// Chip colors: every text/background pair is >= 4.5:1.
const CHIP: Record<TaskStatus, [bg: string, fg: string]> = {
  backlog: ["#cbd5e1", "#0f172a"],
  running: ["#f59e0b", "#1c1000"],
  review: ["#93c5fd", "#0b1d3a"],
  merged: ["#4ade80", "#052e16"],
  parked: ["#fca5a5", "#450a0a"],
};

/** DOM side panel for the task board: rows with status chips + the "Add to backlog" form. */
export class BoardPanel {
  private body?: HTMLElement;
  private list?: HTMLElement;

  constructor(private board: TaskBoard, private mode: () => Mode, private send: (t: NewTask) => Promise<boolean>, private onOpen?: (id: string) => void) {}

  /** Full render into the (freshly emptied) side panel body. */
  render(body: HTMLElement): void {
    this.body = body;
    body.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = `Task board (${this.board.tasks().length})`;
    this.list = document.createElement("div");
    this.list.className = "board-rows";
    body.append(h, this.list, this.form());
    this.refresh();
  }

  /** Update rows in place (keep the form and its typed text). Called on every board change while open. */
  refresh(): void {
    const list = this.list;
    if (!list || !this.body?.isConnected) return;
    const tasks = this.board.tasks();
    tasks.forEach((t, i) => {
      let row = list.children[i] as HTMLElement | undefined;
      if (!row) {
        row = document.createElement("div");
        row.className = "board-row";
        row.title = "Open the full task";
        row.addEventListener("click", () => { if (row!.dataset.task) this.onOpen?.(row!.dataset.task); });
        row.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 0";
        for (const c of ["id", "title", "attempts", "chip"]) {
          const s = document.createElement("span");
          s.className = `board-${c}`;
          row.append(s);
        }
        (row.children[0] as HTMLElement).style.fontWeight = "bold";
        (row.children[1] as HTMLElement).style.flex = "1";
        (row.children[3] as HTMLElement).style.cssText = "padding:1px 8px;border-radius:8px;font-size:12px";
      }
      const [id, title, att, chip] = Array.from(row.children) as HTMLElement[];
      id.textContent = t.id;
      title.textContent = t.title;
      att.textContent = `×${t.attempts}`;
      att.title = `${t.attempts} attempt${t.attempts === 1 ? "" : "s"}`;
      chip.textContent = t.status;
      chip.style.background = CHIP[t.status][0];
      chip.style.color = CHIP[t.status][1];
      row.dataset.task = t.id;
      if (!row.parentElement) list.append(row);
    });
    while (list.children.length > tasks.length) list.lastElementChild!.remove();
  }

  private form(): HTMLElement {
    const f = document.createElement("form");
    f.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-top:12px";
    const title = document.createElement("input");
    title.placeholder = "Title";
    title.setAttribute("aria-label", "Title");
    const desc = document.createElement("textarea");
    desc.placeholder = "Details";
    desc.setAttribute("aria-label", "Details");
    desc.rows = 3;
    const btn = document.createElement("button");
    btn.type = "submit";
    btn.textContent = "Add to backlog";
    const msg = document.createElement("div");
    msg.className = "board-msg";
    msg.setAttribute("role", "status");
    f.append(title, desc, btn, msg);
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void this.submit(title, desc, btn, msg);
    });
    return f;
  }

  private async submit(title: HTMLInputElement, desc: HTMLTextAreaElement, btn: HTMLButtonElement, msg: HTMLElement): Promise<void> {
    if (!title.value.trim()) { msg.textContent = "Title is required"; return; }
    if (this.mode() !== "live") { msg.textContent = "demo mode: not sent"; return; }
    btn.disabled = true;
    const ok = await this.send({ title: title.value.trim(), description: desc.value.trim() });
    btn.disabled = false;
    if (ok) {
      msg.textContent = "queued: the factory picks it up on its next build step";
      title.value = "";
      desc.value = "";
    } else msg.textContent = "Could not send: try again";
  }
}
