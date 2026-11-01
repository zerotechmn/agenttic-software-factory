# 02 — Prior Art for the Agentic Software Factory

Research date: 2026-10-16. Target: ZeroTech hackathon (Oct 23 2026), solo dev, 24–48h, Claude Code / Claude Agent SDK (TypeScript) as the engine.
Judging axes: orchestration, autonomy, quality/reliability, self-correction, product completeness.

---

## 1. ECC plugin (v2.2.3, `~/.claude/plugins/cache/ecc/ecc/2.2.3/`)

### 1.1 orch-pipeline (shared engine behind `orch-*`)
- **Step 0 size classifier.** Score on 3 signals (files touched / new dependency or contract / design ambiguity) and take the **highest** tier: `trivial` (phases 4→5→6), `small` (light 1 → 4→5→6), `standard` 2–5 files (1→2→4→5→6), `large` (1→2→3→4→5→6). Tie-breaker: a security trigger or public API change makes it **at least standard**. State the tier in one line so the human can override it.
- **Phases:** 0 Intake → 1 Research & Reuse (gh search → Context7/vendor docs → registries → Exa; "prefer adopting a proven implementation") → 2 Plan (`planner`/`architect` → `task_list` of thin vertical slices) → 3 Scaffold (MVP only) → 4 Implement via TDD (`tdd-guide`; `build-error-resolver` when the build breaks) → 5 Review (`code-reviewer` + `security-reviewer` when triggered) → 6 Commit (conventional, one per logical chunk).
- **Two human gates:** GATE 1 after the plan (no implementation code until approved) and GATE 2 before commit. "Everything between the gates flows without stopping."
- **Security trigger list:** authn/authz, user input, DB queries, FS paths, external API calls, crypto, secrets.
- **Handoff = docs, no hidden state.** `task_list` drives Implement. PRD, architecture and system_design go under `docs/`. CRITICAL/HIGH review findings block Gate 2. Coverage must be at least 80%.

### 1.2 orch-build-mvp (skill + `/orch-build-mvp <doc>`)
- Size floor: large. First move: read the spec, then extract **scope, locked decisions and the feature list**, ordered as **thin vertical slices** (one end-to-end path first, "not all-models-then-all-views").
- Translates the SDD into `gan-harness/spec.md` + `gan-harness/eval-rubric.md`, then runs `/gan-build "<brief>" --skip-planner` (defaults: `--max-iterations 15`, `--pass-threshold 7.0`, `--eval-mode playwright|screenshot|code-only`).
- Each slice gets its own `feat:` commit. Gates 1 and 2 are kept.

### 1.3 gan-style-harness + gan-planner / gan-generator / gan-evaluator + `/gan-build`
- **Artifacts (file-based protocol):** `gan-harness/spec.md`, `eval-rubric.md`, `generator-state.md` (built / changed this iteration / known issues / dev-server URL + status + command), `feedback/feedback-NNN.md`, `screenshots/`, `build-report.md`.
- **Planner:** "deliberately ambitious", 12–16 features split into Must/Should/Nice sprints. The spec includes exact hex palette, typography, layout philosophy, anti-slop directives, user flows, edge/empty/error/loading states, a per-project rubric and a sprint plan with definition of done.
- **Generator:** reads the spec and the latest feedback, then fixes **every** issue in this order: functionality bugs → craft → design → originality. "Don't self-evaluate." Commits `iteration-NNN: …` each round and keeps the dev server running. A score below 5 is treated as critical. "If a suggestion seems wrong, still try it."
- **Evaluator:** "ruthlessly strict; your natural tendency is to be generous, fight it". Tests the **live app** with Playwright: happy path, then empty input, 500+ char input, `<script>`/emoji/unicode, rapid double-submit, invalid data, network-like failures. Also checks responsiveness at 375/768/1440, keyboard navigation and hover/focus states. It must record the **achieved** eval mode, not the requested one, and report any degradation.
- **Rubric (1–10 each, weighted):** Design 0.3, Originality 0.2, Craft 0.3, Functionality 0.2. Calibration: 7 = "a junior dev's solid work", 9 = senior quality. Pass when the weighted score is ≥ 7.0.
- **Feedback format:** score table, PASS/FAIL, Critical/Major/Minor issues each written as "issue → how to fix", what improved, what regressed, concrete suggestions.
- **Loop control in `/gan-build`:** `while iter <= max`: generate → evaluate → parse the weighted score. Break on pass. **Plateau break: `iteration >= 3` and no score improvement in the last 2 iterations.** Final report shows score progression per criterion plus cost and time.
- **Anti-patterns worth enforcing:** an evaluator that passes iteration 1 means the rubric is too lenient. Feedback goes **as a file, not inline**. The evaluator never suggests a fix and then grades it. Watch for context exhaustion and use compaction or resets.
- **"Evolution across model capabilities":** each harness component encodes an assumption about what the model can't do. On frontier models, drop sprints, run continuous generation and do one final evaluation pass.

