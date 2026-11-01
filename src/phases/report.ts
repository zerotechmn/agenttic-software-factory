import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commitMain, loadPrd, writeFile, type Ctx } from "../ctx.ts";
import { localLLM } from "../local.ts";
import { computeMetrics, renderMetrics } from "../metrics.ts";
import { renderSecurity } from "../security.ts";
import { exportTranscripts, renderEvidence, renderStory } from "../story.ts";
import { applyLearning, LearnerOutput, loadLessons, promotable, runEvidence, saveLessons } from "../lessons.ts";
import { caps, emit, hooksFor } from "../ctx.ts";

/** Cross-run learning: a cheap learner proposes lesson changes from this run's mistakes; the orchestrator applies them. */
export async function learn(ctx: Ctx): Promise<void> {
  const evidence = runEvidence(ctx.dir);
  if (!evidence.trim() || ctx.budget.remaining() < 0.3) return;
  const lessons = loadLessons();
  const res = await ctx.runner.run({
    role: "learner",
    cwd: ctx.dir,
    prompt: [
      "Dispatch: LEARNER. Propose lesson changes from this run.",
      "## Current lessons",
      ...(lessons.filter((l) => l.status !== "retired").map((l) => `- ${l.id} [${l.role}, ${l.confidence}] ${l.trigger}: ${l.lesson}`)),
      "## This run's failure evidence",
      evidence,
    ].join("\n"),
    model: ctx.cfg.models.learner,
    ...caps(ctx, "learner", 3),
    schema: LearnerOutput,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [], readonlyGlobs: ["**"], allowBash: false }, "learner"),
  });
  const parsed = LearnerOutput.safeParse(res.output);
  if (!res.ok || !parsed.success) return;
  const r = applyLearning(lessons, parsed.data, ctx.state.run);
  saveLessons(lessons);
  ctx.state.learned = { ...r, promotable: promotable(lessons).map((l) => l.id) };
  for (const id of r.added) emit(ctx, { kind: "lesson", status: "new", role: lessons.find((l) => l.id === id)?.role, text: id });
  for (const id of r.reinforced) emit(ctx, { kind: "lesson", status: "reinforced", text: `${id} → ${lessons.find((l) => l.id === id)?.confidence}` });
  for (const id of r.contradicted) emit(ctx, { kind: "lesson", status: "contradicted", text: id });
}

