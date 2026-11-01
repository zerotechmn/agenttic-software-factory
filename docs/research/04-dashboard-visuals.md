# 04: Live visual monitor for FORGE (dashboard visuals)

Research date: 2026-10-17. Hackathon: 2026-10-23, solo. The goal is a monitor that shows FORGE running in real time: who is working, who hands off to whom, tasks moving, gates passing or failing, budget, and QA score. It should be clickable, ideally let you message an agent, and it doubles as the stage demo.

---

## 0. TL;DR

| | A. **FORGE Office** | B. **Living Foundry** (circuit/factory) | C. **Mission Control 3D** |
|---|---|---|---|
| Look | Top-down pixel-art office with walking characters | Neon circuit board / factory line, all procedural, bloom | Dark 3D command deck, low-poly robots, bloom, camera fly-to |
| Stack | Pixi v8 + @pixi/react, sprite sheets, fixed waypoints | Pixi v8 Graphics + `pixi-filters` + particles + GSAP | three + R3F 9 + drei 10 + @react-three/postprocessing |
| Assets | LimeZu (paid, $5 office + PWYW interiors) or Kenney/MetroCity (free) | **None** | Quaternius / KayKit / Kenney 3D (all CC0) |
| Agent effort (1–2h budget) | Medium–high. Most of the time goes into slicing assets and laying out the map | **Low–medium** | High |
| Risk | Medium. Asset cropping and z-order look janky if rushed | **Low** | High. GLTF animation, perf, camera |
| Stage wow | High ("cute"), but familiar: Pixel Agents and Claude Office already exist | High if the bloom and motion are tuned; reads clearly from the back of a room | Very high when it works |

**Recommendation: B (Living Foundry), built in Pixi v8.** Polish it with bloom, particles, liquid shaders and camera zoom. Optionally add C's robots later as a stretch. Reasoning is in §5.

---

## 1. What the user already has and wants (from the local files)

**HELM dashboard** (`/home/forge/dashboard`, Next 16.2, React 19.2, `pixi.js ^8.19`, `@pixi/react ^8.0.5`):
- `components/PixiScene.tsx` (906 lines) has a full-screen scene with:
  - `MainSceneBackground`: a pre-rendered AI-generated isometric room, `MAIN_SCENE.png`, 1408×768, 2.5 MB
  - `BokehLayer`, which uses a `BlurFilter`, and `SceneParticles`
  - `AvatarSprite`: a bobbing bot using a grabCut-matted 83×79 cutout
  - `FuelCellTank`, `SubagentBot` and a `CameraRig`
  - a drag-and-drop scene builder
- `lib/spriteRegistry.ts` has 39 frame rects into one chroma-keyed sheet (`SPRITES-transparent.png`, 0.9 MB). Every character is a **single frame**: no walk cycles, only procedural hover. The owner insisted sprites are never split into separate files.
- `public/images` holds about 12 MB of PNGs, which shows the asset pain directly:
  - `bot*.png` and `assets*.png`: retired
  - `SPRITES-transparent33.png`: a second chroma-key attempt
  - `fuel_cell*.png`: four versions, including "Background Removed" copies, i.e. repeated background-removal passes
- Lessons recorded in the handoff:
  - The pre-composed AI render can't be decomposed. Its characters are baked into the background.
  - Chroma-keying an AI sprite sheet left caption text bleeding into the crops and fuzzy edges.
  - Characters at different scales and filtering modes don't match: pixel art next to a shaded render looks wrong.

**Memory notes** (the quality bar):
- `feedback_visual_quality_bar.md`: a 5-dot indicator light was **rejected**. The user wants actually animated, high-fidelity visuals (a fuel tank that visibly fills and empties), not flat indicators. "No text" is necessary but not sufficient.
- `project_overview.md`:
  - Visual metaphors, not charts. Bots appear when spawned, animate while working, and disappear when done.
  - Click to drill down.
  - Replay is acceptable.
  - The team stayed on Pixi after evaluating Three.js. Their reasoning: the quality gap was in implementation, not the engine, and Three.js needs a 3D asset workflow the owner doesn't have. R3F was named as the fallback if real 3D is ever needed.

