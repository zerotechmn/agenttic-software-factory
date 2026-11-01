import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline, type Ctx } from "../src/pipeline.ts";
import { FakeAgentRunner, type Script } from "../src/testing/fake-runner.ts";
import { EventBus } from "../src/events.ts";
import { Budget } from "../src/budget.ts";
import { DEFAULT_CONFIG, type FactoryConfig } from "../src/config.ts";
import { newState, loadState } from "../src/state.ts";
import { ledger } from "../src/ledger.ts";
import type { GateResult } from "../src/checks.ts";

function fakeTemplate(): string {
  const t = mkdtempSync(join(tmpdir(), "forge-tpl-"));
  writeFileSync(join(t, "package.json"), JSON.stringify({ name: "t", scripts: {} }));
  mkdirSync(join(t, "src/shared"), { recursive: true });
  writeFileSync(join(t, "src/shared/product.ts"), 'export const PRODUCT_NAME = "House App";\n');
  writeFileSync(join(t, "index.html"), "<title>House App</title>");
  mkdirSync(join(t, "docs"), { recursive: true });
  writeFileSync(join(t, "CLAUDE.md"), "# house");
  return t;
}

const PRD = {
  product: "Notes", pitch: "notes", users: ["me"], outOfScope: [],
  features: [
    { id: "F1", title: "Create note", priority: "must", story: "s", acceptance: ["a"], passes: false },
    { id: "F2", title: "Tags", priority: "should", story: "s", acceptance: ["a"], passes: false },
  ],
};
const TASKS = {
  tasks: [
    { id: "T1", title: "API", description: "d", deps: [], lanes: ["src/server/routes/notes.ts"], acceptance: [], featureIds: ["F1"] },
    { id: "T2", title: "UI", description: "d", deps: ["T1"], lanes: ["src/web/pages/Notes.tsx"], acceptance: [], featureIds: ["F1"] },
    { id: "T3", title: "Tags", description: "d", deps: [], lanes: ["src/server/routes/tags.ts"], acceptance: [], featureIds: ["F2"] },
  ],
};
const write = (cwd: string, rel: string, body: string) => {
  mkdirSync(join(cwd, rel, ".."), { recursive: true });
  writeFileSync(join(cwd, rel), body);
};

function baseScripts(over: Record<string, Script> = {}): Record<string, Script> {
  return {
    product: (r) => { write(r.cwd, "docs/prd.json", JSON.stringify(PRD)); write(r.cwd, "docs/prd.md", "# prd"); },
    architect: (r) => { write(r.cwd, "docs/tasks.json", JSON.stringify(TASKS)); write(r.cwd, "docs/architecture.md", "# arch"); },
    uiux: (r) => { write(r.cwd, "docs/design.md", "# design"); },
    dev: (r) => { write(r.cwd, `src/gen/${r.taskId}-${Date.now()}.ts`, "export {};\n"); },
    reviewer: () => ({ output: { verdict: "approve", issues: [] } }),
    qa: () => ({ output: { score: 8, features: [{ id: "F1", passes: true, evidence: "ok" }, { id: "F2", passes: true, evidence: "ok" }], failures: [] } }),
    final_reviewer: () => ({ output: { verdict: "approve", issues: [] } }),
    devops: () => ({ output: { ok: true, url: "http://127.0.0.1:9", method: "node", notes: "" } }),
    ...over,
  };
}

function makeCtx(opts: { scripts?: Record<string, Script>; gate?: (cwd: string, steps?: string[]) => Promise<GateResult>; cfg?: Partial<FactoryConfig>; dir?: string } = {}) {
  const dir = opts.dir ?? join(mkdtempSync(join(tmpdir(), "forge-run-")), "app");
  const briefPath = join(dir, "..", "brief.md");
  if (!existsSync(briefPath)) writeFileSync(briefPath, "Build a notes app");
  const cfg: FactoryConfig = { ...DEFAULT_CONFIG, budgetUsd: 100, ...opts.cfg };
  const state = loadState(dir) ?? newState("test-run");
  const bus = new EventBus(join(dir, ".forge", "events.jsonl"), state.run);
  const budget = new Budget(cfg, state);
  const runner = new FakeAgentRunner(baseScripts(opts.scripts), 0.1, (role, usd, tokens) => budget.record(role, usd, false, undefined, tokens));
  const ctx: Ctx = {
    dir, briefPath, cfg, state, bus, budget, runner,
    ledger: ledger(dir, bus, () => state.phase),
    gate: opts.gate ?? (async () => ({ ok: true, output: "" })),
    app: { start: async () => ({ url: "http://localhost:9999", stop: async () => {} }) },
    templateDir: fakeTemplate(),
    install: false,
    local: false,
    save: () => {},
  };
  return { ctx, runner, dir };
}

