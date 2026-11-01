import type { FactoryConfig } from "./config.ts";
import type { Phase, Role, RunState, TokenCount } from "./types.ts";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Minimum useful spend per call by role: below this, heavy roles can't finish their artifact. */
export const ROLE_FLOOR_USD: Partial<Record<Role, number>> = {
  architect: 1.5, researcher: 0.6, final_reviewer: 1, qa: 1.2, dev: 1, product: 0.6, uiux: 1.2, integrator: 0.6, reviewer: 0.4, devops: 0.4, learner: 0.2, critic: 0.2,
};

/** One model's share of an agent call, from the SDK result's modelUsage. */
export interface ModelSpend { model: string; in: number; out: number; cacheRead: number; cacheWrite: number; usd: number }

export class Budget {
  private held = 0;

  constructor(private cfg: FactoryConfig, private state: RunState) {}

  /** Reserve a call's cap while it runs, so parallel calls can't jointly overshoot the total. */
  hold(usd: number): void {
    this.held = round(this.held + usd);
  }

  release(usd: number): void {
    this.held = round(Math.max(0, this.held - usd));
  }

  /** Kept back for deploy + report so a long build can never starve the finish. */
  reserve(): number {
    const pct = (this.cfg.phaseBudgetPct.deploy ?? 0) + (this.cfg.phaseBudgetPct.report ?? 0);
    return round(Math.max(0.5, (this.cfg.budgetUsd * pct) / 100));
  }

  record(role: string, usd: number, local = false, phase: Phase = this.state.phase, tokens?: { in: number; out: number; cacheRead: number; cacheWrite?: number; model?: string; byModel?: ModelSpend[] }): void {
    const s = this.state.spend;
    if (tokens) {
      const t = (s.tokens ??= { in: 0, out: 0, cacheRead: 0, calls: 0, byRole: {}, byPhase: {}, models: {} });
      const add = (c: TokenCount) => {
        c.in += tokens.in;
        c.out += tokens.out;
        c.cacheRead += tokens.cacheRead;
        c.cacheWrite = (c.cacheWrite ?? 0) + (tokens.cacheWrite ?? 0);
        c.calls += 1;
      };
      add(t);
      add((t.byRole[role] ??= { in: 0, out: 0, cacheRead: 0, calls: 0 }));
      add((t.byPhase[phase] ??= { in: 0, out: 0, cacheRead: 0, calls: 0 }));
      for (const id of tokens.byModel?.length ? tokens.byModel.map((m) => m.model) : tokens.model ? [tokens.model] : []) {
        if (!(t.models[role] ??= []).includes(id)) t.models[role].push(id);
      }
      for (const m of tokens.byModel ?? []) {
        const c = ((t.byModel ??= {})[m.model] ??= { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0, usd: 0 });
        c.in += m.in;
        c.out += m.out;
        c.cacheRead += m.cacheRead;
        c.cacheWrite = (c.cacheWrite ?? 0) + m.cacheWrite;
        c.calls += 1;
        c.usd = round(c.usd + m.usd);
      }
    }
    s.usd = round(s.usd + usd);
    s.byRole[role] = round((s.byRole[role] ?? 0) + usd);
    s.byPhase[phase] = round((s.byPhase[phase] ?? 0) + usd);
    if (local) s.local += 1;
    else s.remote += 1;
  }

  remaining(): number {
    return round(this.cfg.budgetUsd - this.state.spend.usd);
  }

  phaseRemaining(p: Phase): number {
    const pct = this.cfg.phaseBudgetPct[p] ?? 0;
    return round((this.cfg.budgetUsd * pct) / 100 - (this.state.spend.byPhase[p] ?? 0));
  }

  /**
   * Max dollars one agent call may spend. Phase budgets are soft: a phase that has run over
   * still gets 3% of the total per call, so the build never starves while total budget remains.
   */
  perCallCap(role: Role, p: Phase): number {
    const total = this.cfg.budgetUsd;
    const share = Math.min(total * 0.08, Math.max(this.phaseRemaining(p), total * 0.03));
    const available = this.remaining() - this.held - (p === "deploy" || p === "report" ? 0 : this.reserve());
    const cap = Math.min(Math.max(0, available), Math.max(share, ROLE_FLOOR_USD[role] ?? 0));
    return round(Math.max(0.05, cap));
  }

  exhausted(p: Phase = this.state.phase): boolean {
    const keep = p === "deploy" || p === "report" ? 0 : this.reserve();
    return this.remaining() <= keep + 0.05;
  }

  shouldLand(now: Date = new Date()): boolean {
    if (this.state.spend.usd >= this.cfg.budgetUsd * 0.8) return true;
    if (this.cfg.deadline) {
      const msLeft = new Date(this.cfg.deadline).getTime() - now.getTime();
      if (msLeft <= this.cfg.landingMinutes * 60_000) return true;
    }
    return false;
  }
}