export function renderReport(ctx: Ctx): string {
  const s = ctx.state;
  const prd = loadPrd(ctx);
  const ledgerPath = join(ctx.dir, ".forge", "ledger.md");
  const rulings = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.includes("RULING:")) : [];
  const deployPath = join(ctx.dir, ".forge", "deploy.json");
  const deploy = existsSync(deployPath) ? JSON.parse(readFileSync(deployPath, "utf8")) : undefined;
  const mins = Math.round((Date.now() - s.startedAt) / 60000);
  const pct = s.spend.local + s.spend.remote ? Math.round((100 * s.spend.local) / (s.spend.local + s.spend.remote)) : 0;
  const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  const metrics = computeMetrics(ctx.dir, s, prd, ctx.cfg.budgetUsd);
  return [
    `# Run report: ${prd.product}`,
    "",
    `> ${prd.pitch}`,
    "",
    `Run \`${s.run}\` · ${mins} min · $${s.spend.usd.toFixed(2)} spent of $${ctx.cfg.budgetUsd} · ${s.spend.remote} model calls (+${s.spend.local} on the local model, ${pct}%)${s.landing ? " · **landing mode**" : ""}`,
    "",
    "## Features",
    row(["ID", "Priority", "Feature", "Status"]),
    row(["---", "---", "---", "---"]),
    ...prd.features.map((f) => row([f.id, f.priority, f.title, f.status === "partial" ? "🟡 partial" : f.passes ? "✅ working" : "❌ missing"])),
    ...briefCoverage(ctx),
    ...openQuestions(ctx),
    "",
    ...renderStory(ctx.dir, s),
    "## QA rounds",
    s.qaRounds.length ? s.qaRounds.map((r) => `- Round ${r.round}: score ${r.score}, ${r.failures} failure(s)`).join("\n") : "- none",
    "",
    "## Deploy",
    deploy ? `- ${deploy.ok ? "OK" : "FAILED"} via ${deploy.method}${deploy.url ? ` at ${deploy.url}` : ""}${deploy.verified ? " (health verified)" : ""}. ${deploy.notes ?? ""}` : "- not run",
    "",
    ...renderMetrics(metrics, s),
    ...renderModelUsage(s.spend.tokens?.byModel),
    ...renderDialogueUsage(ctx.dir),
    ...(existsSync(join(ctx.dir, ".forge", "security.json")) ? renderSecurity(JSON.parse(readFileSync(join(ctx.dir, ".forge", "security.json"), "utf8"))) : []),
    "## Lessons (cross-run learning)",
    s.learned ? `- new: ${s.learned.added.join(", ") || "none"} · reinforced: ${s.learned.reinforced.join(", ") || "none"} · contradicted: ${s.learned.contradicted.join(", ") || "none"}${s.learned.promotable.length ? ` · ready to promote: ${s.learned.promotable.join(", ")}` : ""}` : "- learner not run",
    "",
    ...renderEvidence(ctx.dir),
    "## Rulings (decisions the factory made on its own)",
    rulings.length ? rulings.map((l) => l.replace(/^- /, "- ")).join("\n") : "- none",
    "",
  ].join("\n");
}

