import { EventBus } from "../events.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { caps, commitMain, commitMessage, hooksFor, readJson, type Ctx } from "../ctx.ts";
import { validatePlan } from "../dag.ts";
import { architectPrompt, uiuxPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { AgentStatus, TaskPlan } from "../schemas.ts";
import type { Task } from "../types.ts";
import { matchesGlob } from "../guard.ts";

export const ARCHITECT_GLOBS = [
  "docs/architecture.md", "docs/tasks.json", "src/shared/**", "src/server/db/**", "src/server/routes/**",
  "package.json", "package-lock.json", "public/**", "src/web/main.tsx", "vite.config.ts", "src/server/app.ts", "src/web/pages/**", "src/web/components/**", "src/web/App.tsx", "src/server/lib/**", "src/web/lib/**", "src/web/hooks/**", ".env.example", "tests/unit/**",
];
export const UIUX_GLOBS = ["docs/design.md", "src/web/theme.css", "src/web/components/ui/**", "index.html"];

/** `repair: true` (contract gate) — UI/UX is done, so the architect may fix any design-phase file. */
export async function runArchitect(ctx: Ctx, retryError?: string, resume?: string, repair = false) {
  const role = loadRole("architect");
  return ctx.runner.run({
    role: "architect",
    cwd: ctx.dir,
    prompt: architectPrompt(ctx.cfg.concurrency, retryError),
    model: ctx.cfg.models.architect,
    ...caps(ctx, "architect", role.maxTurns),
    schema: AgentStatus,
    resume,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: repair ? ["docs/prd.json"] : ["docs/prd.json", "src/web/components/ui/**"], writableGlobs: repair ? [...ARCHITECT_GLOBS, ...UIUX_GLOBS] : ARCHITECT_GLOBS, allowBash: true }, "architect"),
  });
}

/** Parse + validate docs/tasks.json. Returns tasks or a human-readable error for the Architect. */
export function readPlan(dir: string): { tasks?: Task[]; error?: string } {
  const p = join(dir, "docs", "tasks.json");
  if (!existsSync(p)) return { error: "docs/tasks.json was not written" };
  let raw: unknown;
  try {
    raw = readJson(p);
  } catch (e) {
    return { error: `docs/tasks.json is not valid JSON: ${(e as Error).message}` };
  }
  const parsed = TaskPlan.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.message.slice(0, 1500) };
  const problems = validatePlan(parsed.data.tasks);
  if (problems.length) return { error: problems.join("\n") };
  return {
    tasks: parsed.data.tasks.map((t) => ({ ...t, kind: "feature" as const, status: "backlog" as const, attempts: 0, escalations: 0 })),
  };
}

