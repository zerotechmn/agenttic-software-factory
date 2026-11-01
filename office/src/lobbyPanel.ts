import { runAction, startRun, switchRun } from "./api";
import { DEMO_LOBBY } from "./shared/contracts";
import type { ConsoleInfo, LobbyPanelApi, NewRunRequest } from "./shared/contracts";

const STYLE_ID = "lobby-panel-style";
const CSS = `
#hud .lobby-field{margin-top:8px}
#hud .lobby-field label{display:block;font:10px "Press Start 2P",monospace;margin-bottom:4px}
#hud .lobby-field input,#hud .lobby-field textarea{box-sizing:border-box;width:100%;font:20px VT323,monospace;border:3px solid #000;background:var(--paper-hi,#fff8e6);padding:6px}
#hud .lobby-field textarea{resize:vertical}
#hud .lobby-panel button:disabled{opacity:.45;cursor:not-allowed}
#hud .lobby-panel button.danger{background:var(--bad,#c0392b)}
#hud .lobby-error{color:var(--bad,#c0392b);font:20px VT323,monospace;margin-top:6px}
#hud .lobby-status{font:20px VT323,monospace;margin-top:6px;color:var(--good,#2e7d32)}
#hud .lobby-status.bad{color:var(--bad,#c0392b)}
#hud .lobby-demo{border:3px solid #7b4bb7;padding:6px;font:20px VT323,monospace;margin-bottom:6px}
#hud .lobby-panel hr{border:0;border-top:3px solid #000;margin:12px 0 6px}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** New job / Resume / Stop panel (console mode only; demo notice otherwise). */
export class LobbyPanel implements LobbyPanelApi {
  constructor(private info: () => ConsoleInfo) {}

  render(body: HTMLElement): void {
    if (!document.getElementById(STYLE_ID)) {
      const s = el("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const { console: isConsole, current } = this.info();
    const root = el("div", "lobby-panel");
    root.setAttribute("data-testid", "lobby-panel");
    root.appendChild(el("h2", undefined, "NEW JOB"));

    if (!isConsole) {
      const [before = "", code = "", after = ""] = DEMO_LOBBY.split("`");
      const note = el("div", "lobby-demo");
      note.append(before, el("code", undefined, `\`${code}\``), after);
      root.appendChild(note);
    }

    const field = (label: string, input: HTMLInputElement | HTMLTextAreaElement, id: string) => {
      const f = el("div", "lobby-field");
      const l = el("label", undefined, label);
      input.id = `lobby-${id}`;
      l.htmlFor = input.id;
      f.append(l, input);
      root.appendChild(f);
    };
    const name = el("input");
    name.type = "text";
    const budget = el("input");
    budget.type = "number";
    budget.value = "10";
    const brief = el("textarea");
    brief.rows = 10;
    field("Name (optional)", name, "name");
    field("Budget ($)", budget, "budget");
    field("Brief (markdown)", brief, "brief");

    const start = el("button", undefined, "START");
    start.type = "button";
    const error = el("div", "lobby-error");
    error.setAttribute("data-testid", "lobby-error");
    root.append(start, error);

    root.appendChild(el("hr"));
    root.appendChild(el("div", "meta", `Current run: ${current ?? "-"}`));
    const resume = el("button", undefined, "Resume");
    const stop = el("button", "danger", "Stop");
    resume.type = stop.type = "button";
    const status = el("div", "lobby-status");
    root.append(resume, " ", stop, status);

    if (!isConsole) start.disabled = resume.disabled = stop.disabled = true;
    else if (!current) resume.disabled = stop.disabled = true;

    start.addEventListener("click", async () => {
      error.textContent = "";
      const b = Number(budget.value);
      if (!Number.isFinite(b) || b <= 0) {
        error.textContent = "budget must be a positive number";
        return;
      }
      const req: NewRunRequest = { brief: brief.value, budget: b };
      const n = name.value.trim();
      if (n) req.name = n;
      start.disabled = true;
      start.textContent = "STARTING…";
      const r = await startRun(req);
      if (!body.isConnected) return;
      start.disabled = false;
      start.textContent = "START";
      if (r.ok) switchRun(r.data.name);
      else error.textContent = r.error;
    });

    const act = (action: "resume" | "stop") => async () => {
      if (!current) return;
      resume.disabled = stop.disabled = true;
      status.className = "lobby-status";
      status.textContent = "";
      const r = await runAction(current, action);
      if (!body.isConnected) return;
      resume.disabled = stop.disabled = false;
      if (r.ok) status.textContent = `${r.status}: ${action} requested`;
      else {
        status.className = "lobby-status bad";
        status.textContent = r.error;
      }
    };
    resume.addEventListener("click", act("resume"));
    stop.addEventListener("click", act("stop"));

    body.appendChild(root);
  }
}
