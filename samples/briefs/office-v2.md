# Brief: FORGE Office v2: make the pixel office interactive

**This is an existing app.** Read `CLAUDE.md` first: it explains the architecture (director → stage, screen-space text, pixel-snapped animation) and the rules. Extend it; don't rewrite it. There is no server and no `src/shared/contracts.ts` in this project. The "architecture" step is planning tasks against the existing modules. Stack: TypeScript + PixiJS v8 + GSAP + Vite. No React and no new dependencies.

It runs in **replay mode** by itself (it plays `public/sample-run.jsonl`) and in **live mode** when served by FORGE (`/events`, `/state`, `/say`, `/task`). Everything below must work in replay mode, so QA can test it without FORGE.

## Features

1. **Clickable task board.** Clicking the cork board on the Dev Floor wall opens the side panel with every task: id, title, a coloured status chip (backlog/running/review/merged/parked) and attempts.
   - Data comes from `/state` in live mode, or `public/sample-state.json` in replay mode. The panel updates as task events arrive.
   - At the bottom, an **"Add to backlog"** form (title + details) POSTs `{title, description}` to `/task`. In live mode, show "queued: the factory picks it up on its next build step". In replay mode, show "demo mode: not sent".

2. **Note delivery status.** After "Leave a note" is sent from a character's panel, the panel shows the note with a status: *queued*, then *delivered* once a FORGE `note` event whose text starts with `operator → <role>` arrives. Make the rule in the panel clear: "notes reach the agent on its next turn".

3. **Camera.**
   - The mouse wheel zooms between integer scales 2×, 3× and 4×, anchored at the cursor.
   - Dragging pans, clamped to the office bounds.
   - Double-clicking a room centres and zooms on it, and `F` fits the whole office.
   - Text stays crisp at every zoom level (labels follow the world transform). Movement stays pixel-snapped.

4. **Life in the office.**
   - An agent idle for more than 20 s of run time sometimes walks to the coffee corner, then back. At most 2 agents do this at once.
   - While working, the researcher walks to a bookshelf and back now and then.

5. **Escalation helper.** When a FORGE `note` event says a task was escalated (`escalate <taskId> …`), Fay (final reviewer) walks to that task's dev pod and stands beside it with a small "SENIOR" tag until the task is merged or parked, then walks back.

6. **Room hover tooltip.** Hovering a room shows a small pixel-framed tooltip: room name, who works there, and their current activity (working on X / idle).

## Testability (required)
Expose `window.__office` with:
- `tasks()`: the board's task list
- `agents()`: for each agent `{ key, mode, x, y }`
- `zoom()`: the current integer scale
- `openBoard()`, `openAgent(key)`: open the panels
- `room(name)`: the tooltip text for a room

Playwright specs use these together with real clicks, wheel events and keyboard input.

## Quality bar
It's a stage demo, so it must stay **crisp, smooth and readable**: no blurry text, no jitter, no overlapping UI at 1920×1080, and nothing that hides the characters.

## Out of scope
New art assets, sound, 3D, changes to FORGE itself.
