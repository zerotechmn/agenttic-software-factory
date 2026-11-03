# FORGE: autonomous software factory

`forge run brief.md` turns a product brief into a **tested, reviewed, deployed web app** using a team of specialized Claude agents, coordinated by a deterministic orchestrator. A live monitor shows every agent, handoff, gate, retry and dollar spent.

```
brief.md ─▶ PRODUCT ─▶ ARCHITECT ∥ UI/UX ─▶ CONTRACT GATE ─▶ DEVs ×3 (worktrees) ─▶ gate ─▶ REVIEW ─▶ merge ─▶ main gate
                                                               ▲                                                │
                                                               └──────── feedback (≤3, then opus ≤2, then park) ┘
           ─▶ QA (Playwright on the live app, holdout scenarios, score) ─▶ fix tasks ─▶ … ─▶ FINAL REVIEW ─▶ DEPLOY ─▶ REPORT
```

## Quick start

Needs Node 24+, git, an Anthropic API key, and (for the deploy step) Docker running. No local model is needed.

```bash
git clone <this repo> forge && cd forge
./setup.sh                      # npm ci, builds the Office UI, installs Playwright Chromium, creates .env, runs doctor
# put ANTHROPIC_API_KEY=sk-ant-… in .env (git-ignored; ./forge loads it on every command)
./forge doctor                  # every check green? (✗ = must fix, ! = optional)

./forge console                 # the pixel Office: http://127.0.0.1:4300/office/  (click once so the browser allows sound)
./forge run samples/briefs/wheels2go.md --budget 20     # in a second terminal; watch it in the Office
```

**Finish song:** when a run finishes, the Office plays `office/public/finish.mp3` if you put one there (git-ignored, so bring your own; `office/public/finish.json` sets the start and length). Without it, a card links the song on YouTube.

A run of the Wheels2Go brief takes about 20–40 minutes (longer if QA needs several fix rounds) and $6–15 of API usage; `--budget` is a hard cap.
The finished app is served from Docker on the brief's port (8800), and `docs/RUN_REPORT.md` in the run folder says what was built, tested and decided.

**How it works, with diagrams:** open [`docs/architecture.html`](docs/architecture.html) in a browser (architecture, pipeline, sequence diagrams, why worktrees and guards, self-correction loops, operator guide).

## Commands

```bash
./forge run <brief.md> [--budget USD]   # start a run (folder printed; default ~/forge-runs/<brief>-<time>)
./forge status ~/forge-runs/<run>       # terminal summary
./forge stop   ~/forge-runs/<run>       # graceful stop at the next checkpoint (or Ctrl-C)
./forge resume ~/forge-runs/<run>       # continue exactly where it stopped
./forge iterate ~/forge-runs/<run> "change" …   # operator change requests (override the PRD), then resume
./forge console                         # Office: every run, live or replayed; New job; Ask FORGE
./forge serve  ~/forge-runs/<run>       # the plain monitor for one run
./forge report ~/forge-runs/<run>       # print the run report
./forge lessons [promote <id>]          # cross-run lessons
./forge export-agents ~/forge-runs/<run>   # plan B: .claude/agents/forge-*.md + FACTORY.md
./forge doctor                          # check this machine
```

Flags for `run`: `--out DIR`, `--budget USD` (default 60), `--deadline 2026-10-24T10:00:00+08:00`, `--concurrency N` (default 3), `--model-<role> MODEL` (e.g. `--model-dev opus`), `--no-serve`, `--verbose` (show every tool call).

Auth: `ANTHROPIC_API_KEY` from `.env` or the shell (a shell export wins). Without a key, the Agent SDK falls back to whatever the `claude` CLI is logged into.

## Roles (`roles/*.md`)

| Role | Model | Owns | Never touches |
|---|---|---|---|
| Product | sonnet | `docs/prd.json` (+md), holdout scenarios | code |
| Architect | opus | `docs/architecture.md`, `src/shared/contracts.ts`, DB schema, route/page stubs, `docs/tasks.json` | PRD |
| UI/UX | opus | `docs/design.md`, theme tokens, UI primitives | pages, API |
| Developer ×N | sonnet → opus on escalation | its task's file lanes + unit tests, in its own git worktree | contracts, PRD, tasks, e2e, configs |
| Researcher | sonnet | `docs/research/*.md` answers to PRD research questions (web) | code |
| Reviewer | haiku | per-task verdict (read-only) | everything |
| Integrator | sonnet | merge-conflict resolution | contracts |
| QA | sonnet | `tests/e2e/**`, QA report and score | product code |
| Final reviewer | sonnet | release-blocker review (read-only) | everything |
| DevOps | haiku | Dockerfile, deploy | app code |
| PRD critic | haiku | `docs/brief-coverage.json`: every brief requirement mapped to features; gaps go back to Product once | everything |
| Learner | haiku | proposes lesson changes after each run (`lessons/lessons.json`; the orchestrator applies them) | everything |
| Local tier (off by default) | gemma4 (Ollama), opt in with `{"local":{"enabled":true}}` in `forge.config.json` | commit messages, failure-log triage, report summary | anything critical |

Write permissions are **enforced** by a PreToolUse guard (`src/guard.ts`), not just requested in prompts.

**Skills per role.** Each role file lists `skills:`. The skills ship in this repo under [`skills/`](skills/README.md) (27 skills from ECC, superpowers, mattpocock/skills, Anthropic, Microsoft and others, each with its license), so every machine runs the same agents. When an agent starts, only its own skills are copied into its working directory (git-ignored) and passed as the SDK `skills` filter, so it sees nothing else. Pixi projects also get the PixiJS and game skills for developers, the Architect and UI/UX. Personal plugins on the operator's machine are never loaded by factory agents.