describe("pipeline", () => {
  it("happy path: reaches done with every task merged, a deploy record and a run report", async () => {
    const { ctx, dir } = makeCtx();
    const s = await runPipeline(ctx);
    expect(s.phase).toBe("done");
    expect(s.tasks.map((t) => t.status)).toEqual(["merged", "merged", "merged"]);
    expect(existsSync(join(dir, "docs/RUN_REPORT.md"))).toBe(true);
    const report = readFileSync(join(dir, "docs/RUN_REPORT.md"), "utf8");
    expect(report).toContain("per working feature");
    expect(report).toContain("100% of code written by agents");
    expect(JSON.parse(readFileSync(join(dir, "docs/metrics.json"), "utf8")).tokens.calls).toBeGreaterThan(0);
    expect(report).toContain("## Security scan");
    expect(report).toContain("## How each task went");
    expect(report).toContain("## Timeline");
    expect(report).toContain("## Evidence");
    const { sh } = await import("../src/git.ts");
    expect(sh("git log --all --format=%B", dir).out).toMatch(/Forge-Task: T1\nForge-Role: dev\nForge-Model: sonnet/);
    expect(existsSync(join(dir, ".forge/security.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, ".forge/deploy.json"), "utf8")).agentOk).toBe(true);
    expect(readFileSync(join(dir, "src/shared/product.ts"), "utf8")).toContain('"Notes"');
    const prd = JSON.parse(readFileSync(join(dir, "docs/prd.json"), "utf8"));
    expect(prd.features.every((f: { passes: boolean }) => f.passes)).toBe(true);
  });

  it("escalates to the escalation model after the same gate failure twice, then parks with a ruling", async () => {
    const { ctx, runner, dir } = makeCtx({
      gate: async (cwd) => (cwd.includes("/wt/T3") ? { ok: false, failed: "test", output: "FAIL tests/tags.test.ts", signature: "test:FAIL tags" } : { ok: true, output: "" }),
    });
    const s = await runPipeline(ctx);
    const t3 = s.tasks.find((t) => t.id === "T3")!;
    expect(t3.status).toBe("parked");
    const devCalls = runner.callsFor("dev", "T3");
    expect(devCalls[0].model).toBe("sonnet");
    expect(devCalls[1].model).toBe("sonnet");
    expect(devCalls[2].model).toBe("opus");
    expect(devCalls.length).toBe(2 + DEFAULT_CONFIG.maxEscalations);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/RULING: park T3/);
    expect(s.phase).toBe("done");
  });

  it("parks a task whose developer reports BLOCKED twice, without escalating (retries can't fix the environment)", async () => {
    const { ctx, runner, dir } = makeCtx({
      scripts: { "dev:T3": (r) => { write(r.cwd, `src/gen/T3-${Date.now()}.ts`, "export {};\n"); return { output: { status: "BLOCKED", summary: "x", filesChanged: [], concerns: ["the hook makes tests/e2e/** read-only"] } }; } },
      gate: async (cwd) => (cwd.includes("/wt/T3") ? { ok: false, failed: "test", output: `FAIL ${Math.random()}`, signature: `test:${Math.random()}` } : { ok: true, output: "" }),
    });
    const s = await runPipeline(ctx);
    expect(s.tasks.find((t) => t.id === "T3")!.status).toBe("parked");
    const calls = runner.callsFor("dev", "T3");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.model === "sonnet")).toBe(true);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/RULING: park T3.*BLOCKED twice.*read-only/);
  });

  it("a single BLOCKED report still gets a normal retry", async () => {
    let n = 0;
    const { ctx, runner } = makeCtx({
      scripts: { "dev:T1": (r) => { write(r.cwd, `src/gen/T1-${Date.now()}.ts`, "export {};\n"); return n++ === 0 ? { output: { status: "BLOCKED", summary: "x", filesChanged: [], concerns: ["unsure"] } } : undefined; } },
      gate: async (cwd) => (cwd.includes("/wt/T1") && n === 1 ? { ok: false, failed: "test", output: "FAIL", signature: "test:x" } : { ok: true, output: "" }),
    });
    const s = await runPipeline(ctx);
    expect(s.tasks.find((t) => t.id === "T1")!.status).toBe("merged");
    expect(runner.callsFor("dev", "T1")).toHaveLength(2);
  });

  it("never merges an empty BLOCKED fix: widens its lanes once, then the dev does it", async () => {
    const { iterate } = await import("../src/iterate.ts");
    let n = 0;
    const { ctx, runner, dir } = makeCtx({
      scripts: { "dev:IT1-1": (r) => (n++ === 0
        ? { output: { status: "BLOCKED", summary: "x", filesChanged: [], concerns: ["needs src/shared/booking.ts, outside my lanes"] } }
        : (write(r.cwd, "src/shared/booking.ts", "export const nights = true;\n"), undefined)) },
    });
    await runPipeline(ctx);
    iterate(ctx.state, ["Count rental days as nights"], ["src/web/**"]);
    const done = await runPipeline(ctx);
    const t = done.tasks.find((x) => x.id === "IT1-1")!;
    expect(t.status).toBe("merged");
    expect(t.lanes).toEqual(["src/**"]);
    expect(runner.callsFor("dev", "IT1-1")).toHaveLength(2);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/RULING: widen IT1-1 lanes to src\/\*\*/);
    // the operator's request overrides the PRD for QA and the final review
    expect(runner.callsFor("qa").some((c) => c.prompt.includes("1. Count rental days as nights"))).toBe(true);
    expect(runner.callsFor("final_reviewer").at(-1)!.prompt).toContain("THESE are correct");
  });

  it("fails at the contract gate when main is red after committing the baseline (reverted out-of-scope fix)", async () => {
    let mainGates = 0;
    const { ctx, runner } = makeCtx({
      gate: async (cwd) => (!cwd.includes("/wt/") && ++mainGates === 2 ? { ok: false, failed: "lint", output: "error in .claude/skills/x.js", signature: "lint:x" } : { ok: true, output: "" }),
    });
    await expect(runPipeline(ctx)).rejects.toThrow(/after committing the baseline/);
    expect(runner.callsFor("dev", "T1")).toHaveLength(0);
  });

  it("feeds the gate failure back to the same dev session on retry", async () => {
    let n = 0;
    const { ctx, runner } = makeCtx({
      gate: async (cwd) => (cwd.includes("/wt/T1") && n++ === 0 ? { ok: false, failed: "typecheck", output: "src/x.ts(1,1): error TS1: boom", signature: "typecheck:boom" } : { ok: true, output: "" }),
    });
    await runPipeline(ctx);
    const calls = runner.callsFor("dev", "T1");
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("error TS1: boom");
    expect(calls[1].resume).toBe("sess-dev:T1-1");
  });

  it("stops on the STOP file and resumes without re-running merged tasks", async () => {
    const first = makeCtx({
      scripts: {
        dev: (r) => {
          write(r.cwd, `src/gen/${r.taskId}.ts`, "export {};\n");
          if (r.taskId === "T2") write(join(r.cwd, "..", "..", ".."), ".forge/STOP", "");
        },
      },
    });
    first.ctx.cfg.concurrency = 1;
    const s1 = await runPipeline(first.ctx);
    expect(s1.phase).not.toBe("done");
    const merged = s1.tasks.filter((t) => t.status === "merged").map((t) => t.id);
    expect(merged.length).toBeGreaterThan(0);

    const { rmSync } = await import("node:fs");
    rmSync(join(first.dir, ".forge/STOP"));
    const second = makeCtx({ dir: first.dir });
    const s2 = await runPipeline(second.ctx);
    expect(s2.phase).toBe("done");
    for (const id of merged) expect(second.runner.callsFor("dev", id)).toHaveLength(0);
    expect(second.runner.callsFor("product")).toHaveLength(0);
  });

  it("landing mode parks should-only tasks but still deploys and reports", async () => {
    const { ctx, dir } = makeCtx({ cfg: { budgetUsd: 1 } });
    ctx.state.spend.usd = 0.85;
    const s = await runPipeline(ctx);
    expect(s.landing).toBe(true);
    expect(s.tasks.find((t) => t.id === "T3")!.status).toBe("parked");
    expect(existsSync(join(dir, ".forge/deploy.json"))).toBe(true);
    expect(existsSync(join(dir, "docs/RUN_REPORT.md"))).toBe(true);
  });

  it("serializes parallel tasks that share a lane", async () => {
    const tasks = { tasks: [
      { id: "A", title: "a", description: "d", deps: [], lanes: ["src/web/App.tsx"], acceptance: [], featureIds: ["F1"] },
      { id: "B", title: "b", description: "d", deps: [], lanes: ["src/web/**"], acceptance: [], featureIds: ["F1"] },
    ] };
    const { ctx } = makeCtx({ scripts: { architect: (r) => { write(r.cwd, "docs/tasks.json", JSON.stringify(tasks)); } } });
    const s = await runPipeline(ctx);
    expect(s.tasks.find((t) => t.id === "B")!.deps).toContain("A");
  });

  it("turns QA failures into fix tasks and re-runs QA", async () => {
    const { ctx, runner } = makeCtx({
      scripts: {
        qa: (_r, call) =>
          call === 1
            ? { output: { score: 4, features: [{ id: "F1", passes: false, evidence: "button missing" }], failures: [{ title: "No save button", steps: "open /", expected: "Save", actual: "none", suspectedFiles: ["src/web/pages/Notes.tsx"], featureId: "F1" }] } }
            : { output: { score: 8, features: [{ id: "F1", passes: true, evidence: "ok" }], failures: [] } },
      },
    });
    const s = await runPipeline(ctx);
    expect(s.qaRounds.map((r) => r.score)).toEqual([4, 8]);
    const fix = s.tasks.find((t) => t.kind === "fix")!;
    expect(fix.status).toBe("merged");
    expect(runner.callsFor("dev", fix.id)[0].prompt).toContain("No save button");
  });

  it("an invalid PRD is retried with the validation error and then fails loudly", async () => {
    const { ctx, runner } = makeCtx({ scripts: { product: (r) => { write(r.cwd, "docs/prd.json", "{\"product\":1}"); } } });
    await expect(runPipeline(ctx)).rejects.toThrow(/PRD/);
    expect(runner.callsFor("product")).toHaveLength(2);
    expect(runner.callsFor("product")[1].prompt).toMatch(/invalid/i);
  });
});