### 1.4 santa-method (dual independent review)
- Generator → **two reviewers in parallel, with the same rubric and inputs, no shared context**, each returning typed JSON: `{verdict: PASS|FAIL, checks:[{criterion,result,detail}], critical_issues:[], suggestions:[]}`.
- Ships only if **both PASS**. Otherwise merge and dedupe the critical issues, have a fix agent "fix ONLY the flagged issues", then re-review with **fresh** reviewers (to avoid anchoring). `MAX_ITERATIONS = 3`, then escalate to a human.
- Rubric criteria need objective pass/fail conditions (accuracy, hallucination-free, completeness, compliance, internal consistency, technical correctness).
- Metrics: first-pass rate (>70%), mean rounds to converge (<1.5), reviewer agreement (low agreement means the rubric needs tightening), escape rate.
- Cost is 2–3× generation. For batches, run Santa on a 10–15% sample (minimum 5).
- Order: run deterministic verification-loop first, Santa second.

### 1.5 verification-loop
Six phases with `set -o pipefail` and truncated output: build (stop on fail) → `tsc --noEmit` → lint → tests with coverage (≥80%) → security grep (`sk-`, `api_key`, `console.log`) → `git diff --stat`. The output is a fixed block: `Build/Types/Lint/Tests/Security/Diff: PASS|FAIL … Overall: READY|NOT READY`, followed by a list of issues to fix. "Continuous mode" runs it after each component.

### 1.6 delivery-gate
A **Stop hook** (`hooks/quality-gate.py`, exit 2 = block) that uses only deterministic checks: a regex for rationalization phrases in the transcript tail ("skip tests for now", "pre-existing bug"), which **warns only**; mtime of learning logs, which blocks if ≥3 are stale on a complex task (≥3 Edit/Write calls); disk space below 15 GB, which blocks. The steal is the **pattern**: a Stop hook that refuses "done" until machine-verifiable facts hold. Our version should block on things like failing tests, an unpassed feature list or an evaluator-score file missing.

