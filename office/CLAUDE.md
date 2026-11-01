# FORGE Office: conventions for agents

A pixel-art top-down office that visualizes FORGE runs. **Plain TypeScript + PixiJS v8 + GSAP, no React.** Built with Vite.

## Architecture (keep this split)
| File | Responsibility |
|---|---|
| `src/director.ts` | **Pure**, unit-tested: FORGE event → stage `Command`s. All event logic lives here. |
| `src/stage.ts` | Executes commands: handoff walks, throws, bubbles, alerts, stamps, celebration. |
| `src/agent.ts` | One character: pixel-step animation, A* walking, working/idle modes. |
| `src/props.ts` | Live set dressing: task board, whiteboard, QA dial, LEDs, steam, confetti. |
| `src/labels.ts` | **Screen-space** text (room signs, name tags, bubbles): never inside the scaled world. |
| `src/hud.ts` | DOM overlay: top bar, ticker strip, side panel. |
| `src/feed.ts` | Live SSE from FORGE (`/events`, `/state`) or replay of `public/sample-run.jsonl`. |
| `src/map.ts` | Rooms, furniture placements, seats (tile coords, 16 px tiles). |
| `src/path.ts` | Walkable grid + A*. |
| `src/sprites.ts` + `src/atlas.json` | Kenney sheets; **atlas.json is the only source of sprite coordinates** (hand-verified). |

## Rules
- Pixel art: integer world scale, `scaleMode: "nearest"`, every moving thing snapped to whole world pixels; animate in pixel steps (no sub-pixel tweens on sprites).
- Text: only via `labels.ts` (screen space, pixel fonts at multiples of 8 px) or the DOM HUD. Never add `Text` to the scaled world.
- New behavior from events goes into `director.ts` with a unit test in `tests/director.test.ts`; the stage only executes.
- Never edit `src/atlas.json`, `public/assets/*` or `public/sample-run.jsonl`.
- FORGE endpoints: `GET /events` (SSE), `GET /state`, `POST /say {role,text}`, `POST /task {title,description}`.

## Commands
`npm run check` (typecheck + unit tests) must pass. `npm run build` then `npm start` serves the built app on `$PORT`.
