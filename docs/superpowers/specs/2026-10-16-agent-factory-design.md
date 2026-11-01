# FORGE: Agentic Software Factory (design)

Date: 2026-10-16 · Owner: Tuvshuu (solo) · Event: ZeroTech Agentic Software Factory Hackathon, on-site 2026-10-23 (24–48 h, brief secret until the start)

Research behind this design: `docs/research/01-agent-sdk.md`, `02-prior-art.md`, `03-local-models.md`.

## 1. Intent

Tuvshuu competes **alone**. The brief arrives at the event. The factory has to turn it into working, tested, deployed software with as little human steering as possible, while showing judges *how* it does it. Judging axes (from the invite): orchestration, autonomy, quality and reliability, self-correction, and product completeness. A token budget is provided by the company. Tuvshuu's own picture of success: an hour after the brief they are demoing a live view of the factory working, and the product is nearly finished.

So the factory must be:
1. **Autonomous by default.** One command takes it from brief to deployed app. Tuvshuu steers rather than babysits.
2. **Self-correcting under hard limits.** Failures loop back, but every loop has a cap and an escape.
3. **Observable.** Every agent action, handoff, gate result and token/$ spend is an event that a UI can render live.
4. **Token-efficient.** The right model per role, deterministic checks before LLM checks, lean context per agent, and a local Ollama tier for chores.

## 2. Goals / non-goals / anti-goals

Goals
- `forge run brief.md` produces a git repo with a working app, tests, a Docker deploy, and a run report.
- Roles: Orchestrator (code, not an LLM), Product, Architect, UI/UX, Developers (parallel), Integrator, QA/Evaluator, Reviewer, DevOps, Reporter.
- Crash-safe resume (`forge resume`) and a kill switch (`forge stop`).
- A live event stream (SSE) plus a built-in monitor page. The HELM dashboard (`~/dashboard`) becomes a richer client later, built *by the factory* as a practice project.
- A plan B: the same role prompts exported as `.claude/agents/*.md`, so Tuvshuu can drive the pipeline by hand in Claude Code if the orchestrator breaks on the day.

Non-goals (for Oct 23)
- A general multi-provider agent framework. Claude does all reasoning; Ollama only does one-shot chores.
- Hermes Agent / OpenClaw in the critical path. Hermes needs ≥64k context, which doesn't fit 16 GB next to dev tools. OpenClaw is optional for phone notifications only.
- Arbitrary tech stacks. The factory ships one pre-verified **house stack**; the Architect may deviate only with a recorded ruling.

Anti-goals (failure even if it "works")
- Agents looping forever or burning the budget in hour 3.
- Dev agents editing tests or acceptance criteria to go green (reward hacking).
- Parallel devs making conflicting hidden decisions that break integration.
- A pretty monitor over a product that doesn't run.
- The orchestrator stalling, waiting for a human, mid-run.

## 3. Constraints

- Hardware: Apple M4, 16 GB RAM. Local models are limited to ~4–8B (gemma4 E4B ≈ 29 tok/s, 3.2 GB).
- Claude Code CLI 2.1.301, Claude Agent SDK (upgrade to 0.3.301 to match the CLI). Node 20 in the shell (nvm). No tmux.
- Auth: whatever the `claude` CLI is logged into (subscription now; the company key at the event via `ANTHROPIC_API_KEY` or a provider env). This must be switchable by config/env without code changes.
- Agent teams are interactive-only, so the orchestrator coordinates agents itself.
- Factory agents run with `settingSources: ['project']` so Tuvshuu's personal plugins (superpowers, claude-mem, ECC hooks) don't leak into runs. That keeps runs reproducible and cheaper.

## 4. Architecture

