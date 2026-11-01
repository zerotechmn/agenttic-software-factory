import { compressFailure } from "../local.ts";
import { commitMain, commitMessage, type Ctx } from "../ctx.ts";
import { laneConflicts, serializeConflicts, validatePlan } from "../dag.ts";
import { ARCHITECT_GLOBS, readPlan, runArchitect, shellTask, UIUX_GLOBS } from "./design.ts";

/** Deterministic gate before any parallel work: baseline must be green and lanes disjoint. */
export async function contractGate(ctx: Ctx): Promise<void> {
  let gate = await ctx.gate(ctx.dir);
  for (let i = 0; i < 2 && !gate.ok; i++) {
    const feedback = `The baseline (contracts + stubs) fails \`npm run check\` at step ${gate.failed}:\n${await compressFailure(gate.output, { enabled: !!ctx.local, host: ctx.cfg.local.host, model: ctx.cfg.local.model })}`;
    await runArchitect(ctx, feedback, undefined, true);
    const plan = readPlan(ctx.dir);
    if (plan.tasks) {
      const shell = shellTask(ctx.dir, plan.tasks);
      ctx.state.tasks = shell ? [...plan.tasks, shell] : plan.tasks;
    }
    gate = await ctx.gate(ctx.dir);
  }
  if (!gate.ok) throw new Error(`Contract gate: baseline still fails ${gate.failed} after 2 architect repairs`);

  const conflicts = laneConflicts(ctx.state.tasks);
  if (conflicts.length) {
    const before = ctx.state.tasks.map((t) => [...t.deps]);
    serializeConflicts(ctx.state.tasks, conflicts);
    if (validatePlan(ctx.state.tasks).length) {
      ctx.state.tasks.forEach((t, i) => (t.deps = before[i]));
      ctx.cfg.concurrency = 1;
      ctx.ledger.ruling("run all tasks one at a time", "serializing lane conflicts would create a dependency cycle", "slower build");
    } else {
      ctx.ledger.ruling(
        `serialize ${conflicts.length} conflicting task pair(s): ${conflicts.map(([a, b, l]) => `${b} waits for ${a} (${l})`).join("; ")}`,
        "parallel tasks would write the same files",
        "less parallelism",
      );
    }
  }
  commitMain(ctx, await commitMessage(ctx, "chore: contract gate passed", "contract gate"), [...ARCHITECT_GLOBS, ...UIUX_GLOBS]);
  // committing reverts out-of-scope edits (e.g. an architect's eslint.config.js change): main must still be green
  const after = await ctx.gate(ctx.dir);
  if (!after.ok) throw new Error(`Contract gate: main fails ${after.failed} after committing the baseline (an out-of-scope fix was reverted?):\n${after.output.slice(-800)}`);
}
