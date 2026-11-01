// FROZEN CONTRACT (architect). Shapes of every FORGE console API, the run-param helpers, and the public
// surface of each new module. Developers import from here; do not change a shape without the architect.
// No zod: the brief forbids new dependencies, so these are plain TS types (+ tiny pure helpers).
import type { ForgeEvent } from "../director";

export type { ForgeEvent };

// ---- API paths ----------------------------------------------------------------------------------

/** Run routes: always passed through `withRun()` so they carry the page's `?run=`. */
export const RUN_PATHS = { events: "/events", state: "/state", say: "/say", task: "/task" } as const;

/** Console routes (forge console only). Never carry `?run=`; the run name is in the path where needed. */
export const API_PATHS = {
  runs: "/api/runs",
  runAction: (name: string, action: RunAction) => `/api/runs/${encodeURIComponent(name)}/${action}`,
  assistant: "/api/assistant",
  proposals: "/api/proposals",
  proposal: (id: string) => `/api/proposals/${encodeURIComponent(id)}`,
} as const;

// ---- entities / request / response bodies ---------------------------------------------------------

/** One row of GET /api/runs (newest first). */
export interface RunSummary { name: string; run: string; phase: string; usd: number; budget: number; product: string; startedAt: number | string; active: boolean }
/** POST /api/runs body. `name` omitted when blank. budget > 0. → 201 {name} | 400 {error}. */
export interface NewRunRequest { name?: string; brief: string; budget: number }
export interface NewRunResponse { name: string }
export type RunAction = "resume" | "stop"; // POST /api/runs/<name>/<action> → 202
export interface AssistantRequest { message: string }
export interface AssistantResponse { reply: string; usd: number } // reply is markdown
export interface Proposal { id: string; kind: "start" | "resume"; run: string; brief?: string; budget?: number }
export interface ProposalAnswerRequest { confirm: boolean }
export interface ProposalAnswerResponse { result: string }
export interface ErrorResponse { error: string }

/** What every api.ts console call resolves to; never rejects. `error` = server `{error}`, else `HTTP <status>`, else "network error" (status 0). */
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** `"live"`/`"replay"` from feed.ts, plus whether GET /api/runs answered (console mode). */
export interface ConsoleInfo { console: boolean; runs: RunSummary[]; current: string | null }

// ---- run param (pure; used by api.ts and feed.ts) -----------------------------------------------

/** `run=<encoded name>` from `?run=` in `search` (default location.search), or "" when absent/empty. */
export function runParam(search: string = location.search): string {
  const name = new URLSearchParams(search).get("run");
  return name ? `run=${encodeURIComponent(name)}` : "";
}

/** `path` + the page's run param (`/say` → `/say?run=todo`, `/x?a=1` → `/x?a=1&run=todo`); unchanged without ?run=. */
export function withRun(path: string, search: string = location.search): string {
  const p = runParam(search);
  return p ? `${path}${path.includes("?") ? "&" : "?"}${p}` : path;
}

/** Decoded `?run=` name, or null. */
export function runFromUrl(search: string = location.search): string | null {
  return new URLSearchParams(search).get("run") || null;
}

/** Current run: `?run=` if present, else the newest run from /api/runs (index 0), else null. */
export function currentRun(runs: RunSummary[], search: string = location.search): string | null {
  return runFromUrl(search) ?? runs[0]?.name ?? null;
}

// ---- src/api.ts public surface (implemented in api.ts; signatures frozen) -----------------------
//   runParam, withRun re-exported from here
//   postTask(t: {title, description}): Promise<boolean>        → withRun("/task")
//   postSay(role, text): Promise<boolean>                       → withRun("/say")
//   fetchRuns(): Promise<RunSummary[] | null>                   → null = not console mode (404/!array/network)
//   startRun(body: NewRunRequest): Promise<ApiResult<NewRunResponse>>
//   runAction(name, action: RunAction): Promise<ApiResult<unknown>>
//   askAssistant(message): Promise<ApiResult<AssistantResponse>>
//   fetchProposals(): Promise<Proposal[]>                       → [] on any failure
//   answerProposal(id, confirm): Promise<ApiResult<ProposalAnswerResponse>>
//   nav: { assign(url: string): void }                          → location.assign; tests spy on it
//   switchRun(name): void                                       → nav.assign(`${location.pathname}?run=${encodeURIComponent(name)}`)

// ---- module surfaces (classes implement these) ---------------------------------------------------

/** Max raw events kept per agent and shown in the agent panel. */
export const AGENT_LOG_CAP = 50;
/** Event kinds recorded in an agent's log. */
export const LOGGED_KINDS = ["tool", "say", "agent_done"] as const;

/** src/agentLog.ts `AgentLog`: raw events per agent key, newest first, capped at AGENT_LOG_CAP. */
export interface AgentLogApi {
  /** Record `e` for `key` (newest first, drop beyond cap). */
  push(key: string, e: ForgeEvent): void;
  /** Copy of the raw events for `key`, newest first; [] for unknown keys. */
  get(key: string): ForgeEvent[];
}

/** src/agentPanel.ts `AgentPanel` (constructor(notes, mode, send) unchanged). */
export interface AgentPanelInfo { key: string; role: string; title: string; meta: string; events: ForgeEvent[] /* newest first */ }
export interface AgentPanelApi {
  render(body: HTMLElement, info: AgentPanelInfo): void;
  /** Incremental: if the open panel is for `key`, prepend `e` (keep textarea/focus/scroll/expanded; cap 50). Otherwise no-op. */
  prepend(key: string, e: ForgeEvent): void;
  /** Re-render only the notes list (existing). */
  refresh(): void;
}

/** src/markdown.ts: `renderMarkdown(src: string): DocumentFragment`. Builds DOM nodes; never innerHTML. */
export type RenderMarkdown = (src: string) => DocumentFragment;

/** src/runPicker.ts `RunPicker`: renders into the HUD slot; hidden (display:none) when runs is null. */
export interface RunPickerApi { render(slot: HTMLElement, runs: RunSummary[] | null, current: string | null): void }

/** src/lobbyPanel.ts `LobbyPanel(info: () => ConsoleInfo)`. */
export interface LobbyPanelApi { render(body: HTMLElement): void }

/** src/chatPanel.ts `ChatPanel(info: () => ConsoleInfo, storage?: Storage | null)`. */
export interface ChatPanelApi { render(body: HTMLElement): void }

/** Session storage key for chat history: JSON ChatMessage[]. */
export const CHAT_STORAGE_KEY = "forge-office-chat";
export interface ChatMessage { from: "operator" | "assistant" | "error"; text: string; usd?: number; ts: number }

/** Exact demo-mode notices (replay / plain live). */
export const DEMO_LOBBY = "demo mode: start the console with `forge console`";
export const DEMO_CHAT = "The assistant needs `forge console`: start the console to chat with FORGE.";

/** Hud side-panel kinds: "board" | `agent:${key}` | "lobby" | "chat". */
export type PanelKind = "board" | `agent:${string}` | "lobby" | "chat" | "task" | "prd" | "vault";

/** New window.__office members (added to OfficeHooks in src/office.ts; all existing members unchanged). */
export interface OfficeHooksExtra {
  openChat(): void;
  openLobby(): void;
  /** Raw events newest first, max 50; [] for unknown keys. */
  agentLog(key: string): ForgeEvent[];
  /** A character's feet in canvas CSS pixels (for real clicks in tests); null if absent. */
  screenOf(key: string): { x: number; y: number } | null;
}