describe("pipeline robustness", () => {
  it("still gates and merges a dev attempt that hit its budget cap after writing the code", async () => {
    const { ctx, runner } = makeCtx({
      scripts: { "dev:T1": (r) => { write(r.cwd, "src/server/routes/notes.ts", "export {};\n"); return { ok: false, subtype: "error_max_budget_usd", error: "budget", output: undefined }; } },
    });
    const s = await runPipeline(ctx);
    expect(s.tasks.find((t) => t.id === "T1")!.status).toBe("merged");
    expect(runner.callsFor("dev", "T1")).toHaveLength(1);
  });

  it("leaves no task marked running after a STOP", async () => {
    const { ctx } = makeCtx({ scripts: { "dev:T1": (r) => { write(join(r.cwd, "..", "..", ".."), ".forge/STOP", ""); write(r.cwd, "src/a.ts", "x"); } } });
    const s = await runPipeline(ctx);
    expect(s.tasks.some((t) => t.status === "running" || t.status === "review")).toBe(false);
  });

  it("restores missing node_modules on resume", async () => {
    const { rmSync } = await import("node:fs");
    const first = makeCtx({ scripts: { "dev:T1": (r) => { write(join(r.cwd, "..", "..", ".."), ".forge/STOP", ""); write(r.cwd, "src/a.ts", "x"); } } });
    mkdirSync(join(first.ctx.templateDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(first.ctx.templateDir, "node_modules", "pkg", "index.js"), "");
    first.ctx.install = true;
    await runPipeline(first.ctx);
    rmSync(join(first.dir, ".forge/STOP"));
    rmSync(join(first.dir, "node_modules"), { recursive: true, force: true });
    const second = makeCtx({ dir: first.dir });
    second.ctx.templateDir = first.ctx.templateDir;
    second.ctx.install = true;
    await runPipeline(second.ctx);
    expect(existsSync(join(first.dir, "node_modules", "pkg", "index.js"))).toBe(true);
  });
});

describe("deploy", () => {
  it("trusts a passing health check over the agent's ok flag, and offers a free port", async () => {
    const http = await import("node:http");
    const srv = http.createServer((req, res) => { res.writeHead(req.url === "/api/health" ? 200 : 404).end("{}"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    let prompt = "";
    const { ctx, dir } = makeCtx({ scripts: { devops: (r) => { prompt = r.prompt; return { output: { ok: false, url: `http://127.0.0.1:${port}`, method: "docker", notes: "port clash, used another" } }; } } });
    await runPipeline(ctx);
    srv.close();
    const rec = JSON.parse(readFileSync(join(dir, ".forge/deploy.json"), "utf8"));
    expect(rec.ok).toBe(true);
    expect(rec.verified).toBe(true);
    expect(prompt).toMatch(/Host port: \d+/);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).not.toMatch(/finish without a running deploy/);
  });
});

describe("deploy port", () => {
  it("reads this run's own container port from docker ps, so a redeploy keeps its URL", async () => {
    const { hostPort } = await import("../src/phases/deploy.ts");
    expect(hostPort("0.0.0.0:8801->8787/tcp, [::]:8801->8787/tcp")).toBe(8801);
    expect(hostPort("")).toBeUndefined();
    expect(hostPort("0.0.0.0:5432->5432/tcp")).toBeUndefined();
  });
});

describe("main-branch integrity (review fixes)", () => {
  const mainOf = (r: { cwd: string }) => join(r.cwd, "..", "..", "..");

  it("C1: restores protected files a dev changed through bash, before anything is merged", async () => {
    const { ctx, dir } = makeCtx({
      scripts: { "dev:T1": (r) => { write(r.cwd, "docs/prd.json", "HACKED"); write(r.cwd, "src/server/routes/notes.ts", "export {};\n"); } },
    });
    await runPipeline(ctx);
    expect(readFileSync(join(dir, "docs/prd.json"), "utf8")).not.toContain("HACKED");
    const { EventBus: EB } = await import("../src/events.ts");
    expect(EB.readAll(join(dir, ".forge/events.jsonl")).some((e) => e.kind === "guard_deny" && /docs\/prd\.json/.test(e.text ?? ""))).toBe(true);
  });

  it("C1: drops a commit a dev made directly on main from its worktree", async () => {
    const { sh } = await import("../src/git.ts");
    const { ctx, dir } = makeCtx({
      scripts: {
        "dev:T2": (r) => { write(r.cwd, "src/t2.ts", "2"); write(mainOf(r), "docs/prd.json", "ROGUE"); sh("git add -A && git commit -qm rogue", mainOf(r)); },
      },
    });
    ctx.cfg.concurrency = 1;
    await runPipeline(ctx);
    expect(sh("git log --format=%s", dir).out).not.toContain("rogue");
    expect(readFileSync(join(dir, "docs/prd.json"), "utf8")).not.toContain("ROGUE");
  });

  it("I1: a failed main gate after a no-op merge never deletes an earlier task's merge", async () => {
    let mainGates = 0;
    const { ctx, dir } = makeCtx({
      scripts: {
        "dev:T1": (r) => { write(r.cwd, "src/t1.ts", "1"); },
        "dev:T2": (r) => { write(r.cwd, "src/t2.ts", "2"); },
        "dev:T3": () => {},
      },
      gate: async (cwd) => {
        if (cwd.includes("/wt/")) return { ok: true, output: "" };
        mainGates++;
        // #1 contract gate, #2 T1's merge, #3 T3's no-op merge (its branch predates T1) → flaky failure
        return mainGates === 3 ? { ok: false, failed: "test", output: "FAIL flaky", signature: "test:flaky" } : { ok: true, output: "" };
      },
    });
    ctx.cfg.concurrency = 2;
    const s = await runPipeline(ctx);
    expect(s.tasks.find((t) => t.id === "T1")!.status).toBe("merged");
    expect(existsSync(join(dir, "src/t1.ts"))).toBe(true);
  });

  it("I2: resume repairs main: drops an un-gated stray commit and a stale index.lock", async () => {
    const { sh, headSha } = await import("../src/git.ts");
    const first = makeCtx({ scripts: { "dev:T2": (r) => { write(r.cwd, "src/t2.ts", "2"); write(mainOf(r), ".forge/STOP", ""); } } });
    first.ctx.cfg.concurrency = 1;
    await runPipeline(first.ctx);
    const good = loadState(first.dir)!.mainSha!;
    expect(good).toBe(headSha(first.dir));
    writeFileSync(join(first.dir, "stray.txt"), "x");
    sh("git add -A && git commit -qm stray", first.dir);
    writeFileSync(join(first.dir, ".git/index.lock"), "");
    writeFileSync(join(first.dir, "dirty.txt"), "x");
    const { rmSync } = await import("node:fs");
    rmSync(join(first.dir, ".forge/STOP"));
    const second = makeCtx({ dir: first.dir });
    const s = await runPipeline(second.ctx);
    expect(s.phase).toBe("done");
    expect(sh("git log --format=%s", first.dir).out).not.toContain("stray");
    expect(existsSync(join(first.dir, "dirty.txt"))).toBe(false);
  });

  it("I3: QA cannot commit product code to main", async () => {
    const { sh } = await import("../src/git.ts");
    const { ctx, dir } = makeCtx({
      scripts: { qa: (r) => { write(r.cwd, "src/server/evil.ts", "evil"); write(r.cwd, "tests/e2e/F1.spec.ts", "test"); return { output: { score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [] } }; } },
    });
    await runPipeline(ctx);
    const tracked = sh("git ls-files", dir).out;
    expect(tracked).not.toContain("src/server/evil.ts");
    expect(tracked).toContain("tests/e2e/F1.spec.ts");
  });

  it("I4: a QA app that fails to start becomes a fix task; deploy and report still run", async () => {
    let starts = 0;
    const { ctx, dir } = makeCtx();
    ctx.app = { start: async () => { if (++starts === 1) throw new Error("build failed before QA:\nsrc/x.ts error TS2322"); return { url: "http://localhost:9999", stop: async () => {} }; } };
    const s = await runPipeline(ctx);
    expect(s.phase).toBe("done");
    expect(s.qaRounds[0].score).toBe(0);
    expect(s.tasks.some((t) => t.kind === "fix" && /start/i.test(t.title))).toBe(true);
    expect(existsSync(join(dir, "docs/RUN_REPORT.md"))).toBe(true);
  });
});

describe("token efficiency", () => {
  it("defaults the per-task reviewer to haiku and the final reviewer to sonnet", () => {
    expect(DEFAULT_CONFIG.models.reviewer).toBe("haiku");
    expect(DEFAULT_CONFIG.models.final_reviewer).toBe("sonnet");
  });

  it("skips the LLM review for a small diff and reviews a large one", async () => {
    const big = Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const { ctx, runner } = makeCtx({
      scripts: {
        "dev:T1": (r) => { write(r.cwd, "src/server/routes/notes.ts", big); },
        "dev:T3": (r) => { write(r.cwd, "src/server/routes/tags.ts", "export const x = 1;\n"); },
      },
    });
    await runPipeline(ctx);
    expect(runner.callsFor("reviewer", "T1")).toHaveLength(1);
    expect(runner.callsFor("reviewer", "T3")).toHaveLength(0);
    expect(runner.callsFor("reviewer", "T1")[0].prompt).toContain("export const v119 = 119;");
  });

  it("puts the shared context pack (contracts, architecture) first in every dev dispatch", async () => {
    const { ctx, runner } = makeCtx({
      scripts: {
        architect: (r) => {
          write(r.cwd, "docs/tasks.json", JSON.stringify(TASKS));
          write(r.cwd, "docs/architecture.md", "# arch\nNotes live at /api/notes");
          write(r.cwd, "src/shared/contracts.ts", "export const NOTE_CONTRACT_MARKER = 1;");
        },
      },
    });
    await runPipeline(ctx);
    const p = runner.callsFor("dev", "T1")[0].prompt;
    expect(p).toContain("NOTE_CONTRACT_MARKER");
    expect(p).toContain("Notes live at /api/notes");
    expect(p.indexOf("NOTE_CONTRACT_MARKER")).toBeLessThan(p.indexOf("task T1"));
    expect(runner.callsFor("dev", "T3")[0].prompt.slice(0, 200)).toBe(p.slice(0, 200));
  });
});

describe("brief attachments and dependencies", () => {
  it("copies <brief>.files/ into the project as fixtures/", async () => {
    const { ctx, dir } = makeCtx();
    const filesDir = ctx.briefPath.replace(/\.md$/, ".files");
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, "sample-run.jsonl"), '{"kind":"x"}\n');
    await runPipeline(ctx);
    expect(readFileSync(join(dir, "fixtures/sample-run.jsonl"), "utf8")).toContain('"kind":"x"');
  });

  it("lets the architect (only) change package.json", async () => {
    const { ARCHITECT_GLOBS } = await import("../src/phases/design.ts");
    const { matchesGlob } = await import("../src/guard.ts");
    expect(matchesGlob("package.json", ARCHITECT_GLOBS)).toBe(true);
    expect(matchesGlob("package-lock.json", ARCHITECT_GLOBS)).toBe(true);
    expect(matchesGlob("public/assets/sheet.png", ARCHITECT_GLOBS)).toBe(true);
    expect(matchesGlob("src/web/main.tsx", ARCHITECT_GLOBS)).toBe(true);
    expect(matchesGlob("vite.config.ts", ARCHITECT_GLOBS)).toBe(true);
    expect(matchesGlob("src/web/lib/useAuth.ts", ARCHITECT_GLOBS)).toBe(true); // shared web helpers, like src/server/lib
    expect(matchesGlob(".env.example", ARCHITECT_GLOBS)).toBe(true);
  });

  it("a dev's package request: the architect decides, approved ones land on main, the dev continues in its session", async () => {
    const { depsIO } = await import("../src/deps.ts");
    const io = { ...depsIO };
    const installs: string[][] = [];
    depsIO.facts = async (name) => `{"version":"1.9.4","license":"BSD-2-Clause"} (${name})`;
    depsIO.install = (specs, dir) => {
      installs.push(specs);
      const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      for (const s of specs) (p.dependencies ??= {})[s.slice(0, s.lastIndexOf("@"))] = s.slice(s.lastIndexOf("@") + 1);
      writeFileSync(join(dir, "package.json"), JSON.stringify(p));
      return { ok: true, out: "" };
    };
    try {
      const { ctx, runner, dir } = makeCtx({
        scripts: {
          "dev:T2": (r, n) => {
            write(r.cwd, `src/gen/T2-${n}.ts`, "export {};\n");
            if (n === 1) return { output: { status: "DONE_WITH_CONCERNS", summary: "list done, map needs a lib", filesChanged: [], concerns: [], packages: [{ name: "leaflet", why: "map view" }, { name: "moment", why: "dates" }] } };
          },
          "architect:T2": () => ({ output: { decisions: [
            { name: "leaflet", approve: true, version: "1.9.4", reason: "maps", usage: "import L from 'leaflet'; import 'leaflet/dist/leaflet.css'", alternative: "", envVars: [] },
            { name: "moment", approve: false, version: "", reason: "deprecated", usage: "", alternative: "Intl.DateTimeFormat", envVars: [] },
          ] } }),
        },
      });
      const s = await runPipeline(ctx);
      const t2 = s.tasks.find((t) => t.id === "T2")!;
      expect(t2.status).toBe("merged");
      expect(installs).toEqual([["leaflet@1.9.4"]]);
      expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies.leaflet).toBe("1.9.4");
      const devs = runner.callsFor("dev", "T2");
      expect(devs).toHaveLength(2);
      expect(devs[1].resume).toBe("sess-dev:T2-1"); // same session, not an escalation
      expect(devs[1].model).toBe("sonnet");
      expect(devs[1].prompt).toMatch(/leaflet@1\.9\.4: installed\. import L/);
      expect(devs[1].prompt).toMatch(/moment: rejected\. deprecated Use instead: Intl\.DateTimeFormat/);
      expect(runner.callsFor("architect", "T2")[0].prompt).toContain("BSD-2-Clause");
      expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/RULING: install leaflet@1\.9\.4 for T2[\s\S]*RULING: reject moment for T2|RULING: reject moment for T2[\s\S]*RULING: install leaflet/);
    } finally {
      Object.assign(depsIO, io);
    }
  });
});

