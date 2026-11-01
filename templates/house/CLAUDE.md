# House conventions (FORGE)

This repo is built by a team of AI agents coordinated by the FORGE orchestrator. Read this first.

## Stack (fixed)
- Web: Vite + React 19 + TypeScript + Tailwind v4 + react-router (`import { ... } from "react-router"`).
- API: Hono on Node (`src/server`). Dev: API :8787, web :5173 (proxies `/api`). Prod: one server on `$PORT` serves API + built web.
- DB: SQLite via better-sqlite3 + drizzle-orm. `DATABASE_URL` (default `data/app.db`; tests use `:memory:`).
- Validation & types: zod v4. **All shared types live in `src/shared/contracts.ts`.**
- Tests: Vitest (`tests/unit`, node env by default; add `// @vitest-environment jsdom` at the top of UI tests), Playwright (`tests/e2e`).
- Node ≥ 22.12. No other frameworks, ORMs, CSS libs or state libraries.

## Where things go
| What | Where |
|---|---|
| Entity + API schemas/types, API paths | `src/shared/contracts.ts` (frozen; Architect only) |
| DB tables | `src/server/db/schema.ts` **and** the matching `CREATE TABLE IF NOT EXISTS` in `src/server/db/migrate.ts` |
| Demo data | `src/server/db/seed.ts` (idempotent: only insert when empty) |
| API routes | `src/server/routes/<area>.ts` exporting a Hono router; mounted in `src/server/app.ts` |
| Pages | `src/web/pages/<Page>.tsx`; routes + nav in `src/web/App.tsx` |
| Shared UI primitives | `src/web/components/ui/*` (Button, Card, Input, Badge, EmptyState, cn) |
| Page-local components | `src/web/components/<area>/*` |
| Fetch helper | `api(schema, path, { method, json })` from `src/web/lib/api.ts`; `useAsync` hook from `src/web/lib/useAsync.ts` |
| Unit tests | `tests/unit/<area>.test.ts(x)`; server via `app.request(path, init)` |
| E2E tests | `tests/e2e/*.spec.ts` (QA agent owns these) |

## Patterns
- Server handlers validate input with the contract schema: `const body = CreateThing.safeParse(await c.req.json())`; on failure return `c.json({ error: "Invalid input", details: body.error.issues }, 400)`.
- Responses are plain JSON matching the contract response schema; errors are `{ error: string }` with a proper status code.
- Use `crypto.randomUUID()` for ids, `Date.now()` / ISO strings for times (as the contract says).
- UI: every page handles loading, empty (`EmptyState`) and error states. Every input has a visible label (`Input` requires `label`). Buttons have clear text labels; use the exact copy from `docs/design.md` / PRD.
- Keep components small; no global state library: lift state or refetch via `reload()`.

## Security (judges run code and security scans)
- `app.ts` already sets `secureHeaders()` and a 1 MB `bodyLimit`; keep both.
- Validate every request body and param with the zod schemas in `src/shared/contracts.ts` before use.
- Drizzle query builder only: never `sql.raw` or `${}` interpolation inside `sql```.
- No `dangerouslySetInnerHTML`, `innerHTML =`, `eval` or `new Function`.
- No secrets in the repo: read them from `process.env` and list them in `.env.example`.
- Cookies: `secure: process.env.COOKIE_SECURE === "true"`, never `NODE_ENV === "production"`. The container runs production over plain http, where Safari drops Secure cookies and every request after login is 401.

## Commands
- `npm run check`: typecheck + lint + unit tests (**must pass before you report DONE**)
- `npm run build`, `npm start`, `npm run dev`
- `npm run e2e`: builds, starts a server on :8799 with `data/e2e.db`, and runs Playwright (or uses `BASE_URL` if set)

## Rules for every agent
- Stay within the files your task allows. Never edit `docs/prd.json`, `docs/tasks.json`, `tests/acceptance/**` or `.forge/**`.
- Never weaken `tsconfig.json`, `eslint.config.js`, `vitest.config.ts` or `playwright.config.ts` to make checks pass.
- No new dependencies unless your task brief explicitly allows them.
- Don't commit, push or switch branches: the orchestrator handles git.
