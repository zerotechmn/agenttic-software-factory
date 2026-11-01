import { emit, ensureMain, Stopped, type Ctx } from "./ctx.ts";
import { PHASES, type Phase, type RunState } from "./types.ts";
import { intake } from "./phases/intake.ts";
import { product } from "./phases/product.ts";
import { design } from "./phases/design.ts";
import { research } from "./phases/research.ts";
import { contractGate } from "./phases/contractGate.ts";
import { build } from "./phases/build.ts";
import { qa } from "./phases/qa.ts";
import { finalReview } from "./phases/finalReview.ts";
import { deploy } from "./phases/deploy.ts";
import { report } from "./phases/report.ts";
import { saveState } from "./state.ts";
import { InboxRunner } from "./inbox.ts";

export type { Ctx } from "./ctx.ts";
export { Stopped } from "./ctx.ts";

const RUNNERS: Record<Exclude<Phase, "done">, (ctx: Ctx) => Promise<void>> = {
  intake,
  product,
  research,
  design,
  contract_gate: contractGate,
  build,
  qa,
  final_review: finalReview,
  deploy,
  report,
};

/** Run every phase not yet done. Persists state after each step so `resume` picks up where it left off. */
export async function runPipeline(ctx: Ctx): Promise<RunState> {
  const save = ctx.save;
  ctx.save = () => {
    saveState(ctx.dir, ctx.state);
    save();
  };
  if (!(ctx.runner instanceof InboxRunner)) ctx.runner = new InboxRunner(ctx.dir, ctx.runner, ctx.state, ctx.ledger, () => ctx.save());
  try {
    for (const phase of PHASES) {
      if (ctx.state.done.includes(phase)) continue;
      ctx.state.phase = phase;
      if (ctx.state.mainSha) ensureMain(ctx);
      ctx.save();
      emit(ctx, { kind: "phase_start" });
      const t0 = Date.now();
      await RUNNERS[phase](ctx);
      ctx.state.done.push(phase);
      emit(ctx, { kind: "phase_end", text: `${Math.round((Date.now() - t0) / 1000)}s` });
      ctx.save();
    }
    ctx.state.phase = "done";
    emit(ctx, { kind: "run_done", usd: ctx.state.spend.usd });
    ctx.save();
  } catch (e) {
    if (e instanceof Stopped) {
      emit(ctx, { kind: "stopped", text: e.message });
      ctx.save();
      return ctx.state;
    }
    emit(ctx, { kind: "run_error", text: (e as Error).message.slice(0, 500) });
    ctx.save();
    throw e;
  }
  return ctx.state;
}