export async function report(ctx: Ctx): Promise<void> {
  await learn(ctx);
  if (ctx.install) exportTranscripts(ctx.dir);
  let md = renderReport(ctx);
  if (ctx.local) {
    const r = await localLLM({ system: "Summarize this software factory run report in 3 plain sentences for a demo audience. No markdown.", prompt: md.slice(0, 6000), host: ctx.cfg.local.host, model: ctx.cfg.local.model });
    ctx.budget.record("local", 0, r.local);
    if (r.local && r.text) md = md.replace(/\n## Features/, `\n${r.text.trim()}\n\n## Features`);
  }
  writeFile(join(ctx.dir, "docs", "RUN_REPORT.md"), md);
  writeFile(join(ctx.dir, "docs", "metrics.json"), JSON.stringify(computeMetrics(ctx.dir, ctx.state, loadPrd(ctx), ctx.cfg.budgetUsd), null, 2));
  commitMain(ctx, "docs: run report", ["docs/RUN_REPORT.md", "docs/metrics.json"]);
}

/** The critic's brief → feature map, with the QA status of each feature: what a judge checks line by line. */
function briefCoverage(ctx: Ctx): string[] {
  const p = join(ctx.dir, "docs", "brief-coverage.json");
  if (!existsSync(p)) return [];
  const cov = JSON.parse(readFileSync(p, "utf8")) as { coverage: { requirement: string; featureIds: string[] }[] };
  const prd = loadPrd(ctx);
  const st = (id: string) => { const f = prd.features.find((x) => x.id === id); return !f ? "?" : f.status === "partial" ? "partial" : f.passes ? "working" : "missing"; };
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return ["", "### Brief requirements", row(["Requirement", "Features", "Status"]), row(["---", "---", "---"]),
    ...cov.coverage.map((c) => {
      const s = c.featureIds.map(st);
      const overall = !s.length ? "❌ not planned" : s.every((x) => x === "working") ? "✅ working" : s.some((x) => x === "working" || x === "partial") ? "🟡 partial" : "❌ missing";
      return row([c.requirement.replace(/\|/g, "/").slice(0, 120), c.featureIds.join(", ") || "-", overall]);
    })];
}

/** What the factory asked the client and what it built on. */
function openQuestions(ctx: Ctx): string[] {
  const p = join(ctx.dir, ".forge", "clarify.json");
  if (!existsSync(p)) return [];
  const qs = JSON.parse(readFileSync(p, "utf8")) as { id: string; question: string; assumption: string }[];
  const events = readFileSync(join(ctx.dir, ".forge", "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; status?: string; role?: string; text?: string; ts: number });
  const asked = events.find((e) => e.kind === "clarify" && e.status === "asked");
  const answered = events.some((e) => e.kind === "clarify" && e.status === "answered");
  const reply = answered && asked ? events.find((e) => e.kind === "operator_say" && e.ts >= asked.ts && (!e.role || e.role === "product"))?.text : undefined;
  const answers = reply ? splitAnswers(reply, qs.map((q) => q.id)) : {};
  return ["", `### Questions for the client (${answered ? "answered by the operator" : "unanswered: built on these assumptions"})`,
    ...qs.map((q) => `- ${q.id}: ${q.question} → ${answers[q.id] ? `answer: ${answers[q.id]}` : answered ? `operator's answer: ${reply ?? "see the updated PRD"}` : `assumed: ${q.assumption}`}`)];
}

/**
 * Map one free-text operator reply onto the questions: numbered ("1. yes 2. no", "Q3: ...", unnumbered lead = first
 * question), or one line per question in order. Anything else stays one answer for all.
 */
export function splitAnswers(text: string, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const marks = [...text.matchAll(/(?:^|\s)Q?(\d{1,2})\s*[.):]\s+/gi)].filter((m) => Number(m[1]) >= 1 && Number(m[1]) <= ids.length);
  if (marks.length >= 2) {
    const lead = text.slice(0, marks[0].index).trim();
    if (lead && !marks.some((m) => m[1] === "1")) out[ids[0]] = lead;
    marks.forEach((m, i) => {
      const body = text.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
      if (body) out[ids[Number(m[1]) - 1]] = body;
    });
    return out;
  }
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === ids.length) lines.forEach((l, i) => (out[ids[i]] = l.replace(/^Q?\d{1,2}\s*[.):-]?\s+/i, "").replace(/,$/, "")));
  return out;
}

/** Spend per exact model id (SDK estimates): the numbers to compare with the Anthropic Console's usage page. */
export function renderModelUsage(byModel: Record<string, { in: number; out: number; cacheRead: number; cacheWrite?: number; calls: number; usd: number }> | undefined): string[] {
  const rows = Object.entries(byModel ?? {}).sort((a, b) => b[1].usd - a[1].usd);
  if (!rows.length) return [];
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    "### Usage by model (SDK estimate; compare with the Anthropic Console)",
    "| Model | Calls | Input | Cache write | Cache read | Output | Est. $ |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(([id, c]) => `| ${id} | ${c.calls} | ${n(c.in)} | ${n(c.cacheWrite ?? 0)} | ${n(c.cacheRead)} | ${n(c.out)} | ${c.usd.toFixed(2)} |`),
    "",
  ];
}

/** The office's handoff scenes are generated by the console, outside the build: reported on their own line. */
function renderDialogueUsage(dir: string): string[] {
  const p = join(dir, ".forge", "dialogue-usage.json");
  if (!existsSync(p)) return [];
  const u = JSON.parse(readFileSync(p, "utf8")) as { scenes: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; usd: number };
  const total = u.tokensIn + u.tokensOut + u.cacheRead + u.cacheWrite;
  return [
    "### Office extras (not part of the build)",
    `- Handoff scene dialogue (haiku): ${u.scenes} scene(s), ${total.toLocaleString("en-US")} tokens (${u.tokensIn} in, ${u.cacheWrite} cache writes, ${u.cacheRead} cache reads, ${u.tokensOut} out), $${u.usd.toFixed(4)}. Not included in the build spend or the per-feature figures above.`,
    "",
  ];
}
