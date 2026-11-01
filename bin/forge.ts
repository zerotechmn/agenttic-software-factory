#!/usr/bin/env -S npx tsx
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SdkAgentRunner } from "../src/agent.ts";
import { startApp } from "../src/appRunner.ts";
import { Budget } from "../src/budget.ts";
import { runGate } from "../src/checks.ts";
import { FACTORY_ROOT, loadConfig, type FactoryConfig } from "../src/config.ts";
import { stopFile, type Ctx } from "../src/ctx.ts";
import { EventBus } from "../src/events.ts";
import { ledger } from "../src/ledger.ts";
import { runPipeline } from "../src/pipeline.ts";
import { renderReport } from "../src/phases/report.ts";
import { startServer } from "../src/server.ts";
import { loadState, newState, retryParked, saveState } from "../src/state.ts";
import type { ForgeEvent } from "../src/types.ts";
import { exportAgents } from "../src/exportAgents.ts";
import { iterate } from "../src/iterate.ts";
import { formatDoctor, runDoctor } from "../src/doctor.ts";
import { reopenForRequests } from "../src/requests.ts";
import { loadLessons, promotable, promote, saveLessons } from "../src/lessons.ts";

const USAGE = `forge — autonomous software factory

  forge run <brief.md> [--out DIR] [--from EXISTING_APP_DIR] [--budget USD] [--deadline ISO] [--concurrency N]
                       [--no-serve] [--no-local] [--verbose] [--model-<role> MODEL]
  forge resume <dir> [--budget USD] [--retry-parked] [--no-serve] [--verbose]
  forge iterate <dir> "improvement 1" "improvement 2" … [--lanes "src/web/**,src/server/**"]   (then: forge resume <dir>)
  forge doctor                      check this machine: Node, API key, skills, Playwright, Docker, ports
  forge status <dir>
  forge stop <dir>
  forge serve <dir> [--port N]
  forge console [--root ~/forge-runs] [--port 4300]   (FORGE Office as the main console; localhost only)
  forge export-agents <dir>
  forge report <dir>
  forge lessons [promote <id>]     cross-run lessons (confidence-scored)
`;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !k.startsWith("no-") && !["verbose", "retry-parked", "keep-serving"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function overridesFrom(flags: Record<string, string | boolean>): Partial<FactoryConfig> {
  const o: Partial<Omit<FactoryConfig, "models">> & { models?: Record<string, string> } = {};
  if (flags.budget) o.budgetUsd = Number(flags.budget);
  if (flags.deadline) o.deadline = String(flags.deadline);
  if (flags.concurrency) o.concurrency = Number(flags.concurrency);
  if (flags["clarify-minutes"] !== undefined) o.clarifyMinutes = Number(flags["clarify-minutes"]);
  if (flags["accept-stack"]) o.acceptStack = true;
  for (const [k, v] of Object.entries(flags)) if (k.startsWith("model-")) (o.models ??= {})[k.slice(6)] = String(v);
  return o as Partial<FactoryConfig>;
}

const C = { dim: "\x1b[2m", reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m", bold: "\x1b[1m" };

function printer(verbose: boolean) {
  return (e: ForgeEvent) => {
    const quiet = ["say", "tool", "retry"].includes(e.kind);
    if (quiet && !verbose) return;
    const time = new Date(e.ts).toTimeString().slice(0, 8);
    const who = e.agentId ?? e.taskId ?? "";
    const color =
      e.kind === "ruling" ? C.magenta : e.kind.includes("fail") || e.status === "fail" || e.kind === "run_error" ? C.red
      : e.kind === "phase_start" || e.kind === "run_done" ? C.bold + C.cyan
      : e.status === "merged" || e.status === "pass" || e.status === "ok" ? C.green
      : e.kind === "landing" || e.kind === "guard_deny" ? C.yellow : "";
    const cost = e.usd ? ` ${C.dim}$${e.usd.toFixed(3)}${C.reset}` : "";
    const text = (e.text || e.status || "").replace(/\s+/g, " ").slice(0, 160);
    console.log(`${C.dim}${time}${C.reset} ${color}${e.phase.padEnd(13)} ${e.kind.padEnd(12)}${C.reset} ${who.padEnd(14)} ${text}${cost}`);
  };
}

async function execute(dir: string, briefPath: string, flags: Record<string, string | boolean>) {
  const cfg = loadConfig(dir);
  const state = loadState(dir) ?? newState(`${basename(dir)}-${Date.now().toString(36)}`);
  const bus = new EventBus(join(dir, ".forge", "events.jsonl"), state.run);
  bus.subscribe(printer(!!flags.verbose));
  const budget = new Budget(cfg, state);
  const runner = new SdkAgentRunner(bus, budget, () => state.phase);
  runner.shouldAbort = () => existsSync(stopFile(dir));
  if (flags["max-pause-min"]) runner.maxPauseMs = Number(flags["max-pause-min"]) * 60_000;
  const ctx: Ctx = {
    dir, briefPath, cfg, state, bus, budget,
    runner,
    ledger: ledger(dir, bus, () => state.phase),
    gate: runGate,
    app: { start: startApp },
    templateDir: existsSync(join(dir, ".forge", "template")) ? readFileSync(join(dir, ".forge", "template"), "utf8").trim() : join(FACTORY_ROOT, "templates", "house"),
    install: true,
    local: !flags["no-local"] && cfg.local.enabled,
    save: () => {},
  };
  const srv = flags["no-serve"] ? null : await startServer(dir, bus, cfg.port).catch(() => startServer(dir, bus, 0));
  if (srv) console.log(`${C.bold}monitor:${C.reset} ${srv.url}`);
  let interrupts = 0;
  process.on("SIGINT", () => {
    if (++interrupts > 1) process.exit(130);
    writeFileSync(stopFile(dir), "");
    console.log(`\n${C.yellow}stopping at the next checkpoint (Ctrl-C again to kill). Resume with: forge resume ${dir}${C.reset}`);
  });
  // the console uses this to show which runs are alive
  const pidFile = join(dir, ".forge", "pid");
  writeFileSync(pidFile, String(process.pid));
  try {
    const final = await runPipeline(ctx);
    console.log(`\n${C.bold}phase: ${final.phase}${C.reset}  spend $${final.spend.usd.toFixed(2)} / $${cfg.budgetUsd}  → ${join(dir, "docs", "RUN_REPORT.md")}`);
  } finally {
    rmSync(pidFile, { force: true });
    if (srv && !flags["keep-serving"]) await srv.close();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  switch (cmd) {
    case "run": {
      const brief = pos[0] && resolve(pos[0]);
      if (!brief || !existsSync(brief)) throw new Error("forge run <brief.md>: brief file not found");
      const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");
      const dir = resolve(String(flags.out ?? join(homedir(), "forge-runs", `${basename(brief, ".md")}-${stamp}`)));
      if (loadState(dir)) throw new Error(`${dir} already has a run; use: forge resume ${dir}`);
      mkdirSync(join(dir, ".forge"), { recursive: true });
      writeFileSync(join(dir, ".forge", "config.json"), JSON.stringify(overridesFrom(flags), null, 2));
      // --from <dir>: improve an existing app instead of starting from the house template
      if (flags.from) writeFileSync(join(dir, ".forge", "template"), resolve(String(flags.from)));
      writeFileSync(join(dir, ".forge", "brief.md"), readFileSync(brief, "utf8"));
      const attachments = brief.replace(/\.md$/, ".files");
      if (existsSync(attachments)) cpSync(attachments, join(dir, ".forge", "brief.files"), { recursive: true });
      console.log(`${C.bold}FORGE${C.reset} building into ${dir}`);
      return execute(dir, join(dir, ".forge", "brief.md"), flags);
    }
    case "resume": {
      const dir = resolve(pos[0] ?? ".");
      if (!loadState(dir)) throw new Error(`no run found in ${dir}`);
      const cfgPath = join(dir, ".forge", "config.json");
      const saved = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
      writeFileSync(cfgPath, JSON.stringify({ ...saved, ...overridesFrom(flags) }, null, 2));
      const stop = stopFile(dir);
      if (existsSync(stop)) (await import("node:fs")).rmSync(stop);
      {
        const s = loadState(dir)!;
        const added = reopenForRequests(dir, s);
        (s.interventions ??= []).push({ at: Date.now(), kind: "resume", text: `phase ${s.phase}` });
        saveState(dir, s);
        if (added.length) {
          saveState(dir, s);
          console.log(`added ${added.length} operator request(s): ${added.map((t) => t.id).join(", ")}`);
        }
      }
      if (flags["retry-parked"]) {
        const s = loadState(dir)!;
        const n = retryParked(s);
        if (n) (s.interventions ??= []).push({ at: Date.now(), kind: "retry_parked", text: `${n} task(s)` });
        if (s.phase === "done") s.phase = "build";
        saveState(dir, s);
        console.log(`re-queued ${n} parked task(s)`);
      }
      return execute(dir, join(dir, ".forge", "brief.md"), flags);
    }
    case "iterate": {
      const dir = resolve(pos[0] ?? ".");
      const s = loadState(dir);
      if (!s) throw new Error(`no run found in ${dir}`);
      const issues = pos.slice(1);
      if (!issues.length) throw new Error('forge iterate <dir> "what to improve" …');
      const added = iterate(s, issues, flags.lanes ? String(flags.lanes).split(",") : undefined);
      (s.interventions ??= []).push({ at: Date.now(), kind: "iterate", text: issues.join("; ").slice(0, 300) });
      saveState(dir, s);
      console.log(`added ${added.map((t) => t.id).join(", ")}; run: forge resume ${dir}`);
      return;
    }
    case "lessons": {
      const lessons = loadLessons();
      if (pos[0] === "promote") {
        if (!pos[1]) throw new Error("forge lessons promote <id>");
        const l = promote(pos[1], lessons);
        saveLessons(lessons);
        console.log(`promoted ${l.id} into roles/${l.role}.md`);
        return;
      }
      const ready = new Set(promotable(lessons).map((l) => l.id));
      for (const l of [...lessons].sort((a, b) => b.confidence - a.confidence))
        console.log(`${l.status.padEnd(9)} ${l.confidence.toFixed(2)}  ${l.role.padEnd(10)} ${l.id}${ready.has(l.id) ? "  (ready to promote)" : ""}  runs:${l.runs.length}`);
      return;
    }
    case "doctor": {
      const r = formatDoctor(await runDoctor());
      console.log(r.text);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "status": {
      const dir = resolve(pos[0] ?? ".");
      const s = loadState(dir);
      if (!s) throw new Error(`no run found in ${dir}`);
      const cfg = loadConfig(dir);
      console.log(`run ${s.run} · phase ${s.phase} · $${s.spend.usd.toFixed(2)}/$${cfg.budgetUsd}${s.landing ? " · LANDING" : ""}`);
      for (const t of s.tasks) console.log(`  ${t.status.padEnd(8)} ${t.id.padEnd(8)} ${t.title}  (${t.attempts} attempts${t.escalated ? ", escalated" : ""})`);
      for (const r of s.qaRounds) console.log(`  QA round ${r.round}: score ${r.score}, ${r.failures} failures`);
      return;
    }
    case "stop": {
      const dir = resolve(pos[0] ?? ".");
      writeFileSync(stopFile(dir), "");
      console.log("STOP requested; the run halts at the next checkpoint.");
      return;
    }
    case "serve": {
      const dir = resolve(pos[0] ?? ".");
      const srv = await startServer(dir, null, Number(flags.port ?? loadConfig(dir).port));
      console.log(`monitor: ${srv.url}`);
      return new Promise(() => {});
    }
    case "console": {
      const root = resolve(String(flags.root ?? join(homedir(), "forge-runs")));
      const { startConsole, defaultSpawn } = await import("../src/console/server.ts");
      const { createAssistant } = await import("../src/console/assistant.ts");
      const { ClaudeFeed } = await import("../src/console/claude.ts");
      const spawn = defaultSpawn(root);
      // the assistant is read-only and can only propose runs; the operator confirms them in the UI
      const srv = await startConsole({ root, port: Number(flags.port ?? 4300), spawn, ask: createAssistant({ root, spawn }), claude: new ClaudeFeed(root), dialogue: (await import("../src/console/dialogue.ts")).createDialogue({ runDir: (run) => join(root, run) }) });
      console.log(`${C.bold}FORGE console:${C.reset} ${srv.url}/office/  (runs in ${root})`);
      return new Promise(() => {});
    }
    case "export-agents": {
      const dir = resolve(pos[0] ?? ".");
      console.log(exportAgents(dir).map((f) => `wrote ${f}`).join("\n"));
      return;
    }
    case "report": {
      const dir = resolve(pos[0] ?? ".");
      const s = loadState(dir);
      if (!s) throw new Error(`no run found in ${dir}`);
      const md = existsSync(join(dir, "docs", "RUN_REPORT.md"))
        ? readFileSync(join(dir, "docs", "RUN_REPORT.md"), "utf8")
        : renderReport({ dir, state: s, cfg: loadConfig(dir) } as Ctx);
      console.log(md);
      return;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((e) => {
  console.error(`${C.red}forge: ${(e as Error).message}${C.reset}`);
  process.exit(1);
});
