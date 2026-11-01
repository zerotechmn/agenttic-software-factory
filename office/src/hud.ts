import type { Command } from "./director";
import type { PanelKind } from "./shared/contracts";

const PHASES = ["intake", "product", "research", "design", "contract_gate", "build", "qa", "final_review", "deploy", "report"];
const LABEL: Record<string, string> = { intake: "Intake", product: "Product", research: "Research", design: "Design", contract_gate: "Gate", build: "Build", qa: "QA", final_review: "Review", deploy: "Deploy", report: "Report" };

/** "3/10"-style progress for the phase strip (empty before the first phase); shown on mobile where only the active chip fits. */
export function phaseStep(phase: string): string {
  const i = PHASES.indexOf(phase);
  return i < 0 ? "" : `${i + 1}/${PHASES.length}`;
}

/** Badge text and style: a live run that reached its final phase is over, so it reads DONE instead of a stale LIVE. */
export function badgeFor(mode: "live" | "replay", phase: string): { text: string; cls: string } {
  if (mode === "live" && phase === PHASES[PHASES.length - 1]) return { text: "DONE", cls: "replay" };
  return { text: mode.toUpperCase(), cls: mode };
}

const css = `
:root{--ink:#2a1a10;--paper:#fff6e0;--wood:#6e4429;--gold:#ffd166;--good:#7ee081;--bad:#ff5a4e;--warn:#ffb347;--violet:#c3a6ff}
#hud{position:fixed;inset:0;pointer-events:none;font-family:"VT323",monospace;color:var(--paper)}
#hud .bar{position:absolute;left:8px;right:8px;top:6px;height:42px;box-sizing:border-box;flex-wrap:nowrap;display:flex;gap:14px;align-items:center;pointer-events:auto;
  background:rgba(42,26,16,.92);border:3px solid #000;box-shadow:inset 0 0 0 3px var(--wood),0 6px 0 rgba(0,0,0,.35);padding:4px 12px}
#hud .logo{font-family:"Press Start 2P";font-size:12px;color:var(--gold);letter-spacing:1px}
#hud .product{font-family:"Press Start 2P";font-size:10px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
#hud .badge{font-family:"Press Start 2P";font-size:10px;padding:5px 8px;border:3px solid #000}
#hud .badge.live{background:#2e7d32}#hud .badge.replay{background:#6d4cc2}
#hud .phases{display:flex;gap:3px;flex-wrap:nowrap}
#hud .ph{font-size:18px;padding:0 5px;border:2px solid #000;background:#4a3020;color:#c8b49a}
#hud .ph.done{background:#3d6b3a;color:#e8ffe0}#hud .ph.on{background:var(--gold);color:var(--ink);animation:blink 1s steps(2) infinite}
#hud .sp{flex:1}
#hud .stat{font-size:22px;white-space:nowrap}#hud .stat b{font-family:"Press Start 2P";font-size:13px;color:var(--gold)}
#hud .money{width:120px;height:14px;border:3px solid #000;background:#3a2516;position:relative}
#hud .money i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#4ade80,#ffd166 70%,#ff5a4e);width:0%}
#hud .speed{display:flex;gap:3px}#hud .speed button{font-family:"Press Start 2P";font-size:9px;padding:4px 6px;border:3px solid #000;background:#4a3020;color:var(--paper);cursor:pointer}
#hud .speed button.on{background:var(--gold);color:var(--ink)}
#hud .ticker{position:absolute;left:8px;right:400px;top:50px;height:20px;overflow:hidden;display:flex;gap:18px;white-space:nowrap;
  background:rgba(18,13,10,.85);border-bottom:2px solid #000;padding:0 10px}
#hud .tick{font-size:20px;line-height:20px;animation:slide .25s steps(3)}#hud .tick:first-child{color:var(--paper)}
#hud .tick:not(:first-child){opacity:.55}
#hud .tick.good{color:var(--good)}#hud .tick.bad{color:var(--bad)}#hud .tick.warn{color:var(--warn)}#hud .tick.rule{color:var(--violet)}
#hud .panel{position:absolute;right:12px;top:78px;width:340px;max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;display:none;
  background:var(--paper);color:var(--ink);border:3px solid #000;box-shadow:inset 0 0 0 3px var(--wood),0 6px 0 rgba(0,0,0,.35);padding:14px}
#hud .panel h2{font-family:"Press Start 2P";font-size:14px;margin:0 0 6px}#hud .panel .meta{font-size:22px;opacity:.8}
#hud .panel ul{list-style:none;padding:0;margin:8px 0;font-size:20px;line-height:1.05}#hud .panel li{border-bottom:2px dotted #c9b78f;padding:2px 0}
#hud .panel textarea{width:100%;box-sizing:border-box;font-family:"VT323";font-size:20px;border:3px solid #000;padding:6px;background:#fffdf5}
#hud .panel button{font-family:"Press Start 2P";font-size:10px;padding:8px;border:3px solid #000;background:var(--gold);cursor:pointer;margin-top:6px}
#hud .panel .field{margin:8px 0}
#hud .panel .field label{display:block;font-family:"Press Start 2P";font-size:10px;margin-bottom:4px}
#hud .panel input,#hud .panel select{width:100%;box-sizing:border-box;font-family:"VT323";font-size:20px;border:3px solid #000;padding:6px;background:var(--paper-hi,#fffdf5);color:var(--ink)}
#hud .panel button:disabled{opacity:.45;cursor:not-allowed}
#hud .panel button.danger{background:var(--bad)}
#hud .panel .status{font-size:20px;color:var(--good);margin-top:6px}
#hud .panel .error{font-size:20px;color:var(--bad);margin-top:6px}
#hud .actions{display:flex;gap:6px}#hud .actions button{font-family:"Press Start 2P";font-size:9px;padding:4px 6px;border:3px solid #000;background:#4a3020;color:var(--paper);cursor:pointer;white-space:nowrap}
#hud .actions button:hover,#hud .actions button.on{background:var(--gold);color:var(--ink)}
#hud .actions button.locked{outline:3px dashed var(--gold);outline-offset:1px;animation:blink 1s steps(2) infinite}
#hud .consolebar{position:absolute;right:8px;top:50px;display:flex;gap:8px;align-items:center;pointer-events:auto;z-index:5}
#hud .run-slot{white-space:nowrap}#hud .run-slot:empty{display:none}
#hud .x{float:right;cursor:pointer;font-family:"Press Start 2P";font-size:12px}
#hud .notice{position:absolute;left:50%;top:84px;transform:translateX(-50%);pointer-events:auto;font-family:"Press Start 2P";font-size:11px;padding:8px 14px;border:3px solid #000;display:none;z-index:5;max-width:80vw;text-align:center}
#hud .notice.demo{background:#fde68a;color:#1c1000}#hud .notice.conn{background:#fca5a5;color:#450a0a}
#hud .product,#hud .stat.tasks{cursor:pointer;text-decoration:underline dotted}
#hud .panel .tf{margin:6px 0}#hud .panel .tf b{font-family:"Press Start 2P";font-size:10px;display:block;margin-bottom:2px}#hud .panel .tf div,#hud .panel .tf li{font-size:20px;white-space:pre-wrap;word-break:break-word}
#hud .panel .hist li{font-size:18px}#hud .panel .back{font-family:"Press Start 2P";font-size:10px;cursor:pointer;margin-bottom:6px;display:inline-block}
#hud .vault-group{display:block;font-family:"Press Start 2P";font-size:10px;margin-top:10px}#hud .vault-row a{color:inherit}#hud .panel .vault-doc{white-space:pre-wrap;word-break:break-word;font-size:14px;max-height:70vh;overflow:auto;background:#fffdf5;border:2px solid #000;padding:6px}
#hud .board-row{cursor:pointer}#hud .board-row:hover{background:rgba(0,0,0,.06)}
@keyframes blink{50%{filter:brightness(1.25)}}@keyframes slide{from{transform:translateX(-12px);opacity:0}}
@media (max-width:700px){#hud .phases{flex:1;min-width:0;overflow:hidden}#hud .ph{font-size:14px;padding:0 6px;flex:none}#hud .ph:not(.on){display:none}#hud .ph.on{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;flex:0 1 auto}#hud .phases::before{content:attr(data-step);font-size:14px;color:var(--gold);margin-right:6px;align-self:center}#hud .phases:not(:has(.on)) .ph:first-child{display:block}#hud .sp{display:none}#hud .tick{font-size:16px;min-width:0;overflow:hidden;text-overflow:ellipsis}#hud .tick:not(:first-child){display:none}#hud .money,#hud .product,#hud .speed,#hud .stat:has(.usd),#hud .stat:has(.merged),#hud .stat:has(.qa){display:none}#hud .bar{gap:8px;padding:4px 8px}#hud .logo{font-size:10px}#hud .panel{left:12px;width:auto}}
`;

