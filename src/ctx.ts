import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentRunner } from "./agent.ts";
import type { Budget } from "./budget.ts";
import type { GateResult, GateStep } from "./checks.ts";
import type { FactoryConfig } from "./config.ts";
import type { EventBus } from "./events.ts";
import type { Ledger } from "./ledger.ts";
import { guardHooks, rtkRewrite, matchesGlob, type GuardPolicy } from "./guard.ts";
import { changedSince, commitAll, headSha, repairRepo, resetTo, restorePaths } from "./git.ts";
import { localLLM } from "./local.ts";
import type { Prd } from "./schemas.ts";
import type { Phase, Role, RunState } from "./types.ts";

export interface AppHandle {
  url: string;
  stop(): Promise<void>;
}

export interface Ctx {
  dir: string;
  briefPath: string;
  cfg: FactoryConfig;
  state: RunState;
  bus: EventBus;
  budget: Budget;
  runner: AgentRunner;
  ledger: Ledger;
  gate: (cwd: string, steps?: GateStep[]) => Promise<GateResult>;
  app: { start(dir: string, port: number): Promise<AppHandle> };
  templateDir: string;
  /** Run npm install during intake (false in tests). */
  install: boolean;
  /** Use the local Ollama tier for chores. */
  local: boolean;
  save(): void;
}

export class Stopped extends Error {
  constructor() {
    super("STOP file found — run halted; `forge resume` continues");
  }
}

export const stopFile = (dir: string) => join(dir, ".forge", "STOP");

export function checkStop(ctx: Ctx): void {
  if (existsSync(stopFile(ctx.dir))) throw new Stopped();
}

export function emit(ctx: Ctx, e: Omit<Parameters<EventBus["emit"]>[0], "phase">) {
  return ctx.bus.emit({ phase: ctx.state.phase, ...e });
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export function loadPrd(ctx: Ctx): Prd {
  return readJson<Prd>(join(ctx.dir, "docs", "prd.json"));
}

/** Enter landing mode once, with a ruling, when budget or deadline says so. */
export function checkLanding(ctx: Ctx): boolean {
  if (!ctx.state.landing && ctx.budget.shouldLand()) {
    ctx.state.landing = true;
    ctx.ledger.ruling(
      "enter landing mode: no new should/could work, fix must-haves, then deploy and report",
      `spend $${ctx.state.spend.usd.toFixed(2)} of $${ctx.cfg.budgetUsd} or deadline near`,
      "should-have features left unbuilt",
    );
    emit(ctx, { kind: "landing" });
    ctx.save();
  }
  return ctx.state.landing;
}

/** Per-call caps for a role in the current phase. */
export function caps(ctx: Ctx, role: Role, maxTurns: number) {
  return { maxTurns, maxBudgetUsd: ctx.budget.perCallCap(role, ctx.state.phase as Phase) };
}

export function hooksFor(ctx: Ctx, policy: GuardPolicy, role: Role, taskId?: string) {
  // FORGE_RTK=1: compress shell output with rtk (trial; see docs/BUILD_LEDGER.md)
  const rewrite = process.env.FORGE_RTK === "1" ? (c: string) => rtkRewrite(c) : undefined;
  return guardHooks(policy, (tool, reason) => emit(ctx, { kind: "guard_deny", role, taskId, text: `${tool}: ${reason}` }), rewrite);
}

/** Commit message: local model when available, deterministic fallback otherwise. */
export async function commitMessage(ctx: Ctx, fallback: string, context: string): Promise<string> {
  if (!ctx.local) return fallback;
  const r = await localLLM(
    { system: "Write one conventional-commit subject line (max 72 chars). Output only the line.", prompt: context.slice(0, 3000), host: ctx.cfg.local.host, model: ctx.cfg.local.model },
    { fallback: async () => fallback },
  );
  ctx.budget.record("local", 0, r.local);
  const line = r.text.split("\n")[0].replace(/^["'`]|["'`]$/g, "").trim();
  return line && line.length <= 100 ? line : fallback;
}

/** Record main's HEAD as the last known-good state. */
export function markMain(ctx: Ctx): void {
  ctx.state.mainSha = headSha(ctx.dir);
  ctx.save();
}

/**
 * Commit on main as the orchestrator. With `allowed`, any change outside those globs (e.g. an agent
 * editing product code through bash) is reverted first, so only gated code ever reaches main.
 */
export function commitMain(ctx: Ctx, msg: string, allowed?: string[]): boolean {
  if (allowed) {
    const head = headSha(ctx.dir);
    const bad = changedSince(ctx.dir, head).filter((f) => !matchesGlob(f, allowed));
    if (bad.length) {
      restorePaths(ctx.dir, head, bad);
      emit(ctx, { kind: "guard_deny", text: `reverted out-of-scope change(s) on main: ${bad.slice(0, 8).join(", ")}` });
    }
  }
  const committed = commitAll(ctx.dir, msg.includes("Forge-Phase:") ? msg : `${msg}\n\nForge-Phase: ${ctx.state.phase}`);
  markMain(ctx);
  return committed;
}

/** Repair main after a crash or a rogue agent: abort merges, drop locks and dirt, rewind to the last verified commit. */
export function ensureMain(ctx: Ctx): void {
  const fixes = repairRepo(ctx.dir);
  const good = ctx.state.mainSha;
  if (good && headSha(ctx.dir) !== good) {
    resetTo(ctx.dir, good);
    fixes.push(`reset main to the last verified commit ${good.slice(0, 7)}`);
  }
  if (fixes.length) ctx.ledger.note(`repaired main: ${fixes.join("; ")}`);
}