### 1.7 team-agent-orchestration
- Each agent is a teammate with **Owner, Scope (files/branch/tools/forbidden), State, Evidence, Merge gate**.
- Kanban columns, each with an exit criterion: Backlog (acceptance written) → Ready (owner and worktree assigned) → Running (handoff artifact and changed files exist) → Review (tests, diff review and risk check pass) → Blocked (blocker has an owner and a next action) → Merged → Archived.
- Card JSON: `{id,title,owner,state,branch,worktree,acceptance[],merge_gate,handoff}`.
- Control pane must show: cards and their state, owner/harness/branch/worktree/**last heartbeat**, links to evidence, blockers grouped by owner, and **merge readiness by gate, "not vibes"**.
- Failure modes: agent soup, invisible work, board theater, overlapping writes, no product artifact. "One integrator resolves conflicts."

### 1.8 dev-team
Four analysis-only personas (PM, Architect, Dev, QA) run **in parallel**, each with a fixed output format (first reaction / 3 key concerns / first action / one question, under 250 words). Project context is passed as a **bounded ≤150-word summary labelled as untrusted data**. The orchestrator writes the synthesis and must name tensions rather than average them; if 3 or more personas raise the same concern, it becomes **blocking**. This is useful as a cheap Product/Architect/QA "kickoff" when the brief drops.

### 1.9 plan-orchestrate
A router only. It decomposes a plan into steps, tags each step (`build/fix/test/db/migration/change/refactor/review/security/impl/design/plan/lookup/docs/loop` with a precedence order and override rules), and emits one command per step. The task description must start with `[Plan: <path>#step-<id>]`, carry 1–3 acceptance criteria, be 200–600 chars and self-contained, and inherit "Out of scope" verbatim. A step **fails closed** (BLOCKED) when its target command can't carry scope. The steals are the **step ID marker and the self-contained task string**, plus failing closed on steps that can't be routed.

### 1.10 continuous-agent-loop / loop-operator
- Loop types: sequential (default), continuous-pr, rfc-dag, infinite.
- Failure modes: churn without measurable progress, repeated retries with the same root cause, merge-queue stalls, cost drift.
- Recovery: freeze → audit → reduce scope to the failing unit → replay with explicit acceptance criteria.
- **loop-operator escalation triggers:** no progress across **2 consecutive checkpoints**, **repeated failures with identical stack traces**, cost outside the budget window, merge conflicts blocking the queue. Required before starting a loop: quality gates active, eval baseline, rollback path, worktree isolation.

### 1.11 parallel-execution-optimizer
Write a lane matrix first (`Lane | parallel? | write surface | risk | verification`). Lanes run in parallel only when their write surfaces don't collide. Destructive commands, migrations and deploys are never parallelized without a gate. If a lane finds a plan-changing blocker, pause the dependent lanes. End with a verification table, not a speed claim. Never let a background process outlive the turn.

### 1.12 cost-aware-llm-pipeline / token-budget-advisor
- Route by complexity thresholds (e.g. text ≥10k chars or ≥30 items goes to the bigger model). Use an immutable cost tracker (`CostRecord{model,in,out,usd}`) and raise `BudgetExceededError` **before** the call. Retry only transient errors (connection, 429, 5xx), 3× with exponential backoff, and fail fast on auth or 400 errors. Cache system prompts over 1024 tokens. Log every routing decision.
- token-budget-advisor is a UX skill (offers 25/50/75/100% answer depth). Its only reusable idea is the heuristic estimate (prose ≈ words×1.3, code ≈ chars/4) for pre-flight budget checks. Otherwise it is irrelevant to the factory.

### 1.13 hermes-imports
This is not about running Hermes. It is a sanitization checklist for turning local Hermes operator workflows into public ECC skills: strip `/Users/...` and `~/.hermes` paths, tokens, private names and CRM/finance/health data; replace accounts with role labels; output a candidate skill name, a summary, the inputs that were removed and the remaining risks. It confirms the ECC framing: **"Hermes is the operator shell. ECC is the reusable workflow layer."** It has little value for the hackathon beyond that framing.

---

## 2. Superpowers v7.0.0 — mechanics worth reusing

### 2.1 subagent-driven-development (the most rigorous controller design found)
- **Fresh implementer per task, then a task review (spec compliance AND quality, both verdicts required), then one broad final review on the most capable model.**
- **Ledger file survives compaction:** `<repo>/.superpowers/sdd/<plan>/progress.md`. Its first line holds the plan identity, followed by lines such as `Task N: complete (commits a..b, review clean)`, `Task N: fix round R/5 (X addressed, Y open …)`, `Task N: minor (deferred): …`, `Task N: parked — … — Ruling: …`. "Controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed." On resume, trust the ledger and `git log`, not your memory.
- **Rulings, not stalls:** an autonomous controller decides ambiguities itself and records `Ruling: <decision> — <why> — <cost if wrong>`. Only 4 things stop it: an irreversible or destructive operation, a security-sensitive action, an external side effect (merge, push, publish), or a plan so broken every path is a guess. The final message lists every ruling. **Strong fit for the "autonomy" judging axis.**
- **Pre-flight conflict scan:** a table with one row per task pair that shares a file or interface (what one produces vs. what the other consumes) and one row per task for self-consistency. Write it to the ledger before dispatching task 1.
- **Dispatch hygiene:** extract a per-task **brief file** (`scripts/task-brief PLAN N`) and never make a subagent read the whole plan. Never paste accumulated history ("a real dispatch hit 42k chars, 99% pasted history"). Artifacts move as **files**. The implementer writes a full report to `task-N-report.md` and returns ≤15 lines with status `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`. Implementers must **not spawn subagents or reviewers** (duplicate seats).
- **Review package as a file:** `git log --oneline` + `diff --stat` + `diff -U10` from a recorded BASE (never `HEAD~1`). The reviewer is never told "don't flag X" (no pre-judging).
- **Fix loop with a circuit breaker:** max 5 rounds per task. Rounds 1–3 **resume the same implementer**. Rounds 4–5 use a **fresh implementer on a model one tier higher**, told "a prior implementer attempted this N times; you own it now". Each round is one fix plus a **scoped** re-review (findings marked ADDRESSED/NOT ADDRESSED plus new breakage in the fix diff only). After round 5, adjudicate: park with a ruling, or for load-bearing findings rule on the smallest unblocking change. Minors never enter the loop. The controller never fixes code itself.
- **Final review:** one fix dispatch with the full list (not one fixer per finding; "a final-review fix wave cost more than all its tasks combined"), one re-review, no second wave.
- **Model selection:** use the cheapest tier when the plan contains the full code (transcription), mid tier as the floor for reviewers and for prose-spec implementers ("turn count beats token price — cheap models take 2–3× the turns"), and the top tier for architecture and the final review. **Always set the model explicitly**, because an omitted model inherits the expensive session model.
- **Never run parallel implementers on the same tree.** Batch small same-shape edits into a single dispatch.
- **Waiting:** wait in bounded 5–10 minute stretches and reconcile live children between stretches.

### 2.2 dispatching-parallel-agents
One agent per **independent problem domain**, all in the same message. Each prompt is focused, self-contained (paste the error text and test names), constrained ("don't change other code") and specific about output. Afterwards: check for conflicts, run the full suite, spot-check. Don't parallelize related failures or shared state.

### 2.3 using-git-worktrees
Detect existing isolation first (`git-dir` vs `git-common-dir`, with a submodule guard). Prefer the **native** tool (`EnterWorktree`, or the Agent SDK/Claude Code `isolation: worktree`) over a raw `git worktree add`, which "creates phantom state your harness can't see". Default location is `.worktrees/`, and **`git check-ignore` must pass**. After creating it: install deps and run **baseline tests**; a dirty baseline makes every later failure ambiguous.

### 2.4 writing-plans
- Header: Goal, Architecture, Tech Stack, **Spec path**, **Global Constraints** (exact values verbatim), **Review Focus** (the 5 failure-prone input classes the spec implies but no test covers, each turned into a test in its owning task).
- Each task lists **Files** (create/modify/test with exact paths) and **Interfaces: Consumes / Produces with exact signatures**. This block is how isolated implementers agree on names, and it is the direct fix for "agents contradicting each other".
- Steps are TDD-shaped (write the failing test → run it, expect FAIL → implement the signature → run it, expect PASS → commit) with exact commands and expected output. "A plan longer than the code it describes has written the code."
- Self-review: spec coverage, step scan, **type consistency across tasks** (`clearLayers` vs `clearFullLayers`), review focus, proportion.
- Task right-sizing: the smallest unit with its own test cycle that a reviewer could reject independently.

---

## 3. Web prior art

### 3.1 Anthropic — Effective harnesses for long-running agents
- An **Initializer agent** runs once and writes `init.sh` (starts the dev server), `claude-progress.txt`, an initial commit, and a **feature list in JSON** (200+ features for a claude.ai clone): `{category, description, steps[], passes:false}`.
- Coding agents may **only flip `passes`**: "It is unacceptable to remove or edit tests." JSON was chosen because models are less likely to overwrite it than Markdown.
- **One feature at a time**, and leave a clean, mergeable state with a commit and a progress-file update at the end of every session.
- **Startup routine:** `pwd` → read git log and the progress file → pick the highest-priority failing feature → run `init.sh` → **smoke-test e2e before new work** (catches bugs the previous session left).
- Failure modes: declaring victory early, half-built features, marking features done after unit tests or curl only. Fix: **browser automation as a human user** (Puppeteer/Playwright). Agents cannot see native `alert()` modals.

### 3.2 Anthropic — Harness design for long-running application development (Mar 2026)
- Planner → Generator → Evaluator(Playwright). The frontend loop runs 5–15 iterations and up to 4h. The evaluator is calibrated with **few-shot score breakdowns** to cut score drift.
- **Sprint contracts:** before coding, the generator proposes "done" and how it will be verified; the evaluator negotiates until they agree. Communication is via files. Sprint 3 had 27 criteria. **Each criterion has a hard threshold, and falling below any one fails the sprint** (not just a weighted average).
- Out of the box, the evaluator was lenient: it found real bugs and then approved anyway. It was tuned over several rounds by **reading the logs**.
- Cost: solo Opus 4.5 took 20 min / $9 and produced a broken game; the full harness took 6h / $200 and worked. The Opus 4.6 DAW took 3h50 / $124.70, with build round 1 alone costing $71, and QA rounds cost only about $3–4 each. **QA is cheap compared with generation, so spend on evaluation.**
- Sonnet 4.5 showed "context anxiety", so the harness used hard resets with a structured handoff. Opus 4.5+ ran one continuous session with auto-compaction. With newer models they **dropped sprints, moved the evaluator to a single final pass, and kept the planner** (without it the generator under-scopes).
- Simplify by removing **one component at a time**; a radical simplification at once underperformed.

### 3.3 Anthropic — How we built our multi-agent research system
- Agents use about 4× chat tokens and multi-agent systems about **15×**. **Token usage explains about 80% of performance variance** (BrowseComp). An Opus lead with Sonnet subagents beat single Opus by 90.2%. Explicitly: **coding parallelizes less well than research**.
- Each delegation needs **an objective, an output format, tool/source guidance and clear boundaries**. Vague delegation produced duplicated work.
- Effort scaling rules belong in the prompt: 1 agent with 3–10 calls for simple tasks; 2–4 subagents with 10–15 calls each for comparisons; 10+ for complex tasks. Failure modes: 50 subagents spawned for trivial queries, endless searching, subagents distracting each other with updates.
- Evals: start with about 20 cases (early changes move results from 30% to 80%). Use an LLM judge with a single prompt that outputs a 0–1 score plus pass/fail. For agents that mutate state, **grade the end state rather than the path**.
- Reliability: checkpoints and resume rather than restart, deterministic retries, telling the agent when a tool failed, saving the plan to memory (context beyond 200k is truncated), full tracing. Synchronous subagents mean the slowest one blocks everything.

### 3.4 Anthropic — Building effective agents
Patterns: prompt chaining, routing, parallelization (sectioning / voting), **orchestrator-workers** ("can't predict subtasks, e.g. multi-file code changes"), **evaluator-optimizer** ("when clear evaluation criteria exist"). Principles: keep it simple, make planning transparent, invest in the **ACI**. Poka-yoke tools, docstring-quality descriptions, and **absolute file paths** (fixed relative-path errors on SWE-bench).

### 3.5 Claude Code agent teams (experimental)
Enabled with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (reported since v2.1.32). Components: team lead, teammates (full Claude Code sessions), a shared task list (pending / in-progress / done with dependency blocking and claim records), and a per-agent mailbox for peer-to-peer messages. Costs more tokens than subagents. Known issues: no session resume for in-process teammates, task-status lag, slow shutdown. **For a 48h demo, prefer SDK-controlled subagents with our own task board.** Agent teams are a fallback, or something to show off only if stable. (Sources are third-party guides; verify against the official docs.)

### 3.6 Cognition — "Don't build multi-agents"
Two principles: **share context (full traces, not just the task)**, and **actions carry implicit decisions**. Flappy Bird example: parallel subagents built a Mario-style background and a mismatched bird. The recommendation is a single-threaded agent, or subagents that only answer well-scoped questions and don't write code in parallel. **Takeaway for us:** parallel Devs are only safe when an **Architect artifact has frozen the shared decisions** (interfaces, design tokens, data model) beforehand. That is what makes the decisions explicit instead of implicit.

### 3.7 MetaGPT and ChatDev
- **MetaGPT** encodes SOPs into role prompts: PM → **PRD** (goals, user stories, competitive analysis, requirement pool) → Architect → **system design** (file list, data structures, interface definitions, sequence diagrams) → PM/Engineer task list → Engineer → QA. Agents exchange **structured documents, not chat**, through a **shared message pool with publish-subscribe** (each role subscribes to the message types it needs). The thesis is that strict handover standards cut hallucination from "idle chatter". Later versions added executable feedback, where the engineer runs its code and debugs from the errors.
- **ChatDev** uses a chat chain (design → coding → testing → docs) of instructor/assistant pairs. **Communicative dehallucination**: the assistant asks for specifics (exact dependency names, etc.) before answering. The weakness is long dialogue and context drift, which MetaGPT's document handoffs avoid.
- **Steal:** typed, schema'd handoff documents plus pub-sub topics, rather than free-form agent chat.

### 3.8 MAST — "Why Do Multi-Agent LLM Systems Fail?" (NeurIPS 2025, 1,600+ annotated traces, κ = 0.88)
14 modes in 3 groups. Most common: **step repetition 15.7%**, **reasoning-action mismatch 13.2%**, **unaware of termination conditions 12.4%**, **disobey task spec 11.8%**, **incorrect verification 9.1%**, **no/incomplete verification 8.2%**, task derailment 7.4%, failure to ask for clarification 6.8%, premature termination 6.2%. Most failures are **system design and verification**, not model IQ. Every top mode maps to a harness control: repetition → loop detector; termination → explicit stop conditions; spec → acceptance criteria in every brief; verification → an independent evaluator using real tools.

### 3.9 2026 "software factory" writeups
- **StrongDM Software Factory** (Feb 2026): "code must not be written by humans / must not be reviewed by humans". **Scenarios** are end-to-end user stories stored **outside the repo as a holdout set**, so agents can't reward-hack them by editing tests or returning true. The success metric is **satisfaction**: the fraction of scenario trajectories that likely satisfy the user, judged by an LLM rather than a green suite. A **Digital Twin Universe** clones third-party APIs (Okta, Slack, Jira, Google) for high-volume testing. Their benchmark is "<$1k tokens/engineer/day means room to improve".
- **Critique** (Dex Horthy, AI Engineer World's Fair 2026, "Harness engineering is not enough"): autonomous factories rot complex codebases ("slop creep"). Delphi's production list: stale context, over-broad diffs, flaky tests, review spam, false confidence, copying the wrong pattern.
- **OpenHands / Devin-style:** sandboxed runtime per agent, an event-stream architecture (every action and observation is a logged event, which works as observability), a planner plus browsing and coding agents, and the "agent checks in a PR, CI judges" pattern. (General knowledge; not re-verified this session.)

---

## 4. Hermes Agent vs. OpenClaw (local helper)

### 4.1 Hermes Agent (Nous Research)
- An MIT-licensed, Python, self-hosted "self-improving" agent. It has a CLI/TUI/desktop app and **one gateway process for Telegram, Discord, Slack, WhatsApp, Signal and Email**, plus agent-curated persistent memory with session search, auto-created **SKILL.md-format skills** (agentskills.io compatible), isolated **subagents**, a built-in **cron scheduler with delivery to any channel**, MCP servers, and 7 terminal backends (local, Docker, SSH, Modal, Daytona…).
- Install: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`, then `hermes setup` (the installer brings uv, Python 3.11, Node 22, ripgrep and ffmpeg). `ollama launch hermes` is reported as a shortcut. **`hermes claw migrate [--dry-run]` imports an existing `~/.openclaw` setup** (settings, memories, skills, API keys).
- **Ollama works** through the OpenAI-compatible endpoint (`provider: custom`, `base_url: http://localhost:11434/v1`). **Hard requirement: a context of at least 64k** (128k recommended); Hermes rejects smaller windows at startup. Ollama defaults to 4k context on machines with less than 24 GB VRAM, so you must set `OLLAMA_CONTEXT_LENGTH=65536` or a Modelfile `num_ctx`.
- **M4 16 GB fit:** the agent itself is light (2–8 GB RAM, about 1 GB disk), but the model is the problem. The local `gemma4:latest` is 9.6 GB of weights, plus a 64k KV cache (several GB), plus macOS and Claude Code/Next dev servers. That is **over budget or swapping**. `qwen2.5-coder:7b` (4.7 GB) at 64k is borderline-feasible but weak at multi-step tool calling. **Verdict: Hermes is runnable but not trustworthy as an orchestrator on local 16 GB models.** It is only worth it pointed at a cloud model, or used narrowly as an always-on notifier/cron sidecar (e.g. "every 10 min, read `factory/status.json` and Telegram me blockers").
- Delegating to Claude Code is not documented in the README; it would have to go through a terminal tool or skill.

### 4.2 OpenClaw (installed)
- `/opt/homebrew/lib/node_modules/openclaw`, version **2026.7.1-2**, TypeScript, configured with `ollama/gemma4`, gateway on loopback:18789 exposed via **Tailscale serve**. It ships a **`coding-agent` skill that delegates background work to Claude Code / Codex / OpenCode**, plus `taskflow`, `tmux`, `session-logs` and `model-usage` skills. For our use (phone-reachable remote control and status of the factory) it is **a better fit than Hermes** because it already exists, it is TS, and it already has the Claude Code delegation skill.
- **Root cause of the failure** (`~/.openclaw/logs/gateway.err.log`): `openclaw requires Node >=22.22.3 <23, >=24.15.0 <25, or >=25.9.0. Detected: node 25.6.0`. The launchd plist `~/Library/LaunchAgents/ai.openclaw.gateway.plist` runs `/opt/homebrew/opt/node/bin/node` (Homebrew `node` 25.6.0). Your shell default is nvm v20.19.0, which is also unsupported, and the installed nvm v23.11 is unsupported too. The service env file is also stale (`OPENCLAW_SERVICE_VERSION='2026.5.2'` while the package is 2026.7.1-2).
- **Fix (pick one):**
  1. **Simplest:** `brew upgrade node` (25.6.0 → 26.12.0, which satisfies `>=25.9.0`). The plist points at the `opt/node` symlink, so it follows the upgrade. Then reinstall/restart the service so the env file regenerates (`openclaw gateway install --force`, or `openclaw doctor`; otherwise `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`). Risk: other Homebrew-node global packages with native modules may need `npm rebuild`.
  2. **More stable (LTS):** `brew install node@24` (24.22.0, keg-only, satisfies `>=24.15 <25`), then reinstall the gateway service with `PATH=/opt/homebrew/opt/node@24/bin:$PATH openclaw gateway install --force` so the plist points at node@24. Optionally `nvm install 24 && nvm alias default 24` for the interactive shell.
  - Check afterwards: `tail ~/.openclaw/logs/gateway.err.log` and `openclaw status`. (Exact `gateway install` flags are unverified; check with `openclaw gateway --help`.)
- **Security note:** `~/.openclaw/openclaw.json` stores the **gateway password in plaintext**, and the gateway is exposed over Tailscale serve. Rotate it and move it to an env var or secret store, especially before demoing on shared networks.
- Context-window caveat as with Hermes: gemma4 on Ollama defaults to 4k context on 16 GB machines unless `OLLAMA_CONTEXT_LENGTH` is raised, and a 9.6 GB model plus a large context will contend with the factory's own processes.

**Recommendation:** fix OpenClaw (option 2), keep it as the **remote-control and notification surface**, and make Claude Code / the SDK the brain. Skip installing Hermes before the hackathon unless you want to compare; it would duplicate OpenClaw and has no edge on 16 GB.

---

## 5. Cross-cutting lessons: what fails vs. what works

| Failure | Evidence | Control that works |
|---|---|---|
| Context drift / lost place after compaction | SDD ledger note; Anthropic long-running harness | Ledger and progress files on disk; startup routine reads git log + progress + feature JSON |
| Agents contradicting each other | Cognition Flappy Bird; MAST FM-2.x | Architect freezes interfaces, tokens and the data model before fan-out; plan "Interfaces: Consumes/Produces" blocks; one integrator |
| Infinite fix loops / step repetition (15.7%) | MAST; gan plateau rule; loop-operator | Hard caps (5 rounds per task, 3 Santa rounds, 15 GAN iterations); plateau = no gain in 2 rounds; identical stack trace twice → escalate model or re-plan |
| Lenient self-evaluation | Anthropic harness paper; gan-evaluator | Separate evaluator on the live app, few-shot calibrated, with hard per-criterion thresholds |
| Reward hacking tests | Anthropic ("unacceptable to edit tests"); StrongDM | Tests and scenarios are read-only to the dev agents; holdout acceptance scenarios outside the dev worktree |
| Premature "done" | MAST FM-3.1; harness paper | JSON feature list with `passes` flipped only by QA; Stop-hook gate |
| Token blowups | 15× multi-agent; 42k-char dispatches | Brief files, not pasted history; ≤15-line return contracts; explicit model per agent; budget check before each call |
| Overlapping writes | team-orchestration; SDD "never parallel implementers" | Worktree per dev lane, lane matrix, disjoint write surfaces, serialized merges |
| Spawning too many agents | Research system (50 subagents) | Effort-scaling rules in the orchestrator prompt; concurrency cap |

---

## 6. Recommendations for our factory (design rules)

1. **Files are the bus, not chat.** Every handoff is a typed artifact under `factory/` with a schema: `brief.md` → `prd.json` (features with acceptance criteria) → `architecture.md` + `contracts.ts` (frozen interfaces/types) + `design-tokens.json` → `tasks.json` → per-task `brief-N.md` / `report-N.md` → `qa/feedback-NNN.json` → `ledger.md`. Agents publish and subscribe by artifact type (MetaGPT pub-sub). The dashboard renders these files directly.
2. **The feature list is JSON and only QA may set `passes`.** Model it on Anthropic's `{id, category, description, steps[], passes}`. Dev agents are denied writes to it, to `tests/acceptance/` and to `scenarios/` via SDK `canUseTool` / PreToolUse hooks. This is anti-reward-hacking that can be enforced mechanically.
3. **Freeze shared decisions before parallelism.** The Architect must emit `contracts.ts`, the DB schema and design tokens, and the orchestrator runs a pre-flight conflict table (task pairs sharing files or interfaces), before more than one Dev starts. This is the fix for Cognition's "implicit decisions" problem.
4. **Parallel Devs only in isolated worktrees with disjoint write surfaces** (lane matrix from parallel-execution-optimizer), cap at 3–4 concurrent, and have **one Integrator** merge serially, running the verification loop after each merge.
5. **Thin vertical slices, one feature per dev task.** Slice 1 is a walking skeleton deployed end-to-end in the first hours (guarantees product completeness), and each later slice is independently demoable. `init.sh` starts everything in one command.
6. **Deterministic gates before LLM gates.** Order: build → `tsc --noEmit` → lint → unit → Playwright e2e, then the LLM Reviewer, then the Evaluator scoring the live app. An LLM never re-checks what a command can check.
7. **Separate, strict Evaluator on the live app.** Use the Playwright-driven QA agent with a weighted rubric, **plus hard per-criterion floors** (any criterion below 6 fails) and few-shot calibrated examples. Feedback follows the "issue → how to fix" format and is passed as a file. The Evaluator never fixes code.
8. **Bounded self-correction with escalation.** Per task: up to 5 fix rounds; rounds 1–3 resume the same Dev, rounds 4–5 use a fresh Dev one model tier higher, and the round-5 breaker produces a recorded Ruling (park or minimal unblock). Per build loop: max N iterations, with a **plateau stop when 2 rounds bring no score gain**. The **same error signature twice** forces a strategy change (re-plan or model bump), never a third identical retry.
9. **Rulings, not stalls.** The orchestrator never blocks on the human mid-run. It records `Ruling: decision — why — cost if wrong` in the ledger and surfaces every ruling in the final report. It stops only for destructive, security-sensitive or external-publish actions, or for a plan with no viable path. This makes autonomy visible to the judges.
10. **The ledger is the recovery map.** Use an append-only `ledger.md` plus git commits per task. Every agent session starts with: read ledger + `git log` + `prd.json` → run `init.sh` → smoke test → pick the next failing feature. A crashed or compacted orchestrator resumes without redoing completed work.
11. **Lean dispatches.** Each subagent receives a brief file path, the relevant contracts and the global constraints, never the whole plan or prior history. It returns ≤15 lines (`DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` + commits + test summary) and writes details to its report file. Implementers may not spawn subagents.
12. **Right model per role, always explicit.** Opus for Orchestrator, Architect and final review; Sonnet for Product/UI-UX, Devs on judgment-heavy tasks, QA/Evaluator and per-task review; Haiku for transcription tasks, log summarizing, classification and status narration. Never let a subagent inherit the session model by default.
13. **Budget and stop conditions as code.** A global `$` cap and a per-agent token cap tracked from SDK `usage` on every result message, with the budget checked **before** each dispatch. Wall-clock caps per phase. Retry only transient API errors (429/5xx/connection) 3× with backoff. Concurrency cap. A kill switch file (`factory/STOP`) checked between turns.
14. **Observability by default.** Every agent event goes to `logs/<agent>/<run-id>.jsonl` as `{ts, agent, role, model, task_id, tool, in_tokens, out_tokens, cache_read, usd, status}`, plus heartbeats. The dashboard shows a Kanban (Backlog/Ready/Running/Review/Blocked/Merged), per-agent token/$ burn, evaluator score progression per iteration, and merge readiness "by gate, not vibes".
15. **Stop-hook delivery gate plus holdout acceptance.** A Stop hook (delivery-gate pattern) refuses "done" unless `prd.json` must-haves all pass, the verification report says READY and the latest eval is ≥ threshold. The final acceptance run uses scenarios the Devs never saw (StrongDM holdout idea), executed by a fresh QA agent; two independent reviewers (Santa) are reserved for the final release gate only, to control cost.

Ops note: fix OpenClaw (node@24 or `brew upgrade node`), rotate its plaintext password, and use it only as a phone-side status/remote-trigger surface through its `coding-agent` skill. Do not put a local 16 GB model in the critical path.

---

## Sources

Local:
- `~/.claude/plugins/cache/ecc/ecc/2.2.3/skills/{orch-pipeline,orch-build-mvp,dev-team,team-agent-orchestration,gan-style-harness,plan-orchestrate,continuous-agent-loop,delivery-gate,verification-loop,santa-method,parallel-execution-optimizer,token-budget-advisor,cost-aware-llm-pipeline,hermes-imports}/SKILL.md`
- `~/.claude/plugins/cache/ecc/ecc/2.2.3/agents/{gan-planner,gan-generator,gan-evaluator,loop-operator}.md`, `commands/{orch-build-mvp,gan-build}.md`
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/{subagent-driven-development,dispatching-parallel-agents,using-git-worktrees,writing-plans}/`
- `/opt/homebrew/lib/node_modules/openclaw/package.json` (engines), `~/.openclaw/logs/gateway.err.log`, `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, `openclaw/skills/coding-agent/SKILL.md`

Web:
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Cognition — Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents)
- [MAST — Why Do Multi-Agent LLM Systems Fail? (arXiv 2503.13657)](https://arxiv.org/html/2503.13657v3)
- [MetaGPT (arXiv 2308.00352)](https://www.arxiv-vanity.com/papers/2308.00352) · [ChatDev (arXiv 2307.07924)](https://arxiv.org/html/2307.07924v5)
- [StrongDM Software Factory](https://factory.strongdm.ai/) · [AI Engineer 2026 — Harness engineering is not enough](https://ai.engineer/talks/harness-engineering-is-not-enough-why-software-factories-fail) · [Stanford Law — Built by Agents, Tested by Agents](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/)
- Claude Code agent teams (third-party guides): [morphllm](https://www.morphllm.com/claude-code-agent-teams), [fast.io](https://fast.io/resources/claude-code-agent-teams-setup/)
- Hermes Agent: [README](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md), [DevelopersDigest guide 2026](https://www.developersdigest.tech/blog/hermes-agent-guide-2026), [fast.io Ollama guide](https://www.fast.io/resources/hermes-agent-ollama-local-llm/), [hermesagents.net install](https://hermesagents.net/install)
