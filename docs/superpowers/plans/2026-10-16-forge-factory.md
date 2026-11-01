# FORGE Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `forge` CLI that turns `brief.md` into a tested, Docker-deployed app via role agents, with bounded self-correction, budgets, resume and a live event stream.

**Architecture:** A deterministic TypeScript state machine (orchestrator) calls one Claude Agent SDK `query()` per agent invocation through an injectable `AgentRunner`. That makes the whole pipeline testable with a fake runner and zero tokens. Files in the target project are the handoff bus. Everything emits events to `.forge/events.jsonl` + SSE.

**Tech Stack:** Node 20+, TypeScript (ESM, run with `tsx`), `@anthropic-ai/claude-agent-sdk@0.3.301`, `zod@4`, `vitest`. House template: Vite + React + Tailwind + Hono + SQLite/Drizzle + Vitest + Playwright + Docker.

**Spec:** `docs/superpowers/specs/2026-10-16-agent-factory-design.md`

## Global Constraints
- The repo lives at `~/factory`; generated projects default to `~/forge-runs/<slug>` (outside the factory repo).
- Every agent call sets `model` explicitly, `settingSources: ['project']`, `maxTurns`, `maxBudgetUsd`, and `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`, with safety from our `canUseTool` guard.
- Implementer agents have `disallowedTools: ['Agent','Task']`.
- Fix caps: same dev ≤3 attempts, escalated (opus, fresh) ≤2, then a ruling. QA rounds ≤4, plateau stop after 2 rounds without score gain. Final review is 1 round.
- Landing mode at ≥80% of budget or within `landingMinutes` (default 90) of the deadline.
- Transient API errors are retried 3× with backoff 2s/8s/30s.
- Default concurrency is 3 devs.
- SSE/monitor port is 4317.
- Local LLM: `gemma4:latest` at `http://localhost:11434`, 60s timeout, fallback haiku.
- No `git push`, no network deploys, no writes outside the project dir (or `~/forge-runs` + worktrees).

## Review Focus
1. Orchestrator killed mid-task → `forge resume` must not re-run merged tasks and must clean or reuse stale worktrees (test in Task 9).
2. Agent returns invalid/missing structured output → treated as a failed attempt with the reason recorded, never a crash (Task 5).
3. Ollama not running → local calls fall back silently and are counted as non-local (Task 4).
4. Two tasks declare overlapping file lanes → the contract gate fails with the pair listed, and the Architect gets one repair round (Task 7).
5. Budget exhausted mid-build → landing mode stops new features, the run still deploys what's merged and writes a report (Task 9).

---

