import type { ForgeEvent } from "./director";
import type { TaskDetail } from "./detailPanels";
import { renderTask } from "./detailPanels";
import { withRun } from "./shared/contracts";
import { cardImg } from "./avatars";

/**
 * Full-window task board: Board (kanban by status), Handoffs (who passed what to whom, filterable) and Timeline
 * (phases, durations, agents, cost). Read-only: cards open details; nothing here changes a task.
 * All run data is rendered with textContent.
 */

export interface KanbanTask extends TaskDetail { branch?: string; escalations?: number }
/** The character behind an event or task: its card key ("dev:2", "qa") and team name. */
export type Who = (e: { role?: string; taskId?: string }) => { key: string; name: string } | undefined;

const COLUMNS: { id: string; label: string; from: string[] }[] = [
  { id: "backlog", label: "Backlog", from: ["backlog"] },
  { id: "ready", label: "Ready", from: ["ready"] },
  { id: "in_progress", label: "In progress", from: ["running"] },
  { id: "review", label: "Review", from: ["review"] },
  { id: "done", label: "Done", from: ["merged"] },
  { id: "blocked", label: "Blocked", from: ["parked", "blocked"] },
];

/** Documents each role hands to the next: shown as links on its "finished" handoff. */
const ARTIFACTS: Record<string, string[]> = {
  product: ["docs/prd.md", "docs/prd.json"],
  critic: ["docs/brief-coverage.json"],
  architect: ["docs/architecture.md", "docs/tasks.json", "src/shared/contracts.ts"],
  uiux: ["docs/design.md"],
  devops: ["docs/DEPLOY.md", ".forge/deploy.json"],
  final_reviewer: [".forge/security.json"],
  learner: ["lessons"],
};

const HANDOFF_KINDS: Record<string, string> = {
  agent_start: "task.started", agent_done: "artifact.published", task_status: "task.status", gate: "check", review: "review.completed",
  task_fail: "fix.requested", qa_result: "qa.report", deploy: "deploy", prd_critic: "prd.checked", clarify: "client.questions",
  security_scan: "security.scan", lesson: "lesson", ruling: "ruling", operator_say: "operator.note", operator_task: "operator.task",
  guard_deny: "guard.blocked", note: "note", escalate: "escalated", phase_start: "phase.started", phase_end: "phase.finished", run_done: "run.done",
};

const css = `
#kanban{position:fixed;inset:0;z-index:50;background:#f4efe4;color:#1f1a14;font-family:"VT323",ui-monospace,monospace;display:none;flex-direction:column}
#kanban.open{display:flex}
#kanban header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:3px solid #000;background:#fffdf5;flex-wrap:wrap}
#kanban h1{font-family:"Press Start 2P";font-size:13px;margin:0}
#kanban .tabs button,#kanban .x{font-family:"Press Start 2P";font-size:10px;padding:7px 10px;border:3px solid #000;background:#fff;cursor:pointer}
#kanban .tabs button.on{background:#f5c542}
#kanban .x{margin-left:auto}
#kanban .counts{font-size:20px;opacity:.8}
#kanban main{flex:1;min-height:0;display:flex}
#kanban .view{flex:1;min-width:0;overflow:auto;padding:14px 16px}
#kanban .cols{display:grid;grid-template-columns:repeat(6,minmax(220px,1fr));gap:12px;min-height:100%}
#kanban .col{background:#ebe3d2;border:3px solid #000;display:flex;flex-direction:column;min-height:200px}
#kanban .col h2{font-family:"Press Start 2P";font-size:10px;margin:0;padding:8px;border-bottom:3px solid #000;display:flex;justify-content:space-between;background:#fffdf5}
#kanban .col[data-col=done] h2{background:#c9f2d3}#kanban .col[data-col=blocked] h2{background:#fbd0cc}#kanban .col[data-col=in_progress] h2{background:#fde7b0}#kanban .col[data-col=review] h2{background:#d6e6ff}
#kanban .cards{padding:8px;display:flex;flex-direction:column;gap:8px;overflow:auto}
#kanban .card{overflow:hidden;word-break:break-word;min-width:0;background:#fff;border:2px solid #000;padding:8px;cursor:pointer;text-align:left;font:inherit;font-size:19px;line-height:1.05;box-shadow:3px 3px 0 #000}
#kanban .card:hover,#kanban .card:focus-visible{outline:3px solid #f5c542}
#kanban .card .id{font-family:"Press Start 2P";font-size:9px}
#kanban .card .face{float:right;width:44px;height:auto;margin:-4px -4px 2px 6px;image-rendering:pixelated}
#kanban .feed .face{width:30px;height:auto;vertical-align:middle;margin-right:4px;image-rendering:pixelated}
#kanban .card .t{font-weight:bold;margin:4px 0}
#kanban .card .d{opacity:.75;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#kanban .card .meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
#kanban .chip{font-size:15px;border:1px solid #000;padding:0 5px;border-radius:6px;background:#f4efe4}
#kanban .chip.fail{background:#fbd0cc}#kanban .chip.pass{background:#c9f2d3}
#kanban aside{width:min(460px,92vw);border-left:3px solid #000;background:#fffdf5;overflow:auto;padding:12px;display:none}
#kanban aside.open{display:block}
#kanban aside .tf{margin:6px 0}#kanban aside .tf b{font-family:"Press Start 2P";font-size:10px;display:block;margin-bottom:2px}
#kanban aside ul{margin:4px 0;padding-left:18px;font-size:19px}#kanban aside h2{font-family:"Press Start 2P";font-size:12px}
#kanban aside .back{font-family:"Press Start 2P";font-size:10px;cursor:pointer}
#kanban aside pre{white-space:pre-wrap;word-break:break-word;font-size:14px;background:#fff;border:2px solid #000;padding:6px}
#kanban .filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
#kanban .filters input,#kanban .filters select{font:inherit;font-size:20px;border:3px solid #000;padding:4px 6px;background:#fff}
#kanban .feed{list-style:none;margin:0;padding:0}
#kanban .feed li{border-bottom:2px dotted #b9a983;padding:5px 0;font-size:19px;display:grid;grid-template-columns:70px 1fr;gap:8px}
#kanban .feed .who{font-weight:bold}#kanban .feed .type{font-size:15px;border:1px solid #000;padding:0 4px;margin-left:6px}
#kanban .feed a{color:#0b4bb3;cursor:pointer;text-decoration:underline;margin-right:8px}
#kanban .tl{display:grid;grid-template-columns:120px 1fr 90px;gap:6px 10px;align-items:center;font-size:20px}
#kanban .tl .bar{height:18px;background:#f5c542;border:2px solid #000;box-sizing:border-box}
@media (prefers-reduced-motion:reduce){#kanban *{transition:none!important}}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const time = (ts: number) => new Date(ts).toTimeString().slice(0, 8);
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)} min`);

