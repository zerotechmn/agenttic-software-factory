

/**
 * RPG-style handoff scenes: a dialogue box at the bottom with the speakers' portraits (the speaker lit, the
 * listener dimmed), lines typed out and advanced automatically. Lines come from the console (/api/dialogue, written
 * by a cheap model and cached per run); without a console a short scripted line is used. Never blocks the office.
 */

export interface SceneSpeaker { key: string; name: string }
export interface SceneRequest { key: string; moment: string; speakers: SceneSpeaker[]; facts: string }
interface Line { role: string; name: string; text: string }

const css = `
#dlg{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:min(1000px,94vw);z-index:40;display:none;pointer-events:auto}
#dlg.open{display:block;animation:dlgIn .25s ease-out}
#dlg .box{position:relative;min-height:150px;background:#2b3644;border:4px solid #c9b37a;outline:3px solid #1b2129;box-shadow:inset 0 0 0 3px #46566b,0 6px 0 #0008;padding:22px 200px 22px 200px;color:#fff;cursor:pointer}
#dlg .txt{font-family:"VT323",ui-monospace,monospace;font-size:32px;line-height:1.08;min-height:104px;white-space:pre-wrap;word-break:break-word;text-shadow:2px 2px 0 #000}
#dlg .por{position:absolute;bottom:-4px;height:clamp(250px,42vh,400px);width:auto;max-width:240px;object-fit:contain;object-position:bottom;transition:opacity .2s,filter .2s,transform .2s;filter:drop-shadow(4px 4px 0 #0009);pointer-events:none}
#dlg .por.l{left:-34px;transform-origin:bottom left}#dlg .por.r{right:-34px;transform-origin:bottom right}
#dlg .por:not(.dim){transform:scale(1.04)}
#dlg .por.dim{opacity:.55;filter:grayscale(.7) brightness(.8) drop-shadow(4px 4px 0 #0009)}
#dlg .avatar{position:absolute;bottom:20px;width:140px;height:140px;display:flex;align-items:center;justify-content:center;font-family:"Press Start 2P";font-size:40px;color:#1b2129;border:4px solid #1b2129;box-shadow:4px 4px 0 #0008}
#dlg .avatar.l{left:28px}#dlg .avatar.r{right:28px}
#dlg .avatar.dim{opacity:.4;filter:grayscale(.6)}
#dlg .name{position:absolute;top:-4px;font-family:"Press Start 2P";font-size:13px;background:#2b3644;border:4px solid #c9b37a;padding:8px 14px;color:#fff;transform:translateY(-100%)}
#dlg .name.l{left:196px}#dlg .name.r{right:196px}
#dlg .more{position:absolute;right:14px;bottom:8px;font-size:18px;color:#c9b37a;animation:dlgBlink 1s steps(2) infinite}
#dlg.right .more{right:auto;left:14px}
@keyframes dlgIn{from{transform:translate(-50%,30px);opacity:0}}@keyframes dlgBlink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){#dlg.open,#dlg .more{animation:none}}
`;

const COLORS = ["#f5c542", "#7ee0a1", "#8ec5ff", "#ff9e8a", "#d6a3ff", "#ffd27a"];

export class Dialogue {
  private root = document.createElement("div");
  private queue: SceneRequest[] = [];
  private playing = false;
  private skip?: () => void;
  private rightOf = new WeakMap<SceneRequest, SceneSpeaker>();