export class Hud {
  private el = document.createElement("div");
  private q = (s: string) => this.el.querySelector(s) as HTMLElement;
  private spend = 0;
  budget = 30;
  private start = Date.now();
  private first = 0;
  private last = 0;
  private merged = 0;
  private qa = "–";
  private phase = "";
  private mode: "live" | "replay" = "replay";
  onSpeed?: (s: number) => void;
  onRestart?: () => void;
  onNewJob?: () => void;
  onAsk?: () => void;
  onProduct?: () => void;
  onBoard?: () => void;
  onVault?: () => void;
  onSfx?: (on: boolean) => void;
  onMusic?: (on: boolean) => void;
  private total = 0;

  constructor() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.el.id = "hud";
    this.el.innerHTML = `
      <div class="bar">
        <span class="logo">FORGE·OFFICE</span><span class="product" title="Open the PRD">PRD</span><span class="badge replay">REPLAY</span>
        <span class="phases">${PHASES.map((p) => `<span class="ph" data-p="${p}">${LABEL[p]}</span>`).join("")}</span>
        <span class="sp"></span>
        <span class="stat">⏱ <b class="t">0:00</b></span>
        <span class="stat">$ <b class="usd">0.00</b></span><span class="money"><i></i></span>
        <span class="stat tasks" title="Open the task board">tasks <b class="merged">0</b>/<b class="total">0</b></span>
        <span class="stat">QA <b class="qa">–</b></span>
        <span class="speed"><button data-s="1" class="on">1×</button><button data-s="4">4×</button><button data-s="10">10×</button><button data-r>↺</button></span>
      </div>
      <div class="ticker"></div>
      <div class="consolebar"><span class="run-slot"></span><span class="actions"><button data-a="prd">PRD</button><button data-a="tasks">Tasks</button><button data-a="vault">Docs</button><button data-a="replay" title="Replay this run from the start">▶ Replay</button><button data-a="sfx" title="Sound effects" aria-pressed="false">SFX</button><button data-a="music" title="Background music" aria-pressed="false">♪</button><button data-a="job">+ New job</button><button data-a="ask">Ask FORGE</button></span></div>
      <div class="notice demo">DEMO REPLAY · a recorded sample run, not your factory</div><div class="notice conn"></div>
      <div class="panel"><span class="x">✕</span><div class="body"></div></div>`;
    document.body.appendChild(this.el);
    this.el.querySelectorAll<HTMLButtonElement>(".speed button[data-s]").forEach((b) => b.addEventListener("click", () => this.setSpeedUi(Number(b.dataset.s))));
    this.q(".speed [data-r]").addEventListener("click", () => this.onRestart?.());
    this.q(".actions [data-a=job]").addEventListener("click", () => this.onNewJob?.());
    this.q(".actions [data-a=ask]").addEventListener("click", () => this.onAsk?.());
    this.q(".actions [data-a=prd]").addEventListener("click", () => this.onProduct?.());
    this.q(".actions [data-a=tasks]").addEventListener("click", () => this.onBoard?.());
    this.q(".actions [data-a=vault]").addEventListener("click", () => this.onVault?.());
    for (const k of ["sfx", "music"] as const) {
      const b = this.q(`.actions [data-a=${k}]`);
      b.addEventListener("click", () => {
        // "mixed" = on, but waiting for a click to unlock audio: this click turns it on, never off
        const on = b.getAttribute("aria-pressed") !== "true";
        this.setAudio(k, on);
        (k === "sfx" ? this.onSfx : this.onMusic)?.(on);
      });
    }
    this.q(".actions [data-a=replay]").addEventListener("click", () => {
      const u = new URL(location.href);
      if (u.searchParams.has("replay")) u.searchParams.delete("replay");
      else u.searchParams.set("replay", "1");
      location.assign(u.toString());
    });
    if (new URLSearchParams(location.search).has("replay")) this.q(".actions [data-a=replay]").textContent = "● Live";
    this.q(".panel .x").addEventListener("click", () => this.closePanel());
    this.q(".product").addEventListener("click", () => this.onProduct?.());
    this.q(".stat.tasks").addEventListener("click", () => this.onBoard?.());
    window.addEventListener("keydown", (k) => { if (k.key === "Escape") this.closePanel(); });
    setInterval(() => {
      // run time from the events themselves (correct for live and for replay)
      const s = this.first ? Math.floor((this.last - this.first) / 1000) : 0;
      this.q(".t").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 1000);
  }