export async function design(ctx: Ctx): Promise<void> {
  const uiuxRole = loadRole("uiux");
  const [arch, ux] = await Promise.all([
    runArchitect(ctx),
    ctx.runner.run({
      role: "uiux",
      cwd: ctx.dir,
      prompt: uiuxPrompt(),
      model: ctx.cfg.models.uiux,
      ...caps(ctx, "uiux", uiuxRole.maxTurns),
      schema: AgentStatus,
      hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: UIUX_GLOBS, allowBash: true }, "uiux"),
    }),
  ]);
  if (!ux.ok) ctx.ledger.ruling("continue without a complete design.md", `UI/UX agent failed: ${ux.error}`, "less consistent UI");
  else {
    // Skills are only advice unless someone checks: send UI/UX back once if it skipped the required design research.
    const missing = designResearchGaps(ctx);
    if (missing.length) {
      ctx.ledger.ruling("send UI/UX back once", `skipped required design research: ${missing.join("; ")}`, "one extra UI/UX turn");
      await ctx.runner.run({
        role: "uiux", cwd: ctx.dir, prompt: uiuxPrompt(`you skipped ${missing.join(" and ")}. Do it now and update docs/design.md, theme.css and the kit with what you learn.`),
        model: ctx.cfg.models.uiux, ...caps(ctx, "uiux", uiuxRole.maxTurns), schema: AgentStatus, resume: ux.sessionId,
        hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: UIUX_GLOBS, allowBash: true }, "uiux"),
      });
    }
  }

  let plan = readPlan(ctx.dir);
  let session = arch.sessionId;
  for (let i = 0; i < 2 && plan.error; i++) {
    const retry = await runArchitect(ctx, plan.error, session);
    session = retry.sessionId;
    plan = readPlan(ctx.dir);
  }
  if (!plan.tasks) throw new Error(`Architect failed to produce a valid task plan: ${plan.error}`);
  ctx.state.tasks = plan.tasks;
  const shell = shellTask(ctx.dir, plan.tasks);
  if (shell) {
    ctx.state.tasks.push(shell);
    ctx.ledger.ruling(`add ${shell.id}: wire the design into ${shell.lanes[0]}`, "the design specifies the app shell but no task owns that file (Architect and UI/UX plan in parallel)", "one more task after the UI tasks");
  }
  ctx.ledger.note(`Plan: ${ctx.state.tasks.length} tasks — ${ctx.state.tasks.map((t) => t.id).join(", ")}`);
  commitMain(ctx, await commitMessage(ctx, "docs: architecture, design system, contracts and task plan", `architecture + ${plan.tasks.length} tasks`), [...ARCHITECT_GLOBS, ...UIUX_GLOBS]);
}

export const SHELL_FILE = "src/web/App.tsx";

/**
 * Architect and UI/UX plan at the same time, so the designer's app shell (header, logo, nav, page wrappers) can end
 * up in docs/design.md and the UI kit while App.tsx keeps the template's plain header and no task owns it. Then
 * nobody ever wires the design in. When no task's lanes cover the shell file, add one task, after every web task.
 */
export function shellTask(dir: string, tasks: Task[]): Task | null {
  if (!existsSync(join(dir, SHELL_FILE)) || !existsSync(join(dir, "docs", "design.md"))) return null;
  if (tasks.some((t) => matchesGlob(SHELL_FILE, t.lanes))) return null;
  const web = tasks.filter((t) => t.lanes.some((l) => l.startsWith("src/web")));
  return {
    id: "SHELL",
    title: "Apply the design to the app shell",
    description: [
      `docs/design.md is the source of truth for how the app looks. Make ${SHELL_FILE} use the app shell it specifies: the header/top bar, the logo or wordmark, the nav styling and the page/layout wrappers, using the components the designer already built in src/web/components/ui and the tokens in src/web/theme.css.`,
      "Replace any leftover template header or layout. Keep the routes, providers and the nav's behaviour (which links show for which user) exactly as they are: other tasks' tests render <App/>.",
      "Then start the app, look at every page in a browser at desktop and mobile width, and fix anything that still doesn't match docs/design.md.",
    ].join("\n"),
    deps: web.map((t) => t.id),
    lanes: [SHELL_FILE],
    acceptance: ["npm run check passes", "the header, logo and nav render the design's shell components; no template header is left"],
    kind: "feature",
    status: "backlog",
    attempts: 0,
    escalations: 0,
    featureIds: [],
  };
}

/** Which required design steps the UI/UX agent's tool log doesn't show (only for skills actually installed in the run). */
export function designResearchGaps(ctx: Ctx): string[] {
  const tools = EventBus.readAll(join(ctx.dir, ".forge", "events.jsonl")).filter((e) => e.role === "uiux" && e.kind === "tool").map((e) => e.text ?? "");
  const has = (skill: string) => existsSync(join(ctx.dir, ".claude", "skills", skill, "SKILL.md"));
  const gaps: string[] = [];
  if (has("frontend-design") && !tools.some((t) => /^Skill\b/.test(t) && t.includes("frontend-design"))) gaps.push("the frontend-design skill");
  if (has("ui-ux-pro-max") && !tools.some((t) => t.includes("search.py"))) gaps.push("the ui-ux-pro-max design-system search");
  return gaps;
}