**FORGE event stream** (`/home/forge/factory`):
- `ForgeEvent` has these fields: `{ts, run, phase, role?, agentId?, taskId?, kind, model?, tokensIn/Out, cacheRead, usd?, status?, text?, data?}`.
  - Phases: `intake → product → design → contract_gate → build → qa → final_review → deploy → report`
  - Roles: `product, architect, uiux, dev, reviewer, integrator, qa, final_reviewer, devops, reporter`
- Event kinds emitted in `src/`:

  | Group | Kinds |
  |---|---|
  | Agent lifecycle | `agent_start`, `agent_done`, `say`, `tool` |
  | Phases and tasks | `phase_start`, `phase_end`, `task_status`, `task_fail`, `retry`, `fix`, `conflict`, `feature` |
  | Gates and quality | `gate`, `review`, `ruling`, `guard_deny`, `qa_start`, `qa_result` |
  | Run control | `paused`, `resumed`, `stopped`, `landing`, `deploy`, `run_done`, `run_error`, `note` |

- `src/server.ts`:
  - `GET /events` is SSE. It replays the whole `events.jsonl` first, then streams live.
  - `GET /state` returns the `RunState` (tasks with status, `qaRounds[{round,score,failures}]`, `spend{usd,byRole,byPhase}`), plus `budgetUsd`, `concurrency` and `prd`.
  - `GET /` serves `monitor/index.html`, the current flat monitor: CSS cards, phase rail, stat pills.
  - **There is no POST endpoint.** "Message an agent" needs a new `POST /say` that writes to an inbox the orchestrator reads between turns, for example as a `ruling` or `note` injected into the next prompt. Budget about 20 minutes for that in the orchestrator, separate from the visuals.
- Because the server replays a finished run from file, the stage demo can **replay a recorded good run at 4–10× speed**. That is the biggest de-risking move available.

**Event → visual mapping** (shared by all three concepts):

| FORGE event | Visual verb |
|---|---|
| `phase_start` / `phase_end` | Camera pans or zooms to that zone. The zone lights up, then dims to "done" |
| `agent_start` (role, agentId) | An agent materializes: spawn shimmer and a role colour |
| `tool` (text = description) | A work animation: typing, sparks or scanning, plus a small tool glyph |
| `say` (text) | A speech bubble or holo ticker over the agent |
| `agent_done` | The agent delivers its artifact (a packet travels to the next role), then idles or fades |
| `task_status` → running / review / merged / blocked / parked | A task token moves to the matching lane or station |
| `gate` / `review` / `ruling` with pass or fail | A gate opens green (shockwave), or slams red (glitch, shake) and the token bounces back |
| `retry` / `fix` / `conflict` | The token loops back along a return path; a red pulse marks the loop |
| `qa_result` (score) | The score dial charges; the history shows as rings |
| `usd` on any event + `spend` | The budget tank level drops (liquid shader); it turns amber at 70% and red at 90% |
| `paused` / `guard_deny` | A warning beacon over the agent |
| `deploy` / `run_done` | Finale: container launch, confetti or bloom flare, final score |

---

## 2. Prior art (verified 2026-10)