  setSpeedUi(s: number) {
    this.el.querySelectorAll<HTMLButtonElement>(".speed button[data-s]").forEach((b) => b.classList.toggle("on", Number(b.dataset.s) === s));
    this.onSpeed?.(s);
  }

  setMode(m: "live" | "replay", product?: string) {
    this.mode = m;
    this.render();
    (this.q(".speed") as HTMLElement).style.display = m === "live" ? "none" : "";
    if (product) this.q(".product").textContent = `${product} · PRD`;
    const run = new URLSearchParams(location.search);
    const demo = this.q(".notice.demo");
    demo.textContent = run.has("replay") ? `REPLAY · ${run.get("run") ?? "latest run"} from its recorded log (● Live to go back)` : "DEMO REPLAY · a recorded sample run, not your factory";
    demo.style.display = m === "replay" ? "block" : "none";
  }

  /** A red banner while the live connection to FORGE is down or not established yet. */
  setConnection(ok: boolean, why?: string) {
    const n = this.q(".notice.conn");
    n.textContent = why ?? "";
    n.style.display = ok ? "none" : "block";
  }

  setTotal(n: number) { this.total = n; this.render(); }

  /** Reflect a sound toggle's state on its button (pressed = on; "locked" = on but the browser wants a click first). */
  setAudio(kind: "sfx" | "music", on: boolean | "locked") {
    const b = this.q(`.actions [data-a=${kind}]`);
    b.setAttribute("aria-pressed", on === "locked" ? "mixed" : String(on));
    b.style.background = on === true ? "var(--gold)" : "";
    b.classList.toggle("locked", on === "locked");
    b.title = on === "locked" ? "Click to turn sound on (the browser needs one click first)" : kind === "sfx" ? "Sound effects" : "Background music";
  }

