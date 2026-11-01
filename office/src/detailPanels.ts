import type { ForgeEvent } from "./director";

/** Full task and PRD views for the side panel. Text only via textContent (never innerHTML of run data). */

export interface TaskDetail {
  id: string; title: string; description?: string; status: string; kind?: string; attempts?: number; escalated?: boolean;
  deps?: string[]; lanes?: string[]; acceptance?: string[]; featureIds?: string[]; feedback?: string; blocked?: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

function field(label: string, value: string | string[] | undefined): HTMLElement | null {
  if (value === undefined || (Array.isArray(value) && !value.length) || value === "") return null;
  const box = el("div", undefined, "tf");
  box.append(el("b", label));
  if (Array.isArray(value)) {
    const ul = el("ul");
    for (const v of value) ul.append(el("li", v));
    box.append(ul);
  } else box.append(el("div", value));
  return box;
}

const KINDS: Record<string, string> = {
  agent_start: "started", agent_done: "finished", gate: "gate", review: "review", task_status: "status", task_fail: "failed → feedback to dev",
  guard_deny: "guard blocked", note: "note", ruling: "ruling", escalate: "escalated", operator_say: "operator note",
};

/** One task in full: brief, lanes, acceptance, and its whole history (every gate, review, failure and hand-back). */
export function renderTask(body: HTMLElement, t: TaskDetail, events: ForgeEvent[], back: () => void): void {
  body.innerHTML = "";
  const b = el("span", "← all tasks", "back");
  b.addEventListener("click", back);
  body.append(b, el("h2", `${t.id} · ${t.title}`), el("div", `${t.status}${t.kind ? ` · ${t.kind}` : ""} · ${t.attempts ?? 0} attempt(s)${t.escalated ? " · escalated" : ""}`, "meta"));
  for (const f of [
    field("What to build", t.description), field("Acceptance", t.acceptance), field("File lanes", t.lanes),
    field("Depends on", t.deps), field("Features", t.featureIds), field("Blocked", t.blocked), field("Latest feedback to the dev", t.feedback),
  ]) if (f) body.append(f);
  const hist = events.filter((e) => e.kind !== "tool" && e.kind !== "say");
  if (hist.length) {
    const box = el("div", undefined, "tf");
    box.append(el("b", `History (${hist.length})`));
    const ul = el("ul", undefined, "hist");
    for (const e of hist) {
      const who = e.role ? `${e.role}${e.model ? ` (${e.model})` : ""}` : "";
      ul.append(el("li", `${new Date(e.ts).toTimeString().slice(0, 8)} ${KINDS[e.kind] ?? e.kind}${e.status ? ` ${e.status}` : ""}${who ? ` · ${who}` : ""}${e.text ? `: ${e.text}` : ""}`));
    }
    box.append(ul);
    body.append(box);
  }
}

export interface PrdView {
  product?: string; pitch?: string; users?: string[]; outOfScope?: string[];
  features?: { id: string; title: string; priority: string; story?: string; acceptance?: string[]; passes?: boolean; status?: string }[];
  openQuestions?: { id: string; question: string; assumption: string }[];
}

/** The whole PRD, with QA status per feature and the open questions for the client (answerable from here). */
export function renderPrd(body: HTMLElement, prd: PrdView | null, live: boolean, answer: (text: string) => Promise<boolean>, closed = false): void {
  body.innerHTML = "";
  if (!prd) {
    body.append(el("h2", "PRD"), el("div", "No PRD yet: the Product agent writes it in the first phase.", "meta"));
    return;
  }
  body.append(el("h2", prd.product ?? "PRD"));
  if (prd.pitch) body.append(el("div", prd.pitch, "meta"));
  const users = field("Users", prd.users);
  if (users) body.append(users);
  if (prd.openQuestions?.length) {
    const box = el("div", undefined, "tf");
    box.append(el("b", closed ? "Questions for the client (window closed: built on the assumptions)" : "Questions for the client"));
    for (const q of prd.openQuestions) {
      box.append(el("div", `${q.id}: ${q.question}`), el("div", `assumed if unanswered: ${q.assumption}`, "meta"));
    }
    const ta = el("textarea");
    ta.rows = 3;
    ta.placeholder = "Answer, e.g. Q1: yes, due dates please";
    ta.setAttribute("aria-label", "Answer the open questions");
    const btn = el("button", closed ? "Send as a change request" : "Send answers to Product");
    const msg = el("div", "", "status");
    btn.addEventListener("click", async () => {
      if (!ta.value.trim()) return;
      if (!live) { msg.textContent = "demo mode: not sent"; return; }
      btn.disabled = true;
      msg.textContent = (await answer(ta.value.trim())) ? (closed ? "queued as a backlog task: the factory builds it as a fix" : "sent: Product revises the PRD with your answers") : "could not send: try again";
      btn.disabled = false;
      ta.value = "";
    });
    box.append(ta, btn, msg);
    body.append(box);
  }
  for (const f of prd.features ?? []) {
    const status = f.status ?? (f.passes ? "working" : "not yet");
    const box = el("div", undefined, "tf");
    box.append(el("b", `${f.id} · ${f.priority} · ${status}`), el("div", f.title));
    if (f.story) box.append(el("div", f.story, "meta"));
    const acc = field("Acceptance", f.acceptance);
    if (acc) box.append(acc);
    body.append(box);
  }
  const oos = field("Out of scope", prd.outOfScope);
  if (oos) body.append(oos);
}
