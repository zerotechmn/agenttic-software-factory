import { switchRun } from "./api";
import type { RunPickerApi, RunSummary } from "./shared/contracts";

const CSS = `
#hud .run-picker{position:relative;display:inline-block}
#hud .run-picker-btn{font:9px "Press Start 2P",monospace;max-width:220px;padding:4px 6px;border:3px solid #000;background:#4a3020;color:var(--paper);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
#hud .run-picker-btn:hover,#hud .run-picker-btn[aria-expanded=true]{color:var(--gold)}
#hud .run-picker-list{position:absolute;top:100%;right:0;z-index:20;min-width:260px;max-height:60vh;overflow:auto;margin:2px 0 0;padding:0;list-style:none;background:var(--paper-hi,#fbf3dc);border:2px solid var(--ink,#3a2a1a)}
#hud .run-picker-list[hidden]{display:none}
#hud .run-picker-list li{display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer;white-space:nowrap}
#hud .run-picker-list li:hover{background:#f3e6c4}
#hud .run-picker-list li[aria-selected=true]{background:var(--gold)}
#hud .run-picker-name{font:10px "Press Start 2P",monospace;flex:1}
#hud .run-picker-phase,#hud .run-picker-cost{font:20px VT323,monospace}
#hud .run-picker-phase{color:var(--muted,#7a6a50)}
#hud .run-dot{display:inline-block;width:8px;height:8px;background:var(--good,#3a9a4a);animation:blink 1s steps(2) infinite}
#hud .run-picker-pad{display:inline-block;width:8px;height:8px}
`;

const cost = (r: RunSummary): string => `$${r.usd.toFixed(2)}/$${r.budget}`;

export class RunPicker implements RunPickerApi {
  private cleanup: (() => void) | null = null;

  render(slot: HTMLElement, runs: RunSummary[] | null, current: string | null): void {
    this.cleanup?.();
    this.cleanup = null;
    slot.replaceChildren();
    slot.style.display = runs ? "" : "none";
    if (!runs) return;
    if (!document.getElementById("run-picker-style")) {
      const s = document.createElement("style");
      s.id = "run-picker-style";
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const wrap = document.createElement("div");
    wrap.className = "run-picker";
    const btn = document.createElement("button");
    btn.className = "run-picker-btn";
    btn.type = "button";
    btn.setAttribute("data-testid", "run-picker");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const cur = runs.find((r) => r.name === current);
    btn.textContent = cur ? `${cur.name}${cur.active ? " ●" : ""} ${cost(cur)}` : (current ?? "runs");
    const list = document.createElement("ul");
    list.className = "run-picker-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    const close = (): void => {
      list.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };
    for (const r of runs) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("data-run", r.name);
      const sel = r.name === current;
      li.setAttribute("aria-selected", String(sel));
      if (sel) li.setAttribute("aria-current", "true");
      const dot = document.createElement("span");
      if (r.active) {
        dot.className = "run-dot";
        dot.setAttribute("data-testid", "run-dot");
      } else {
        dot.className = "run-picker-pad";
      }
      const name = document.createElement("span");
      name.className = "run-picker-name";
      name.textContent = r.name;
      const phase = document.createElement("span");
      phase.className = "run-picker-phase";
      phase.textContent = r.phase;
      const c = document.createElement("span");
      c.className = "run-picker-cost";
      c.textContent = cost(r);
      li.append(dot, name, phase, c);
      li.addEventListener("click", () => {
        close();
        switchRun(r.name);
      });
      list.appendChild(li);
    }
    btn.addEventListener("click", () => {
      list.hidden = !list.hidden;
      btn.setAttribute("aria-expanded", String(!list.hidden));
    });
    const onDoc = (e: Event): void => {
      if (!wrap.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    this.cleanup = () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    wrap.append(btn, list);
    slot.appendChild(wrap);
  }
}