export class Kanban {
  private root = el("div");
  private view = el("div", undefined, "view");
  private drawer = el("aside");
  private tab: "board" | "handoffs" | "timeline" = "board";
  private tasks: KanbanTask[] = [];
  private filterWho = "";
  private filterType = "";

  constructor(private events: () => ForgeEvent[], private loadTasks: () => Promise<KanbanTask[]>, private live: () => boolean, private addBacklog?: () => void, private who?: Who) {
    const style = el("style", css);
    document.head.append(style);
    this.root.id = "kanban";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Task board");
    const header = el("header");
    const tabs = el("span", undefined, "tabs");
    for (const [id, label] of [["board", "Board"], ["handoffs", "Handoffs"], ["timeline", "Timeline"]] as const) {
      const b = el("button", label);
      b.dataset.tab = id;
      b.addEventListener("click", () => { this.tab = id; this.drawer.classList.remove("open"); this.render(); });
      tabs.append(b);
    }
    const x = el("button", "✕ close", "x");
    x.addEventListener("click", () => this.close());
    const add = el("button", "+ Add to backlog", "x");
    add.style.marginLeft = "auto";
    add.addEventListener("click", () => this.addBacklog?.());
    x.style.marginLeft = "0";
    header.append(el("h1", "Task board"), tabs, el("span", "", "counts"), add, x);
    const main = el("main");
    main.append(this.view, this.drawer);
    this.root.append(header, main);
    document.body.append(this.root);
    window.addEventListener("keydown", (k) => {
      if (k.key !== "Escape" || !this.isOpen()) return;
      if (this.drawer.classList.contains("open")) this.drawer.classList.remove("open");
      else this.close();
    });
  }

  isOpen(): boolean { return this.root.classList.contains("open"); }

  async open(tab?: "board" | "handoffs" | "timeline"): Promise<void> {
    if (tab) this.tab = tab;
    this.root.classList.add("open");
    await this.refresh();
  }

  close(): void {
    this.root.classList.remove("open");
    this.drawer.classList.remove("open");
  }

  /** Reload the task snapshot (called on open and when the board changes while open). */
  async refresh(): Promise<void> {
    if (!this.isOpen()) return;
    this.tasks = await this.loadTasks();
    this.render();
  }