```
brief.md ─▶ forge (TypeScript orchestrator, deterministic state machine)
              │  state: <project>/.forge/state.json  ledger: .forge/ledger.md  events: .forge/events.jsonl
              │  SSE: http://localhost:4317/events   monitor: http://localhost:4317/
              ▼
 0 INTAKE     copy house template → git init → brief to docs/brief.md
 1 PRODUCT    (sonnet)  brief → docs/prd.json + docs/prd.md ; holdout scenarios → .forge/holdout/ (devs never see)
 2 ARCHITECT  (opus)    prd → docs/architecture.md, src/shared/contracts.ts, db schema, docs/tasks.json (DAG + file lanes)
   UI/UX      (sonnet)  prd → docs/design.md (screens, flows, tokens) + src/web/theme  [parallel with ARCHITECT]
 3 CONTRACT GATE (code) typecheck contracts; lane-overlap check of tasks; fail → Architect fixes (≤2)
 4 BUILD LOOP scheduler: ready tasks (deps merged) → up to N devs (default 3) in git worktrees
     DEV (sonnet) implement + tests → TASK GATE (code: typecheck, lint, unit tests in worktree)
        fail → same dev resumed with compressed failure (≤3) → fresh dev on opus (≤2) → RULING (park task)
     REVIEW (sonnet, read-only, structured verdict) reject → back to dev (counts toward same cap)
     INTEGRATE (code) merge to main serially → full gate on main → broken ⇒ revert + requeue
        merge conflict → integrator agent (sonnet) resolves in a worktree
 5 QA LOOP    (sonnet + Playwright) start app, run e2e + acceptance + holdout scenarios, score rubric
     failures → new fix tasks into the DAG → BUILD LOOP; stop on pass, plateau (2 rounds no gain) or cap
 6 FINAL REVIEW (opus) security + quality on the full diff → fix tasks (≤1 round)
 7 DEPLOY     (haiku)   docker build + run + smoke test; optional extra target via config
 8 REPORT     (code + local LLM) docs/RUN_REPORT.md: what was built, rulings, gate history, tokens/$ by role
```

### 4.1 Orchestrator (code, not an LLM)
- A deterministic TypeScript state machine. Phases are idempotent and persisted to `.forge/state.json` after every transition, so `forge resume` continues from the last completed step. Completed tasks are never redone.
- **Rulings, not stalls.** When an agent reports BLOCKED or a cap is hit, the orchestrator records `RULING: decision — why — cost if wrong` in the ledger and continues (park the task, cut scope to "should/could", or pick the default). It stops only on budget exhaustion, the STOP file, or zero viable work.
- **Budget as code.** A global USD/token cap from config, split by phase with a reserve. The check happens *before* every dispatch. Each agent call gets `maxBudgetUsd` + `maxTurns`. When spend crosses 80% of budget the orchestrator switches to "landing mode": no new features, only fixes for must-haves, then deploy and report.
- **Wall-clock caps** per phase, and an overall deadline (`--deadline 2026-10-24T10:00`). As the deadline approaches the orchestrator moves to landing mode.
- **Transient-error retry**: 429/5xx/network errors are retried 3× with backoff. This is separate from quality retries.
- **Same-error detection**: a failure signature (normalized first error line + file) seen twice in a row on a task forces escalation (model bump / fresh agent) instead of a third identical attempt.

### 4.2 Agents (Agent SDK `query()` per agent invocation)
Each role has a definition in `roles/<role>.md`: mission, owns / must-not-touch, inputs, output contract, done criteria, model, tools, turn and budget caps. The orchestrator builds the prompt from the role file plus a **lean dispatch** (paths to the brief, the relevant contracts and the task brief; never the whole history). Agents return a short structured status via `outputFormat: json_schema`:
`{status: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT, summary (≤15 lines), files_changed[], tests_added[], concerns[]}`
and write details to `.forge/reports/<task>-<attempt>.md`.

Model routing (defaults, overridable in `forge.config.ts`): Architect, final Reviewer, escalated dev → opus; Product, UI/UX, Dev, per-task Reviewer, QA, Integrator → sonnet; DevOps, status narration → haiku; commit messages, failure-log compression, report prose → local Ollama (gemma4) with fallback to haiku. Every call sets its model explicitly.

### 4.3 Guardrails enforced mechanically
- `canUseTool`/PreToolUse hook per role. Devs may not write `docs/prd.json`, `docs/tasks.json`, `tests/acceptance/**` or `.forge/**`. Only the orchestrator flips `passes` on features, based on QA evidence. Nobody can `git push`, `rm -rf` outside the worktree, or touch paths outside the project.
- Devs only write inside their worktree and their task's declared file lanes (outside a lane: a warning is logged and the Reviewer flags it).
- Implementers may not spawn subagents (`disallowedTools: ['Agent','Task']`).
- Contracts (`src/shared/contracts.ts`, db schema) are frozen after the contract gate. Changing them requires a contract-change task routed through the Architect.

