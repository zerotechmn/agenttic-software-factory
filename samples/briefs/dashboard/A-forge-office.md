# Brief: FORGE Office: a living pixel-art office where an AI software team works

Build the live demo screen for FORGE, an autonomous multi-agent software factory. It shows the factory as a **cozy top-down pixel-art office** (think *Stardew Valley* / *Gather.town* / *Pixel Agents*). Each AI agent is a little character at its desk, work is carried desk to desk, and you can click anyone to see what they're doing. It runs on a projector in front of judges, so it has to feel **alive, charming and readable from 5 meters**. It must not look like a dashboard with sprites glued on.

## Quality bar (non-negotiable)
- Every element animates or reacts. No static indicators, no plain rectangles, no unlabelled shapes.
- Pixel art is rendered crisp (nearest-neighbor, integer scale 3× for 16 px tiles) on a full-screen canvas. UI text uses a pixel font (bundle `@fontsource/press-start-2p` for headings and `@fontsource/vt323` for body text). Use one consistent warm palette.
- It looks finished at 1920×1080 and is still usable at 390×844 (pan and zoom, HUD collapses).

## The office (one floor, rooms in pipeline order, left → right, top → bottom)
1. **Lobby / Intake**: a front desk where the brief arrives (a letter drops in when the run starts).
2. **Product office**: one desk, a big corkboard that fills with feature cards (`prd.features`, ✓ when `passes`).
3. **Research library**: bookshelves. The researcher pulls books while working.
4. **Architecture room**: a whiteboard that gets sketched lines while the architect works, next to the **Design studio** (easel and color swatches).
5. **Dev floor**: **3 desks** (dev pods) with monitors that glow and scroll while their developer works. A coffee machine in the corner.
6. **Review booth**: a desk with a magnifying-glass sign and a stamp (✓ approve / ✗ reject).
7. **Main vault**: a filing cabinet that fills up with each merged task (count visible).
8. **QA lab**: a bench with a test screen and a framed **QA score** dial (0–10, needle animates; 7 = pass line).
9. **Deploy dock**: a server rack with blinking LEDs that turns green and plays a little rocket/flag animation on deploy.

On the wall: a **phase banner** (current phase, highlighted) and a **task board** (sticky notes per task, colored by status, animated when they move). A **water-cooler budget tank** drains as `spend.usd → budgetUsd` (amber in landing mode).

## Characters (the heart of it)
- Compose each agent from the layered character sheet (body + outfit + hair layers, all 16 px), so every role looks distinct. Keep a role → look table in code. Name them (Product "Pia", Architect "Arlo", Designer "Dee", devs "Dev 1–3", Reviewer "Rex", QA "Quinn", DevOps "Ops", Researcher "Remy").
- **Procedural animation** (the sheet has single frames): idle breathing (1 px bob), walking (bob + slight squash + footstep dust puffs + facing flip), typing (fast 1 px jitter + monitor glow), thinking (dotted thought bubble).
- **Speech bubbles** show the latest `say`/`tool` text for that agent: pixel-framed, max 2 lines, they fade after a few seconds. Tool icons: 🔍 read, ✏️ edit, ▶ run, 🌐 web.
- **Handoffs are walks.** When work moves to the next role, the sender stands up, carries a document sprite along a path through the doors (A* or waypoint graph on the tile grid), hands it over with a little "+1" pop, then walks back.
  - Product → Architect / Designer / Researcher; Architect → each Dev (one folder per task); Dev → Reviewer.
  - Reviewer approve: stamp ✓ and carry it to the Main vault (sparkle, cabinet count +1).
  - **Reject or gate fail:** a red ✗ stamp, the paper is tossed back to the dev desk in an arc, and the dev gets a "!" and a frustrated shake. That's self-correction made visible.
  - **Escalation:** a senior character in a different color walks in to help at that desk.
  - QA failure → the QA character walks a bug note 🐞 to the dev floor.
- `run_done`: confetti and everyone gathers at the deploy dock.

## Interaction
- Drag to pan, scroll to zoom (clamped), double-click a room to focus it.
- **Click a character**: a side panel (pixel-framed) with name, role, model, current task, live tool and say log (last 30), tokens and $ spent, plus a **"Leave a note"** box that POSTs `{ role, text }` to `/forge/say` (show "delivered on its next turn").
- Click a sticky note: task history (attempts, gate and review results, fixes).
- Keys: `1` / `4` / `0` set replay speed 1×/4×/10×, `R` restarts the replay, `F` toggles fullscreen, `H` hides the HUD.
- HUD (top): product name, phase, elapsed, $ spent / budget, merged/total, self-fixes count, LIVE/REPLAY badge. A rulings ticker scrolls along the bottom.

## Technical direction
- React + **pixi.js v8** + **@pixi/react v8** (a single canvas), **gsap v3** for tweens. A **pure, unit-tested reducer** turns the event stream into a scene model (agents, positions, carried items, tasks, counters). Visuals only render that model. Use a small fixed-step simulation for walking, so replay at 10× stays correct.
- **Assets are provided and pre-mapped** in `fixtures/assets/` (CC0, Kenney): `kenney-roguelike-indoors/roguelikeIndoor_transparent.png` (furniture only), `kenney-roguelike-characters/roguelikeChar_transparent.png` (layered characters), and **`atlas.json`**, a hand-verified map of named furniture sprites and the 10 role characters (layer order body → pants → shirt → hair). `preview.png` shows exactly what each name looks like. Tiles are 16×16 with a 1 px margin (x = col·17, y = row·17). **Use `atlas.json` as the only source of sprite coordinates. Never guess tiles from the sheet.** Copy the sheets to `public/assets/`.
- **The pack has no floors or walls.** Draw them in code in the same pixel style: wood-plank floors (a slightly different tone per room), carpet in the lobby, a 2-tile wall band with a baseboard along the top of each room, door gaps between rooms. Draw monitors, whiteboard lines, LEDs, bubbles and the coffee steam with Pixi Graphics too. Credit Kenney in `docs/CREDITS.md` and in a small footer.
- Office layout as a tile map in code (`src/web/scene/map.ts`): walls, doors, floor types per room, and a walkable grid for pathfinding.
- The server proxies `/forge/events`, `/forge/state` and `/forge/say` to FORGE_URL. If FORGE is unreachable **or returns no run** (`/state` has no `run`), switch to replay of `fixtures/sample-run.jsonl` automatically (with `fixtures/sample-state.json` for the initial state) and show the REPLAY badge.
- Performance: ≥ 50 fps at 1920×1080 on a laptop. Pool particles; no per-frame React re-renders of the scene.

## Dependencies allowed
pixi.js@^8, @pixi/react@^8, gsap@^3, @fontsource/press-start-2p@^5, @fontsource/vt323@^5.

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
Authentication. Sound (nice-to-have). Editing the factory. 3D.
