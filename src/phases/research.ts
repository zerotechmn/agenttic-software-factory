import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { caps, checkStop, commitMain, emit, hooksFor, loadPrd, stopFile, writeFile, type Ctx } from "../ctx.ts";
import { mcpFor } from "../mcp.ts";
import { researcherPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { ResearchStatus, type ResearchQuestion } from "../schemas.ts";

const MAX_TOPICS = 3;
const MAX_QUESTIONS = 4;
const TOPIC_CAP_USD = 1.0;

/** Answer the PRD's external-fact questions in parallel (one Researcher per topic) before design starts. */
export async function research(ctx: Ctx): Promise<void> {
  stackCheck(ctx);
  const prd = loadPrd(ctx);
  const byTopic = new Map<string, ResearchQuestion[]>();
  for (const q of prd.researchQuestions ?? []) byTopic.set(q.topic, [...(byTopic.get(q.topic) ?? []), q]);
  const topics = [...byTopic.entries()].slice(0, MAX_TOPICS);
  if (!topics.length) {
    ctx.ledger.note("Research: no external questions in the PRD; skipped");
    return;
  }
  if (byTopic.size > MAX_TOPICS) ctx.ledger.ruling(`research only ${MAX_TOPICS} of ${byTopic.size} topics`, "cap research cost", "some facts left to the architect");

  const role = loadRole("researcher");
  const results = await Promise.all(
    topics.map(async ([topic, qs]) => {
      const file = `docs/research/${topic}.md`;
      const res = await ctx.runner.run({
        role: "researcher",
        taskId: topic,
        cwd: ctx.dir,
        prompt: researcherPrompt(topic, qs.slice(0, MAX_QUESTIONS), file),
        model: ctx.cfg.models.researcher,
        ...caps(ctx, "researcher", role.maxTurns),
        maxBudgetUsd: Math.min(caps(ctx, "researcher", role.maxTurns).maxBudgetUsd, TOPIC_CAP_USD),
        schema: ResearchStatus,
        mcpServers: mcpFor(role.mcp),
        // Web content is untrusted: no shell, write one file, read only the project.
        hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readRoots: [ctx.dir], readonlyGlobs: [], writableGlobs: [file], allowBash: false }, "researcher", topic),
      });
      if (!res.ok) ctx.ledger.note(`research ${topic} failed: ${res.error}`);
      return { topic, file, status: res.ok ? (res.output as ResearchStatus) : undefined };
    }),
  );

  const lines = ["# Research index", "", "External facts gathered before design. Read the topic file before using a finding.", ""];
  for (const r of results) {
    lines.push(`## ${r.topic} (${r.status?.status ?? "FAILED"}) → \`${r.file}\``);
    if (r.status) {
      lines.push(r.status.summary.trim(), "");
      for (const f of r.status.findings) lines.push(`- ${f.questionId} [${f.confidence}]: ${f.answer}`);
      for (const c of r.status.concerns) emit(ctx, { kind: "guard_deny", role: "researcher", taskId: r.topic, text: `research concern: ${c}` });
      for (const impact of r.status.prdImpact) ctx.ledger.ruling(impact, `research finding (${r.topic})`, "architect adapts the affected feature");
    } else lines.push("No answers; the architect decides with what the brief says.");
    lines.push("");
  }
  writeFile(join(ctx.dir, "docs", "research", "INDEX.md"), lines.join("\n"));
  commitMain(ctx, "docs: research", ["docs/research/**"]);
}

/**
 * Stop before any design or build work when the brief demands a stack the house template can't deliver.
 * The operator decides: `forge resume <dir> --accept-stack` builds the house web app anyway (and says so in the report).
 */
export function stackCheck(ctx: Ctx): void {
  const p = join(ctx.dir, ".forge", "stack-check.json");
  if (!existsSync(p)) return;
  const conflicts = (JSON.parse(readFileSync(p, "utf8")) as { conflicts?: string[] }).conflicts ?? [];
  if (!conflicts.length) return;
  if (ctx.cfg.acceptStack) {
    ctx.ledger.ruling("build on the house stack", `operator accepted the stack conflict: ${conflicts.join("; ")}`, "judges may mark these requirements as missing");
    return;
  }
  emit(ctx, { kind: "stack_conflict", status: "stop", text: conflicts.join(" · ").slice(0, 600) });
  ctx.ledger.ruling("stop before design", `the brief asks for what the house stack can't build: ${conflicts.join("; ")}`, "resume with --accept-stack to build the house web app anyway");
  writeFileSync(stopFile(ctx.dir), "");
  checkStop(ctx);
}
