import { answerProposal, switchRun } from "./api";
import type { Proposal } from "./shared/contracts";

function btn(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  return b;
}

/** One proposal card: title, optional brief, Confirm/Dismiss. Answering shows the result and removes the buttons. */
export function renderProposalCard(p: Proposal): HTMLElement {
  const card = document.createElement("div");
  card.className = "chat-proposal";
  card.setAttribute("data-testid", "proposal-card");
  card.dataset.id = p.id;

  const title = document.createElement("div");
  title.className = "chat-proposal-title";
  const name = document.createElement("i");
  name.textContent = p.run;
  if (p.kind === "start") {
    title.append("Start run ", name, ` ($${p.budget ?? 0})`);
  } else {
    title.append("Resume ", name);
  }
  card.appendChild(title);

  if (p.kind === "start" && p.brief) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "Brief";
    const t = document.createElement("div");
    t.textContent = p.brief;
    d.append(s, t);
    card.appendChild(d);
  }

  const row = document.createElement("div");
  row.className = "chat-proposal-actions";
  const confirm = btn("Confirm", "chat-confirm");
  const dismiss = btn("Dismiss", "chat-dismiss");
  row.append(confirm, dismiss);
  card.appendChild(row);

  const answer = async (yes: boolean): Promise<void> => {
    confirm.disabled = dismiss.disabled = true;
    const r = await answerProposal(p.id, yes);
    row.remove();
    const res = document.createElement("div");
    res.className = r.ok ? "status" : "error";
    res.textContent = r.ok ? r.data.result : r.error;
    card.appendChild(res);
    card.dataset.answered = "1";
    if (r.ok && yes && p.kind === "start") switchRun(p.run);
  };
  confirm.addEventListener("click", () => void answer(true));
  dismiss.addEventListener("click", () => void answer(false));
  return card;
}