  constructor(private fetchLines: (r: SceneRequest) => Promise<Line[]>) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    this.root.id = "dlg";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    document.body.append(this.root);
  }

  /** Queue a scene. Busy moments keep only the newest few so the office never falls behind. */
  play(r: SceneRequest): void {
    this.queue.push(r);
    while (this.queue.length > 3) this.queue.shift();
    if (!this.playing) void this.next();
  }

  isPlaying(): boolean { return this.playing; }

  private async next(): Promise<void> {
    const r = this.queue.shift();
    if (!r) { this.playing = false; this.root.classList.remove("open"); return; }
    this.playing = true;
    let lines: Line[] = [];
    try {
      lines = await this.fetchLines(r);
    } catch {
      lines = [];
    }
    for (const line of lines) await this.say(r, line);
    await wait(900);
    void this.next();
  }

  private portrait(sp: SceneSpeaker, side: "l" | "r", active: boolean, i: number): HTMLElement[] {
    const file = `portraits/${sp.key.replace(":", "-")}.png`;
    const img = document.createElement("img");
    img.className = `por ${side}${active ? "" : " dim"}`;
    img.alt = sp.name;
    img.src = file;
    const avatar = document.createElement("div");
    avatar.className = `avatar ${side}${active ? "" : " dim"}`;
    avatar.style.background = COLORS[i % COLORS.length];
    avatar.textContent = sp.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    avatar.style.display = "none";
    // until the real portrait art is dropped into public/portraits/, show a coloured initials tile
    img.onerror = () => { img.remove(); avatar.style.display = "flex"; };
    return [img, avatar];
  }

  private async say(r: SceneRequest, line: Line): Promise<void> {
    const idx = Math.max(0, r.speakers.findIndex((s) => s.key === line.role));
    const speaker = r.speakers[idx] ?? r.speakers[0];
    // portraits stay put for the whole scene: the opener on the left, the one being answered/answering on the right
    if (idx > 0) this.rightOf.set(r, speaker);
    const left = r.speakers[0];
    const rightSp = this.rightOf.get(r) ?? r.speakers[1];
    const right = idx > 0;
    this.root.className = "open";
    this.root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "box";
    const txt = document.createElement("div");
    txt.className = "txt";
    const name = document.createElement("div");
    name.className = `name ${right ? "r" : "l"}`;
    name.textContent = speaker.name;
    const more = document.createElement("div");
    more.className = "more";
    more.textContent = "▼";
    box.append(...this.portrait(left, "l", !right, 0), ...(rightSp ? this.portrait(rightSp, "r", right, r.speakers.indexOf(rightSp)) : []), txt, name, more);
    this.root.append(box);
    let skipped = false;
    box.addEventListener("click", () => { skipped = true; this.skip?.(); });
    // typewriter: about 40 characters a second; a click finishes the line, a second click moves on
    for (let i = 1; i <= line.text.length && !skipped; i++) {
      txt.textContent = line.text.slice(0, i);
      await wait(25, (s) => (this.skip = s));
    }
    txt.textContent = line.text;
    skipped = false;
    await wait(Math.min(4500, 1600 + line.text.length * 25), (s) => (this.skip = s));
  }
}

function wait(ms: number, onSkip?: (skip: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    onSkip?.(() => { clearTimeout(t); resolve(); });
  });
}

/** Ask the console for the scene's lines; a short scripted exchange when there is no console. */
export async function fetchSceneLines(r: SceneRequest): Promise<Line[]> {
  try {
    const res = await fetch("/api/dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: new URLSearchParams(location.search).get("run") ?? undefined, key: r.key, moment: r.moment, facts: r.facts, speakers: r.speakers.map((s) => ({ role: s.key, name: s.name })) }),
    });
    if (res.ok) {
      const j = (await res.json()) as { lines?: Line[] };
      if (j.lines?.length) return j.lines;
    }
  } catch {
    // no console: scripted lines below
  }
  const [a, b] = r.speakers;
  const diir = (k: string) => (k === "product" || k === "integrator" ? "Diir, " : k === "final_reviewer" ? "Сайн байна өө, " : "");
  return [
    { role: a.key, name: a.name, text: `${diir(a.key)}${r.facts.slice(0, 100)}. Ene chinii eelj!` },
    { role: b.key, name: b.name, text: `${diir(b.key)}Za oilgoloo, odoo l ehelne.` },
  ];
}