**Research tools.** The Researcher uses the context7 docs MCP (via `npx`) and, if installed, the Scrapling MCP for pages that block plain fetches (Python; optional: `pipx install 'scrapling[ai]'`). Without Scrapling it uses the built-in WebFetch.

## Console (`forge console`)

The pixel office becomes the operator console: a run picker, a **New job** form (brief → run), backlog and notes per run, and **Ask FORGE**, a factory assistant (sonnet, about $0.05–0.10 per message). The assistant reads only the factory folder and the runs folder (no shell, no writes, every other tool denied). It diagnoses runs from their state, ledger and events, and can queue backlog, notes and improvements. It can only *propose* starting or resuming a run; you click Confirm. It finds and enables installed skills on request.

## Guarantees

- **Handoffs are files**, validated with zod schemas (`src/schemas.ts`). Agents reply with a short structured status.
- **Contracts freeze before any parallel work starts.** The contract gate requires a green baseline and serializes tasks whose file lanes overlap.
- **Gates:** typecheck, lint and unit tests run in the worktree, then the LLM review, then a merge to main and the gate again on main (a broken main is reverted automatically).
- **Bounded self-correction:** the same dev session gets compressed failure feedback (≤3 tries). The same error twice, or the cap, escalates to a fresh opus session (≤2). After that the task is parked with a recorded ruling.
- **QA loop:** Playwright runs against the running app, plus holdout scenarios the developers never saw. The run stops when every must-have passes and the score is ≥7, the score plateaus for 2 rounds, or 4 rounds are reached.
- **Budget as code:** a per-call cap of ≤8% of the total, phase allocations, and landing mode at 80% spend or near the deadline (should/could work is parked; must-haves get fixed, then deploy and report).
- **Rulings, not stalls:** the orchestrator never waits for a human. Every judgment call goes into `.forge/ledger.md` and the run report.
- **Crash-safe:** `.forge/state.json` is written atomically after every step, so `resume` never redoes merged tasks.
- **Observability:** `.forge/events.jsonl` + SSE (`/events`), `/state`, and the monitor at `/`.

## Layout

```
bin/forge.ts         CLI            src/pipeline.ts   phase driver       src/phases/*    one file per phase
src/agent.ts         SDK runner     src/guard.ts      tool permissions   src/budget.ts   spend + landing
src/dag.ts           task graph     src/checks.ts     gates + signature  src/git.ts      worktrees/merge
src/local.ts         Ollama tier    src/server.ts     SSE + monitor      monitor/        live UI
roles/               prompts        templates/house/  verified app stack scripts/verify-template.sh
```

Generated project layout: see `templates/house/CLAUDE.md`.

## Tests

`npm test` runs 221 factory tests; `cd office && npm test && npm run e2e` runs the Office's unit and Playwright suites. The pipeline tests run the whole state machine with a scripted fake runner, so they use zero tokens.
`scripts/verify-template.sh` proves the house template is green: check, build, Playwright e2e and Docker build.

## Experimental owner routing

Disabled by default. Set `FORGE_ROUTING_MODE=mock` for deterministic **simulated** suggestions or `shadow` for **external** TypeSafe suggestions. Both leave the existing `dev` assignment authoritative. Shadow requires server-only `TYPESAFE_API_KEY` and `FORGE_ROUTING_MODEL=jev-1.14.0`. The launcher reads `.env`; exported shell values take precedence, including empty values. Never use Vite-prefixed credential variables or commit keys.

Approve each task by creating a local, Git-ignored `.forge/routing-approved.json` in the generated run directory:

```json
{
  "T1": { "revision": "<taskRevision(task) SHA-256>", "summary": "Implement a calculator unit test." }
}
```

`taskRevision` is exported from `src/routing.ts` and fingerprints `[title, description, lanes]` using JSON serialization. Changed tasks require renewed approval. Only the approved summary (maximum 1,000 characters) and static eligible-role descriptions leave the machine. No original task text, code, file paths, notes or artifacts are sent. Common credential patterns are redacted, but automatic redaction is not comprehensive: review summaries before approving them. Missing, malformed or stale approval skips the suggestion.

The adapter uses the documented [Choice API](https://docs.typesafe.ai/primitives/choice), validates roles, probabilities and usage, times out after two seconds and never retries failures. At most three observations run concurrently, with at most 100 per build invocation; retries within that build are deduplicated. Pending observations drain on phase exit. Limits reset on a later build or resume. No confidence threshold is assumed or applied.

Events use `kind: routing_decision`, `taskId`, a labeled `text` field and typed `data`: `source` (simulated/external), `assignedRole`, `suggestedRole`, `assignmentChanged: false`, `model`, `latencyMs`, `confidence`, `probabilities`, `usage` or `null`, and a sanitized error code. The Office displays an advisory ticker only; suggestions never move workers or alter execution. Actual usage is shown only when returned; otherwise it is unavailable. No cost estimate is fabricated. Events are stored in `.forge/events.jsonl`; summaries, credentials and raw provider error bodies are excluded. Retention follows the run directory: delete experiment runs after evaluation. Provider retention guarantees have not been verified.

Run `npm run typecheck`, `npm test -- tests/routing.test.ts`, and `cd office && npm run check && npm run build`. There is no root or Office lint script. Tests use local fake HTTP responses, not inference calls. Mock and disabled modes need no key. A synthetic live request was successfully verified with `jev-1.14.0`; this does not prove a full factory run. The live hook offers only the currently executable `dev` role, so cross-role improvement must be evaluated separately with an offline labeled dataset through the provider interface. Broader assignment, cross-resume deduplication, cooldown scheduling and automatic retention remain outside this minimal integration.
