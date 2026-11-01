import { askAssistant, fetchProposals } from "./api";
import { renderMarkdown } from "./markdown";
import { renderProposalCard } from "./proposals";
import { CHAT_STORAGE_KEY, DEMO_CHAT } from "./shared/contracts";
import type { ChatMessage, ChatPanelApi, ConsoleInfo } from "./shared/contracts";

const CSS = `
#hud .chat-list{max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin:8px 0}
#hud .chat-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#hud .chat-msg{max-width:85%;border:3px solid var(--outline);border-radius:0;padding:4px 6px;font:var(--fs-body) var(--font-body);color:var(--ink);overflow-wrap:anywhere}
#hud .msg-operator{margin-left:auto;background:var(--msg-operator-bg);white-space:pre-wrap}
#hud .msg-assistant{margin-right:auto;background:var(--msg-assistant-bg)}
#hud .msg-error{margin-right:auto;background:var(--msg-error-bg);color:var(--bad)}
#hud .chat-msg p{margin:0 0 4px}
#hud .chat-msg code{font-family:var(--font-body);background:#e4d3a8;padding:0 2px}
#hud .chat-msg pre{background:#2a1a10;color:var(--paper);white-space:pre-wrap;padding:4px;margin:4px 0}
#hud .chat-cost{font:18px var(--font-body);color:#7a6548;margin-top:2px}
#hud .chat-empty{font:var(--fs-body) var(--font-body);color:#7a6548}
#hud .chat-thinking{font:var(--fs-body) var(--font-body)}
#hud .chat-thinking span{animation:chat-blink 1s steps(3) infinite}
@keyframes chat-blink{0%{opacity:0}100%{opacity:1}}
#hud .chat-proposals{display:flex;flex-direction:column;gap:6px}
#hud .chat-proposal{background:var(--paper-hi);border:3px solid var(--outline);padding:6px;font:var(--fs-body) var(--font-body);color:var(--ink)}
#hud .chat-proposal-actions{display:flex;gap:6px;margin-top:6px}
#hud .chat-confirm{background:var(--gold);color:var(--ink)}
#hud .chat-dismiss{background:var(--wood-dark);color:var(--paper)}
#hud .chat-compose{display:flex;gap:6px;align-items:flex-end}
#hud .chat-compose textarea{flex:1;min-height:48px}
`;

export class ChatPanel implements ChatPanelApi {
  constructor(private info: () => ConsoleInfo, private storage: Storage | null = null) {}

  private load(): ChatMessage[] {
    try {
      const raw = this.storage?.getItem(CHAT_STORAGE_KEY);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? (v as ChatMessage[]) : [];
    } catch {
      return [];
    }
  }

  private save(msgs: ChatMessage[]): void {
    try {
      this.storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
    } catch {
      /* storage unavailable */
    }
  }

  render(body: HTMLElement): void {
    if (!document.getElementById("chat-panel-style")) {
      const st = document.createElement("style");
      st.id = "chat-panel-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const demo = !this.info().console;
    const msgs = demo ? [] : this.load();

    const root = document.createElement("div");
    root.setAttribute("data-testid", "chat-panel");

    const head = document.createElement("div");
    head.className = "chat-head";
    const h = document.createElement("h2");
    h.textContent = "Ask FORGE";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";
    clear.className = "chat-clear";
    head.append(h, clear);
    root.appendChild(head);

    const list = document.createElement("div");
    list.className = "chat-list";
    const cards = document.createElement("div");
    cards.className = "chat-proposals";
    const thinking = document.createElement("div");
    thinking.className = "chat-thinking";
    thinking.append("thinking");
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.textContent = ".";
      thinking.appendChild(dot);
    }
    thinking.hidden = true;

    const compose = document.createElement("div");
    compose.className = "chat-compose";
    const input = document.createElement("textarea");
    input.rows = 2;
    input.placeholder = "Ask FORGE…";
    const send = document.createElement("button");
    send.type = "button";
    send.textContent = "Send";
    compose.append(input, send);

    const scroll = (): void => { list.scrollTop = list.scrollHeight; };
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = demo ? DEMO_CHAT : "Ask FORGE to start, resume or explain a run.";

    const addBubble = (m: ChatMessage): void => {
      empty.remove();
      const b = document.createElement("div");
      b.className = `chat-msg ${m.from === "operator" ? "msg-operator" : m.from === "assistant" ? "msg-assistant" : "msg-error"}`;
      if (m.from === "assistant") {
        b.appendChild(renderMarkdown(m.text));
        if (typeof m.usd === "number") {
          const c = document.createElement("div");
          c.className = "chat-cost";
          c.textContent = `$${m.usd.toFixed(2)}`;
          b.appendChild(c);
        }
      } else {
        b.textContent = m.text;
      }
      list.insertBefore(b, cards);
    };
    const push = (m: ChatMessage): void => {
      msgs.push(m);
      this.save(msgs);
      addBubble(m);
      scroll();
    };

    const syncProposals = async (): Promise<void> => {
      const ps = await fetchProposals();
      if (!root.isConnected) return;
      const ids = new Set(ps.map((p) => p.id));
      for (const c of Array.from(cards.children) as HTMLElement[]) {
        if (!c.dataset.answered && !ids.has(c.dataset.id ?? "")) c.remove();
      }
      const have = new Set(Array.from(cards.children).map((c) => (c as HTMLElement).dataset.id));
      for (const p of ps) if (!have.has(p.id)) cards.appendChild(renderProposalCard(p));
      scroll();
    };

    list.append(empty, cards, thinking);
    for (const m of msgs) addBubble(m);
    root.append(list, compose);
    body.appendChild(root);
    scroll();

    if (demo) {
      input.disabled = true;
      send.disabled = true;
      clear.disabled = true;
      return;
    }

    let pending = false;
    const submit = async (): Promise<void> => {
      const text = input.value.trim();
      if (!text || pending) return;
      pending = true;
      input.value = "";
      push({ from: "operator", text, ts: Date.now() });
      input.disabled = send.disabled = true;
      thinking.hidden = false;
      list.appendChild(thinking);
      scroll();
      const r = await askAssistant(text);
      pending = false;
      if (!root.isConnected) return;
      thinking.hidden = true;
      if (r.ok) push({ from: "assistant", text: r.data.reply, usd: r.data.usd, ts: Date.now() });
      else push({ from: "error", text: `Couldn't reach FORGE: ${r.error}`, ts: Date.now() });
      input.disabled = send.disabled = false;
      input.focus();
      void syncProposals();
    };
    send.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    });
    clear.addEventListener("click", () => {
      msgs.length = 0;
      try { this.storage?.removeItem(CHAT_STORAGE_KEY); } catch { /* ignore */ }
      for (const c of Array.from(list.querySelectorAll(".chat-msg"))) c.remove();
      list.insertBefore(empty, cards);
    });

    void syncProposals();
  }
}