### 4.4 Shared context (single source of truth)
The project repo itself: `docs/brief.md`, `docs/prd.json`, `docs/architecture.md`, `docs/design.md`, `docs/tasks.json`, `src/shared/contracts.ts`, `CLAUDE.md` (house conventions from the template), plus `.forge/ledger.md`. Every agent starts by reading `CLAUDE.md` + its dispatch. Git history plus the ledger is the recovery map.

### 4.5 House stack (pre-verified template, `templates/house/`)
A boring stack that models know well: **Vite + React + TypeScript + Tailwind** (web), **Hono on Node** (API), **SQLite via Drizzle** (db), **Vitest** (unit), **Playwright** (e2e), and **one Dockerfile** serving API + static web. Scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `start`, and `check` (= typecheck + lint + test). It ships with a sample health endpoint and page plus passing tests, so gates are green from minute zero. The template is verified by CI-style script before the event.

### 4.6 Observability
- Every agent message → normalized event `{ts, run, phase, role, agent_id, task_id, kind, tool?, model, tokens_in, tokens_out, cache_read, usd, status, text?}`, appended to `.forge/events.jsonl` and broadcast over SSE.
- Gate results, merges, rulings, retries and budget snapshots are events too.
- `forge serve` offers SSE plus a built-in monitor page: pipeline phases, Kanban of tasks (backlog/ready/running/review/blocked/merged), live agent cards with their current tool, a token/$ burn chart by role, QA score per round, the rulings list and "% done locally".
- `forge status` gives a terminal summary.

### 4.7 Local tier (Ollama)
`lib/local.ts` calls `/api/chat` with `think:false`, an optional JSON schema and a 60 s timeout. It's used for commit messages, compressing failing test/build output to ≤40 lines before it's fed to a dev, and drafting report prose. If Ollama is down or the output fails validation, it falls back to haiku. Each use is counted for the "% local" metric. Settings: `OLLAMA_KEEP_ALIVE=30m`, model `gemma4:latest` (E4B).

### 4.8 Plan B and integrations
- `forge export-agents <project>` writes `.claude/agents/<role>.md` plus a `FACTORY.md` playbook, so the pipeline can be run by hand from Claude Code.
- Obsidian: `forge report --vault` copies RUN_REPORT.md into `~/Documents/Obsidian Vault/01 Projects/Agent Factory/`.
- OpenClaw/HELM: consume the SSE stream later; not required for the event.

## 5. Decided by Tuvshuu
- Solo, no teammates. The factory comes first; the dashboard is a nice-to-have and can be rebuilt or discarded.
- Use Claude as the main engine, Ollama locally for small tasks, Obsidian as the notebook.
- Interactive demo of the factory working is part of the pitch.
- The token budget is for any provider the dev uses.

## 6. Builder's calls (made without Tuvshuu, check these)
- Orchestrator is deterministic code, not an LLM "orchestrator agent". This gives more reliability and cheaper control; the LLM roles do the judgment.
- House stack: Vite/React/Hono/SQLite/Drizzle/Vitest/Playwright/Docker (not Next.js 16, whose breaking changes trip models).
- Default concurrency of 3 devs. Fix caps 3+2. QA loop cap 4 rounds with a plateau stop. Final review 1 round.
- Hermes skipped. OpenClaw left alone (needs Node ≥24.15 or ≥25.9, and its password should be rotated). Tuvshuu can fix it later.
- Factory agents don't load personal plugins (`settingSources: ['project']`).

## 7. Success test before the event
1. The house template passes `npm run check && npm run e2e && docker build` from a clean clone.
2. `forge run` on a small sample brief (a todo/notes app) completes autonomously within a budget cap, producing a running Docker app plus a report.
3. A medium sample brief (multi-entity CRUD + auth-less dashboard) completes, with at least one self-corrected failure visible in the ledger.
4. `forge resume` after a kill mid-build continues without redoing merged tasks.
5. The monitor shows the run live.
