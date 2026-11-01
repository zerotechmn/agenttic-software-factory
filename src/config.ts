import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Phase, Role } from "./types.ts";

export interface FactoryConfig {
  models: Record<Role, string>;
  escalationModel: string;
  budgetUsd: number;
  phaseBudgetPct: Partial<Record<Phase, number>>;
  concurrency: number;
  deadline?: string;
  landingMinutes: number;
  local: { enabled: boolean; host: string; model: string };
  port: number;
  maxQaRounds: number;
  maxDevAttempts: number;
  maxEscalations: number;
  /** Changed non-test lines below which the LLM review is skipped (the deterministic gate still runs). */
  reviewMinLines: number;
  /** Minutes to wait for operator answers to the PRD's open questions (0 = proceed on the stated assumptions). */
  clarifyMinutes: number;
  /** Build on the house stack even when the brief asks for another one (set after a stack-check stop). */
  acceptStack?: boolean;
}

export const FACTORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_CONFIG: FactoryConfig = {
  models: {
    product: "sonnet",
    architect: "opus",
    uiux: "opus",
    dev: "sonnet",
    reviewer: "haiku",
    integrator: "sonnet",
    qa: "sonnet",
    final_reviewer: "sonnet",
    devops: "haiku",
    reporter: "haiku",
    researcher: "sonnet",
    learner: "haiku",
    critic: "haiku",
  },
  escalationModel: "opus",
  budgetUsd: 60,
  phaseBudgetPct: { product: 5, research: 4, design: 12, contract_gate: 3, build: 46, qa: 18, final_review: 6, deploy: 3, report: 1 },
  concurrency: 3,
  clarifyMinutes: 0,
  landingMinutes: 90,
  local: { enabled: false, host: "http://localhost:11434", model: "gemma4:latest" }, // opt in via forge.config.json; all agents use the Anthropic API
  port: 4317,
  maxQaRounds: 4,
  maxDevAttempts: 3,
  maxEscalations: 2,
  reviewMinLines: 80,
};

function readJson(path: string): Partial<FactoryConfig> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function merge(base: FactoryConfig, over: Partial<FactoryConfig>): FactoryConfig {
  return {
    ...base,
    ...over,
    models: { ...base.models, ...(over.models ?? {}) },
    phaseBudgetPct: { ...base.phaseBudgetPct, ...(over.phaseBudgetPct ?? {}) },
    local: { ...base.local, ...(over.local ?? {}) },
  };
}

export function loadConfig(projectDir: string, overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  let cfg = merge(DEFAULT_CONFIG, readJson(join(FACTORY_ROOT, "forge.config.json")));
  cfg = merge(cfg, readJson(join(projectDir, ".forge", "config.json")));
  return merge(cfg, overrides);
}
