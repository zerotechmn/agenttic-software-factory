# SDD ledger — plan: docs/superpowers/plans/2026-10-16-forge-factory.md
Setup: Ruling: fresh repo with no main history — work on branch build/forge in ~/factory instead of a worktree — cost if wrong: none (branch is isolated)
Pre-flight: T5 consumes T2 Budget/makeGuard, T3 schemas/roles, T1 EventBus — consistent. T9 consumes T4 compressFailure, T5 AgentRunner, T6 runGate/signature/git, T7 readyTasks/laneConflicts/validatePlan — consistent. T9 build re-entry from QA: plan says remove 'build' from done — consistent with T1 RunState.done: Phase[].
Task 1: complete (commits da6278e..f494cc8, tests: npx vitest run →    Duration  172ms (transform 32ms, setup 0ms, collect 34ms, tests 5ms, environment 0ms, prepare 75ms))
Task 2: Ruling: plan said guard = canUseTool — canUseTool is skipped under bypassPermissions, so guard is a pure checkTool() exposed as a PreToolUse hook (guardHooks) which fires in every mode — cost if wrong: swap adapter, checkTool unchanged
Task 2: complete (commits f494cc8..b1020fe, tests: npx vitest run →    Duration  197ms (transform 82ms, setup 0ms, collect 122ms, tests 10ms, environment 0ms, prepare 189ms))
Task 3: Ruling: added DeployReport schema and Prd.pitch/users/outOfScope fields beyond plan — devops + report phases need them — cost if wrong: unused fields. Note: role prompts assume template has src/web/components/ui/{Button,Card,Input,Badge,EmptyState}, HealthResponse in contracts, routes via Hono app.request(), Playwright BASE_URL — Task 8 must provide these.
Task 3: complete (commits b1020fe..559992b, tests: npx vitest run →    Duration  231ms (transform 100ms, setup 0ms, collect 179ms, tests 13ms, environment 0ms, prepare 221ms))
Task 4: complete (commits 559992b..777ce9d, tests: npx vitest run →    Duration  309ms (transform 149ms, setup 0ms, collect 245ms, tests 31ms, environment 1ms, prepare 520ms))
Task 5: live haiku smoke run passed ($0.02): structured output, guard deny, spend. Found+fixed guard bug: /var vs /private/var symlink — canonical() realpath; test "treats /var and /private/var spellings" RED→GREEN. Ruling: SdkAgentRunner takes a phase() getter (4th ctor arg ordering: bus, budget, phase, queryFn, backoff) — needed to tag events/spend by phase — cost if wrong: ctor signature change.
Task 5: complete (commits 777ce9d..ed4437f, tests: npx vitest run →    Duration  356ms (transform 208ms, setup 0ms, collect 454ms, tests 41ms, environment 1ms, prepare 482ms))
Task 6: Ruling: revertLastMerge uses reset --hard HEAD^1 instead of git revert — a revert commit would make git treat the branch as merged and block re-merging the fixed branch; main is orchestrator-only — cost if wrong: lost history of failed merges (ledger keeps it). Ruling: initRepo writes .forge/ to .git/info/exclude so worktrees under .forge/wt never dirty main.
Task 6: complete (commits ed4437f..b68555b, tests: npx vitest run →    Duration  1.39s (transform 211ms, setup 0ms, collect 604ms, tests 1.69s, environment 1ms, prepare 580ms))
Task 7: Ruling: added serializeConflicts() helper for the contract-gate ruling — plan describes the behavior, no named function — cost if wrong: none.
Task 7: complete (commits b68555b..c733874, tests: npx vitest run →    Duration  1.42s (transform 240ms, setup 0ms, collect 564ms, tests 1.72s, environment 1ms, prepare 630ms))
Task 8: Ruling: toolchain requires Node ≥22 (vitest 5, jsdom 30, better-sqlite3 13) — installed Node 24.22 via nvm (user-level) and the factory/template run on it; .nvmrc=24 — cost if wrong: switch PATH back. Ruling: Dockerfile compiles better-sqlite3 in build stage (python3/make/g++) and copies pruned node_modules — no linux-arm64 prebuilt for node24. Added src/shared/product.ts (PRODUCT_NAME), src/web/lib/{api,useAsync}.ts, db/migrate.ts beyond plan — gives agents fixed patterns. verify-template.sh: check+build+e2e+docker build all green; container serves /api/health and SPA.
Task 8: complete (commits c733874..242b93a, tests: bash scripts/verify-template.sh → TEMPLATE OK (/var/folders/5m/x16l062j74vfrdpckpz6rzth0000gn/T/tmp.yGGxnPOur4/house))
Task 9: Ruling: QA re-entry implemented as a loop inside the qa phase that calls build() for fix tasks (instead of removing 'build' from done) — simpler resume semantics, rounds persist in state — cost if wrong: none observed.
Task 9: Ruling: contract-gate lane conflicts are serialized deterministically with a ruling (no architect LLM repair for lanes) — saves tokens; architect repair is used only for a red baseline — cost if wrong: less parallelism.
Task 9: Ruling: Ctx moved to src/ctx.ts with injectable gate/app/install/local; Task gained `escalated` flag; worktrees symlink node_modules from main.
Task 9: Ruling: final review fix tasks use id prefix FIXR-n; QA fix tasks FIX<round>-n chained sequentially.
Task 9: complete (commits 242b93a..6708a90, tests: npx vitest run →    Duration  6.39s (transform 372ms, setup 0ms, collect 1.02s, tests 7.75s, environment 1ms, prepare 717ms))
Task 10: Ruling: /state also returns budgetUsd, concurrency and the PRD (monitor needs them); added ./forge launcher pinning Node 24; startApp (real QA app runner) in src/appRunner.ts; serve without a live bus tails events.jsonl. Monitor screenshot verified (fake run), no console errors.
Task 10: complete (commits 6708a90..2b3f41b, tests: npx vitest run →    Duration  6.26s (transform 367ms, setup 0ms, collect 996ms, tests 7.86s, environment 1ms, prepare 653ms))
Live-run fix: Ruling: per-call cap gains per-role floors (architect $1.5, dev $1, qa $1.2…) bounded by remaining budget — tiny-1 product hit $0.40 cap; test "gives heavy roles a minimum per-call cap" RED→GREEN — cost if wrong: one call can spend more of a small budget.
Live-run fixes (tiny-1): (A) node_modules symlink committed from worktrees → merge+revert deleted main node_modules; fix: info/exclude + template .gitignore `node_modules` (no slash); test "never commits a node_modules symlink" RED→GREEN. (B) guard denied reading main node_modules via resolved symlink; fix: policy.readable; test RED→GREEN. (C) SDK throws after yielding result on budget cap → spend lost; fix: keep result / map message to subtype; 2 tests RED→GREEN. (D) Ruling: capped dev attempts are still committed+gated (work may be complete) — test RED→GREEN — cost if wrong: an incomplete change can reach review (gate+review still apply). (E) STOP waits for in-flight tasks; ensureDeps restores node_modules on resume; test RED→GREEN.
Live-run fixes (medium-1): subscription 5h session limit hit → every agent returned "You've hit your session limit · resets 6:50pm" and all 7 tasks parked in 30s. Fix: SdkAgentRunner detects usage-limit text, pauses until parsed reset (+1 min, 30s steps, STOP aborts, maxPause 6h), retries same call; 4 tests RED→GREEN. Fix: startApp killed the orchestrator (lsof -ti tcp:PORT lists clients) → -sTCP:LISTEN (exit 137 root cause). Added `resume --retry-parked` (retryParked(), test RED→GREEN).
Live-run fix (medium-1): deploy port clash (8788 held by tiny-1) → orchestrator picks freePort(8788) for DevOps and deploy ok = health check (agent self-report kept as agentOk); tests "trusts a passing health check" + "freePort skips a port in use" RED→GREEN.
Final: Ruling: per-call caps now subtract a deploy+report reserve (max $0.5, 4%) outside deploy/report — I5; two older budget tests moved to the deploy phase to keep checking the floor/remaining logic — cost if wrong: build calls slightly smaller near the end.
Final review: opus reviewer — 1 Critical, 7 Important, 7 Minor. Re-graded M6 (no per-call timeout) to Important: a hung stream stalls an unattended 48h run.
Final: fixed C1 (bash bypasses guard) — post-attempt restore of DEV_READONLY vs merge-base + main integrity (mainSha/ensureMain) + bash heuristics (git -C, $HOME, ../ climb, writes to read-only paths, history rewrites); tests "C1: restores protected files…", "C1: drops a commit a dev made directly on main…", 6 guard cases RED→GREEN.
Final: fixed I1 (reset HEAD^1 after no-op merge deletes prior merge) — reset to recorded pre-merge sha only if HEAD moved; test "I1: …never deletes an earlier task's merge" RED→GREEN.
Final: fixed I2 (resume doesn't repair main) — ensureMain before every phase and every merge: abort MERGE_HEAD, drop index.lock, discard dirt, rewind to mainSha; test "I2: resume repairs main" RED→GREEN.
Final: fixed I3 (QA/devops commit product code) — commitMain(allowedGlobs) reverts out-of-scope changes; test "I3: QA cannot commit product code" RED→GREEN.
Final: fixed I4 (QA app start failure kills run) — becomes a 0-score round + fix task; test "I4" RED→GREEN.
Final: fixed I5 (no deploy reserve) — Budget.reserve(), exhausted(phase), caps subtract reserve; tests RED→GREEN.
Final: fixed I6 (false usage-limit match; limits burn attempts) — only failed short results match; exhausted pause throws UsageLimitError (a Stopped) to halt cleanly; tests RED→GREEN.
Final: fixed I7 (spend gaps, parallel overshoot) — $/token estimate for result-less calls, hold/release per call; tests RED→GREEN.
Final: fixed M6 (no wall-clock timeout) — 30-min AbortController per call → subtype timeout; test RED→GREEN. Suite 114/114.
Final: minor (deferred): M1 resume mid-QA runs a QA round before leftover backlog fix tasks; fix-task lanes not re-checked for conflicts.
Final: minor (deferred): M2 cycle-fallback concurrency=1 not persisted across resume.
Final: minor (deferred): M3 bare directory lanes (no glob) only compared by equality.
Final: minor (deferred): M4 reviewer diffs base..HEAD, includes main's changes after an integrator merge.
Final: minor (deferred): M5 compressFailure ignores ctx.local/cfg host+model and isn't counted in % local.
Final: minor (deferred): M7 shared node_modules symlink — a dev `npm install` mutates main's deps.
Live (tiny-2): fixed guard false positive — `cd sub && ../../x` resolved from root; now also from cd targets; test RED→GREEN. Observed (by design): architect denied writing src/web/components/notes/* (UI/UX + devs own components).
Live (tiny-2): Ruling: ../ climb check applies only to writing commands (grep patterns like "../db/client.ts" were denied); reads outside are covered by the absolute-path check and post-attempt write enforcement — cost if wrong: an agent can read a sibling dir via ../. Fixed reviewer false positive on `2>/dev/null` (harmless redirects stripped). NOTE: commit 2fd… went in with 1 red test (pipe masked vitest exit); corrected here, suite 119/119 with real exit code checked.

## 2026-10-17 — efficiency + researcher
- perf: static cacheable system prompt (excludeDynamicSections+snapshot); shared context pack first in dev dispatch; LLM review skipped under 80 changed non-test lines; reviewer haiku, final reviewer sonnet.
- perf+security: strictMcpConfig — agents no longer inherit ~110 claude.ai connector tools (~100k tokens/call; email/drive actions under bypass).
- fix: contract-gate repair architect may edit UI/UX files (tiny-3 failed: UI/UX left a type error in components/ui, architect was forbidden to fix it).
- feat: Researcher role + research phase (≤3 topics in parallel, sonnet, $1 cap/topic, scrapling+context7 MCP, no Bash, readRoots=project, one writable file); PRD.researchQuestions; INDEX.md built deterministically and shared in the dev context pack; prdImpact → ledger rulings.
- feat: brief attachments (`<brief>.files/` → fixtures/); architect may install brief-allowed dependencies (only role allowed to touch package.json).
- Ruling: on-demand research for NEEDS_CONTEXT deferred — planned research covers event briefs; cost if wrong: a dev guesses an external fact.

## 2026-10-17 — dashboard builds
- Night: dashboard-B built autonomously (11 tasks, QA 7→8, $8.68); cron resume at 04:55 worked. Foundry v1 = working skeleton, plain visuals.
- feat: screenshot-based visual QA (score <7 fails; issues → fix tasks); `forge iterate`; POST /say operator notes; usage-limit refund + configurable probe.
- Iteration: 6 visual IT tasks merged first try ($2.14) → Foundry v2: distinct machines, labels, glow, packets, HUD column, ticker. QA rounds all failed to report (2 invalid output, 2 hung to 30-min timeout).
- dashboard-A: architect + researcher hung to 30-min timeout (long/blocked shell & MCP waits).
- fix: idle watchdog (10 min no SDK activity → abort); per-role timeoutMin (architect, QA 45); guard denies run_in_background shell jobs; task lanes override non-core read-only config (FIXR-1 vite.config.ts deadlock); QA "reply with the report" nudge on invalid output. Tests RED→GREEN; suite 145/145.
- dashboard-A: done but broken (wrong floor tiles, no characters): atlas task T2 parked after 5 tries, $15 exhausted with 52 self-fixes; QA rounds 2–4 ran on a $0.05 cap. fix: QA stops with a ruling when the cap is below the QA floor (test RED→GREEN, 146/146).
- fix: pause loop counts wall-clock time (Mac sleep stalled B for hours); QA e2e specs that break typecheck are reverted before commit (FIX1-3 deadlock). Tests RED→GREEN, 148/148.
- dashboard-A rebuild FAILED: a QA e2e spec broke **lint** on main (my earlier fix only covered typecheck) → every dev gate failed on a file devs can't edit → 24 tasks parked, ~$14 wasted. My fault.
- fix: house template + both runs exclude tests/e2e and tests/acceptance from lint/typecheck (QA-owned; Playwright runs them); systemic-failure breaker — 2 distinct tasks failing with the same signature halts the build with a ruling instead of parking everything; signatures normalize worktree paths. Tests RED→GREEN, 150/150; template check green.
- moved asset helper scripts (grid/preview renderers used for the hand-verified atlas) to scripts/asset-tools.
- feat: per-role skills (roles/*.md `skills:`; copied into the agent's cwd, git-ignored; SDK skills filter hides the rest; Pixi stack adds game skills). Verified live: reviewer sees exactly coding-standards, react-patterns, security-review (9k ctx, $0.002). Operator session keeps ECC/superpowers.
- office-v2 built BY FORGE (brief samples/briefs/office-v2.md, --from office): 11/11 tasks first try, QA 8/8, $4.14. Verified by hand (board panel, zoom 3→4, tooltips, coffee walks, no page errors); merged into office/ (42 tests). Excluded an unused src/web/theme.css leftover.
- office v3 via forge iterate (4 IT tasks + operator backlog OP-1 added live from the office UI): fewer coffee breaks, QA visibly carries bugs, 2x carried items, 1.6x errand speed, stale agents silenced on phase change (root cause: unmatched agent_start/done in recording). 5/5 first try, QA 8.5, +$1.12. Verified in browser; merged (46 tests).
- office v4 via FORGE (IT2: coffee bubble, live-updating board panel, iteration banner) merged; QA 6x3 was an env artifact (vite preview proxied to the live factory on :4317 → QA saw LIVE mode). fix: preview proxies only with FORGE_LIVE=1; hide StructuredOutput bubbles; vitest includes tests/**.
- office: tests/unit (15 files FORGE devs wrote) never ran — vitest include was tests/*.test.ts; now tests/**, env happy-dom: 24 files / 75 tests green. Preview proxy really disabled unless FORGE_LIVE=1 (isPreview). DEFERRED factory gap: detect new test files the runner doesn't collect.

## 2026-10-20 · RTK trial (FORGE_RTK=1), tiny-notes A/B, same commit
| | total | dev | dev/task | bash calls | tasks/attempts | QA |
|---|---|---|---|---|---|---|
| base | $1.84 | $0.724 | $0.145 | 49 | 5/5 | 9 |
| rtk | $1.69 | $0.650 | $0.130 | 40 | 5/5 | 9 |
Total −8% (below the 10% bar). `rtk gain` measured only 5.3K tokens saved (15% of 35K command-output tokens), worth cents; most of the gap is run-to-run noise (the architect, which barely uses Bash, also differed by 11%). Decision: keep the option, off by default. Command output is a small part of spend; prompts/context and retries dominate.
