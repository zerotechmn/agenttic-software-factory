# Event day runbook (Oct 30)

## Team (4–5 people; at most 1 each of Tech lead, UI/UX, QA, System engineer)
- **Operator / Tech lead:** runs FORGE, answers clarify questions, steers only (notes, backlog). Never hand-edits code: hand commits count as high-impact interventions.
- **Presenter (PM/BA):** owns the 20% presentation: demo script below, the run report metrics, the factory diagram.
- **QA:** tries the deployed app by hand like a judge, files issues as backlog items (steering, low impact).
- **System engineer:** auth/API key, Docker, network, the deploy URL judges will open.
- Everyone: be ready to answer "which agent did X, show the log" from `.forge/events.jsonl` and `ledger.md`.

## Day before
- [ ] Disable the OpenClaw night-build cron (`forge-night-build`) so nothing spends tokens on the day
- [ ] Full rehearsal run on a sample brief; check `docs/RUN_REPORT.md` shows Efficiency + Autonomy

## Before you leave home
- [ ] `cd ~/factory && git pull` (if pushed) and `npm test`: all green
- [ ] `./scripts/verify-template.sh`: TEMPLATE OK (also warms the npm and Playwright caches)
- [ ] `ollama run gemma4 "hi"`: the local tier answers (optional; the factory falls back without it)
- [ ] Docker Desktop running (`docker info`)
- [ ] Charger, power strip, phone hotspot as a network fallback

## At the venue, before the brief
1. Set auth for the company tokens:
   - Anthropic key: `export ANTHROPIC_API_KEY=...`
   - Bedrock/Vertex/Foundry: `export CLAUDE_CODE_USE_BEDROCK=1` (etc.) plus the provider credentials
   - Check with a tiny run: `claude -p "say ok" --model haiku`
2. Pick the budget. Rule of thumb from practice runs: see "Cost reference" below. Use about 60% of the allowance for the first full run and keep the rest for fix rounds and a second product iteration.

## When the brief drops (minute 0)
1. Paste the brief into `~/briefs/event.md` as is. Add a `## Constraints` section only for facts the organizers state (stack demands, deploy target).
2. Run:
   ```bash
   ./forge run ~/briefs/event.md --budget <USD> --deadline <ISO end time> --clarify-minutes 5 --out ~/forge-runs/event
   ```
   Product posts its open questions (each with the assumption it builds on) as a `clarify` event and in the ticker. Answer within 5 minutes by clicking the Product character and sending a note (or Ask FORGE → send_note). No answer = the assumptions stand and are logged as rulings; the factory never blocks.
3. Open the office console on the big screen: `./forge console` → `http://127.0.0.1:4300/office/` (or the plain monitor at `http://127.0.0.1:4317`). This **is** the demo of the factory.
4. While Product and Architect work (~5–10 min), read `docs/prd.json` once. If it misread the brief badly: `./forge stop`, edit `docs/brief.md` to clarify, delete `.forge/state.json`, and re-run.

## If the run stops at the stack check
The critic found a brief requirement the house stack (TypeScript web: React + Hono + SQLite) can't meet, e.g. "must be Django" or "native iOS app". The ticker and ledger say which. Decide with the team, then either:
- build the web app anyway: `./forge resume ~/forge-runs/event --accept-stack` (logged as a ruling), or
- hand that part to the team and let FORGE build the rest.

## During the build
- Watch the **Rulings** panel: those are the decisions the factory took alone. They make good demo talking points.
- A task parked on a real blocker: read `.forge/reports` / `ledger.md`. Prefer steering (a note, `forge iterate`, `resume --retry-parked`) over hand fixes: autonomy is scored and hand commits show up as high-impact in the report.
- Need to change models mid-run: `./forge stop`, then `./forge resume <dir> --model-dev opus`.
- Out of budget: landing mode kicks in automatically at 80%. You can top up with `./forge resume <dir> --budget <higher>`.

## Failure playbook
| Symptom | Do |
|---|---|
| Orchestrator crashes | `./forge resume <dir>` (state is saved after every step) |
| Same task keeps failing | Check its feedback in the events. Usually a contract gap: fix `src/shared/contracts.ts` by hand, commit, resume |
| Main gate red after a merge | The factory reverts automatically. If it stays red, run `npm run check` in `<dir>` and fix by hand |
| Rate limits (429) | Retried automatically. Lower concurrency: stop, then `resume --concurrency 2` |
| Docker unavailable | DevOps falls back to `npm run build && npm start` on :8788 |
| Factory unusable | Plan B: `./forge export-agents <dir>`, open Claude Code in `<dir>`, follow `FACTORY.md` |

## Demo script (5 min), mapped to the judging criteria
Product 20 · Orchestration 20 · Presentation 20 · Quality 10 · Self-correction 10 · Tokens 10 · Autonomy 10
1. **The factory:** the monitor on screen. "One command, nine roles, files as the contract between them."
2. **Autonomy:** the phase rail, then the task board filling up with parallel developers in isolated worktrees.
3. **Quality gates:** show a task that failed the gate and fixed itself (count under "Self-fixes"), and an escalation.
4. **Self-correction:** the QA score rising across rounds; QA tests the live app with scenarios developers never saw.
5. **Guardrails:** budget bar, landing mode, rulings, the guard denying a dev's edit of the PRD/tests.
6. **The product:** open the deployed app (`.forge/deploy.json` url), then the generated `docs/RUN_REPORT.md`.
7. **Numbers (tokens + autonomy):** the report's Efficiency section (tokens and $ per working feature, cache hit %, model per role) and Autonomy section (% code by agents, interventions by impact). `docs/metrics.json` is the same data for judges.

## Cost reference (practice runs, 2026-10-16, default models)
| Brief | Features | Tasks | Wall time | Spend | QA | Notes |
|---|---|---|---|---|---|---|
| tiny-notes | 7 (4 must) | 5 | 14 min | $8.82 | 9.2 | Includes ~$3 wasted before the worktree-symlink fix |
| medium-tracker | 10 (6 must) | 7, all first try | 18 min | $12.82 | 9.0 | Includes a subscription usage-limit outage (now auto-paused) |
| tiny-notes (verify) | 7 | 5, all first try | ~15 min of work | $8.90 | 8.0 | Paused itself on a usage limit overnight, then resumed and finished on its own |

| tiny-notes (after efficiency pass) | 7 | 4, all first try | ~6 min | **$1.42** | 8.5 | strict MCP isolation + cacheable prompt + context pack + review skip: 84% cheaper than $8.90 |

Rules of thumb (pre-efficiency numbers below; expect roughly 1/4–1/5 of them now):
- About $1.0–1.5 per task (dev $0.5 plus review $0.4 plus gates), about $2–3 fixed (product, architect, UI/UX, final review), and about $0.5–1 per QA round.
- A typical hackathon brief of 10–15 tasks plus 2–3 QA rounds costs **$20–35 per full pass**. Budget 2–3 passes (iterations, extra features) out of the company allowance.
- **Subscription accounts hit the 5-hour session limit fast** with 3 parallel agents. The runner now pauses and re-probes every 10 min, but on the day use the company API key (no session limit, only 429s, which are retried).
- Lower cost: `--model-reviewer haiku` (about 40% of review spend) or `--concurrency 2`. Higher quality: `--model-dev opus`.
