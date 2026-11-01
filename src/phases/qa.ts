import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { caps, checkLanding, checkStop, commitMain, commitMessage, emit, hooksFor, loadPrd, writeFile, type AppHandle, type Ctx } from "../ctx.ts";
import { qaPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { QaReport, type Prd } from "../schemas.ts";
import type { Task } from "../types.ts";
import { build } from "./build.ts";
import { headSha, restorePaths } from "../git.ts";
import { ROLE_FLOOR_USD } from "../budget.ts";

const QA_PORT = 8790;
/** Judges score UI design: "good with minor flaws" (7) is not enough to stop polishing. */
export const VISUAL_BAR = 8;
const QA_GLOBS = ["tests/e2e/**", "docs/prd.json"];

/** A feature counts as working only when QA says so; "partial" is not done. */
export const works = (f: { passes: boolean; status?: string }) => (f.status ? f.status === "working" : f.passes);

/** Score must-haves; true when the product is good enough to ship. */
function passing(prd: Prd, report: QaReport): boolean {
  const musts = prd.features.filter((f) => f.priority === "must");
  const byId = new Map(report.features.map((f) => [f.id, works(f)]));
  const visualOk = !report.visual || report.visual.score >= VISUAL_BAR;
  return musts.every((f) => byId.get(f.id) === true) && report.score >= 7 && visualOk;
}

function plateau(ctx: Ctx): boolean {
  const s = ctx.state.qaRounds.map((r) => r.score);
  if (s.length < 3) return false;
  const [a, b, c] = s.slice(-3);
  return b <= a && c <= a;
}

/** QA loop: evaluate the running app, turn failures into fix tasks, rebuild, re-evaluate. */
export async function qa(ctx: Ctx): Promise<void> {
  const role = loadRole("qa");
  let prev: QaReport | undefined;
  let polished = false;
  for (;;) {
    checkStop(ctx);
    const round = ctx.state.qaRounds.length + 1;
    if (round > ctx.cfg.maxQaRounds) {
      ctx.ledger.ruling("stop QA", `round cap ${ctx.cfg.maxQaRounds} reached`, "remaining failures ship as known issues");
      return;
    }
    if (ctx.budget.perCallCap("qa", "qa") < (ROLE_FLOOR_USD.qa ?? 0)) {
      ctx.ledger.ruling("stop QA — budget too low for a meaningful QA round", `per-call cap $${ctx.budget.perCallCap("qa", "qa").toFixed(2)}`, "remaining issues unverified");
      return;
    }
    const prd = loadPrd(ctx);
    let app: AppHandle;
    try {
      app = await ctx.app.start(ctx.dir, QA_PORT);
    } catch (e) {
      // A product that won't build or start is a defect like any other: record it and send it back to the devs.
      const log = (e as Error).message.slice(0, 3000);
      ctx.state.qaRounds.push({ round, score: 0, failures: 1 });
      emit(ctx, { kind: "qa_result", status: "0", text: "app failed to build or start" });
      if (round >= ctx.cfg.maxQaRounds) continue;
      addFixTasks(ctx, round, [{ title: "App fails to build or start for QA", steps: "npm run build && npm start", expected: "the app builds and /api/health answers", actual: log, suspectedFiles: [] }]);
      await build(ctx);
      continue;
    }
    let report: QaReport | undefined;
    try {
      emit(ctx, { kind: "qa_start", text: `round ${round} at ${app.url}` });
      const res = await ctx.runner.run({
        role: "qa",
        cwd: ctx.dir,
        prompt: qaPrompt(app.url, round, prd, prev, ctx.state.changeRequests),
        model: ctx.cfg.models.qa,
        ...caps(ctx, "qa", role.maxTurns),
        schema: QaReport,
        env: { BASE_URL: app.url },
        hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: ["tests/e2e/**", ".forge/qa/**"], allowBash: true }, "qa"),
      });
      let final = res;
      // QA sometimes finishes its testing but ends without the report: ask the same session once, cheaply.
      if (!res.ok && res.error?.startsWith("invalid_output") && res.sessionId) {
        final = await ctx.runner.run({
          role: "qa", cwd: ctx.dir, model: ctx.cfg.models.qa, maxTurns: 3, maxBudgetUsd: 0.3, schema: QaReport, resume: res.sessionId,
          prompt: "You ended without the QA report. Reply now with ONLY the QA report JSON for what you already tested (no more testing).",
          hooks: hooksFor(ctx, { root: ctx.dir, writable: [], readonlyGlobs: ["**"], allowBash: false }, "qa"),
        });
      }
      if (final.ok) report = final.output as QaReport;
      else ctx.ledger.note(`QA round ${round} failed to report: ${final.error}`);
      // Judges score the UI: a report without the visual judgment is incomplete. Ask the same session once (it has the screenshots).
      if (report && !report.visual && final.sessionId) {
        const again = await ctx.runner.run({
          role: "qa", cwd: ctx.dir, model: ctx.cfg.models.qa, maxTurns: 4, maxBudgetUsd: 0.3, schema: QaReport, resume: final.sessionId,
          prompt: `Your report has no \`visual\`. Read .forge/qa/r${round}-desktop.png and .forge/qa/r${round}-mobile.png (take them first if missing) and reply with the same QA report JSON plus \`visual\` { score, issues[{ title, fix, suspectedFiles[] }] }.`,
          hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: [".forge/qa/**"], allowBash: true }, "qa"),
        });
        if (again.ok && (again.output as QaReport).visual) report = { ...report, visual: (again.output as QaReport).visual };
        else ctx.ledger.note(`QA round ${round} gave no visual score`);
      }
    } finally {
      await app.stop();
    }
    if (!report) {
      ctx.state.qaRounds.push({ round, score: 0, failures: 0 });
      ctx.save();
      continue;
    }

    writeFile(join(ctx.dir, ".forge", "qa", `round-${round}.json`), JSON.stringify(report, null, 2));
    // QA's specs must never break the build (devs can't edit them): revert any e2e file that fails typecheck.
    const tc = await ctx.gate(ctx.dir, ["typecheck"]);
    if (!tc.ok) {
      const bad = [...new Set(tc.output.match(/tests\/e2e\/[^\s(:'"]+/g) ?? [])];
      if (bad.length) {
        restorePaths(ctx.dir, headSha(ctx.dir), bad);
        ctx.ledger.note(`reverted QA spec(s) that broke typecheck: ${bad.join(", ")}`);
      }
    }
    ctx.state.qaRounds.push({ round, score: report.score, failures: report.failures.length });
    const qaById = new Map(report.features.map((f) => [f.id, f]));
    const updated = { ...prd, features: prd.features.map((f) => { const q = qaById.get(f.id); return q ? { ...f, passes: works(q), status: q.status ?? (q.passes ? "working" : "missing") } : f; }) };
    writeFileSync(join(ctx.dir, "docs", "prd.json"), JSON.stringify(updated, null, 2) + "\n");
    commitMain(ctx, await commitMessage(ctx, `test: QA round ${round} (score ${report.score})`, `QA round ${round}`), QA_GLOBS);
    emit(ctx, { kind: "qa_result", status: String(report.score), text: `score ${report.score}, ${report.failures.length} failures`, data: report });
    ctx.save();

    if (passing(updated, report)) {
      ctx.ledger.note(`QA round ${round} passed: score ${report.score}, all must-haves pass`);
      // Known bugs left in a passing product still cost Quality points: fix them once while budget and rounds allow.
      if (polished || !report.failures.length || round >= ctx.cfg.maxQaRounds || checkLanding(ctx) || ctx.budget.perCallCap("qa", "qa") < (ROLE_FLOOR_USD.qa ?? 0)) return;
      polished = true;
      ctx.ledger.ruling("polish round", `${report.failures.length} known issue(s) left in a passing product`, "one more build + QA round");
      addFixTasks(ctx, round, report.failures);
      prev = report;
      await build(ctx);
      continue;
    }
    if (plateau(ctx)) {
      ctx.ledger.ruling("stop QA", "score plateaued for 2 rounds", "remaining failures ship as known issues");
      return;
    }
    if (round >= ctx.cfg.maxQaRounds) continue;

    const landing = checkLanding(ctx);
    const mustIds = new Set(updated.features.filter((f) => f.priority === "must").map((f) => f.id));
    const weakVisual = !!report.visual && report.visual.score < VISUAL_BAR;
    // The first weak visual score gets one whole-app design pass (on the escalation model): small per-issue fixes only
    // nudge a page that doesn't follow its design at all. Later rounds go back to per-issue fixes for the details.
    const designPass = weakVisual && ctx.state.designPassRound === undefined;
    const failures = [
      ...report.failures.filter((f) => !landing || !f.featureId || mustIds.has(f.featureId)),
      // Visual craft is a must for a demo product: weak visuals become fix tasks even in landing mode.
      ...(weakVisual && !designPass ? report.visual!.issues.map((v) => ({ title: v.title, fix: v.fix, suspectedFiles: v.suspectedFiles, expected: v.fix })) : []),
    ];
    if (designPass) {
      addDesignPass(ctx, round, report.visual!);
      if (!failures.length) {
        prev = report;
        await build(ctx);
        continue;
      }
    }
    if (!failures.length) {
      ctx.ledger.ruling("stop QA", "no actionable failures left in landing mode", "should-have issues remain");
      return;
    }
    addFixTasks(ctx, round, failures);
    prev = report;
    await build(ctx);
  }
}

/** One task that brings the whole web app in line with docs/design.md, run on the escalation model. */
export function addDesignPass(ctx: Ctx, round: number, visual: NonNullable<QaReport["visual"]>): Task {
  ctx.state.designPassRound = round;
  const t: Task = {
    id: `DESIGN${round}`,
    title: "Make the app look like its design",
    description: [
      `QA scored the visuals ${visual.score}/10 (the bar is ${VISUAL_BAR}). Start the app and take desktop (1440px) and mobile (390px) screenshots with Playwright before and after your changes, and look at them.`,
      "docs/design.md is the designer's spec and src/web/components/ui + src/web/theme.css are its kit. Compare the running app with that spec page by page, starting with the app shell (header, logo/wordmark, nav), then every page.",
      "Use the kit's components and tokens everywhere; replace leftover template markup and one-off styling. Change how things look, not what they do: keep routes, labels, form fields and behaviour, since QA's e2e tests use them.",
      "QA's visual issues:",
      ...visual.issues.map((v) => `- ${v.title}${v.fix ? `: ${v.fix}` : ""}`),
    ].join("\n"),
    deps: [],
    lanes: ["src/web/**", "tests/unit/**"],
    acceptance: ["npm run check passes", "the shell and every page use the design's components and tokens", ...visual.issues.map((v) => v.title)],
    kind: "fix",
    status: "backlog",
    attempts: 0,
    escalations: 0,
    escalated: true,
    featureIds: [],
  };
  ctx.state.tasks.push(t);
  ctx.ledger.ruling(`${t.id}: one whole-app design pass on ${ctx.cfg.escalationModel}`, `visual score ${visual.score} < ${VISUAL_BAR}`, "a larger task instead of per-issue visual fixes");
  ctx.save();
  return t;
}

export function addFixTasks(ctx: Ctx, round: number | string, failures: { title: string; steps?: string; expected?: string; actual?: string; suspectedFiles?: string[]; featureId?: string; fix?: string }[]): Task[] {
  // Suspected files are guesses: keep the ones that exist (a folder means everything in it), else the whole src.
  const lanesFor = (files?: string[]) => {
    const real = (files ?? []).flatMap((f) => (f.includes("*") ? [f] : existsSync(join(ctx.dir, f)) ? [statSync(join(ctx.dir, f)).isDirectory() ? `${f.replace(/\/$/, "")}/**` : f] : []));
    return real.length ? real : ["src/**"];
  };
  const created: Task[] = failures.map((f, i) => ({
    id: `FIX${round}-${i + 1}`,
    title: f.title,
    description: [
      `Fix this defect found by ${typeof round === "number" ? "QA" : "the final review"}: ${f.title}`,
      f.steps ? `Steps: ${f.steps}` : "",
      f.expected ? `Expected: ${f.expected}` : "",
      f.actual ? `Actual: ${f.actual}` : "",
      f.fix ? `Suggested fix: ${f.fix}` : "",
      "Add or adjust a unit test that reproduces the defect first.",
    ].filter(Boolean).join("\n"),
    deps: [],
    lanes: lanesFor(f.suspectedFiles),
    acceptance: [f.expected ?? "defect no longer reproduces"],
    kind: "fix" as const,
    status: "backlog" as const,
    attempts: 0,
    escalations: 0,
    featureIds: f.featureId ? [f.featureId] : [],
  }));
  // Fix tasks run one after another: they often touch the same files.
  for (let i = 1; i < created.length; i++) created[i].deps = [created[i - 1].id];
  ctx.state.tasks.push(...created);
  ctx.ledger.note(`added ${created.length} fix task(s): ${created.map((t) => t.id).join(", ")}`);
  ctx.save();
  return created;
}