describe("research phase", () => {
  const withQuestions = (qs: unknown[]) => ({ ...PRD, researchQuestions: qs });
  it("runs one researcher per topic with web MCP servers, indexes results, and shares them with devs", async () => {
    const qs = [
      { id: "R1", topic: "weather-api", question: "Which free weather API needs no key?", why: "F1 data source", consumers: ["architect"], featureIds: ["F1"] },
      { id: "R2", topic: "weather-api", question: "Rate limits?", why: "caching", consumers: ["dev"], featureIds: ["F1"] },
      { id: "R3", topic: "map-tiles", question: "Free map tiles license?", why: "F2", consumers: ["uiux"], featureIds: ["F2"] },
    ];
    const { ctx, runner, dir } = makeCtx({
      scripts: {
        product: (r) => { write(r.cwd, "docs/prd.json", JSON.stringify(withQuestions(qs))); },
        researcher: (r) => {
          write(r.cwd, `docs/research/${r.taskId}.md`, `# ${r.taskId}\nANSWER-${r.taskId}`);
          return { output: { status: "DONE", topic: r.taskId, file: `docs/research/${r.taskId}.md`, summary: `found ${r.taskId}`, findings: [], prdImpact: r.taskId === "map-tiles" ? ["F2: use OSM tiles with attribution"] : [], concerns: [] } };
        },
      },
    });
    await runPipeline(ctx);
    const calls = runner.callsFor("researcher");
    expect(calls.map((c) => c.taskId).sort()).toEqual(["map-tiles", "weather-api"]);
    expect(Object.keys(calls[0].mcpServers ?? {}).sort()).toEqual(["context7", "scrapling"]);
    expect(readFileSync(join(dir, "docs/research/INDEX.md"), "utf8")).toContain("weather-api");
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toContain("F2: use OSM tiles");
    expect(runner.callsFor("dev", "T1")[0].prompt).toContain("found weather-api");
  });

  it("skips research when the PRD has no questions", async () => {
    const { ctx, runner } = makeCtx();
    await runPipeline(ctx);
    expect(runner.callsFor("researcher")).toHaveLength(0);
  });
});

