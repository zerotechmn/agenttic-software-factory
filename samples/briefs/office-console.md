# Brief: FORGE Office as the operator console

**This is an existing app.** Read `CLAUDE.md` first: it explains the architecture (director → stage, screen-space text, pixel-snapped animation) and the rules. Extend it; don't rewrite it. Stack: TypeScript + PixiJS v8 + GSAP + Vite, plain DOM for panels. No React and no new dependencies.

The office now runs in three places:
- **Replay mode** by itself (plays `public/sample-run.jsonl`). Everything below must work or degrade gracefully here, so QA can test it without FORGE.
- **Live mode** under `forge serve` (one run: `/events`, `/state`, `/say`, `/task`).
- **Console mode** under `forge console`, at `/office/`. The same run routes accept `?run=<name>`, plus these console APIs (all JSON):
  - `GET /api/runs` → `[{name, run, phase, usd, budget, product, startedAt, active}]`, newest first. 404 or a network error means "not in console mode".
  - `POST /api/runs {name?, brief, budget}` → `201 {name}`, or `400 {error}`.
  - `POST /api/runs/<name>/resume`, `POST /api/runs/<name>/stop` → `202`.
  - `POST /api/assistant {message}` → `{reply, usd}`. This takes 5–60 s. The reply is markdown.
  - `GET /api/proposals` → `[{id, kind: "start"|"resume", run, brief?, budget?}]`. `POST /api/proposals/<id> {confirm: true|false}` → `{result}`.

## Features

1. **Live agent panel (bug).** Clicking a character opens its panel. The activity list is rendered once and never updates while the panel stays open. Fix it: new events for that agent appear at the top immediately, while keeping the textarea contents and focus, the scroll position and any expanded item.

2. **Event detail.** Each activity item in the agent panel is clickable and expands in place, without opening a new panel:
   - the full text of the event;
   - for tool events, the tool name and its input (`event.data.input`), pretty-printed (JSON in a `<pre>`, long strings wrapped);
   - the time, phase and taskId.

   Clicking it again collapses it. Keep the list capped (the latest 50). Keep raw events per agent instead of preformatted strings.

3. **Run picker (console mode only).** A compact dropdown in the HUD lists the runs from `/api/runs`, with name, phase, `$usd/$budget` and a green dot if active. Choosing a run reloads the office on that run (`?run=<name>` in the page URL). Every live fetch must pass it through: `/events`, `/state`, `/say`, `/task`. Without `?run=`, the server picks the newest run. The picker is hidden in replay or plain live mode.

4. **Lobby "New job".** Clicking the lobby/reception (or a "+ New job" HUD button in console mode) opens a side panel with: name, budget (default 10), and a large brief textarea (markdown). START POSTs to `/api/runs`. On success it switches to the new run (`?run=`); on error it shows the error. Under it: "Resume" and "Stop" buttons for the current run. In replay mode the panel says "demo mode: start the console with `forge console`" and the buttons are disabled.

5. **Assistant chat.** A "Ask FORGE" HUD button opens a chat side panel:
   - message list (operator right, assistant left), a textarea (Enter sends, Shift+Enter makes a newline) and a send button;
   - a "thinking…" indicator while waiting, with the input disabled;
   - minimal safe markdown for replies (paragraphs, **bold**, `code`, bullet lists, code blocks). Build DOM nodes or escape text first: never put reply text into innerHTML unescaped;
   - each reply shows its cost (`$0.07`);
   - **proposals:** after each reply, and when the panel opens, fetch `/api/proposals`. Show each one as a card: "Start run *todo* ($8)" with the brief collapsible, or "Resume *x*". The card has Confirm and Dismiss buttons that POST to `/api/proposals/<id>`; show the result. Confirming a start switches to that run;
   - chat history is kept in `sessionStorage` (wrapped in try/catch);
   - in replay mode the panel explains it needs `forge console`.

## Constraints

- Do not break anything that works now: replay playback, board panel with add-to-backlog, notes with delivery status, camera, tooltips, coffee breaks, escalation helper, `window.__office`.
- Put the API calls in `src/api.ts` (one `runParam()` helper that reads `?run=` from `location.search`). Put new panels in their own modules (`chatPanel.ts`, `lobbyPanel.ts`, `runPicker.ts`), styled like the existing pixel HUD panels.
- Unit tests (vitest + happy-dom, `tests/**/*.test.ts`) for: the agent panel live update and expansion, the markdown renderer (including an XSS case: `<img onerror>` must render as text), runParam pass-through, and proposal cards (with fetch mocked).
- Extend `window.__office` with what QA needs: e.g. `openChat()`, `openLobby()`, `agentLog(key)`.

## Out of scope

Mobile layout, authentication, new sprites or art, changes outside this app.
