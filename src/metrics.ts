import { join } from "node:path";
import { EventBus } from "./events.ts";
import { sh } from "./git.ts";
import type { Prd } from "./schemas.ts";
import type { Intervention, RunState, TokenCount } from "./types.ts";

export const AGENT_AUTHOR = "FORGE";
/** Steering (plan, notes, backlog, resume) barely counts against autonomy; hands-on code does. */
export const IMPACT: Record<Intervention["kind"], "low" | "medium" | "high"> = {
  note: "low", task: "low", resume: "low", iterate: "low", retry_parked: "medium", manual_commit: "high",
};

export interface Authorship { agentLines: number; humanLines: number; agentCommits: number; humanCommits: number; pct: number; humans: { sha: string; author: string; lines: number; subject: string }[] }

/** Lines added since the template baseline, split by commit author (agents commit as FORGE). */
export function authorship(dir: string, baseSha?: string): Authorship {
  const out: Authorship = { agentLines: 0, humanLines: 0, agentCommits: 0, humanCommits: 0, pct: 100, humans: [] };
  if (!baseSha) return out;
  const r = sh(`git log --no-merges --numstat --format='@%H%x09%an%x09%s' ${baseSha}..HEAD`, dir);
  if (r.code !== 0) return out;
  let cur: { sha: string; author: string; subject: string; lines: number } | undefined;
  const flush = () => {
    if (!cur) return;
    if (cur.author === AGENT_AUTHOR) {
      out.agentCommits++;
      out.agentLines += cur.lines;
    } else {
      out.humanCommits++;
      out.humanLines += cur.lines;
      out.humans.push(cur);
    }
  };
  for (const line of r.out.split("\n")) {
    if (line.startsWith("@")) {
      flush();
      const [sha, author, subject] = line.slice(1).split("\t");
      cur = { sha: sha.slice(0, 8), author, subject: subject ?? "", lines: 0 };
    } else if (cur) {
      const [added, , file] = line.split("\t");
      if (file && /^\d+$/.test(added) && !/(^|\/)package-lock\.json$/.test(file)) cur.lines += Number(added);
    }
  }
  flush();
  const total = out.agentLines + out.humanLines;
  out.pct = total ? Math.round((1000 * out.agentLines) / total) / 10 : 100;
  return out;
}

/** Operator notes/backlog come from the event log (the console may write them from another process). */
export function interventions(dir: string, state: RunState, auth: Authorship): Intervention[] {
  const fromEvents = EventBus.readAll(join(dir, ".forge", "events.jsonl"))
    .filter((e) => e.kind === "operator_say" || e.kind === "operator_task")
    .map((e): Intervention => ({ at: e.ts, kind: e.kind === "operator_say" ? "note" : "task", text: e.text }));
  const commits = auth.humans.map((h): Intervention => ({ at: 0, kind: "manual_commit", text: `${h.sha} ${h.author}: ${h.subject} (+${h.lines})` }));
  return [...fromEvents, ...(state.interventions ?? []), ...commits];
}

export interface Metrics {
  tokens: TokenCount & { total: number; cacheHitPct: number };
  features: { total: number; working: number };
  tokensPerFeature?: number;
  usdPerFeature?: number;
  budget: { usd: number; spent: number; leftPct: number };
  authorship: Authorship;
  interventions: { total: number; byKind: Record<string, number>; byImpact: Record<string, number>; list: Intervention[] };
}

