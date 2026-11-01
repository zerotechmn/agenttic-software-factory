import { Escalation } from "./escalation";
import { Life, type Rng } from "./life";
import { noteRecipient } from "./notes";

// Pure translation of FORGE events into stage commands (unit-tested; the scene just executes them).
export interface ForgeEvent {
  ts: number; run: string; phase: string; kind: string;
  role?: string; agentId?: string; taskId?: string; status?: string; text?: string; usd?: number; model?: string;
  data?: { tool?: string; input?: unknown; [k: string]: unknown };
}

export type Command =
  | { type: "work"; agent: string; on: boolean; text?: string }
  | { type: "bubble"; agent: string; text: string }
  | { type: "handoff"; from: string; to: string; item: "paper" | "folder" | "bug"; label: string }
  | { type: "throw"; from: string; to: string; label: string }
  | { type: "alert"; agent: string; mood: "bad" | "good" }
  | { type: "stamp"; agent: string; ok: boolean }
  | { type: "merged"; count: number }
  | { type: "phase"; phase: string }
  | { type: "qa"; score: number }
  | { type: "spend"; usd: number }
  | { type: "ruling"; text: string }
  | { type: "ticker"; who: string; text: string; tone: "info" | "good" | "bad" | "warn" }
  | { type: "board"; tasks: { id: string; status: string }[] }
  | { type: "celebrate" }
  | { type: "deployed"; ok: boolean }
  /** Walk away from the seat to a tile and stay there (agent mode "walking", then "idle" on arrival). */
  | { type: "walk"; agent: string; to: { x: number; y: number }; reason: "coffee" | "bookshelf" | "escalation" | "client" }
  /** Walk back to the seat; on arrival set working mode if `work`. */
  | { type: "home"; agent: string; work: boolean }
  /** Small screen-space tag over an agent ("SENIOR"); null removes it. At most one tag per agent. */
  | { type: "tag"; agent: string; text: string | null }
  /** A FORGE note event confirmed delivery of the oldest queued operator note for this FORGE role. */
  | { type: "noteDelivered"; role: string }
  /** A one-off sound effect (no visual). */
  | { type: "sfx"; name: "beer" }
  /** Back from the beer run: walk to the desk carrying the bottle, then open it and drink (with its sound). */
  | { type: "beerReturn"; agent: string; work: boolean }
  /** Sneak out for a beer: through the hall by the lobby to the building's edge, then out of sight. */
  | { type: "beerOut"; agent: string }
  /** An RPG-style handoff scene between characters (keys like "product", "dev:2"); lines are written elsewhere. */
  | { type: "dialogue"; key: string; moment: string; speakers: string[]; facts: string };

const PODS = ["dev:1", "dev:2", "dev:3"];

