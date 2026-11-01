# Brief: Living Foundry: a glowing factory-floor visualizer for an AI software factory

Build a web app that shows the FORGE multi-agent factory as a **living neon foundry**, drawn entirely in code with no image assets. Work flows through glowing machines like energy through a circuit. It's the stage demo for a hackathon: it must look premium and alive on a projector, never like a flat dashboard.

## The experience
- A dark, deep-space background with slow parallax bokeh. Across the screen, **one machine per pipeline phase**, left to right: Intake funnel → Product forge → Research antenna → Architect core + Design prism (side by side) → **three Developer assemblers** (stacked, running in parallel) → Review scanner gate → Main reactor (merges) → QA crucible → Deploy launch pad. Machines are built from Pixi Graphics: rounded hulls, rotating rings, pulsing cores, each tinted with its role color.
- **Agents are glowing orbs** that dock onto their machine while an `agent_start`…`agent_done` is active. The machine "works" (rings spin faster, core pulses, sparks) and a floating label shows the latest `tool`/`say` text.
- **Tasks are energy packets** riding glowing conveyor traces between machines. A packet's color is its status.
  - Gate pass / review approve: the packet passes through a green scanner.
  - Fail or reject: it **bounces off a red barrier** with a shockwave and glitch flash, then loops back along a return trace to its developer (self-correction made visible). Escalation (`note` mentioning escalate) turns the packet violet and sends it to a bigger assembler.
  - Merge: the packet is "welded" into the Main reactor with a bright flash, and the reactor grows a ring.
- **Handoffs between agents** are lightning arcs (animated bezier beams) drawn from the sender machine to the receiver when work moves on.
- **Budget** is a liquid reactor tank on the side (animated fluid level and color from cyan to amber to red; landing mode makes it pulse amber). **QA score** is a charging radial gauge that fills up to the 7.0 pass line. Rulings appear as brief holographic toasts.
- **Interaction:** hover a machine to highlight its traces. Click it to **zoom the camera smoothly** onto it and open a glass side panel with the live agent log (tools, says, tokens, spend), the tasks it handled, and a "transmit" text box (POST to `/forge/say`; if FORGE doesn't support it yet, store the note locally and show it as sent). Keyboard: 1/4/0 sets the replay speed, R restarts the replay, F toggles fullscreen.
- Top HUD: product name, phase rail, elapsed, spend/budget, merged/total, self-fixes count.

## Technical direction
- Frontend: React + **pixi.js v8** + **@pixi/react**, **pixi-filters v6** (AdvancedBloom/Glow, Shockwave, Glitch: apply bloom once on a top-level container, not per sprite), **gsap v3** for tweens and timelines. Particle effects with a pooled ParticleContainer. Target 60 fps at 1920×1080. Degrade gracefully (fewer particles) on slow GPUs.
- **No image assets at all**: everything is procedural Graphics, gradients, filters and text. This is deliberate.
- The server proxies `/forge/events`, `/forge/state` and `/forge/say` to FORGE_URL, and switches transparently to replay of `fixtures/sample-run.jsonl` when FORGE is unreachable.
- Event processing is a pure, unit-tested reducer (`events → scene model`), so visuals stay a thin layer over tested state.

## Dependencies allowed
pixi.js@^8, @pixi/react@^8, pixi-filters@^6, gsap@^3.

## FORGE event source (shared by all dashboard briefs)
The factory exposes, on `FORGE_URL` (default `http://127.0.0.1:4317`, CORS open):
- `GET /events`: Server-Sent Events. It first replays every past event, then streams live ones. Each `data:` line is a JSON `ForgeEvent`:
  `{ ts (ms), run, phase, role?, agentId?, taskId?, kind, model?, tokensIn?, tokensOut?, cacheRead?, usd?, status?, text?, data? }`
  - `phase`: intake | product | research | design | contract_gate | build | qa | final_review | deploy | report | done
  - `role`: product | researcher | architect | uiux | dev | reviewer | integrator | qa | final_reviewer | devops
  - Key `kind`s:
    - `phase_start` / `phase_end`
    - `agent_start` (an agent begins; `agentId` is unique, e.g. `dev:T3#12`) / `agent_done` (status ok|fail, usd, tokens)
    - `tool` (agent used a tool; `text` = short description) / `say` (agent's short message)
    - `task_status` (status: running|review|merged|parked)
    - `gate` (status pass|fail) / `review` (status approve|reject|skipped) / `task_fail` (feedback is sent back to the developer)
    - `conflict`, `ruling` (an autonomous decision), `note`, `guard_deny` (the guard blocked an agent action)
    - `qa_result` (status = score 0–10), `landing` (budget mode), `paused` / `resumed` (usage limit), `deploy`, `run_done`, `stopped`, `run_error`
- `GET /state`: JSON `{ run, phase, done[], tasks[{ id, title, status, attempts, escalated, featureIds, kind }], qaRounds[{ round, score, failures }], spend{ usd, byRole, local, remote }, landing, budgetUsd, prd{ product, features[{ id, title, priority, passes }] } }`

Handoffs, to visualize as "who talks to whom":
Product → Researcher(s) → Architect ∥ UI/UX → Developers (parallel) → Reviewer → Integrator/main → QA → (failures → Developers) → Final reviewer → DevOps.

**Replay mode is required:** `fixtures/sample-run.jsonl` is a real recorded run (one ForgeEvent per line). The app must be able to play it back at 1×/4×/10× with no factory running, and must use it when FORGE_URL is unreachable. This is the safe stage demo.

## Out of scope
Authentication. 3D. Editing the factory. Sound (nice-to-have only).
