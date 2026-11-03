# FORGE World

The realm artwork and React components were integrated from `/Users/tuvshinjargalanar/zerohack/factory-dashboard`. This app runs alongside Office, using the existing FORGE APIs (no second backend).

From the factory root:

```sh
npm run world:build
```

Open `/world/` on your existing `forge console` or `forge serve` server. Both `/world` and `/world/` work. Select a console run with the picker or `/world/?run=NAME`. Live is the default; `/world/?mode=demo` enables the isolated simulator.

For development, `npm run world:dev` proxies `/state`, `/events`, `/api`, `/docs`, `/doc`, `/task`, and `/say` to `http://127.0.0.1:4300`. Set `FORGE_URL` to change that backend.

The header shows reported token usage (input, output, cache read/write), reported USD spend, elapsed time, completed tasks and running agent calls. Task state polls every two seconds; agent messages and lifecycle events stream through SSE. Missing usage stays unavailable. The fullscreen control uses the browser fullscreen API. On narrow screens the map scrolls horizontally and panels fit the viewport.

Checks: `npm --prefix world run build`, `npm --prefix world test`, and `npm test -- tests/world.test.ts`.

## Workspace panels

- **PRD**: product requirements, users, feature acceptance, and client questions. Answers go to Product while its phase is open; later answers become backlog change requests, matching Office.
- **Tasks**: full task details, dependencies, file lanes, acceptance, feedback, blocked reasons, and event history. Add requests with the backlog form.
- **Docs**: grouped run documents with safe text previews, JSON formatting, downloads, refresh, loading, and retry states.

All reads and writes use the selected run. Demo mode never submits changes. Failed submissions preserve the entered text.

Run the workspace browser smoke test from the factory root with `node --import tsx world/scripts/workspace-smoke.mjs` (uses Office’s installed Playwright). It creates disposable runs and verifies both Product answer routes, backlog failure/retry, document viewing/downloads, run selection, demo mode, and mobile layout.