function shortTool(text: string): string {
  const [tool, ...rest] = text.split(" ");
  const arg = rest.join(" ");
  const file = arg.split("/").pop() ?? arg;
  switch (tool) {
    case "Write": case "Edit": case "MultiEdit": return `✏️ ${file}`;
    case "Read": return `📖 ${file}`;
    case "Grep": case "Glob": return `🔍 ${arg.slice(0, 18)}`;
    case "Bash": {
      const cmd = arg.replace(/^\(?\s*cd\s+\S+\s*(&&|;)\s*/, "").replace(/^\(/, "");
      return `▶ ${cmd.split(/\s+/).filter((w) => w && !w.startsWith("-") && !w.includes("/")).slice(0, 3).join(" ") || "shell"}`;
    }
    case "WebSearch": case "WebFetch": return `🌐 ${arg.slice(0, 18)}`;
    default: return tool.startsWith("mcp__") ? `🌐 ${tool.split("__").pop()}` : `⚙ ${tool}`;
  }
}

export class Director {
  private clarifying = false;
  private lastSummary = new Map<string, string>();
  private approvedOnce = false;
  private planTold = false;
  private qaBugRounds = 0;
  private rejects = new Map<string, number>();

  private scene(key: string, moment: string, speakers: string[], facts: string): Command {
    return { type: "dialogue", key, moment, speakers, facts: facts.slice(0, 900) };
  }
  /** Product's questions are settled (answered or the window closed): clear the tag and send Product back to its desk. */
  private endClarify(): Command[] {
    if (!this.clarifying) return [];
    this.clarifying = false;
    return [{ type: "tag", agent: "product", text: null }, { type: "home", agent: "product", work: true }];
  }

  private podOf = new Map<string, string>();
  /** Every desk a task ever had (kept after merge, for the board's avatars). */
  private deskHistory = new Map<string, string>();
  private merged = 0;
  private active = new Set<string>();
  /** idled by a phase change without an agent_done: no bubbles until they start again */
  private muted = new Set<string>();
  private board = new Map<string, string>();
  private escalation = new Escalation((taskId) => this.podOf.get(taskId));
  private life: Life;
  /** run_done was seen and no new work has started since (celebration state) */
  private finished = false;
  private iteration = 1;

  constructor(rng: Rng = Math.random) {
    this.life = new Life(rng);
  }

  /** Periodic tick with the current run time (ms, same clock as event ts): ambient life commands. */
  tick(runMs: number): Command[] {
    return this.life.tick(runMs);
  }

  private pod(taskId: string): string {
    const have = this.podOf.get(taskId);
    if (have) return have;
    const used = new Set(this.podOf.values());
    const free = PODS.find((p) => !used.has(p)) ?? PODS[this.podOf.size % PODS.length];
    this.podOf.set(taskId, free);
    this.deskHistory.set(taskId, free);
    return free;
  }

  /** The dev desk ("dev:2") that worked a task, if it has started. */
  deskOf(taskId: string): string | undefined {
    return this.podOf.get(taskId) ?? this.deskHistory.get(taskId);
  }

  /** Which on-stage character an event belongs to. */
  agentFor(e: ForgeEvent): string | undefined {
    if (!e.role) return undefined;
    if (e.role === "dev" || e.role === "integrator") return e.taskId ? (e.role === "dev" ? this.pod(e.taskId) : "integrator") : e.role === "dev" ? PODS[0] : "integrator";
    return e.role;
  }

  /** After a run_done, the first new build work starts the next iteration: announce it and clear the celebration state. */
  private nextIteration(e: ForgeEvent, out: Command[]) {
    if (!this.finished) return;
    const newTask = e.kind === "task_status" && !!e.taskId && !this.board.has(e.taskId);
    const newPhase = e.kind === "phase_start" && e.phase === "build";
    if (!newTask && !newPhase) return;
    this.finished = false;
    this.iteration += 1;
    const text = newTask ? "1 new task" : "new build phase";
    out.push({ type: "ticker", who: `Iteration ${this.iteration}`, text, tone: "info" });
  }

  handle(e: ForgeEvent): Command[] {
    const who = this.agentFor(e);
    const out: Command[] = [];
    this.nextIteration(e, out);
    switch (e.kind) {
      case "phase_start":
        if (this.clarifying && e.phase !== "product") out.push(...this.endClarify());
        if (e.phase === "design") out.push(this.scene("prd-design", "Product hands the finished PRD to the architect and the designer", ["product", "architect", "uiux"], this.lastSummary.get("product") ?? "The PRD is done"));
        if (e.phase === "build" && !this.planTold) {
          this.planTold = true;
          out.push(this.scene("plan-devs", "The architect hands the task plan and frozen contracts to the developers", ["architect", PODS[0], PODS[1]], `${this.board.size} tasks planned. ${this.lastSummary.get("architect") ?? ""}`));
        }
        // a new phase starts: anyone still marked working from an earlier phase (missed agent_done) goes idle
        for (const a of this.active) {
          out.push({ type: "work", agent: a, on: false });
          this.muted.add(a);
        }
        this.active.clear();
        out.push({ type: "phase", phase: e.phase });
        break;
      case "agent_start":
        if (who) {
          this.active.add(who);
          this.muted.delete(who);
        }
        if (who) out.push({ type: "work", agent: who, on: true, text: e.taskId ? `${e.taskId}` : e.role });
        // new work is delivered: QA brings a bug for fix tasks, the architect a folder for planned tasks
        if (e.role === "dev" && e.taskId) {
          const fix = /^(FIX|IT)/.test(e.taskId);
          out.push({ type: "handoff", from: fix ? "qa" : "architect", to: who!, item: fix ? "bug" : "folder", label: e.taskId });
        }
        break;
      case "agent_done":
        if (e.role && e.status === "ok" && e.text) this.lastSummary.set(e.role, summaryOf(e.text));
        if (who) this.active.delete(who);
        if (who) out.push({ type: "work", agent: who, on: false });
        if (e.usd) out.push({ type: "spend", usd: e.usd });
        if (e.status === "fail" && who) out.push({ type: "alert", agent: who, mood: "bad" });
        break;
      case "tool":
        if (/^StructuredOutput\b/.test(e.text ?? "")) break; // internal: the agent filing its report
        if (who && e.text && !this.muted.has(who)) out.push({ type: "bubble", agent: who, text: shortTool(e.text) });
        break;
      case "say":
        if (who && e.text && !this.muted.has(who)) out.push({ type: "bubble", agent: who, text: e.text.length > 28 ? e.text.slice(0, 27).trimEnd() + "…" : e.text });
        break;
      case "note": {
        const role = noteRecipient(e.text ?? "");
        if (role) out.push({ type: "noteDelivered", role });
        out.push(...this.escalation.onNote(e.text ?? ""));
        break;
      }
      case "task_status":
        if (!e.taskId) break;
        out.push(...this.escalation.onTaskStatus(e.taskId, e.status ?? "backlog"));
        this.board.set(e.taskId, e.status ?? "backlog");
        out.push({ type: "board", tasks: [...this.board].map(([id, status]) => ({ id, status })) });
        if (e.status === "review") out.push({ type: "handoff", from: this.pod(e.taskId), to: "reviewer", item: "paper", label: e.taskId });
        if (e.status === "merged") {
          this.merged += 1;
          out.push({ type: "handoff", from: "reviewer", to: "integrator", item: "paper", label: e.taskId }, { type: "merged", count: this.merged });
          out.push({ type: "ticker", who: e.taskId, text: "merged", tone: "good" });
          this.podOf.delete(e.taskId);
        }
        if (e.status === "parked") {
          out.push({ type: "ticker", who: e.taskId, text: "parked", tone: "warn" });
          this.podOf.delete(e.taskId);
        }
        break;
      case "gate":
        if (e.taskId && e.status === "fail") {
          out.push({ type: "alert", agent: this.pod(e.taskId), mood: "bad" });
          out.push({ type: "ticker", who: e.taskId, text: e.text ?? "gate failed", tone: "bad" });
        }
        break;
      case "review":
        if (!e.taskId) {
          if (e.status === "approve") out.push(this.scene("ship", "The final reviewer approves the release and hands it to DevOps to deploy", ["final_reviewer", "devops"], `${e.text ?? "final review approved"}. Time to ship.`));
          break;
        }
        if (e.status === "reject" || (e.status === "approve" && !this.approvedOnce)) {
          if (e.status === "approve") this.approvedOnce = true;
          const rejects = e.status === "reject" ? (this.rejects.get(e.taskId) ?? 0) + 1 : 0;
          if (rejects) this.rejects.set(e.taskId, rejects);
          const moment = e.status === "approve" ? "The reviewer approves a developer's work" : rejects === 1 ? "The reviewer rejects a developer's work and kindly explains what to fix" : rejects === 2 ? "The reviewer rejects the same task a second time and is getting annoyed" : "The reviewer rejects the same task yet again and is losing patience (funny)";
          out.push(this.scene(`review-${e.taskId}-${e.ts}`, moment, ["reviewer", this.pod(e.taskId)], `${e.taskId} ${e.status === "reject" ? "rejected" : "approved"}. ${e.text ?? ""}`));
        }
        if (e.status === "reject") {
          out.push({ type: "stamp", agent: "reviewer", ok: false }, { type: "throw", from: "reviewer", to: this.pod(e.taskId), label: e.taskId }, { type: "alert", agent: this.pod(e.taskId), mood: "bad" });
          out.push({ type: "ticker", who: e.taskId, text: "review rejected", tone: "bad" });
        } else if (e.status === "approve") out.push({ type: "stamp", agent: "reviewer", ok: true });
        break;
      case "qa_result": {
        out.push({ type: "qa", score: Number(e.status) || 0 });
        const failures = Number((e.text ?? "").match(/(\d+) failure/)?.[1] ?? 0);
        if (failures > 0) {
          const n = ++this.qaBugRounds;
          const mood = n === 1 ? "QA found bugs and hands them back to the developers, calmly" : n === 2 ? "QA found bugs AGAIN: Duuree is clearly annoyed, the devs make excuses" : "QA keeps finding bugs round after round: Duuree is openly angry (funny, not insulting), the devs panic";
          out.push(this.scene(`qa-${e.ts}`, mood, ["qa", PODS[0]], `QA round ${n} with bugs, score ${e.status}/10, ${failures} bug(s) to fix. ${this.lastSummary.get("qa") ?? ""}`));
        }
        break;
      }
      case "run_done":
        this.finished = true;
        out.push({ type: "celebrate" });
        break;
      case "deploy":
        out.push({ type: "deployed", ok: e.status === "ok" });
        break;
      case "clarify": {
        const n = Array.isArray(e.data) ? (e.data as unknown[]).length : 0;
        if (e.status === "asked") {
          // Product walks out to the lobby (where the client is) and waits there with the questions until answered
          this.clarifying = true;
          out.push(
            { type: "walk", agent: "product", to: { x: 3, y: 6 }, reason: "client" },
            { type: "tag", agent: "product", text: `❓ ${n || ""} question${n === 1 ? "" : "s"} · click me` },
            { type: "bubble", agent: "product", text: `I have ${n || "some"} question${n === 1 ? "" : "s"} for you!` },
            { type: "ticker", who: "Product", text: `asks ${n} question(s): click Product or PRD to answer`, tone: "warn" },
          );
        } else {
          out.push(...this.endClarify(), { type: "bubble", agent: "product", text: "thanks! updating the PRD" }, { type: "ticker", who: "Product", text: "got the operator's answers", tone: "good" });
        }
        break;
      }
      case "stack_conflict":
        out.push({ type: "ticker", who: "Stack", text: `stopped: the brief needs ${e.text ?? "another stack"}; resume with --accept-stack`, tone: "bad" });
        break;
      case "prd_critic":
        out.push({ type: "ticker", who: "Critic", text: e.text ?? "", tone: e.status === "ok" ? "good" : "warn" });
        break;
      case "security_scan":
        out.push({ type: "ticker", who: "Security", text: e.text ?? "", tone: e.status === "ok" ? "good" : "bad" });
        break;
      case "lesson":
        out.push({ type: "ticker", who: "Learner", text: `lesson ${e.status}: ${e.text ?? ""}`, tone: "info" });
        break;
      case "ruling":
        if (e.text) out.push({ type: "ruling", text: e.text.replace(/^RULING:\s*/, "") });
        break;
    }
    out.push(...this.life.observe(out, e.ts));
    return out;
  }
}

/** An agent's finished report is often JSON: keep its human summary for the scene's facts. */
function summaryOf(text: string): string {
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return String(o.summary ?? o.notes ?? text).slice(0, 600);
    } catch {
      return text.slice(0, 600);
    }
  }
  return text.slice(0, 600);
}