### Task 1: Scaffold factory + core types, config, events, ledger, state

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/config.ts`, `src/events.ts`, `src/ledger.ts`, `src/state.ts`, `tests/state.test.ts`, `tests/events.test.ts`

**Interfaces — Produces:**
- `types.ts`: `Role = 'product'|'architect'|'uiux'|'dev'|'reviewer'|'integrator'|'qa'|'final_reviewer'|'devops'|'reporter'`; `Phase = 'intake'|'product'|'design'|'contract_gate'|'build'|'qa'|'final_review'|'deploy'|'report'|'done'`; `TaskStatus = 'backlog'|'ready'|'running'|'review'|'blocked'|'merged'|'parked'`; `Task {id, title, description, deps: string[], lanes: string[], acceptance: string[], kind: 'feature'|'fix'|'contract', status, attempts: number, escalations: number, lastSignature?: string, branch?: string, featureIds: string[]}`; `ForgeEvent {ts, run, phase, role?, agentId?, taskId?, kind: string, model?, tokensIn?, tokensOut?, cacheRead?, usd?, status?, text?, data?}`.
- `config.ts`: `FactoryConfig {models: Record<Role,string>, escalationModel, budgetUsd, phaseBudgetPct: Record<Phase,number>, concurrency, deadline?: string, landingMinutes, local: {enabled, host, model}, port, maxQaRounds, maxDevAttempts: 3, maxEscalations: 2}`; `loadConfig(projectDir, overrides?): FactoryConfig` (defaults ← `<factory>/forge.config.json` ← `<project>/.forge/config.json` ← overrides).
- `events.ts`: `class EventBus { constructor(file: string, run: string); emit(e: Omit<ForgeEvent,'ts'|'run'>): ForgeEvent; subscribe(fn): () => void; static readAll(file): ForgeEvent[] }`. It appends JSONL synchronously.
- `ledger.ts`: `ledger(projectDir).ruling(decision, why, costIfWrong)`, `.note(text)`; appends to `.forge/ledger.md` and emits event kind `ruling`/`note`.
- `state.ts`: `RunState {run, phase, startedAt, tasks: Task[], qaRounds: {round, score, failures}[], spend: {usd, byRole: Record<string,number>, local: number, remote: number}, landing: boolean, done: Phase[]}`; `loadState(dir): RunState|null`, `saveState(dir, s)` (atomic write via tmp+rename), `newState(run)`.

- [ ] Step 1: `npm init`, install deps (`@anthropic-ai/claude-agent-sdk@0.3.301 zod tsx typescript vitest @types/node`), ESM, strict TS.
- [ ] Step 2: tests: `saveState` then `loadState` round-trips; a crash mid-write (simulate a leftover tmp file) still loads the last good state; `EventBus.emit` appends one line per event and notifies subscribers; `readAll` skips a corrupt trailing line.
- [ ] Step 3: implement; `npx vitest run` PASS; commit `feat: core types, config, events, state`.

### Task 2: Budget + guard

**Files:** Create `src/budget.ts`, `src/guard.ts`, `tests/budget.test.ts`, `tests/guard.test.ts`

**Interfaces — Produces:**
- `class Budget { constructor(cfg: FactoryConfig, state: RunState); record(role: string, usd: number, local?: boolean): void; remaining(): number; phaseRemaining(p: Phase): number; perCallCap(role: Role, p: Phase): number; shouldLand(now?: Date): boolean }`. `perCallCap` = min(phaseRemaining, budgetUsd*0.08), floor $0.05.
- `makeGuard(policy: {root: string; writable: string[]; readonlyGlobs: string[]; allowBash: boolean}): CanUseTool` (SDK `canUseTool` signature `(toolName, input, {signal}) => Promise<{behavior:'allow', updatedInput} | {behavior:'deny', message}>`).

Guard rules: Write/Edit/MultiEdit/NotebookEdit `file_path` must resolve inside one of `writable` and match none of `readonlyGlobs`. Bash denies `git push`, `rm -rf /`, `rm -rf ~`, `sudo`, `curl … | sh`, and any `cd` / absolute path outside root (heuristic: any absolute path token not under root, `/tmp` or `/dev/null`). WebFetch/WebSearch are allowed.

- [ ] Step 1: tests: landing triggers at 80% spend; landing triggers at deadline − landingMinutes; guard denies writing `docs/prd.json` for dev policy, denies `/etc/hosts`, allows `src/x.ts`, denies `git push origin main`, allows `npm test`.
- [ ] Step 2: implement; PASS; commit `feat: budget and tool guard`.

### Task 3: Roles + schemas

**Files:** Create `roles/{product,architect,uiux,dev,reviewer,integrator,qa,final_reviewer,devops}.md`, `src/roles.ts`, `src/schemas.ts`, `tests/roles.test.ts`

**Interfaces — Produces:**
- Role file = YAML-ish frontmatter (`model`, `maxTurns`, `tools` comma list) + markdown body (mission, owns, must-not-touch, inputs, outputs, done criteria).
- `loadRole(name: Role): {name, model?, maxTurns: number, tools?: string[], body: string}`.
- `schemas.ts` (zod + `toJsonSchema()` via `z.toJSONSchema`): `AgentStatus {status: 'DONE'|'DONE_WITH_CONCERNS'|'BLOCKED'|'NEEDS_CONTEXT', summary, filesChanged: string[], concerns: string[]}`; `Prd {product, features: {id, title, priority: 'must'|'should'|'could', story, acceptance: string[], passes: boolean}[]}`; `TaskPlan {tasks: {id, title, description, deps, lanes, acceptance, featureIds}[]}`; `ReviewVerdict {verdict: 'approve'|'reject', issues: {severity: 'critical'|'major'|'minor', file?, message, fix}[]}`; `QaReport {score: number (0-10), features: {id, passes: boolean, evidence}[], failures: {title, steps, expected, actual, suspectedFiles: string[]}[]}`.

Role prompts must state the handoff file each role writes (Product → `docs/prd.json`+`docs/prd.md`+`.forge/holdout/scenarios.md`; Architect → `docs/architecture.md`, `src/shared/contracts.ts`, `src/server/db/schema.ts`, `docs/tasks.json`; UI/UX → `docs/design.md`, `src/web/theme.css`; Dev → code + tests in lanes, report file; QA → `tests/e2e/*.spec.ts` + `.forge/qa/round-N.json`; DevOps → Dockerfile tweaks + `.forge/deploy.json`).

- [ ] Step 1: test: every role in `Role` (except reporter) loads, has a body > 200 chars and maxTurns > 0; each schema's JSON Schema has `type: 'object'`.
- [ ] Step 2: write the role files (use `docs/research/02-prior-art.md` §6 rules), implement; PASS; commit `feat: role definitions and output schemas`.

### Task 4: Local LLM tier

**Files:** Create `src/local.ts`, `tests/local.test.ts`

**Interfaces — Produces:** `localLLM(opts: {prompt: string; system?: string; schema?: object; maxChars?: number}, deps?: {fetch?: typeof fetch; fallback?: (prompt) => Promise<string>}): Promise<{text: string; local: boolean}>`; `compressFailure(raw: string, deps?): Promise<string>`: if raw ≤ 3000 chars return it unchanged; else return the last 60 lines plus the first error block, plus local summary when available (never more than 4000 chars).

- [ ] Step 1: tests: with a fetch stub returning `{message:{content:'hi'}}` → `{text:'hi', local:true}`; fetch throws → fallback used, `local:false`; `compressFailure` output ≤ 4000 chars and contains the line with `Error:`.
- [ ] Step 2: implement (POST `/api/chat`, `stream:false`, `think:false`, `format: schema`, `keep_alive:'30m'`, AbortSignal 60s); PASS; commit.

### Task 5: Agent runner

**Files:** Create `src/agent.ts`, `tests/agent.test.ts`

**Interfaces — Consumes:** Budget, EventBus, roles, schemas, guard. **Produces:**
- `interface AgentRunner { run(req: AgentRequest): Promise<AgentResult> }`
- `AgentRequest {role: Role, taskId?: string, cwd: string, prompt: string, model: string, maxTurns: number, maxBudgetUsd: number, schema?: z.ZodType, guard?: CanUseTool, resume?: string /* sessionId */, extraDirs?: string[]}`
- `AgentResult {ok: boolean, output?: unknown, text: string, sessionId?: string, usd: number, tokensIn: number, tokensOut: number, error?: string, subtype: string}`
- `class SdkAgentRunner implements AgentRunner { constructor(bus: EventBus, budget: Budget, queryFn = query) }`: system prompt = preset `claude_code` + append(role body); `outputFormat` from schema; streams every assistant tool_use → event `tool` (`{tool, text: short input}`), assistant text → event `say` (truncated 300 chars), result → event `agent_done` with tokens/usd; records spend with Budget; validates `structured_output` with zod (invalid → `ok:false, error:'invalid_output: …'`); retries transient errors (message matches /429|overloaded|5\d\d|ECONNRESET|ETIMEDOUT/) 3×.
- `class FakeAgentRunner implements AgentRunner` (in `src/testing/fake-runner.ts`): scripted responses keyed by role/taskId, with optional side effects (a function writing files), used by the pipeline tests.

- [ ] Step 1: tests with a fake `queryFn` async generator: success with valid structured output → ok + usd recorded; invalid output → ok:false + `invalid_output`; first call throws `429` then succeeds → ok after retry; `error_max_turns` result → ok:false, subtype preserved, spend still recorded.
- [ ] Step 2: implement; PASS; commit.

### Task 6: Git + gates

**Files:** Create `src/git.ts`, `src/checks.ts`, `tests/git.test.ts`, `tests/checks.test.ts`

**Interfaces — Produces:**
- `git.ts`: `sh(cmd, cwd, timeoutMs?) → {code, out}`; `initRepo(dir)`; `commitAll(dir, msg) → boolean` (false if nothing to commit); `addWorktree(repo, branch, path)` (removes a stale path/branch first); `removeWorktree(repo, path)`; `mergeBranch(repo, branch) → {ok, conflict: boolean, out}` (`--no-ff`; on conflict aborts unless `{keepConflict:true}`); `revertLastMerge(repo)`; `headSha(repo)`.
- `checks.ts`: `runGate(cwd, steps = ['typecheck','lint','test']) → {ok, failed?: string, output: string, signature?: string}` running `npm run <step>` with a 5 min timeout each, stopping at the first failure. `signature(output)` = first line matching /error|Error|FAIL|✗/ with digits and paths' line:col normalized, plus the step name.

- [ ] Step 1: tests in a tmp repo: worktree add/merge clean → ok; conflicting edits → `conflict:true` and the repo is clean after abort; `signature` is identical for two outputs differing only by line numbers/timestamps; `runGate` on a dir whose `package.json` has `"test":"exit 1"` → ok:false, failed:'test'.
- [ ] Step 2: implement; PASS; commit.

### Task 7: DAG + contract gate

**Files:** Create `src/dag.ts`, `tests/dag.test.ts`

**Interfaces — Produces:** `readyTasks(tasks): Task[]` (status backlog/ready, all deps merged; parked deps count as satisfied so the factory never deadlocks, plus a ruling); `laneConflicts(tasks): [string,string,string][]` (pairs of tasks *with no dependency path between them* whose lane globs overlap, plus the overlapping lane); `validatePlan(plan): string[]` (unknown deps, cycles, empty lanes, duplicate ids).

- [ ] Step 1: tests: a chain a→b → only a is ready; after a merged → b ready; parallel tasks both writing `src/web/App.tsx` → conflict listed; same pair with a dep → no conflict; a cycle a↔b → validation error.
- [ ] Step 2: implement (glob overlap: a prefix match on the static prefix before the first `*`); PASS; commit.

### Task 8: House template

**Files:** Create `templates/house/**`: `package.json` (scripts dev, build, typecheck, lint, test, e2e, start, check), `vite.config.ts`, `index.html`, `src/web/{main.tsx,App.tsx,theme.css}`, `src/server/{index.ts,app.ts,db/schema.ts,db/client.ts}`, `src/shared/contracts.ts`, `tests/unit/health.test.ts`, `tests/e2e/smoke.spec.ts`, `playwright.config.ts`, `Dockerfile`, `.dockerignore`, `.gitignore`, `eslint.config.js`, `CLAUDE.md` (house conventions: where things go, the scripts, the "never edit tests/acceptance" rule, contracts frozen), `docs/.gitkeep`; plus `scripts/verify-template.sh`.

The server is Hono (`@hono/node-server`), serving `/api/*` and the built static web in production; dev runs Vite on 5173 with proxy `/api` → 8787. DB: better-sqlite3 + drizzle-orm, file `data/app.db`, created on boot. `GET /api/health` → `{ok:true}`. The App shows the product name from `/api/health`.

- [ ] Step 1: `scripts/verify-template.sh` copies the template to a tmp dir, runs `npm install && npm run check && npm run build && npx playwright install chromium && npm run e2e`, and (if docker is available) `docker build`. Expected: all exit 0.
- [ ] Step 2: build the template until the verify script passes; commit `feat: house template`.

### Task 9: Phases + pipeline

**Files:** Create `src/phases/{intake,product,design,contractGate,build,qa,finalReview,deploy,report}.ts`, `src/pipeline.ts`, `src/prompts.ts`, `tests/pipeline.test.ts`

**Interfaces — Consumes:** everything above. **Produces:** `type Ctx = {dir, cfg, state, bus, budget, runner: AgentRunner, ledger, save(): void}`; each phase `run(ctx): Promise<void>`; `runPipeline(ctx): Promise<RunState>` loops over phases not in `state.done`, setting `state.phase`, saving after each, honoring `.forge/STOP` (checked between every dispatch → throw `Stopped`).

Phase behavior (prompts in `prompts.ts`, each a lean dispatch naming exact input/output paths):
- intake: copy the template (skip `node_modules`), write `docs/brief.md`, `git init` + commit, `npm install` (cached), and add `.forge/` to `.gitignore`.
- product: Product agent → validated `docs/prd.json` (re-read from disk and parse with `Prd`; a parse failure counts as an attempt, ≤2).
- design: Architect and UI/UX in parallel (`Promise.all`). The Architect's `docs/tasks.json` is parsed with `TaskPlan` and must pass `validatePlan`. State gets tasks with status backlog.
- contract_gate: `runGate(dir, ['typecheck'])` + `laneConflicts`; failures → one Architect repair dispatch with the problems listed; still failing → ruling "serialize conflicting tasks" (add a dep between each conflicting pair).
- build: scheduler loop: while unfinished tasks are not parked: start up to `concurrency` ready tasks, each `runTask` in a worktree `.forge/wt/<id>` on branch `t/<id>`; `Promise.race` on the in-flight ones. `runTask`: dev attempt → commit in worktree → `runGate` → on fail compress output, same signature twice → escalate; attempts capped per Global Constraints → reviewer agent (read-only guard) → reject = attempt with issues as feedback → approve → integrate (merge under a mutex → `runGate` on main → fail → revert + feedback attempt). Conflict → integrator agent in the worktree after `git merge main`. Landing mode: tasks whose features are all non-must are parked with a ruling.
- qa: start the app (`npm run build && npm start` on port 8787, wait for health), QA agent writes/updates `tests/e2e/*.spec.ts`, runs them, produces a `QaReport` (it can read `.forge/holdout/`). The orchestrator sets `prd.features[].passes` from the report, saves the round, and turns failures into fix tasks (kind fix, lanes = suspectedFiles) → back to build (the build phase is re-entered by removing it from `done`). It stops at all-must-pass and score ≥ 7, plateau, round cap, or landing.
- final_review: final reviewer on the full `git diff <intake-sha>..HEAD` summary → critical/major issues become fix tasks → one build pass.
- deploy: DevOps agent with a docker build + run on port 8788 + curl health → `.forge/deploy.json` `{ok, url, image}`; if docker is missing, `npm start` + health is used instead.
- report: write `docs/RUN_REPORT.md` (features pass/fail, tasks, rulings from the ledger, QA rounds, spend by role, % local, wall time) and commit.

- [ ] Step 1: pipeline tests with FakeAgentRunner (side effects write the expected files) and a stubbed gate: (a) happy path reaches `done` with all tasks merged; (b) a task whose gate fails with the same signature twice gets escalated to `cfg.escalationModel`, and after the caps it is parked with a ruling in the ledger; (c) `.forge/STOP` present → stops, and a resume after removing it completes without re-running merged tasks (count runner calls per taskId); (d) budget at 85% → landing: should-only tasks parked, deploy + report still run.
- [ ] Step 2: implement until PASS; commit.

### Task 10: CLI + server + monitor

**Files:** Create `bin/forge.ts`, `src/server.ts`, `monitor/index.html`, `forge.config.json`, `tests/server.test.ts`; add `"bin": {"forge": "bin/forge.ts"}` and a `forge` npm script.

**Interfaces — Produces:** commands `forge run <brief.md> [--out dir] [--budget usd] [--deadline iso] [--concurrency n] [--no-serve]`, `forge resume <dir>`, `forge status <dir>`, `forge stop <dir>`, `forge serve <dir>`, `forge export-agents <dir>`, `forge report <dir> [--vault]`. `startServer(dir, bus, port) → close()`: `GET /events` (SSE: replays the existing events then streams live), `GET /state` (state.json), `GET /` (monitor).

Monitor (single HTML file, no build): phase rail, Kanban by TaskStatus, live agent cards (role, model, current tool, tokens), a spend-by-role bar, QA score sparkline, rulings feed, % local, landing-mode banner. Dark, polished; it reads `/state` every 2s plus SSE for the live feed.

- [ ] Step 1: test: `startServer` on a random port; `GET /state` returns JSON; `GET /events` streams previously emitted events.
- [ ] Step 2: implement; PASS; commit.

### Task 11: Real-run verification + plan B + docs

**Files:** Create `samples/briefs/{tiny-notes.md,medium-tracker.md}`, `src/exportAgents.ts`, `README.md` (operator runbook for event day), `docs/EVENT_DAY.md` (checklist, timings, budget plan, failure playbook).

- [ ] Step 1: `forge run samples/briefs/tiny-notes.md --budget 8` end to end with real agents; fix whatever breaks; record the cost and time in `docs/EVENT_DAY.md`.
- [ ] Step 2: kill the medium run mid-build, then `forge resume`; verify it continues.
- [ ] Step 3: `forge export-agents` writes `.claude/agents/*.md` from the role files plus `FACTORY.md`; commit.