describe("contract gate repair", () => {
  it("lets the repairing architect fix UI/UX-owned files (UI/UX is no longer running)", async () => {
    let n = 0;
    const repairHooks: any[] = [];
    const { ctx } = makeCtx({
      gate: async (cwd) => (!cwd.includes("/wt/") && n++ === 0 ? { ok: false, failed: "typecheck", output: "src/web/components/ui/Input.tsx(3,1): error TS2322", signature: "x" } : { ok: true, output: "" }),
      scripts: { architect: (r, call) => { if (call > 1) repairHooks.push(r.hooks); write(r.cwd, "docs/tasks.json", JSON.stringify(TASKS)); } },
    });
    await runPipeline(ctx);
    expect(repairHooks.length).toBeGreaterThan(0);
    const hook = repairHooks[0].PreToolUse[0].hooks[0];
    const out = await hook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(ctx.dir, "src/web/components/ui/Input.tsx") } }, undefined, { signal: new AbortController().signal });
    expect(out.hookSpecificOutput?.permissionDecision).not.toBe("deny");
  });
});

describe("operator notes", () => {
  it("delivers an inbox note once, to the next dispatch of the matching role", async () => {
    const { ctx, runner, dir } = makeCtx();
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "inbox.jsonl"), JSON.stringify({ id: "n1", ts: 1, role: "dev", text: "prefer small components" }) + "\n");
    await runPipeline(ctx);
    const devPrompts = runner.callsFor("dev").map((c) => c.prompt);
    expect(devPrompts.filter((p) => p.includes("prefer small components"))).toHaveLength(1);
    expect(runner.callsFor("product")[0].prompt).not.toContain("prefer small components");
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/operator → dev/);
  });
});

