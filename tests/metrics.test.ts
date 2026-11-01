import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budget } from "../src/budget.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { newState } from "../src/state.ts";
import { commitAll, headSha, initRepo, sh } from "../src/git.ts";
import { authorship, computeMetrics, renderMetrics } from "../src/metrics.ts";
import type { Prd } from "../src/schemas.ts";

const prd = (passes: boolean[]): Prd => ({
  product: "p", pitch: "x", users: [], outOfScope: [], openQuestions: [], researchQuestions: [],
  features: passes.map((p, i) => ({ id: `F${i + 1}`, title: "f", priority: "must", story: "s", acceptance: ["a"], passes: p })),
});

describe("token accounting", () => {
  it("sums tokens by role and phase and remembers the model per role", () => {
    const s = newState("r");
    const b = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 10 }, s);
    b.record("dev", 0.5, false, "build", { in: 100, out: 50, cacheRead: 900, cacheWrite: 0, model: "sonnet" });
    b.record("dev", 0.5, false, "build", { in: 100, out: 50, cacheRead: 900, model: "opus" });
    b.record("qa", 0.2, false, "qa", { in: 10, out: 5, cacheRead: 0, model: "sonnet" });
    expect(s.spend.tokens?.byRole.dev).toMatchObject({ in: 200, out: 100, cacheRead: 1800, calls: 2 });
    expect(s.spend.tokens?.byPhase.qa.calls).toBe(1);
    expect(s.spend.tokens?.models.dev).toEqual(["sonnet", "opus"]);
    const m = computeMetrics(mkdtempSync(join(tmpdir(), "m-")), s, prd([true, true, false]), 10);
    expect(m.tokens.total).toBe(2115);
    expect(m.tokensPerFeature).toBe(Math.round(2115 / 2));
    expect(m.tokens.cacheHitPct).toBeCloseTo((100 * 1800) / 2010, 1);
    expect(renderMetrics(m, s).join("\n")).toContain("2/3 features working");
  });
});

describe("autonomy", () => {
  it("splits added lines by author since the baseline and lists human commits as interventions", () => {
    const dir = mkdtempSync(join(tmpdir(), "a-"));
    initRepo(dir);
    writeFileSync(join(dir, "seed.ts"), "a\n");
    commitAll(dir, "seed");
    const base = headSha(dir);
    writeFileSync(join(dir, "agent.ts"), "1\n2\n3\n");
    writeFileSync(join(dir, "package-lock.json"), "x\n".repeat(50));
    commitAll(dir, "agent work");
    writeFileSync(join(dir, "human.ts"), "h\n");
    sh("git add -A && git -c user.name=Tuvshuu -c user.email=t@x commit -qm 'hand fix'", dir);
    const a = authorship(dir, base);
    expect(a).toMatchObject({ agentLines: 3, humanLines: 1, agentCommits: 1, humanCommits: 1, pct: 75 });
    const s = newState("r");
    s.baseSha = base;
    s.interventions = [{ at: 1, kind: "resume" }];
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "events.jsonl"), JSON.stringify({ ts: 2, run: "r", phase: "build", kind: "operator_say", text: "use blue" }) + "\n");
    const m = computeMetrics(dir, s, prd([true]), 10);
    expect(m.interventions.byKind).toEqual({ note: 1, resume: 1, manual_commit: 1 });
    expect(m.interventions.byImpact).toEqual({ low: 2, high: 1 });
  });
});
