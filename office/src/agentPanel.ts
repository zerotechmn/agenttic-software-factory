import type { Mode } from "./feed";
import type { NoteBook } from "./notes";
import type { AgentPanelApi, AgentPanelInfo, ForgeEvent } from "./shared/contracts";
import { AGENT_LOG_CAP } from "./shared/contracts";
import { cardImg } from "./avatars";

/** One activity row: icon + text with the forge-runs path prefix stripped. */
export function eventLine(e: ForgeEvent): string {
  const rel = (e.text ?? e.status ?? "").replace(/\/\S*?\/forge-runs\/[^/\s]+\/(\.forge\/wt\/[^/\s]+\/)?/g, "");
  return `${e.kind === "tool" ? "⚙" : e.kind === "say" ? "💬" : "✔"} ${rel.slice(0, 80)}`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function injectStyle(): void {
  if (document.getElementById("agent-panel-style")) return;
  const st = document.createElement("style");
  st.id = "agent-panel-style";
  st.textContent = `#hud ul.log li[role=button]{cursor:pointer;border-left:4px solid transparent;animation:slide .25s steps(3)}
#hud ul.log li[role=button]:hover{background:#f3e6c4}
#hud ul.log li.open{border-left-color:var(--gold);background:var(--paper-hi)}
#hud .event-detail{margin:4px 0 4px 8px;cursor:auto}
#hud img.agent-card{display:block;width:140px;height:auto;margin:0 auto 6px;image-rendering:pixelated}
#hud .event-detail .row{display:flex;gap:8px;align-items:baseline}
#hud .event-detail .lbl{flex:0 0 56px;font-family:"Press Start 2P",monospace;font-size:10px;color:var(--muted,#7a6a4a)}
#hud .event-detail .val{font-family:VT323,monospace;font-size:20px;overflow-wrap:anywhere}
#hud .event-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 0;font-family:VT323,monospace;font-size:20px}`;
  document.head.appendChild(st);
}

/** DOM side panel for one character: live log + "Leave a note" with per-note delivery status. */
export class AgentPanel implements AgentPanelApi {
  private body?: HTMLElement;
  private info?: AgentPanelInfo;
  private expanded = new WeakSet<ForgeEvent>();

  constructor(private notes: NoteBook, private mode: () => Mode, private send: (role: string, text: string) => Promise<boolean>) {}

  render(body: HTMLElement, info: AgentPanelInfo): void {
    this.body = body;
    this.info = info;
    injectStyle();
    body.innerHTML = `<h2></h2><div class="meta"></div><ul class="log" data-testid="activity-list"></ul><div class="meta log-empty" hidden>Nothing yet. This agent is quiet.</div><div class="notebox"><h3>Leave a note</h3><div class="meta rule">Notes reach the agent on its next turn.</div><textarea rows="3" placeholder="Leave a note for this agent…"></textarea><button>SEND NOTE</button><div class="ok meta"></div><ul class="notes"></ul></div>`;
    // an interactive Claude Code session is view-only: notes only reach FORGE agents
    (body.querySelector(".notebox") as HTMLElement).hidden = info.role === "claude";
    (body.querySelector("h2") as HTMLElement).textContent = info.title;
    if (info.role !== "claude") body.prepend(cardImg(info.key, info.title, "agent-card"));
    (body.querySelector(".meta") as HTMLElement).textContent = info.meta;
    this.renderLog();
    const ok = body.querySelector(".ok") as HTMLElement;
    body.querySelector("button")!.addEventListener("click", () => {
      const ta = body.querySelector("textarea")!;
      const text = ta.value.trim();
      if (!text) return;
      this.notes.add(info.role, text);
      if (this.mode() === "live") void this.send(info.role, text);
      else ok.textContent = "demo mode: not sent";
      ta.value = "";
      this.refresh();
    });
    this.refresh();
  }

  /** Insert one event row at the top of the open panel's list; nothing else is re-rendered. */
  prepend(key: string, e: ForgeEvent): void {
    if (!this.body || !this.info || this.info.key !== key || !this.body.isConnected) return;
    this.info.events = [e, ...this.info.events].slice(0, AGENT_LOG_CAP);
    const ul = this.body.querySelector("ul.log");
    if (!ul) return;
    const li = this.row(e);
    ul.prepend(li);
    while (ul.children.length > AGENT_LOG_CAP) ul.lastElementChild?.remove();
    if (this.body.scrollTop > 0) this.body.scrollTop += li.offsetHeight;
    this.syncEmpty();
  }

  private renderLog(): void {
    const ul = this.body?.querySelector("ul.log");
    if (!ul || !this.info) return;
    ul.innerHTML = "";
    for (const e of this.info.events.slice(0, AGENT_LOG_CAP)) ul.appendChild(this.row(e));
    this.syncEmpty();
  }

  private syncEmpty(): void {
    const empty = this.body?.querySelector<HTMLElement>(".log-empty");
    if (empty) empty.hidden = (this.body?.querySelector("ul.log")?.children.length ?? 0) > 0;
  }

  private row(e: ForgeEvent): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    const head = document.createElement("span");
    li.appendChild(head);
    const sync = () => {
      const open = this.expanded.has(e);
      li.setAttribute("aria-expanded", String(open));
      li.classList.toggle("open", open);
      head.textContent = `${open ? "▾" : "▸"} ${eventLine(e)}`;
      const cur = li.querySelector("[data-testid=event-detail]");
      if (open && !cur) li.appendChild(this.detail(e));
      else if (!open && cur) cur.remove();
    };
    const toggle = () => {
      if (this.expanded.has(e)) this.expanded.delete(e);
      else this.expanded.add(e);
      sync();
    };
    li.addEventListener("click", (ev) => {
      const d = li.querySelector("[data-testid=event-detail]");
      if (d && ev.target instanceof Node && d.contains(ev.target)) return;
      toggle();
    });
    li.addEventListener("keydown", (ev) => {
      if (ev.target !== li || (ev.key !== "Enter" && ev.key !== " ")) return;
      ev.preventDefault();
      toggle();
    });
    sync();
    return li;
  }

  private detail(e: ForgeEvent): HTMLElement {
    const d = document.createElement("div");
    d.setAttribute("data-testid", "event-detail");
    d.className = "event-detail";
    const add = (label: string, value: string) => {
      const r = document.createElement("div");
      r.className = "row";
      const l = document.createElement("span");
      l.className = "lbl";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "val";
      v.textContent = value;
      r.append(l, v);
      d.appendChild(r);
    };
    add("Time", fmtTime(e.ts));
    add("Phase", e.phase || "-");
    add("Task", e.taskId || "-");
    if (e.kind === "tool") add("Tool", e.data?.tool ?? (e.text ?? "").split(/\s+/)[0] ?? "");
    add("Text", e.text ?? e.status ?? "");
    if (e.kind === "tool" && e.data?.input !== undefined) {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(e.data.input, null, 2);
      d.appendChild(pre);
    }
    return d;
  }

  /** Re-render the note list (statuses changed). Called after a noteDelivered command while this panel is open. */
  refresh(): void {
    if (!this.body || !this.info) return;
    const ul = this.body.querySelector("ul.notes");
    if (!ul) return;
    ul.innerHTML = "";
    for (const n of this.notes.list(this.info.role).slice().reverse()) {
      const li = document.createElement("li");
      const chip = document.createElement("span");
      chip.className = `chip ${n.status}`;
      chip.textContent = n.status;
      const t = document.createElement("span");
      t.textContent = ` ${n.text}`;
      li.append(chip, t);
      ul.appendChild(li);
    }
  }
}