  private render(): void {
    this.root.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === this.tab));
    const done = this.tasks.filter((t) => t.status === "merged").length;
    (this.root.querySelector(".counts") as HTMLElement).textContent = `${this.tasks.length} tasks · ${done} done · ${this.tasks.filter((t) => ["running", "review"].includes(t.status)).length} active`;
    this.view.innerHTML = "";
    if (this.tab === "board") this.renderBoard();
    else if (this.tab === "handoffs") this.renderHandoffs();
    else this.renderTimeline();
  }

  private lastCheck(id: string): { gate?: string; review?: string } {
    const ev = this.events().filter((e) => e.taskId === id);
    const gate = [...ev].reverse().find((e) => e.kind === "gate")?.status;
    const review = [...ev].reverse().find((e) => e.kind === "review")?.status;
    return { gate, review };
  }

  private renderBoard(): void {
    const grid = el("div", undefined, "cols");
    const byId = new Map(this.tasks.map((t) => [t.id, t]));
    for (const c of COLUMNS) {
      const tasks = this.tasks.filter((t) => c.from.includes(t.status));
      const col = el("section", undefined, "col");
      col.dataset.col = c.id;
      const h = el("h2");
      h.append(el("span", c.label), el("span", String(tasks.length)));
      const cards = el("div", undefined, "cards");
      for (const t of tasks) {
        const card = el("button", undefined, "card");
        card.dataset.task = t.id;
        const check = this.lastCheck(t.id);
        const owner = t.status === "backlog" || t.status === "ready" ? undefined : this.who?.({ role: "dev", taskId: t.id });
        if (owner) card.append(cardImg(owner.key, owner.name, "face"));
        card.append(el("div", `${t.id} · ${t.kind ?? "feature"}`, "id"), el("div", t.title, "t"));
        if (t.description) card.append(el("div", t.description, "d"));
        const meta = el("div", undefined, "meta");
        meta.append(el("span", `dev ×${t.attempts ?? 0}${t.escalated ? " · opus" : ""}`, "chip"));
        if (t.branch) meta.append(el("span", t.branch, "chip"));
        if (check.gate) meta.append(el("span", `gate ${check.gate}`, `chip ${check.gate}`));
        if (check.review) meta.append(el("span", `review ${check.review}`, `chip ${check.review === "reject" ? "fail" : check.review === "approve" ? "pass" : ""}`));
        for (const d of t.deps ?? []) meta.append(el("span", `needs ${d}${byId.get(d)?.status === "merged" ? " ✓" : ""}`, "chip"));
        card.append(meta);
        card.addEventListener("click", () => this.openTask(t.id));
        cards.append(card);
      }
      if (!tasks.length) cards.append(el("div", "—", "d"));
      col.append(h, cards);
      grid.append(col);
    }
    this.view.append(grid);
    if (!this.tasks.length) this.view.append(el("div", "No tasks yet: the Architect plans them in the design phase.", "counts"));
  }

  openTask(id: string): void {
    const t = this.tasks.find((x) => x.id === id) ?? { id, title: id, status: "?" };
    this.drawer.classList.add("open");
    renderTask(this.drawer, t, this.events().filter((e) => e.taskId === id), () => this.drawer.classList.remove("open"));
    const back = this.drawer.querySelector(".back");
    if (back) back.textContent = "✕ close";
  }

  private async openDoc(path: string): Promise<void> {
    this.drawer.classList.add("open");
    this.drawer.innerHTML = "";
    const back = el("span", "✕ close", "back");
    back.addEventListener("click", () => this.drawer.classList.remove("open"));
    const dl = el("a", "⬇ download");
    dl.href = withRun(`/doc?path=${encodeURIComponent(path)}&download=1`);
    const pre = el("pre", "loading…");
    this.drawer.append(back, el("h2", path), dl, pre);
    if (!this.live()) { pre.textContent = "demo mode: documents need forge console"; return; }
    try {
      const r = await fetch(withRun(`/doc?path=${encodeURIComponent(path)}`));
      let text = r.ok ? await r.text() : "not available yet";
      if (path.endsWith(".json")) try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* as is */ }
      pre.textContent = text.slice(0, 300_000);
    } catch {
      pre.textContent = "could not load";
    }
  }

  private renderHandoffs(): void {
    const all = this.events().filter((e) => HANDOFF_KINDS[e.kind]);
    const filters = el("div", undefined, "filters");
    const who = el("input");
    who.placeholder = "agent / role / task";
    who.setAttribute("aria-label", "Filter by sender or task");
    who.value = this.filterWho;
    who.addEventListener("input", () => { this.filterWho = who.value; this.renderFeed(list, all); });
    const type = el("select");
    type.setAttribute("aria-label", "Filter by event type");
    type.append(el("option", "all types"));
    (type.firstChild as HTMLOptionElement).value = "";
    for (const k of [...new Set(all.map((e) => HANDOFF_KINDS[e.kind]))].sort()) {
      const o = el("option", k);
      o.value = k;
      type.append(o);
    }
    type.value = this.filterType;
    type.addEventListener("change", () => { this.filterType = type.value; this.renderFeed(list, all); });
    filters.append(who, type);
    const list = el("ul", undefined, "feed");
    this.view.append(filters, list);
    this.renderFeed(list, all);
  }

  private renderFeed(list: HTMLElement, all: ForgeEvent[]): void {
    list.innerHTML = "";
    const q = this.filterWho.toLowerCase();
    const rows = all.filter((e) => (!this.filterType || HANDOFF_KINDS[e.kind] === this.filterType) && (!q || `${e.role ?? ""} ${e.agentId ?? ""} ${e.taskId ?? ""}`.toLowerCase().includes(q)));
    for (const e of rows.slice(-400).reverse()) {
      const li = el("li");
      const body = el("div");
      const face = e.role ? this.who?.(e) : undefined;
      const who = face?.name ?? e.agentId ?? e.role ?? "orchestrator";
      if (face) body.append(cardImg(face.key, face.name, "face"));
      const to = e.kind === "task_status" && e.status === "review" ? " → reviewer" : e.kind === "task_fail" ? " → dev" : e.kind === "task_status" && e.status === "merged" ? " → main" : "";
      body.append(el("span", `${who}${to}`, "who"), el("span", HANDOFF_KINDS[e.kind], "type"));
      if (e.status) body.append(el("span", ` ${e.status}`));
      if (e.text) {
        let text = e.text;
        // A finished agent's report is JSON: show its summary, not the raw object.
        if (text.startsWith("{")) try { const o = JSON.parse(text) as Record<string, unknown>; text = String(o.summary ?? o.notes ?? o.verdict ?? text); } catch { /* truncated JSON: keep */ }
        body.append(el("div", text.slice(0, 400)));
      }
      const links = el("div");
      if (e.taskId && this.tasks.some((t) => t.id === e.taskId)) {
        const a = el("a", `task ${e.taskId}`);
        a.addEventListener("click", () => this.openTask(e.taskId!));
        links.append(a);
      }
      const docs = e.kind === "agent_done" && e.status === "ok" ? ARTIFACTS[e.role ?? ""] ?? (e.role === "qa" ? [".forge/qa"] : []) : [];
      for (const d of docs.filter((x) => x !== ".forge/qa")) {
        const a = el("a", d.split("/").pop());
        a.addEventListener("click", () => void this.openDoc(d));
        links.append(a);
      }
      if (links.childNodes.length) body.append(links);
      li.append(el("span", time(e.ts)), body);
      list.append(li);
    }
    if (!rows.length) list.append(el("li", "no handoffs match"));
  }

  private renderTimeline(): void {
    const ev = this.events();
    const starts = new Map<string, ForgeEvent>();
    const rows: { phase: string; start: number; ms: number; agents: string; usd: number }[] = [];
    for (const e of ev) {
      if (e.kind === "phase_start") starts.set(e.phase, e);
      if (e.kind === "phase_end" && starts.has(e.phase)) {
        const s = starts.get(e.phase)!;
        const done = ev.filter((x) => x.kind === "agent_done" && x.ts >= s.ts && x.ts <= e.ts);
        rows.push({ phase: e.phase, start: s.ts, ms: e.ts - s.ts, agents: [...new Set(done.map((x) => `${x.role}${x.model ? ` (${x.model})` : ""}`))].join(", "), usd: done.reduce((a, x) => a + (x.usd ?? 0), 0) });
        starts.delete(e.phase);
      }
    }
    for (const [phase, s] of starts) rows.push({ phase: `${phase} (running)`, start: s.ts, ms: Date.now() - s.ts, agents: "", usd: 0 });
    // Gantt: each bar starts where its phase started on the run's clock.
    const t0 = Math.min(...rows.map((r) => r.start));
    const span = Math.max(1, Math.max(...rows.map((r) => r.start + r.ms)) - t0);
    const grid = el("div", undefined, "tl");
    for (const r of rows) {
      const bar = el("div");
      const fill = el("div", undefined, "bar");
      fill.style.marginLeft = `${(100 * (r.start - t0)) / span}%`;
      fill.style.width = `${Math.max(0.6, (100 * r.ms) / span)}%`;
      bar.append(fill, el("div", r.agents, "counts"));
      grid.append(el("div", `${time(r.start)} ${r.phase}`), bar, el("div", `${mins(r.ms)} · $${r.usd.toFixed(2)}`));
    }
    this.view.append(rows.length ? grid : el("div", "No phases finished yet.", "counts"));
  }
}
