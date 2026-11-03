import { approvedTaskSummary, RoutingObserver, routingMode, routingProvider } from "../routing.ts";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { caps, checkLanding, checkStop, commitMessage, emit, ensureMain, hooksFor, loadPrd, markMain, Stopped, stopFile, type Ctx } from "../ctx.ts";
import { matchesGlob } from "../guard.ts";
import { ensureDeps } from "./intake.ts";
import { takeRequests } from "../requests.ts";
import { actionableIssues, lanesOverlap, readyTasks } from "../dag.ts";
import { addWorktree, changedSince, commitAll, headSha, mergeBranch, removeWorktree, repairRepo, resetTo, restorePaths, sh } from "../git.ts";
import { handlePackages, MAX_PACKAGE_REQUESTS } from "../deps.ts";
import { compressFailure } from "../local.ts";
import { contextPack, devPrompt, integratorPrompt, reviewPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { AgentStatus, ReviewVerdict } from "../schemas.ts";
import type { Task } from "../types.ts";

const DEV_READONLY = ["docs/**", "tests/e2e/**", "tests/acceptance/**", ".forge/**", "src/shared/contracts.ts", "src/server/db/schema.ts",
  "package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "vitest.config.ts", "playwright.config.ts", "vite.config.ts", "CLAUDE.md"];

/** Never writable by a developer, whatever its lanes say. */
const CORE_PROTECTED = ["docs/**", "tests/e2e/**", "tests/acceptance/**", ".forge/**", "src/shared/contracts.ts", "CLAUDE.md"];

/** A task that explicitly lists a config file in its lanes may change it; core files stay protected. */
function readonlyFor(t: Task): string[] {
  return DEV_READONLY.filter((g) => CORE_PROTECTED.includes(g) || !t.lanes.some((l) => lanesOverlap(l, g)));
}

class Mutex {
  private p = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.p.then(fn, fn);
    this.p = next.then(() => undefined, () => undefined);
    return next;
  }
}

/** Run the scheduler until every task is merged or parked. */
export async function build(ctx: Ctx): Promise<void> {
  const mode = routingMode();
  const observer = new RoutingObserver(routingProvider(mode, {
    key: process.env.TYPESAFE_API_KEY, model: process.env.FORGE_ROUTING_MODEL,
  }), (taskId, decision) => emit(ctx, { kind: "routing_decision", taskId,
    text: `${decision.source === "simulated" ? "MOCK · simulated" : "SHADOW · external"}: suggested ${decision.suggestedRole ?? "unavailable"}; assigned dev; usage ${decision.usage ? JSON.stringify(decision.usage) : "unavailable"}${decision.error ? `; ${decision.error}` : ""}`, data: decision }));
  const mergeLock = new Mutex();
  const running = new Map<string, Promise<void>>();
  // Tasks left "running" by a crashed run start over from a fresh worktree.
  for (const t of ctx.state.tasks) if (t.status === "running" || t.status === "review") t.status = "backlog";
  ctx.state.systemicHalt = undefined; // a resume means a human looked at it
  ctx.state.failureSpread = {};
  ensureDeps(ctx);

  try {
    for (;;) {
      if (existsSync(stopFile(ctx.dir)) || ctx.state.systemicHalt) {
        // Let in-flight tasks reach their own checkpoint so none is left half-merged or marked running.
        await Promise.allSettled(running.values());
        ctx.save();
        throw new Stopped();
      }
      // operator backlog requests (office UI / POST /task) join the queue as they arrive
      const fresh = takeRequests(ctx.dir, ctx.state);
      if (fresh.length) ctx.ledger.note(`operator added ${fresh.length} task(s): ${fresh.map((t) => `${t.id} ${t.title}`).join("; ")}`);
      if (checkLanding(ctx)) parkNonMust(ctx, running);
      if (ctx.budget.exhausted()) {
        for (const t of ctx.state.tasks) if (!running.has(t.id) && !["merged", "parked"].includes(t.status)) park(ctx, t, "budget exhausted");
      }
      for (const t of readyTasks(ctx.state.tasks)) {
        if (running.size >= ctx.cfg.concurrency) break;
        if (running.has(t.id)) continue;
        if (mode !== "disabled") {
          const summary = approvedTaskSummary(ctx.dir, t);
          if (summary) observer.observe(t.id, { summary, eligibleRoles: ["dev"], baselineRole: "dev" });
          else emit(ctx, { kind: "routing_skipped", taskId: t.id, text: `routing skipped: no current approval for ${t.id} in .forge/routing-approved.json` });
        }
        const p = runTask(ctx, t, mergeLock).finally(() => running.delete(t.id));
        running.set(t.id, p);
      }
      if (running.size === 0) break;
      await Promise.race(running.values()).catch(() => undefined);
      ctx.save();
    }
    for (const t of ctx.state.tasks) if (!["merged", "parked"].includes(t.status)) park(ctx, t, "unreachable: its dependencies never completed");
    ctx.save();
  } finally { await observer.flush(); }
}

function park(ctx: Ctx, t: Task, why: string): void {
  t.status = "parked";
  ctx.ledger.ruling(`park ${t.id} (${t.title})`, why, `features ${t.featureIds.join(", ") || "-"} may be incomplete`, t.id);
  emit(ctx, { kind: "task_status", taskId: t.id, status: "parked", text: why });
}

function parkNonMust(ctx: Ctx, running: Map<string, Promise<void>>): void {
  const prd = loadPrd(ctx);
  const must = new Set(prd.features.filter((f) => f.priority === "must").map((f) => f.id));
  for (const t of ctx.state.tasks) {
    if (running.has(t.id) || ["merged", "parked"].includes(t.status)) continue;
    const isMust = t.kind === "fix" || t.featureIds.length === 0 || t.featureIds.some((f) => must.has(f));
    if (!isMust) park(ctx, t, "landing mode: not a must-have");
  }
}

function setStatus(ctx: Ctx, t: Task, status: Task["status"], text?: string): void {
  t.status = status;
  emit(ctx, { kind: "task_status", taskId: t.id, status, text });
  ctx.save();
}

async function runTask(ctx: Ctx, t: Task, mergeLock: Mutex): Promise<void> {
  const wt = join(ctx.dir, ".forge", "wt", t.id);
  const branch = `t/${t.id}`;
  t.branch = branch;
  setStatus(ctx, t, "running");
  try {
    await mergeLock.run(async () => addWorktree(ctx.dir, branch, wt));
    linkNodeModules(ctx.dir, wt);
    const base = headSha(wt);
    let devAttempts = 0;
    let escalatedAttempts = 0;

    for (;;) {
      checkStop(ctx);
      if (ctx.budget.exhausted()) return park(ctx, t, "budget exhausted");
      const escalated = !!t.escalated;
      const fail = await attempt(ctx, t, wt, base, mergeLock, escalated);
      if (fail === null) return;
      if (fail.free) {
        // a package request answered: the dev continues in its session, and it doesn't count as a failed attempt
        t.feedback = fail.feedback;
        ctx.save();
        continue;
      }
      escalated ? escalatedAttempts++ : devAttempts++;
      t.feedback = fail.feedback;
      const repeated = !!fail.signature && fail.signature === t.lastSignature;
      t.lastSignature = fail.signature;
      emit(ctx, { kind: "task_fail", taskId: t.id, text: fail.feedback.slice(0, 300), data: { signature: fail.signature, repeated } });
      // The dev says it can't proceed (permissions, missing setup…): a retry or a bigger model won't change that.
      t.blockedStreak = t.blocked ? (t.blockedStreak ?? 0) + 1 : 0;
      if (t.blockedStreak >= 2) {
        return park(ctx, t, `developer reported BLOCKED twice: ${t.blocked}. Retries and escalation can't fix an environment or permission problem; fix the cause, then resume --retry-parked`);
      }
      if (fail.signature && !fail.signature.startsWith("review:")) {
        const spread = (ctx.state.failureSpread ??= {});
        const ids = (spread[fail.signature] ??= []);
        if (!ids.includes(t.id)) ids.push(t.id);
        if (ids.length >= 2 && !ctx.state.systemicHalt) {
          ctx.state.systemicHalt = fail.signature;
          ctx.ledger.ruling(
            `halt the build: systemic failure, ${ids.length} different tasks fail with the same error (${ids.join(", ")})`,
            `the cause is outside the tasks (e.g. a broken file on main): ${fail.signature.slice(0, 160)}`,
            "the build waits for a human; `forge resume` after fixing the cause",
          );
        }
      }
      if (ctx.state.systemicHalt) {
        t.status = "backlog";
        t.attempts = 0;
        t.escalated = false;
        return;
      }

      if (!escalated && (repeated || devAttempts >= ctx.cfg.maxDevAttempts)) {
        t.escalated = true;
        t.sessionId = undefined;
        ctx.ledger.note(`escalate ${t.id} to ${ctx.cfg.escalationModel} with a fresh session (${repeated ? "same failure twice" : "attempt cap"})`, t.id);
      } else if (escalated && escalatedAttempts >= ctx.cfg.maxEscalations) {
        return park(ctx, t, `still failing after ${devAttempts + escalatedAttempts} attempts: ${fail.signature ?? fail.feedback.slice(0, 120)}`);
      }
      ctx.save();
    }
  } catch (e) {
    if (e instanceof Stopped) {
      t.status = "backlog";
      throw e;
    }
    park(ctx, t, `orchestrator error: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    if (t.status === "merged" || t.status === "parked") removeWorktree(ctx.dir, wt);
    ctx.save();
  }
}

function linkNodeModules(dir: string, wt: string): void {
  const src = join(dir, "node_modules");
  const dst = join(wt, "node_modules");
  if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst, "dir");
}

type Failure = { feedback: string; signature?: string; free?: boolean };

/** One dev → gate → review → merge cycle. Returns null on merge, a Failure otherwise. */
async function attempt(ctx: Ctx, t: Task, wt: string, base: string, mergeLock: Mutex, escalated: boolean): Promise<Failure | null> {
  const role = loadRole("dev");
  t.attempts++;
  const model = escalated ? ctx.cfg.escalationModel : ctx.cfg.models.dev;
  const res = await ctx.runner.run({
    role: "dev",
    taskId: t.id,
    cwd: wt,
    prompt: devPrompt(t, t.feedback, contextPack(ctx.dir)),
    model,
    ...caps(ctx, "dev", role.maxTurns),
    schema: AgentStatus,
    resume: t.feedback && t.sessionId ? t.sessionId : undefined,
    hooks: hooksFor(ctx, { root: wt, writable: [wt], readonlyGlobs: readonlyFor(t), readable: [join(ctx.dir, "node_modules")], allowBash: true }, "dev", t.id),
  });
  t.sessionId = res.sessionId;
  const capped = res.subtype === "error_max_budget_usd" || res.subtype === "error_max_turns";
  if (!res.ok && !capped) return { feedback: `Your previous attempt ended abnormally (${res.subtype}): ${res.error}. Work in smaller steps and finish with the status JSON.`, signature: `agent:${res.subtype}` };
  // A capped agent may still have finished the code: let the gate decide instead of discarding the work.
  const status: AgentStatus = res.ok
    ? (res.output as AgentStatus)
    : { status: "DONE_WITH_CONCERNS", summary: `stopped by ${res.subtype}`, filesChanged: [], concerns: [`agent hit ${res.subtype}; work may be incomplete`] };
  if (capped) emit(ctx, { kind: "note", taskId: t.id, text: `dev hit ${res.subtype}; gating the work it left` });
  t.blocked = status.status === "BLOCKED" ? status.concerns.join("; ").slice(0, 200) || status.summary.slice(0, 200) : undefined;
  if (status.status === "BLOCKED" || status.status === "NEEDS_CONTEXT") {
    ctx.ledger.note(`${t.id} reported ${status.status}: ${status.concerns.join("; ").slice(0, 300)}`, t.id);
  }

  // The real write guarantee (bash can dodge the PreToolUse guard): put protected files back before committing.
  const mb = sh("git merge-base HEAD main", wt).out.trim() || base;
  const touched = changedSince(wt, mb).filter((f) => matchesGlob(f, readonlyFor(t)));
  if (touched.length) {
    restorePaths(wt, mb, touched);
    emit(ctx, { kind: "guard_deny", role: "dev", taskId: t.id, text: `reverted protected file(s): ${touched.join(", ")}` });
  }
  const subject = await commitMessage(ctx, `feat(${t.id}): ${t.title}`, `${t.title}\n${status.summary}`);
  // Trailers tie every agent commit to its task, role, model and attempt, so the git history proves who wrote what.
  commitAll(wt, `${subject.includes(t.id) ? subject : `${subject} [${t.id}]`}\n\nForge-Task: ${t.id}\nForge-Role: dev\nForge-Model: ${model}\nForge-Attempt: ${t.attempts}\nForge-Phase: build`);
  if (status.packages?.length && (t.packageRequests ?? 0) < MAX_PACKAGE_REQUESTS) {
    t.packageRequests = (t.packageRequests ?? 0) + 1;
    const pkgs = status.packages;
    return { feedback: await mergeLock.run(() => handlePackages(ctx, t, wt, pkgs)), free: true };
  }
  // BLOCKED with nothing changed is not done: never merge an empty "fix" as if it worked.
  if (status.status === "BLOCKED" && !sh(`git diff --numstat ${mb}..HEAD`, wt).out.trim()) {
    if (t.kind === "fix" && !t.lanesWidened) {
      // Fix lanes come from guesses (QA's suspected files, an operator's request): widen once instead of shipping nothing.
      t.lanesWidened = true;
      t.lanes = ["src/**"];
      ctx.ledger.ruling(`widen ${t.id} lanes to src/**`, `dev reported BLOCKED with no changes: ${t.blocked ?? ""}`.slice(0, 240), "a fix touches more files than planned");
      return { feedback: `Your lanes are now src/** (core contracts stay frozen). You reported: ${t.blocked}. Do the task now.`, signature: "blocked:lanes" };
    }
    return { feedback: `You reported BLOCKED and changed nothing: ${t.blocked}`, signature: "blocked" };
  }
  setStatus(ctx, t, "review", "gate");
  const gate = await ctx.gate(wt);
  emit(ctx, { kind: "gate", taskId: t.id, status: gate.ok ? "pass" : "fail", text: gate.ok ? "check passed" : `${gate.failed} failed` });
  if (!gate.ok) {
    if (capped) t.sessionId = undefined; // a capped session is out of room; continue fresh
    const extra = status.status === "BLOCKED" ? `\nYou reported BLOCKED: ${status.concerns.join("; ")}. Work around it inside your lanes.` : "";
    return { feedback: `\`npm run ${gate.failed}\` failed after your changes:\n${await compressFailure(gate.output, { enabled: !!ctx.local, host: ctx.cfg.local.host, model: ctx.cfg.local.model })}${extra}`, signature: gate.signature };
  }

  // Small, gate-green diffs skip the LLM review: commands already checked types, lint and tests.
  const changedLines = sh(`git diff --numstat ${mb}..HEAD -- . ':(exclude)tests/**'`, wt).out.split("\n")
    .reduce((n, l) => n + l.split("\t").slice(0, 2).reduce((a, x) => a + (Number(x) || 0), 0), 0);
  if (changedLines < ctx.cfg.reviewMinLines) {
    emit(ctx, { kind: "review", taskId: t.id, status: "skipped", text: `${changedLines} changed lines < ${ctx.cfg.reviewMinLines}; gate is enough` });
    return mergeLock.run(() => integrate(ctx, t, wt));
  }
  const diff = sh(`git diff ${mb}..HEAD`, wt).out;
  const rv = loadRole("reviewer");
  const review = await ctx.runner.run({
    role: "reviewer",
    taskId: t.id,
    cwd: wt,
    prompt: reviewPrompt(t, mb, diff.length > 24000 ? diff.slice(0, 24000) + "\n… (diff truncated; run git diff for the rest)" : diff),
    model: ctx.cfg.models.reviewer,
    ...caps(ctx, "reviewer", rv.maxTurns),
    schema: ReviewVerdict,
    hooks: hooksFor(ctx, { root: wt, writable: [], readonlyGlobs: ["**"], readable: [ctx.dir], allowBash: true }, "reviewer", t.id),
  });
  repairRepo(wt); // the reviewer is read-only; drop anything it left behind
  if (review.ok) {
    const v = review.output as ReviewVerdict;
    const { keep, dropped } = actionableIssues(v.issues, readonlyFor(t));
    if (dropped.length) emit(ctx, { kind: "note", taskId: t.id, text: `ignored ${dropped.length} review finding(s) on files the developer may not write: ${dropped.map((i) => i.file).join(", ")}` });
    const blocking = keep.filter((i) => i.severity !== "minor");
    emit(ctx, { kind: "review", taskId: t.id, status: v.verdict, text: blocking.map((i) => i.message).join("; ").slice(0, 300) });
    if (v.verdict === "reject" && blocking.length) {
      return {
        feedback: `Code review rejected your change:\n${blocking.map((i) => `- [${i.severity}] ${i.file ?? ""} ${i.message}\n  fix: ${i.fix}`).join("\n")}`,
        signature: `review:${blocking[0].message.slice(0, 80)}`,
      };
    }
  } else {
    ctx.ledger.ruling(`accept ${t.id} without LLM review`, `reviewer failed: ${review.error}`, "an unreviewed change on main; the main gate still applies", t.id);
  }

  return mergeLock.run(() => integrate(ctx, t, wt));
}

async function integrate(ctx: Ctx, t: Task, wt: string): Promise<Failure | null> {
  ensureMain(ctx);
  const preMerge = headSha(ctx.dir);
  let merge = mergeBranch(ctx.dir, t.branch!);
  if (!merge.ok && merge.conflict) {
    emit(ctx, { kind: "conflict", taskId: t.id, text: "merge conflict; integrator resolving" });
    const inWt = mergeBranch(wt, "main", { keepConflict: true });
    if (!inWt.ok) {
      const role = loadRole("integrator");
      const r = await ctx.runner.run({
        role: "integrator",
        taskId: t.id,
        cwd: wt,
        prompt: integratorPrompt(t),
        model: ctx.cfg.models.integrator,
        ...caps(ctx, "integrator", role.maxTurns),
        schema: AgentStatus,
        hooks: hooksFor(ctx, { root: wt, writable: [wt], readonlyGlobs: DEV_READONLY.filter((g) => g !== "package-lock.json"), readable: [join(ctx.dir, "node_modules")], allowBash: true }, "integrator", t.id),
      });
      if (sh("git diff --name-only --diff-filter=U", wt).out.trim()) sh("git merge --abort", wt);
      else commitAll(wt, `merge main into ${t.branch}`);
      if (!r.ok) return { feedback: `Merging main into your branch conflicted and could not be resolved automatically. Re-read main's version of your lanes and adapt.`, signature: "merge:conflict" };
    }
    const gate = await ctx.gate(wt);
    if (!gate.ok) return { feedback: `After merging main into your branch, \`npm run ${gate.failed}\` fails:\n${await compressFailure(gate.output, { enabled: !!ctx.local, host: ctx.cfg.local.host, model: ctx.cfg.local.model })}`, signature: gate.signature };
    merge = mergeBranch(ctx.dir, t.branch!);
  }
  if (!merge.ok) return { feedback: `Merging into main failed:\n${merge.out.slice(-1500)}`, signature: "merge:failed" };

  const mainGate = await ctx.gate(ctx.dir);
  if (!mainGate.ok) {
    // Undo exactly this merge — and nothing when the merge was a no-op.
    if (headSha(ctx.dir) !== preMerge) resetTo(ctx.dir, preMerge);
    emit(ctx, { kind: "gate", taskId: t.id, status: "fail", text: `main broke after merge (${mainGate.failed}); reverted` });
    return { feedback: `Your change passed alone but broke main after merging (\`npm run ${mainGate.failed}\`). Main now contains other merged tasks; merge main into your branch mentally and fix:\n${await compressFailure(mainGate.output, { enabled: !!ctx.local, host: ctx.cfg.local.host, model: ctx.cfg.local.model })}`, signature: `main:${mainGate.signature}` };
  }
  markMain(ctx);
  setStatus(ctx, t, "merged", `merged after ${t.attempts} attempt(s)`);
  ctx.ledger.note(`merged ${t.id} (${t.title}) after ${t.attempts} attempt(s)${t.escalated ? " [escalated]" : ""}`, t.id);
  return null;
}