describe("visual QA", () => {
  it("a weak visual score gets one whole-app design pass on opus, then per-issue fixes", async () => {
    const weak = (title: string) => ({ score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [],
      visual: { score: 6, issues: [{ title, fix: "fix it", suspectedFiles: ["src/web/components/stage/Machine.tsx"] }] } });
    const { ctx, runner } = makeCtx({
      scripts: {
        qa: (_r, call) => ({
          output: call === 1 ? weak("Header ignores the design") : call === 2 ? weak("Machines have no labels")
            : { score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [], visual: { score: 8, issues: [] } },
        }),
      },
    });
    const s = await runPipeline(ctx);
    expect(s.qaRounds).toHaveLength(3);
    const design = s.tasks.find((t) => t.id === "DESIGN1")!;
    expect(design.description).toMatch(/docs\/design\.md/);
    expect(design.description).toMatch(/Header ignores the design/);
    expect(design.lanes).toEqual(["src/web/**", "tests/unit/**"]);
    expect(runner.callsFor("dev").find((c) => c.prompt.includes("DESIGN1"))?.model).toBe(ctx.cfg.escalationModel);
    // only once per run: the next weak score is fixed issue by issue
    const fix = s.tasks.find((t) => t.kind === "fix" && t.id.startsWith("FIX"))!;
    expect(fix.title).toMatch(/no labels/);
    // QA guessed a file the fake app does not have: the fix may touch all of src
    expect(fix.lanes).toEqual(["src/**"]);
    expect(s.tasks.filter((t) => t.id.startsWith("DESIGN"))).toHaveLength(1);
    expect(runner.callsFor("qa")[0].prompt).toMatch(/screenshot/i);
  });
});

describe("forge iterate", () => {
  it("adds operator fix tasks to a finished run and reopens build → report", async () => {
    const { iterate } = await import("../src/iterate.ts");
    const first = makeCtx();
    await runPipeline(first.ctx);
    const s = loadState(first.dir)!;
    const added = iterate(s, ["Add bloom to machines", "Fix overlapping QA gauge"]);
    expect(added.map((t) => t.id)).toEqual(["IT1-1", "IT1-2"]);
    expect(added[1].deps).toEqual(["IT1-1"]);
    expect(s.done).not.toContain("build");
    expect(s.done).not.toContain("qa");
    expect(s.qaRounds).toEqual([]);
    expect(s.phase).toBe("build");
  });
});