  reset() {
    this.spend = 0; this.merged = 0; this.qa = "–"; this.start = Date.now(); this.first = 0; this.last = 0;
    this.render();
    this.q(".ticker").innerHTML = "";
  }

  clock(ts: number) {
    if (!this.first) this.first = ts;
    this.last = Math.max(this.last, ts);
  }

  product(name: string) { this.q(".product").textContent = `${name} · PRD`; }

  handle(c: Command) {
    if (c.type === "phase") this.phase = c.phase;
    else if (c.type === "spend") this.spend += c.usd;
    else if (c.type === "merged") this.merged = c.count;
    else if (c.type === "qa") { this.qa = String(c.score); this.tick("QA", `score ${c.score}/10`, c.score >= 7 ? "good" : "warn"); }
    else if (c.type === "ruling") this.tick("ruling", c.text, "rule");
    else if (c.type === "ticker") this.tick(c.who, c.text, c.tone);
    this.render();
  }

  tick(who: string, text: string, tone: string) {
    const t = document.createElement("div");
    t.className = `tick ${tone}`;
    t.textContent = `${who} · ${text}`.slice(0, 72);
    if (/click the product name/.test(text)) { t.style.cursor = "pointer"; t.title = "Answer in the PRD panel"; t.addEventListener("click", () => this.onProduct?.()); }
    const box = this.q(".ticker");
    box.prepend(t);
    while (box.children.length > 4) box.lastElementChild!.remove();
  }

  private render() {
    const badge = badgeFor(this.mode, this.phase);
    const b = this.q(".badge");
    b.textContent = badge.text;
    b.className = `badge ${badge.cls}`;
    this.q(".usd").textContent = this.spend.toFixed(2);
    (this.q(".money i") as HTMLElement).style.width = `${Math.min(100, (100 * this.spend) / this.budget)}%`;
    this.q(".merged").textContent = String(this.merged);
    this.q(".total").textContent = String(this.total);
    this.q(".qa").textContent = this.qa;
    const idx = PHASES.indexOf(this.phase);
    this.q(".phases").dataset.step = phaseStep(this.phase);
    this.el.querySelectorAll<HTMLElement>(".ph").forEach((p, i) => { p.classList.toggle("on", i === idx); p.classList.toggle("done", idx > i); });
  }

  private kind: PanelKind | null = null;

  /** Open the single side panel for `kind` ("board", "agent:<key>", "lobby" or "chat"), emptied; returns its body to render into. */
  showPanel(kind: PanelKind): HTMLElement {
    this.kind = kind;
    this.q(".panel").style.display = "block";
    const body = this.q(".panel .body");
    body.innerHTML = "";
    return body;
  }

  closePanel() {
    this.kind = null;
    this.q(".panel").style.display = "none";
  }

  /** Empty slot in the bar for the run picker. */
  runSlot(): HTMLElement { return this.q(".run-slot"); }

  /** What the side panel currently shows, or null when closed. */
  panelKind(): PanelKind | null { return this.kind; }
}
