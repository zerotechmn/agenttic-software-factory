import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventBus } from "./events.ts";
import { sh } from "./git.ts";
import type { ForgeEvent, RunState } from "./types.ts";

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

/** Copy each agent's full SDK transcript into the run (`.forge/transcripts/`), with an index: the evidence behind every event. */
export function exportTranscripts(dir: string, projectsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects")): number {
  const done = EventBus.readAll(join(dir, ".forge", "events.jsonl")).filter((e) => e.kind === "agent_done" && e.sessionId);
  if (!done.length || !existsSync(projectsDir)) return 0;
  const out = join(dir, ".forge", "transcripts");
  mkdirSync(out, { recursive: true });
  const folders = readdirSync(projectsDir);
  const index: Record<string, unknown>[] = [];
  for (const e of done) {
    const folder = folders.find((f) => existsSync(join(projectsDir, f, `${e.sessionId}.jsonl`)));
    const file = `${safe(e.agentId ?? e.role ?? "agent")}.jsonl`;
    if (folder) copyFileSync(join(projectsDir, folder, `${e.sessionId}.jsonl`), join(out, file));
    index.push({ agentId: e.agentId, role: e.role, taskId: e.taskId, model: e.model, phase: e.phase, status: e.status, usd: e.usd, sessionId: e.sessionId, transcript: folder ? `.forge/transcripts/${file}` : null });
  }
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2));
  return index.filter((i) => i.transcript).length;
}

const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)} min`);

/** The run told as a story: phase timeline, then how each task went (attempts, gates, reviews, cost, files). */
export function renderStory(dir: string, state: RunState): string[] {
  const events = EventBus.readAll(join(dir, ".forge", "events.jsonl"));
  const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  const starts = new Map<string, ForgeEvent>();
  const phases: string[] = [];
  for (const e of events) {
    if (e.kind === "phase_start") starts.set(e.phase, e);
    if (e.kind === "phase_end") {
      const s = starts.get(e.phase);
      const agents = events.filter((x) => x.kind === "agent_done" && x.phase === e.phase && s && x.ts >= s.ts && x.ts <= e.ts);
      const usd = agents.reduce((a, x) => a + (x.usd ?? 0), 0);
      const who = [...new Set(agents.map((x) => `${x.role}${x.model ? ` (${x.model})` : ""}`))].join(", ");
      if (s) phases.push(row([new Date(s.ts).toTimeString().slice(0, 5), e.phase, mins(e.ts - s.ts), who || "-", agents.length, `$${usd.toFixed(2)}`]));
    }
  }
  const files = new Map<string, number>();
  const log = sh("git log --format=@%(trailers:key=Forge-Task,valueonly) --name-only", dir);
  if (log.code === 0) {
    let cur = "";
    for (const line of log.out.split("\n")) {
      if (line.startsWith("@")) cur = line.slice(1).trim();
      else if (cur && line.trim()) files.set(cur, (files.get(cur) ?? 0) + 1);
    }
  }
  const tasks = state.tasks.map((t) => {
    const ev = events.filter((e) => e.taskId === t.id);
    const n = (k: string, st?: string) => ev.filter((e) => e.kind === k && (!st || e.status === st)).length;
    const agents = ev.filter((e) => e.kind === "agent_done");
    const usd = agents.reduce((a, e) => a + (e.usd ?? 0), 0);
    const models = [...new Set(agents.filter((e) => e.role === "dev").map((e) => e.model))].join("→") || "-";
    const review = n("review", "reject") ? `${n("review", "reject")} reject → ${n("review", "approve") ? "approve" : "-"}` : n("review", "approve") ? "approve" : n("review", "skipped") ? "skipped (small diff)" : "-";
    const fixes = n("task_fail");
    return row([t.id, t.title.slice(0, 60), models, t.attempts, `${n("gate", "pass")} pass / ${n("gate", "fail")} fail`, review, fixes ? `${fixes} self-fix${fixes > 1 ? "es" : ""}` : "-", files.get(t.id) ?? "-", `$${usd.toFixed(2)}`, t.status + (t.escalated ? " (escalated)" : "")]);
  });
  return [
    "## Timeline",
    row(["Start", "Phase", "Took", "Agents", "Calls", "USD"]),
    row(["---", "---", "---", "---", "---", "---"]),
    ...phases,
    "",
    "## How each task went",
    row(["Task", "Title", "Dev model", "Attempts", "Gate", "Review", "Fix loops", "Files", "USD", "Outcome"]),
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]),
    ...tasks,
    "",
  ];
}

export function renderEvidence(dir: string): string[] {
  const has = (p: string) => existsSync(join(dir, p));
  const t = has(".forge/transcripts/index.json") ? readdirSync(join(dir, ".forge", "transcripts")).filter((f) => f.endsWith(".jsonl")).length : 0;
  return [
    "## Evidence (where to verify each claim)",
    "- Every agent action (start, each tool call and input, what it said, result, tokens, $): `.forge/events.jsonl`",
    "- Decisions the factory took alone: `.forge/ledger.md` · crash-safe state: `.forge/state.json`",
    `- Full transcript of every agent call: \`.forge/transcripts/\` (${t} files, mapped in \`index.json\`)`,
    "- Who wrote which code: `git log` trailers `Forge-Task`, `Forge-Role`, `Forge-Model`, `Forge-Attempt`",
    "- Handoffs: `docs/brief.md` → `docs/prd.json` → `docs/brief-coverage.json` → `docs/architecture.md` + `src/shared/contracts.ts` + `docs/tasks.json` → task branches → `.forge/qa/round-*.json` → `.forge/security.json` → `.forge/deploy.json` → this report + `docs/metrics.json`",
    "",
  ];
}