describe("lanes vs read-only config", () => {
  it("a task whose lanes name a config file may change it (core files stay protected)", async () => {
    const tasks = { tasks: [{ id: "T1", title: "proxy", description: "d", deps: [], lanes: ["vite.config.ts"], acceptance: [], featureIds: ["F1"] }] };
    const { ctx, dir } = makeCtx({
      scripts: {
        architect: (r) => { write(r.cwd, "docs/tasks.json", JSON.stringify(tasks)); },
        "dev:T1": (r) => { write(r.cwd, "vite.config.ts", "export default { proxy: 1 };\n"); write(r.cwd, "docs/prd.json", "HACK"); },
      },
    });
    await runPipeline(ctx);
    expect(readFileSync(join(dir, "vite.config.ts"), "utf8")).toContain("proxy: 1");
    expect(readFileSync(join(dir, "docs/prd.json"), "utf8")).not.toContain("HACK");
  });
});

describe("QA report nudge", () => {
  it("re-asks the same QA session for the report once when it ends without one", async () => {
    const { ctx, runner } = makeCtx({
      scripts: {
        qa: (_r, call) => (call === 1 ? { ok: false, subtype: "success", error: "invalid_output: missing", sessionId: "qa-sess", output: undefined } : { output: { score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [], visual: { score: 9, issues: [] } } }),
      },
    });
    const s = await runPipeline(ctx);
    const qa = runner.callsFor("qa");
    expect(qa).toHaveLength(2);
    expect(qa[1].resume).toBe("qa-sess");
    expect(s.qaRounds).toEqual([{ round: 1, score: 8, failures: 0 }]);
  });

  it("asks the same session for the visual score when the report has none", async () => {
    const ok = { score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [] };
    const { ctx, runner, dir } = makeCtx({
      scripts: { qa: (_r, call) => (call === 1 ? { output: ok, sessionId: "qa-sess" } : { output: { ...ok, visual: { score: 9, issues: [] } } }) },
    });
    await runPipeline(ctx);
    const qa = runner.callsFor("qa");
    expect(qa).toHaveLength(2);
    expect(qa[1].resume).toBe("qa-sess");
    expect(JSON.parse(readFileSync(join(dir, ".forge/qa/round-1.json"), "utf8")).visual.score).toBe(9);
  });
});

describe("QA polish round", () => {
  it("fixes known issues once even when QA passes, then stops", async () => {
    const feats = [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }];
    const bug = { title: "Menu label low contrast", steps: "open /", expected: "readable", actual: "dark on dark", suspectedFiles: ["src/web/App.tsx"] };
    const { ctx, runner } = makeCtx({
      scripts: { qa: (_r, call) => ({ output: { score: 8, features: feats, failures: call === 1 ? [bug] : [bug], visual: { score: 9, issues: [] } } }) },
    });
    const s = await runPipeline(ctx);
    expect(runner.callsFor("qa")).toHaveLength(2);
    expect(s.tasks.filter((t) => t.kind === "fix").map((t) => t.title)).toEqual(["Menu label low contrast"]);
  });
});

describe("QA under budget", () => {
  it("stops QA (with a ruling) instead of running rounds it can't afford", async () => {
    const { ctx, runner, dir } = makeCtx({ cfg: { budgetUsd: 4 } });
    ctx.state.spend.usd = 3.5;
    await runPipeline(ctx);
    expect(runner.callsFor("qa")).toHaveLength(0);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/RULING: stop QA — budget/);
  });
});

describe("QA test files must typecheck", () => {
  it("reverts a QA e2e file that breaks typecheck instead of committing it", async () => {
    const { sh } = await import("../src/git.ts");
    const { ctx, dir } = makeCtx({
      scripts: { qa: (r) => { write(r.cwd, "tests/e2e/bad.spec.ts", "const x: number = 'nope';\n"); write(r.cwd, "tests/e2e/good.spec.ts", "export {};\n"); return { output: { score: 8, features: [{ id: "F1", passes: true, evidence: "" }, { id: "F2", passes: true, evidence: "" }], failures: [] } }; } },
      gate: async (cwd, steps) => {
        const { existsSync: ex } = await import("node:fs");
        if (steps?.includes("typecheck") && steps.length === 1 && ex(join(cwd, "tests/e2e/bad.spec.ts"))) return { ok: false, failed: "typecheck", output: "tests/e2e/bad.spec.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.", signature: "x" };
        return { ok: true, output: "" };
      },
    });
    await runPipeline(ctx);
    const tracked = sh("git ls-files", dir).out;
    expect(tracked).not.toContain("tests/e2e/bad.spec.ts");
    expect(tracked).toContain("tests/e2e/good.spec.ts");
  });
});

describe("systemic failure breaker", () => {
  it("stops the build when 2 different tasks fail with the same error, instead of parking everything", async () => {
    const { ctx, runner, dir } = makeCtx({
      gate: async (cwd) => (cwd.includes("/wt/") ? { ok: false, failed: "lint", output: "tests/e2e/x.spec.ts 22:1 error no-require-imports", signature: "lint:e2e-require" } : { ok: true, output: "" }),
    });
    const s = await runPipeline(ctx);
    expect(s.phase).toBe("build");
    expect(s.tasks.filter((t) => t.status === "parked")).toHaveLength(0);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toMatch(/systemic/i);
    expect(runner.callsFor("dev").length).toBeLessThanOrEqual(6);
  });
});

describe("operator backlog requests", () => {
  it("turns queued requests into tasks during the build", async () => {
    const { ctx, runner, dir } = makeCtx({
      scripts: { "dev:T1": (r) => { write(join(r.cwd, "..", "..", ".."), ".forge/requests.jsonl", JSON.stringify({ id: "q1", ts: 1, title: "Add zoom", description: "wheel zoom" }) + "\n"); write(r.cwd, "src/a.ts", "x"); } },
    });
    const s = await runPipeline(ctx);
    const req = s.tasks.find((t) => t.title === "Add zoom")!;
    expect(req.status).toBe("merged");
    expect(runner.callsFor("dev", req.id)[0].prompt).toContain("wheel zoom");
  });

  it("a finished run reopens build for requests on resume", async () => {
    const { pendingRequests, takeRequests } = await import("../src/requests.ts");
    const first = makeCtx();
    await runPipeline(first.ctx);
    writeFileSync(join(first.dir, ".forge", "requests.jsonl"), JSON.stringify({ id: "q2", ts: 1, title: "Dark mode" }) + "\n");
    const s = loadState(first.dir)!;
    expect(pendingRequests(first.dir, s)).toHaveLength(1);
    const added = takeRequests(first.dir, s);
    expect(added[0].title).toBe("Dark mode");
    expect(pendingRequests(first.dir, s)).toHaveLength(0);
  });
});

