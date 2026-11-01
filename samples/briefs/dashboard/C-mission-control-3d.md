# Brief: Mission Control 3D: a cinematic command deck for an AI software factory

Build a web app that shows the FORGE multi-agent factory as a **3D sci-fi command deck**. Each agent is a small animated robot at its station, and a director camera cuts to whatever is happening. It's the stage demo for a hackathon: it must feel cinematic.

## The experience
- A circular low-poly deck (sci-fi floor, consoles, holo-table in the middle) built from CC0 Kenney Space Station / Factory kit models. **Stations around the ring** in pipeline order: Product, Research, Architect, Design, three Developer bays, Review, QA, Deploy.
- **Agents are robots** (CC0 Quaternius LowPoly Robot, tinted per role) at their stations.
  - Idle: idle animation.
  - Working (between `agent_start` and `agent_done`): standing/working animation, with a holo-screen above the console showing the latest `tool` text.
  - Gate pass / review approve: "Yes" or thumbs-up animation. Fail or reject: "No" animation and a red holo flash.
  - `run_done`: every robot dances.
- **Handoffs:** a glowing data cube flies along an arc from one station to the next. Rejections fly back. Merges drop into the central holo-table, which builds a growing 3D "product" of stacked blocks (one per merged task).
- **Director camera:** smoothly cuts and dollies to the station with the newest event. "Free camera" mode uses orbit controls. Keyboard: D toggles director mode, 1/4/0 sets the replay speed.
- **Interaction:** click a robot to focus it and open an HTML overlay panel with its live log, model, task and spend.
- A 2D HUD over the canvas: phase rail, spend/budget bar, QA score gauge, merged/total, rulings ticker. Bloom post-processing for neon accents.

## Technical direction
- Frontend: React + **three** + **@react-three/fiber** + **@react-three/drei** (useGLTF, useAnimations, OrbitControls, Html) + **@react-three/postprocessing** (Bloom). One robot GLB cloned per agent with SkeletonUtils. Keep ≥ 45 fps on a laptop. Keep draw calls low (instanced consoles).
- **Assets (all CC0):** Quaternius LowPoly Robot (GLB/glTF), Kenney Space Station Kit and Factory Kit (glTF). A script downloads them into `public/models/`, with URLs and licenses recorded in `docs/CREDITS.md`. **Fallback:** if a model fails to load, render a procedural capsule robot so the scene never breaks.
- The server proxies `/forge/events` and `/forge/state` to FORGE_URL, and falls back to replaying `fixtures/sample-run.jsonl`.
- Event handling is a pure, unit-tested reducer (`events → scene model`). The 3D layer only renders that model.

## Dependencies allowed
three@^0.17, @react-three/fiber@^9, @react-three/drei@^10, @react-three/postprocessing@^3, postprocessing@^6.

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
Authentication. VR. Editing the factory.
