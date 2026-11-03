import { EventBus } from "../events.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { loadConfig } from "../config.ts";
import { stopFile } from "../ctx.ts";
import { addNote } from "../inbox.ts";
import { iterate } from "../iterate.ts";
import { addRequest } from "../requests.ts";
import { loadState, saveState } from "../state.ts";

export interface RunSummary {
  name: string;
  dir: string;
  run?: string;
  phase: string;
  usd: number;
  budget: number;
  product?: string;
  startedAt: number;
  active: boolean;
  /** Deployed app URL, only when .forge/deploy.json says verified. */
  deployUrl?: string;
}

/** Resolve a run name inside the runs root; never outside it. */
export function runDir(root: string, name: string): string {
  const dir = resolve(root, name);
  const rel = relative(resolve(root), dir);
  if (!name || rel.startsWith("..") || isAbsolute(rel) || rel.includes("/")) throw new Error(`invalid run name: ${name}`);
  if (!existsSync(join(dir, ".forge", "state.json")) && !existsSync(join(dir, ".forge"))) throw new Error(`no such run: ${name}`);
  return dir;
}

function alive(dir: string): boolean {
  const pidFile = join(dir, ".forge", "pid");
  if (!existsSync(pidFile)) return false;
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), 0);
    return true;
  } catch {
    return false;
  }
}

export function listRuns(root: string): RunSummary[] {
  if (!existsSync(root)) return [];
  const out: RunSummary[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const s = loadStateSafe(dir);
    if (!s) continue;
    let product: string | undefined;
    try {
      product = JSON.parse(readFileSync(join(dir, "docs", "prd.json"), "utf8")).product;
    } catch {
      // PRD not written yet
    }
    let deployUrl: string | undefined;
    try {
      const d = JSON.parse(readFileSync(join(dir, ".forge", "deploy.json"), "utf8"));
      if (d.verified === true && typeof d.url === "string" && /^https?:\/\//.test(d.url)) deployUrl = d.url;
    } catch {
      // not deployed yet
    }
    out.push({ name, dir, run: s.run, phase: s.phase, usd: s.spend.usd, budget: loadConfig(dir).budgetUsd, product, startedAt: s.startedAt, active: alive(dir), deployUrl });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

function loadStateSafe(dir: string) {
  try {
    return loadState(dir);
  } catch {
    return null;
  }
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";

export interface StartOptions { name?: string; brief: string; budget: number; from?: string }

/** Write the brief and spawn `forge run` detached. `spawn` receives the forge CLI args. */
export function startRun(root: string, o: StartOptions, spawn: (args: string[]) => void): { name: string; dir: string; briefPath: string } {
  const name = slug(o.name ?? o.brief.split("\n").find((l) => l.trim())?.replace(/^#+\s*(brief:)?/i, "") ?? "run");
  const dir = join(root, name);
  if (existsSync(dir)) throw new Error(`run ${name} already exists`);
  const briefs = join(root, ".console", "briefs");
  mkdirSync(briefs, { recursive: true });
  const briefPath = join(briefs, `${name}.md`);
  writeFileSync(briefPath, o.brief);
  const budget = Math.max(1, Math.min(100, Number(o.budget) || 10));
  // An operator is watching a console job: give them 5 minutes to answer the PRD's open questions (never blocks).
  spawn(["run", briefPath, "--out", dir, "--budget", String(budget), "--no-serve", "--clarify-minutes", "5", ...(o.from ? ["--from", o.from] : [])]);
  return { name, dir, briefPath };
}

/** What a diagnosis needs: phase, tasks, spend, rulings, recent notes, last QA failures. */
export function runStatus(root: string, name: string) {
  const dir = runDir(root, name);
  const s = loadState(dir);
  if (!s) throw new Error(`no state for run ${name}`);
  const ledger = existsSync(join(dir, ".forge", "ledger.md")) ? readFileSync(join(dir, ".forge", "ledger.md"), "utf8").split("\n").filter(Boolean) : [];
  const qaDir = join(dir, ".forge", "qa");
  const rounds = existsSync(qaDir) ? readdirSync(qaDir).filter((f) => /^round-\d+\.json$/.test(f)).sort() : [];
  let lastQa: unknown = null;
  if (rounds.length) {
    try {
      const r = JSON.parse(readFileSync(join(qaDir, rounds[rounds.length - 1]), "utf8"));
      lastQa = { score: r.score, visual: r.visual?.score, failures: (r.failures ?? []).map((f: { title: string; actual?: string }) => `${f.title}: ${f.actual ?? ""}`.slice(0, 300)) };
    } catch {
      // partial file
    }
  }
  return {
    name, phase: s.phase, landing: s.landing, usd: s.spend.usd, budget: loadConfig(dir).budgetUsd, byRole: s.spend.byRole,
    tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, attempts: t.attempts, escalated: !!t.escalated })),
    qaRounds: s.qaRounds, lastQa,
    rulings: ledger.filter((l) => l.includes("RULING")).slice(-15),
    recent: ledger.slice(-25),
    active: alive(dir),
    working: working(dir),
  };
}

/** Agents started but not finished (from the event log): what is happening right now, even before tasks exist. */
export function working(dir: string) {
  const events = EventBus.readAll(join(dir, ".forge", "events.jsonl"));
  const open = new Map<string, { agentId: string; role?: string; taskId?: string; model?: string; phase: string; since: string; lastAction?: string }>();
  for (const e of events) {
    if (!e.agentId) continue;
    if (e.kind === "agent_start") open.set(e.agentId, { agentId: e.agentId, role: e.role, taskId: e.taskId, model: e.model, phase: e.phase, since: new Date(e.ts).toISOString() });
    else if (e.kind === "agent_done") open.delete(e.agentId);
    else if ((e.kind === "tool" || e.kind === "say") && open.has(e.agentId)) open.get(e.agentId)!.lastAction = (e.text ?? "").slice(0, 160);
  }
  return [...open.values()];
}

export const actions = {
  addBacklog: (root: string, name: string, title: string, description?: string) => addRequest(runDir(root, name), { title, description }),
  note: (root: string, name: string, role: string | undefined, text: string) => addNote(runDir(root, name), { role, text }),
  stop: (root: string, name: string) => writeFileSync(stopFile(runDir(root, name)), ""),
  iterate: (root: string, name: string, items: string[]) => {
    const dir = runDir(root, name);
    const s = loadState(dir)!;
    const added = iterate(s, items);
    (s.interventions ??= []).push({ at: Date.now(), kind: "iterate", text: items.join("; ").slice(0, 300) });
    saveState(dir, s);
    return added;
  },
};