describe("cross-run lessons", () => {
  it("the learner reinforces a seed lesson from this run's mistakes, and lessons reach the role prompt", async () => {
    const { loadLessons } = await import("../src/lessons.ts");
    const before = loadLessons().find((l) => l.id === "reviewer-judge-lanes-only")!.confidence;
    const { ctx, dir, runner } = makeCtx({
      gate: async (cwd) => ({ ok: !cwd.includes("T1") || runner.callsFor("dev", "T1").length > 1, output: "lint failed", failed: "lint" }),
      scripts: { learner: () => ({ output: { reinforce: [{ id: "reviewer-judge-lanes-only", evidence: "T1 rejected" }], contradict: [], add: [{ id: "dev-run-lint-first", role: "dev", trigger: "Before finishing", lesson: "Run npm run lint.", evidence: "T1 gate/fail" }] } }) },
    });
    await runPipeline(ctx);
    const after = loadLessons();
    expect(after.find((l) => l.id === "reviewer-judge-lanes-only")!.confidence).toBeCloseTo(before + 0.15, 2);
    expect(after.find((l) => l.id === "dev-run-lint-first")).toMatchObject({ status: "candidate", confidence: 0.3 });
    expect(readFileSync(join(dir, "docs/RUN_REPORT.md"), "utf8")).toContain("new: dev-run-lint-first");
    const learnerCall = runner.callsFor("learner")[0];
    expect(learnerCall.prompt).toContain("gate/fail");
  });
});


describe("PRD critic and three-state QA", () => {
  it("sends uncovered brief requirements back to Product once, and the report traces brief → features → status", async () => {
    const { ctx, dir, runner } = makeCtx({
      scripts: {
        critic: () => ({ output: { coverage: [{ requirement: "Users can add notes", featureIds: ["F1"] }, { requirement: "Export to CSV", featureIds: [] }], uncovered: ["Export to CSV"], invented: [] } }),
        qa: () => ({ output: { score: 8, features: [{ id: "F1", passes: true, status: "working", evidence: "ok" }], failures: [] } }),
      },
    });
    await runPipeline(ctx);
    const product = runner.callsFor("product");
    expect(product).toHaveLength(2);
    expect(product[1].prompt).toContain("Not covered: Export to CSV");
    expect(product[1].prompt).toContain("needs changes");
    expect(runner.callsFor("critic")).toHaveLength(2);
    const report = readFileSync(join(dir, "docs/RUN_REPORT.md"), "utf8");
    expect(report).toContain("### Brief requirements");
    expect(report).toMatch(/Export to CSV \| - \| ❌ not planned/);
    expect(report).toMatch(/Users can add notes \| F1 \| ✅ working/);
  });

  it("a partial feature does not count as working", async () => {
    const { works } = await import("../src/phases/qa.ts");
    expect(works({ passes: true, status: "partial" })).toBe(false);
    expect(works({ passes: true })).toBe(true);
    expect(works({ passes: false, status: "working" })).toBe(true);
  });
});

describe("clarify: ask the client, never block", () => {
  const prdWith = (r: { cwd: string }) => {
    const prd = JSON.parse(readFileSync(join(r.cwd, "docs/prd.json"), "utf8"));
    write(r.cwd, "docs/prd.json", JSON.stringify({ ...prd, openQuestions: [{ id: "Q1", question: "Do todos need due dates?", assumption: "no due dates", featureIds: [] }] }));
  };
  it("with no wait, proceeds on the stated assumptions and records them as rulings and in the report", async () => {
    const { ctx, dir } = makeCtx({ scripts: { product: (r, n) => { if (n === 1) { baseScripts({}).product!(r, n); prdWith(r); } } } });
    await runPipeline(ctx);
    expect(readFileSync(join(dir, ".forge/ledger.md"), "utf8")).toContain("RULING: assume: no due dates");
    expect(readFileSync(join(dir, "docs/RUN_REPORT.md"), "utf8")).toContain("Q1: Do todos need due dates? → assumed: no due dates");
  });
  it("an operator answer sent while Product works triggers one PRD revision with the answer", async () => {
    const { addNote } = await import("../src/inbox.ts");
    const { ctx, dir, runner } = makeCtx({ cfg: { clarifyMinutes: 1 }, scripts: { product: (r, n) => { if (n === 1) { baseScripts({}).product!(r, n); prdWith(r); addNote(dir, { role: "product", text: "Q1: yes, due dates please" }); } } } });
    await runPipeline(ctx);
    const calls = runner.callsFor("product");
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("Q1: yes, due dates please");
  });
});

describe("stack check", () => {
  const critic = () => ({ output: { coverage: [], uncovered: [], invented: [], stackConflicts: ["must be written in Django"] } });
  it("stops before design when the brief needs another stack, and --accept-stack continues", async () => {
    const first = makeCtx({ scripts: { critic } });
    const s = await runPipeline(first.ctx);
    expect(s.phase).toBe("research");
    expect(first.runner.callsFor("architect")).toHaveLength(0);
    expect(readFileSync(join(first.dir, ".forge/ledger.md"), "utf8")).toContain("RULING: stop before design");
    const { rmSync } = await import("node:fs");
    rmSync(join(first.dir, ".forge/STOP"));
    const again = makeCtx({ dir: first.dir, cfg: { acceptStack: true }, scripts: { critic } });
    const s2 = await runPipeline(again.ctx);
    expect(s2.phase).toBe("done");
    expect(readFileSync(join(first.dir, ".forge/ledger.md"), "utf8")).toContain("RULING: build on the house stack");
  });
});