export function computeMetrics(dir: string, state: RunState, prd: Prd, budgetUsd: number): Metrics {
  const t = state.spend.tokens ?? { in: 0, out: 0, cacheRead: 0, calls: 0, byRole: {}, byPhase: {}, models: {} };
  const write = t.cacheWrite ?? 0;
  const total = t.in + write + t.out + t.cacheRead;
  const working = prd.features.filter((f) => f.passes).length;
  const auth = authorship(dir, state.baseSha);
  const list = interventions(dir, state, auth);
  const byKind: Record<string, number> = {};
  const byImpact: Record<string, number> = {};
  for (const i of list) {
    byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    byImpact[IMPACT[i.kind]] = (byImpact[IMPACT[i.kind]] ?? 0) + 1;
  }
  return {
    tokens: { in: t.in, out: t.out, cacheRead: t.cacheRead, cacheWrite: write, calls: t.calls, total, cacheHitPct: t.in + write + t.cacheRead ? Math.round((1000 * t.cacheRead) / (t.in + write + t.cacheRead)) / 10 : 0 },
    features: { total: prd.features.length, working },
    tokensPerFeature: working ? Math.round(total / working) : undefined,
    usdPerFeature: working ? Math.round((100 * state.spend.usd) / working) / 100 : undefined,
    budget: { usd: budgetUsd, spent: state.spend.usd, leftPct: budgetUsd ? Math.round((100 * (budgetUsd - state.spend.usd)) / budgetUsd) : 0 },
    authorship: auth,
    interventions: { total: list.length, byKind, byImpact, list },
  };
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

export function renderMetrics(m: Metrics, state: RunState): string[] {
  const t = state.spend.tokens;
  const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  const sum = (c: TokenCount) => c.in + (c.cacheWrite ?? 0) + c.out + c.cacheRead;
  const hit = (c: TokenCount) => (c.in + (c.cacheWrite ?? 0) + c.cacheRead ? `${Math.round((100 * c.cacheRead) / (c.in + (c.cacheWrite ?? 0) + c.cacheRead))}%` : "");
  const tokRows = (rec: Record<string, TokenCount>, usd: Record<string, number>, models: boolean) =>
    Object.entries(rec).sort((a, b) => sum(b[1]) - sum(a[1]))
      .map(([name, c]) => row([name, models ? (t?.models[name] ?? []).join(", ") : "", c.calls, k(c.in + (c.cacheWrite ?? 0)), k(c.out), k(c.cacheRead), hit(c), k(sum(c)), `$${(usd[name] ?? 0).toFixed(2)}`]));
  return [
    "## Efficiency",
    `- **${k(m.tokens.total)} tokens** (${k(m.tokens.in)} in, ${k(m.tokens.cacheWrite ?? 0)} cache writes, ${k(m.tokens.cacheRead)} cache reads, ${k(m.tokens.out)} out · ${m.tokens.cacheHitPct}% of input served from cache) over ${m.tokens.calls} agent calls`,
    `- **${m.features.working}/${m.features.total} features working** · ${m.tokensPerFeature ? `**${k(m.tokensPerFeature)} tokens and $${m.usdPerFeature?.toFixed(2)} per working feature**` : "no working features"}`,
    `- Budget: $${m.budget.spent.toFixed(2)} of $${m.budget.usd} (${m.budget.leftPct}% left)`,
    "",
    "### By role (model chosen per role)",
    row(["Role", "Model", "Calls", "In", "Out", "Cache read", "Hit", "Total", "USD"]),
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
    ...(t ? tokRows(t.byRole, state.spend.byRole, true) : []),
    "",
    "### By phase",
    row(["Phase", "", "Calls", "In", "Out", "Cache read", "Hit", "Total", "USD"]),
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
    ...(t ? tokRows(t.byPhase, state.spend.byPhase, false) : []),
    "",
    "## Autonomy",
    `- **${m.authorship.pct}% of code written by agents**: ${m.authorship.agentLines} lines in ${m.authorship.agentCommits} agent commits, ${m.authorship.humanLines} lines in ${m.authorship.humanCommits} human commits (since the template baseline)`,
    `- Human interventions: ${m.interventions.total}${m.interventions.total ? ` (${Object.entries(m.interventions.byImpact).map(([i, n]) => `${n} ${i}-impact`).join(", ")}; ${Object.entries(m.interventions.byKind).map(([i, n]) => `${i} ×${n}`).join(", ")})` : ""}`,
    ...m.interventions.list.slice(0, 20).map((i) => `  - ${i.kind} (${IMPACT[i.kind]}): ${(i.text ?? "").slice(0, 120)}`),
    "",
  ];
}