| Project | What it is | Stack / assets | License | Takeaway |
|---|---|---|---|---|
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) (Pablo De Lucca) | Each Claude Code terminal becomes a pixel character in a tiny office. Characters type, read and wait, with speech bubbles, sub-agent characters and a layout editor. Also runs as a browser app via `npx pixel-agents` | React 19 + Vite + **Canvas 2D**, pathfinding, character state machines. Characters are "based on JIK-A-4, Metro City" | MIT | Proves the office metaphor works and is popular. It is also **already familiar**, so judges may have seen it. Its own roadmap lists "orchestrator characters, hand work between agents", which FORGE already does |
| [Claude Office Visualizer](https://github.com/paulrobello/claude-office) (paulrobello) | The main agent is the boss and subagents are employees. Has a multi-floor building, a whiteboard with 12 modes including kanban, a context "trashcan" that fills up, and a day/night skyline. v0.25.0 released Oct 2026 | Next.js + **PixiJS 8.19** + Zustand, FastAPI backend, A* pathfinding | MIT (per listing) | Same idea as above, polished. Shows how much ongoing work a convincing office takes: many releases over months |
| [Agent Flow](https://github.com/patoles/agent-flow) | Live **node graph** of Claude Code / Codex orchestration with branching, tool calls, timeline and a file-attention heatmap | Next.js, SSE relay | Apache-2.0 | The node-graph approach is good for debugging but reads as a diagram. Less theatrical |
| [a16z AI Town](https://github.com/a16z-infra/ai-town) | Town of chatting AI characters | **PixiJS** + Convex + Tiled → `convertMap.js`. Tilesheets from OpenGameArt ([16x16 game assets, George Bailey](https://opengameart.org/content/16x16-game-assets); [16x16 RPG tileset, hilau](https://opengameart.org/content/16x16-rpg-tileset)), original assets by ansimuz, and "Pixel Art Generation: Replicate, Fal.ai" | Code MIT. **Art licensing is per source and not stated in the repo**, so don't copy their `public/assets` blindly | Pixi + Tiled is a proven pipeline. Note that even a16z mixed OpenGameArt with AI-generated art |
| [Stanford Generative Agents / Smallville](https://github.com/joonspk-research/generative_agents) | The 25-agent town from the paper | Phaser/Django, Tiled map. Art credits: background by PixyMoon, **furniture/interiors by LimeZu**, characters by ぴぽ (pipohi) | Research code. Art belongs to the named artists | The most famous agent-world visual uses **LimeZu** interiors. That is the style benchmark for direction A |
| Gather.town-style | Top-down 32px rooms with avatars | Commonly LimeZu / Modern Interiors (itch.io has a "gathertown" collection) | n/a | The same aesthetic as A |
| Factorio / Shapez | Conveyors, items flowing, machines lighting up | n/a | n/a | Inspires B: throughput you can **see**. Items on belts are instantly legible at a distance |
| React Flow ([animating edges](https://reactflow.dev/examples/edges/animating-edges), [Animated SVG Edge](https://reactflow.dev/ui/components/animated-svg-edge)) | Nodes plus SVG `<animateMotion>` dots travelling along edges | `@xyflow/react` 12.12.0 | MIT | Gives graph-correct layout fastest (about 30 min), but it looks like a flowchart. Usable as the drill-down view, not the hero view |

**What tends to impress in hackathon demos:**
1. Something moves the moment you start talking.
2. Causality is legible from 10 m away: "that packet just went from Architect to Dev 2".
3. One dramatic failure-and-recovery beat, e.g. a gate slams red, the task loops back, then it goes green.
4. A satisfying finale.
5. Live interaction: click an agent and its thoughts stream in, or type a message and see it arrive.

Dense charts and small text do not read on a projector.

---

## 3. Assets that solve the asset problem (verified on source pages)

| Source | License (verified) | View | Character animation | Consistency | Notes / size |
|---|---|---|---|---|---|
| [Kenney: Roguelike Indoors](https://kenney.nl/assets/roguelike-indoors) | CC0 | 2D top-down, 16px | none (furniture) | Kenney house style | 480 files, small (<5 MB) |
| [Kenney: 1-Bit Pack](https://kenney.nl/assets/1-bit-pack) | CC0 | 2D, 16×16 | single-frame characters | Very consistent; tint-friendly | 1078 files; great with neon tinting |
| [Kenney: Tiny Factory](https://kenney.nl/assets/tiny-factory) | CC0 | 2D, 16×16 | none | consistent | 130 files, **released 2026**, conveyors and machines. Ideal for a pixel "factory floor" |
| [Kenney: Isometric Miniature Library](https://kenney.nl/assets/isometric-miniature-library) | CC0 | 2D isometric | none | consistent | 35 files. Kenney's isometric line is furniture or blocks, without animated characters |
| [Kenney: Factory Kit (3D)](https://kenney.nl/assets/factory-kit) | CC0 | 3D | animated parts | consistent | 140 files, v3.0 "completely remade", conveyors and machines |
| [Kenney: Space Station Kit (3D)](https://kenney.nl/assets/space-station-kit) | CC0 | 3D | none | consistent | 90 files. Sci-fi interior for a control room |
| [Kenney: Mini Characters (3D)](https://kenney.nl/assets/mini-characters) | CC0 | 3D | animated | consistent | 25 files (2024) |
| [Kenney: Furniture Kit (3D)](https://kenney.nl/assets/furniture-kit) | CC0 | 3D | none | consistent | 140 files |
| [Quaternius: LowPoly Robot](https://quaternius.itch.io/lowpoly-robot) | CC0 | 3D | **14 animations**: idle, run, sitting, standing, wave, yes, no, thumbs up, dance, punch, jump, death | one robot model. Tint per role | ~6.6 MB zip. A perfect "agent" for C: *yes/no* map to gate pass or fail, *thumbs up* to merge |
| [Quaternius: Sci-Fi Essentials Kit](https://quaternius.com/packs/scifiessentialskit.html) | CC0 | 3D | animated robot enemies | matches LowPoly Robot | glTF/FBX/OBJ |
| [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) + [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) | CC0 ("free for personal and commercial use, no attribution") | 3D | 133 humanoid animations, plus 28 tool animations (hammering, digging…) in v1.1 | one gradient atlas, very consistent | Animations ship as **FBX only** and need conversion to GLB (`fbx2gltf` or a Blender pass). Fantasy theme is off-brand for a software factory |
| [LimeZu: Modern Office (Revamped)](https://limezu.itch.io/modernoffice) | **$5.00+**. Commercial OK, **credits required**, no redistribution | 2D top-down, 16/32/48px | furniture only. Characters come from Modern Interiors | the best-looking cohesive office set | 300+ single sprites, RPG Maker files |
| [LimeZu: Modern Interiors](https://limezu.itch.io/moderninteriors) | Name your price. Full version needs **≥ $1.50**: commercial OK, editing OK, credits required, no redistribution. A free version also exists | 2D top-down, 16/32/48px | **character generator**: idle, run, read a book, lift, pick up, sit… plus 100+ animated objects (gifs and sheets) | Smallville-grade style | Big download, thousands of PNGs. "Control room" and "TV studio" themes included |
| [MetroCity Free Top-Down Characters](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) (JIK-A-4) | Free, "use it as you wish", credit appreciated | 2D top-down | 4-direction run, plus hair and outfit layers | used by Pixel Agents | small |
| [Pixel Office (Masalimov Ilnur)](https://masalimov-ilnur.itch.io/pixel-office) | $5 min, CC BY 4.0 (per listing) | 32×32 top-down | 5 characters, idle and walk | cohesive | alternative to LimeZu |
| [Office Characters 16×16](https://lamangoustii.itch.io/office-characters-16x16) | PWYW, **license unclear** | 16×16 | 12 characters, walk | n/a | avoid unless the license is confirmed |
| [OpenGameArt](https://opengameart.org) | mixed per asset (CC0 / CC-BY / GPL) | any | varies | **inconsistent styles** | Hunting through it takes time. Only use specific packs, e.g. AI Town's tilesheets |
| [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Royalty-free for personal and commercial use. Raw files can't be redistributed. Needs an Adobe ID | 3D humanoid | huge library (typing, sitting, talking) | n/a | Requires an FBX download and conversion per clip. A third-party guide says it is in maintenance mode |

**Verdict on assets:**
- For **2D**, the only route that looks truly cohesive and premium is **LimeZu** (about $6.50 total, attribution in the credits). Kenney 2D is CC0 and consistent but reads as "prototype".
- For **3D**, the CC0 low-poly packs (Quaternius robot + Kenney Factory / Space Station kits) **do solve the "no assets" problem that killed the earlier Three.js attempt**. The styles match well enough, they ship glTF, and the robot has gate-friendly animations.
- **Never** go back to chroma-keying AI images. That is where the transparency pain came from.

---

## 4. The three concept directions

### A. "FORGE Office": the factory as a living pixel office
**Pitch:** watch your software team at work. Ten little workers in a cozy office, passing documents desk to desk until the product ships.

**Screen:**
- A 16:9 top-down office at 32px tiles (LimeZu Modern Office + Interiors), split into rooms along the pipeline from left to right:
  - Product corner with a whiteboard
  - Architect drafting desk with blueprints
  - UI/UX studio with easels
  - **Dev pit with three desks and monitors**: the parallel worktrees
  - Review booth
  - QA lab with test rigs
  - DevOps loading dock with a "container" crate and a truck
- Wall decor carries the metrics:
  - A wall clock for elapsed time
  - A **water-cooler tank** for budget, reusing the liquid-fill shader idea from the fuel cell
  - A **scoreboard** for the QA score
- A kanban corkboard holds task cards that physically move between columns.

**Agent communication:**
- On `agent_done`, the character **stands up, walks** along fixed waypoints (no A*) to the next role's desk and hands over a glowing document. A dotted path trail stays visible for a few seconds.
- `say` shows as speech bubbles.
- Review rejection: the reviewer throws the paper back, and it arcs to the dev desk with a red stamp.
- Gates are a door or turnstile with a light that turns green or red.

**Interactions:**
- Click a character: the camera zooms in, and a side drawer opens with role, model, tokens and $, a live stream of `say` and `tool` lines, and the current task.
- "Message" box → `POST /say`.
- Hover a kanban card for task details.
- Speed slider for replay.

**Stack:**
- Pixi v8 + @pixi/react (already known), Tiled JSON map or a hand-placed layout
- `AnimatedSprite` for idle, walk and sit
- GSAP for path tweens; `pixi-filters` for a soft glow on the active agent

**Assets:**
- [LimeZu Modern Office](https://limezu.itch.io/modernoffice) ($5, credit) + [Modern Interiors](https://limezu.itch.io/moderninteriors) (≥$1.50 for the commercial and editing license, credit)
- Free fallback: [Kenney Roguelike Indoors](https://kenney.nl/assets/roguelike-indoors) (CC0) + [MetroCity characters](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)
- **Note:** LimeZu has to be bought and downloaded by the human, since the license forbids redistribution. Its sheets also have to be mapped to frame rects, which is the same tedium that hurt HELM.

**Effort and risk for a factory build (1–2h agent time):**
- **Medium–high.** Code is about 600–900 lines.
- About 50% of the time goes into asset wiring: frame rects, z-sorting characters behind desks, the room layout.
- Agents are bad at judging pixel crops without visual verification. They need a Playwright screenshot loop.
- Risk is **medium**. If rushed it looks janky: characters sliding, floating, or rendering under furniture.

**Stage impact:**
- High charm, and judges "get it" instantly.
- But it is **the most derivative** option (Pixel Agents, Claude Office, AI Town, Smallville).
- 16px art is tiny on a projector unless you zoom the camera in.

---

### B. "Living Foundry": a glowing circuit factory (asset-free)
**Pitch:** FORGE as a living machine. Work flows like molten light through a neon foundry, and every gate, retry and dollar is visible as motion.

**Screen:**
- A full-screen dark scene, with a subtle animated hex or PCB-trace grid in the background (a shader or `TilingSprite` with noise).
- **Nine stations** sit along a curving main bus, matching the phases. Each is a procedurally drawn "machine core": rounded hex chassis, rotating segmented rings, inner plasma orb, status LEDs.
  - Product = a prism that splits the brief into feature shards
  - Architect = a lattice that builds wireframe lines
  - UI/UX = a palette wheel spinning colours
  - Contract gate = a heavy **blast door**
  - Build = **three parallel forge lanes** (Dev 1, 2 and 3). Each has an anvil core that throws sparks while `tool` events arrive
  - Review = a scanner beam sweeping each packet
  - QA = a test chamber; laser grid sweeps, each failure flashes a red cell
  - Deploy = a launch rail that fires a container capsule upward
- **Agents** are glowing "spirits": bright orbs with an orbiting ring and a role glyph, docked at their station.
  - Idle: breathing pulse
  - Working: faster spin, particle exhaust, a small holo ticker above it scrolling the last `tool` or `say` line
- **Tasks** are ingots or packets labelled T-03 etc. that physically travel on conveyor traces with motion trails.
- HUD:
  - **Budget** is a tall reactor tank on the left: animated liquid with a sine-wave surface, bubbles, and a displacement filter. The colour shifts from cyan to amber to red as `spend.usd / budgetUsd` rises.
  - **QA score** is a big radial gauge that charges up after each `qa_result`, with rings for previous rounds.
  - A **phase rail** across the top fills with light.

**Agent communication:**
- Every handoff (`agent_done` → next role's `agent_start`, `review` → dev, `ruling`) fires a **beam pulse**: a bezier lightning arc between the two orbs, with a packet riding it and bloom on impact.
- Parallel devs show three simultaneous streams.
- Failures:
  - A rejected review or gate makes the packet **bounce off a red barrier** (shockwave filter, screen shake, `glitch` filter for 200 ms) and loop back along a red return track to its dev. A `retry` counter pip increments.
  - `conflict` shows two packets colliding with sparks.
- The merge into main is a satisfying **"weld"** flash.

**Interactions:**
- Click an orb: the camera eases in with a GSAP zoom on the Pixi container. A glass side panel opens with a live log of that agent's `say` and `tool` stream, tokens and $ (a mini sparkline), model, current task and acceptance criteria. A **"transmit" input** sends a message: the packet visibly flies from your cursor to the agent, then `POST /say`.
- Click a packet for its task card.
- Click a gate for its last verdict.
- Keyboard: Space pauses the replay, 1–9 jump to a station. A speed toggle runs replay at 1× / 4× / 10×.

**Stack:**
- Pixi v8 (8.22) + `@pixi/react` 8.0.5 in a Vite React app at `factory/monitor` (or in HELM)
- Pixi `Graphics` for every shape
- `pixi-filters` 6.1.5 (peer `pixi.js >=8`) subpaths: `advanced-bloom`, `glow`, `shockwave`, `glitch`, `godray`, `crt`, `simplex-noise`, `rgb-split`
- `ParticleContainer` for sparks
- GSAP 3.15 for tweens and path motion. GSAP is now free including former Club plugins ([Webflow announcement](https://webflow.com/blog/gsap-becomes-free)). MotionPathPlugin handles packets on curves.
- The SSE client maps `ForgeEvent`s to scene commands through one pure reducer that is unit-testable with recorded `events.jsonl`.

**Assets:** none. The only optional one is a single display font, e.g. Google Fonts *Orbitron* or *JetBrains Mono*, which the current monitor already uses.

**Effort and risk:**
- **Low–medium**, and the most agent-friendly option.
  - Everything is code, and there are no crops to verify.
  - The layout is a fixed coordinate table.
  - The visual polish knobs (bloom strength, particle counts) are easy to iterate on with a screenshot-and-evaluate loop.
- Estimate: about 700–1000 lines. A first good-looking version fits in about 1.5 h of agent time; tuning is extra.
- **Risk is low**. The main ones are:
  - Bloom overdone, so it looks washed out
  - Perf if the filters sit on too many containers. Put bloom on one top-level container and cap particles.

**Stage impact:**
- High. It reads on a projector because big glowing shapes and motion survive low contrast.
- Every judging axis (orchestration, self-correction, quality) maps to a visible beat.
- It is **distinct** from the office visualizers already out there.
- The failure-and-recovery beat (red bounce, loop back, green weld) is the money shot.

**Why it meets the "no flat indicators" bar:** every metric is a physical, animated object: a liquid tank, a charging gauge, sparking anvils. There are no dots or text badges.

---

### C. "Mission Control 3D": a cinematic command deck
**Pitch:** a holographic war room where a crew of robots builds your product. You orbit, swoop in, and talk to them.

**Screen:**
- A dark 3D scene with fog and bloom.
- A circular **command deck** ([Kenney Space Station Kit](https://kenney.nl/assets/space-station-kit)) with role stations around a central **holographic table**. The table projects the task DAG as floating cards, built with drei `<Text>` / `<Billboard>` or `<Html>`.
- Each station holds a **robot** ([Quaternius LowPoly Robot](https://quaternius.itch.io/lowpoly-robot)) tinted by role, with a floating role label.
  - Idle loop while waiting
  - "Standing" or a typing-like loop while working
  - **`yes`** animation on a gate pass, **`no`** on a fail
  - **`thumbs up`** on merge, **`dance`** on `run_done`
- Three dev robots sit side by side at a "forge" bay, with [Kenney Factory Kit](https://kenney.nl/assets/factory-kit) **conveyor belts** carrying task crates between bays.
- HUD:
  - **Budget** is a glass cylinder with an animated fluid shader.
  - **QA score** is a holographic ring.

**Agent communication:**
- Handoffs are **light beams**: drei `<QuadraticBezierLine>` with a dash-offset animation, plus a glowing packet with drei `<Trail>`.
- A gate is a force-field plane that turns green or red. Rejections shake the camera.

**Interactions:**
- Click a robot: drei `<CameraControls>` flies to it, and a DOM side panel shows its live log and a message box.
- Orbit or zoom freely.
- A "Director mode" auto-cuts the camera to whatever event just happened. Great on stage.

**Stack:**
- three 0.186 + `@react-three/fiber` 9.8 (React 19)
- `@react-three/drei` 10.7: `useGLTF`, `useAnimations`, `CameraControls`, `Html`, `Text`, `Trail`, `Sparkles`, `Environment`
- `@react-three/postprocessing` 3.2: Bloom, Vignette, ChromaticAberration
- GSAP for camera choreography

**Assets (all CC0):**
- [Quaternius LowPoly Robot](https://quaternius.itch.io/lowpoly-robot)
- [Kenney Factory Kit](https://kenney.nl/assets/factory-kit)
- [Kenney Space Station Kit](https://kenney.nl/assets/space-station-kit)
- Optional: [Kenney Mini Characters](https://kenney.nl/assets/mini-characters), [Quaternius Sci-Fi Essentials](https://quaternius.com/packs/scifiessentialskit.html)
- Alternative humanoids: KayKit + Character Animations (CC0, but animations are FBX only and need conversion). [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) works too (royalty-free, Adobe ID, FBX to convert).

**Effort and risk:**
- **High.** The specific risks:
  - The GLTF animation clip names and mixer crossfades have to be correct.
  - Cloning skinned meshes for nine robots needs `SkeletonUtils.clone`. This is a classic trap: a plain clone makes the robots share one skeleton.
  - Model scale and orientation normalisation
  - Perf on the event laptop with bloom and shadows
  - Camera choreography
  - Agents can't "see" 3D well without screenshot loops.
- Realistically about 2–4 h of agent time to look good, plus manual asset download and placement. Risk is high that it lands looking like "robots floating in a void" if the environment pass is skipped. That failure mode is already noted in the memory file.

**Stage impact:** very high when it works ("whoa"), and the director-mode camera is cinematic. It is also the most fragile on stage: GPU, a WebGL context loss, or a projector resolution change can break it.

---

## 5. Recommendation

**Build B, "Living Foundry", in Pixi v8 as the stage hero.** If and only if B is done by about T-2 days, add **one 3D flourish** from C as a stretch: for example, a single R3F canvas for the finale "deploy launch", or Quaternius robots as rendered sprite sheets. Skip A.

Why, weighed against the user's history:
1. **Asset pain → zero assets.** Every failure in HELM came from assets:
   - un-decomposable AI renders
   - chroma-key halos and caption bleed
   - mismatched pixel art versus shaded art
   - no walk cycles

   B removes that entire failure class. A reintroduces it, even with LimeZu, because frame-rect mapping and z-sorting were exactly the tedious part. C solves the asset supply with CC0 packs but trades it for 3D integration risk.
2. **Quality bar → motion and light, not sprites.** The rejected fuel-cell dots failed because they were static indicators, not because they were 2D. B makes every metric a physical animated object with bloom, particles and shaders. That is where Pixi v8 plus `pixi-filters` is strongest, and it matches the earlier conclusion that Pixi can hit the bar when the implementation is ambitious.
3. **Reuse.** The user already knows Pixi v8 and @pixi/react quirks: SSR off, the `useTick` and `autoUpdate` fix, BlurFilter bokeh, CameraRig. The `FuelCellTank` liquid idea becomes B's budget reactor.
4. **The factory can build it.** It is pure code, has a deterministic layout, and can be tested: an event reducer fed by a recorded `events.jsonl`, plus Playwright screenshots for the visual evaluator. That fits 1–2 h of agent time, and it is the best showcase of FORGE building its own monitor.
5. **Originality on stage.** Office visualizers for Claude Code already exist (Pixel Agents, Claude Office). A glowing factory where you watch a rejected packet bounce back and get re-forged is distinct, and it maps one-to-one onto the judging axes: orchestration (streams), autonomy (no human), self-correction (red bounce → retry → green), quality (QA gauge).

**Must-do regardless of direction:**
- **Replay mode at 4–10×** over a recorded good run. `/events` already replays `events.jsonl`; add a client-side time scaler.
- Add `POST /say` + an orchestrator inbox to make "message an agent" real.
- Keep the old flat monitor at `/classic` as a fallback.
- Put bloom on one root container and cap particles at about 2k.
- Test on the actual projector resolution.

---

## Sources
- Pixel Agents: https://github.com/pixel-agents-hq/pixel-agents
- Claude Office Visualizer: https://github.com/paulrobello/claude-office
- Agent Flow: https://github.com/patoles/agent-flow
- a16z AI Town: https://github.com/a16z-infra/ai-town · tilesheets https://opengameart.org/content/16x16-game-assets , https://opengameart.org/content/16x16-rpg-tileset
- Generative Agents (Smallville): https://github.com/joonspk-research/generative_agents
- React Flow: https://reactflow.dev/examples/edges/animating-edges · https://reactflow.dev/ui/components/animated-svg-edge
- Kenney (license on each page: CC0):
  - https://kenney.nl/assets/roguelike-indoors
  - https://kenney.nl/assets/1-bit-pack
  - https://kenney.nl/assets/tiny-factory
  - https://kenney.nl/assets/isometric-miniature-library
  - https://kenney.nl/assets/factory-kit
  - https://kenney.nl/assets/space-station-kit
  - https://kenney.nl/assets/mini-characters
  - https://kenney.nl/assets/furniture-kit
- Quaternius: https://quaternius.itch.io/lowpoly-robot · https://quaternius.com/packs/scifiessentialskit.html
- KayKit: https://kaylousberg.itch.io/kaykit-adventurers · https://kaylousberg.itch.io/kaykit-character-animations
- LimeZu: https://limezu.itch.io/modernoffice · https://limezu.itch.io/moderninteriors
- MetroCity (JIK-A-4): https://jik-a-4.itch.io/metrocity-free-topdown-character-pack
- Pixel Office: https://masalimov-ilnur.itch.io/pixel-office · Office Characters: https://lamangoustii.itch.io/office-characters-16x16
- Mixamo FAQ: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- GSAP free: https://webflow.com/blog/gsap-becomes-free
- Pixi v8 filters guide: https://pixijs.com/8.x/guides/components/filters.md
- npm versions checked 2026-10-17 with `npm view`:

  | Package | Version | Peer |
  |---|---|---|
  | pixi.js | 8.22.0 | n/a |
  | pixi-filters | 6.1.5 | pixi.js >=8 |
  | @pixi/react | 8.0.5 | n/a |
  | @pixi/tilemap | 5.0.2 | n/a |
  | three | 0.186.1 | n/a |
  | @react-three/fiber | 9.8.2 | n/a |
  | @react-three/drei | 10.7.9 | n/a |
  | @react-three/postprocessing | 3.2.0 | n/a |
  | @xyflow/react | 12.12.0 | n/a |
  | gsap | 3.15.0 | n/a |
