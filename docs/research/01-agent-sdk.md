# Claude Agent SDK + Claude Code headless: verified capabilities (2026-10-16)

Legend: **VERIFIED** = read from installed `.d.ts` / binary help / live run. **DOCS** = code.claude.com docs fetched today. **UNSURE** = inferred, not confirmed.

Versions: installed SDK `@anthropic-ai/claude-agent-sdk@0.3.217` (latest on npm: **0.3.301**, matching CLI 2.1.301). Installed CLI `claude` 2.1.301. VERIFIED.
Types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (Options at line ~1295), `sdk-tools.d.ts` (tool I/O schemas). No CHANGELOG in the package.

Live tests run (haiku, < $0.02 total): `research/stream-test.jsonl` holds a raw stream-json transcript of a parent + one programmatic subagent.

---

## 1. `query()` signature — VERIFIED

```ts
function query(_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query;
```
`Query` is an `AsyncGenerator<SDKMessage>` plus control methods (only work in streaming-input mode, i.e. prompt is an AsyncIterable):
`interrupt()`, `setPermissionMode(mode)`, `setModel(model?)`, `setMaxThinkingTokens(n|null)`, `applyFlagSettings(...)`, `initializationResult()`, `supportedCommands()`, `supportedModels()`, `supportedAgents()`, `mcpServerStatus()`, `getContextUsage()`, `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, `reloadPlugins()`, `reloadSkills()`, `accountInfo()`, `rewindFiles(userMessageId)`, `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers(servers)`, `streamInput(stream)`, `stopTask(taskId)`, `backgroundTasks(toolUseId?)`, `close()`.

Other exports: `tool()`, `createSdkMcpServer()`, `listSessions`, `getSessionMessages`, `listSubagents(sessionId)`, `getSubagentMessages(sessionId, agentId)`, `forkSession(sessionId)`, `renameSession`, `tagSession`, `deleteSession`, `HOOK_EVENTS`, `USAGE_LIMIT_ERROR_PREFIXES`.

## 2. Options — VERIFIED (exact names)

| Option | Type / notes |
|---|---|
| `model` | `string` — alias (`'fable'`,`'opus'`,`'sonnet'`,`'haiku'`) or full id |
| `fallbackModel` | `string`, comma-separated list tried in order; primary retried each user turn |
| `agent` | `string` — run main thread as a named agent (= `--agent`) |
| `agents` | `Record<string, AgentDefinition>` (see §3) |
| `tools` | `string[]` \| `{type:'preset',preset:'claude_code'}` — base set of built-ins; `[]` disables all |
| `allowedTools` / `disallowedTools` | `string[]` (allowed = auto-approve, not availability; use `tools` to restrict) |
| `toolAliases` | `Record<string,string>` redirect tool names (e.g. `Bash`→`mcp__ws__bash`) |
| `canUseTool` | `CanUseTool` permission callback |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` |
| `allowDangerouslySkipPermissions` | `boolean` — **required** with `bypassPermissions` |
| `planModeInstructions` | `string` |
| `cwd` | `string` |
| `additionalDirectories` | `string[]` (absolute) |
| `maxTurns` | `number` → result subtype `error_max_turns` |
| `maxBudgetUsd` | `number` → result subtype `error_max_budget_usd` |
| `taskBudget` | `{ total: number }` tokens, API-side (`task-budgets-2026-03-13` beta), `@alpha` — model is told its remaining budget |
| `thinking` | `{type:'adaptive'} \| {type:'enabled',budgetTokens} \| {type:'disabled'}` |
| `effort` | `'low'\|'medium'\|'high'\|'xhigh'\|'max'` (default high) |
| `maxThinkingTokens` | deprecated → use `thinking` |
| `systemPrompt` | `string \| string[] \| {type:'preset',preset:'claude_code',append?:string,excludeDynamicSections?:boolean}` |
| `settingSources` | `('user'\|'project'\|'local')[]`. **When omitted, ALL sources load** (matches CLI). `[]` = isolation mode. Must include `'project'` to get CLAUDE.md |
| `settings` / `managedSettings` | `string \| Settings` — inline settings (e.g. `worktree`, `env`, permissions) |
| `skills` | `string[] \| 'all'` |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` (see §5) |
| `mcpServers` | `Record<string, McpServerConfig>` — stdio / sse / http / sdk(in-process) |
| `strictMcpConfig` | `boolean` |
| `outputFormat` | `{ type:'json_schema', schema: Record<string,unknown> }` → `result.structured_output`; failure subtype `error_max_structured_output_retries` |
| `resume` / `continue` / `forkSession` / `sessionId` / `resumeSessionAt` | resume by id; continue latest; fork to new id; set explicit UUID |
| `persistSession` | `boolean` (default true); false = no `~/.claude/projects` transcript |
| `sessionStore` | custom session persistence backend |
| `abortController` | `AbortController` |
| `env` | `Record<string,string\|undefined>` passed to the CLI subprocess |
| `executable` / `executableArgs` | `'bun'\|'deno'\|'node'` |
| `pathToClaudeCodeExecutable` | use a specific CLI binary |
| `extraArgs` | `Record<string,string\|null>` — arbitrary extra CLI flags (null = boolean flag) |
| `spawnClaudeCodeProcess` | custom spawn (e.g. run CLI in a container/VM) |
| `plugins` | `{ type:'local', path:string, skipMcpDiscovery?:boolean }[]` |
| `sandbox` | `SandboxSettings` (bash sandboxing, network allowlist) |
| `includePartialMessages` | stream token deltas |
| `forwardSubagentText` | forward full subagent text/thinking with `parent_tool_use_id` (default: only tool_use/tool_result) |
| `agentProgressSummaries` | ~30s AI summaries of running subagents on `task_progress.summary` |
| `includeHookEvents` | emit `hook_started/progress/response` messages |
| `enableFileCheckpointing` | enables `rewindFiles()` |
| `betas` | `'context-1m-2025-08-07'` |
| `promptSuggestions`, `title`, `debug`, `debugFile`, `stderr`, `loadTimeoutMs`, `toolConfig`, `onElicitation`, `onUserDialog` | misc |

## 3. Programmatic subagents — `AgentDefinition` — VERIFIED

```ts
type AgentDefinition = {
  description: string;            // when to use
  prompt: string;                 // system prompt
  tools?: string[];               // omitted = inherit all parent tools
  disallowedTools?: string[];     // supports mcp__server, mcp__*
  model?: string;                 // alias or full id; 'inherit' / omitted = main model
  mcpServers?: (string | Record<string, McpServerConfigForProcessTransport>)[];
  skills?: string[];
  initialPrompt?: string;         // only when used as main-thread agent
  maxTurns?: number;
  background?: boolean;           // always run as background task
  memory?: 'user' | 'project' | 'local';
  effort?: EffortLevel | number;
  permissionMode?: PermissionMode;
  observer?: string; observerMessage?: string;   // read-only observer agent
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```
- Per-subagent **model, tools, effort, maxTurns, permissionMode, MCP servers**: yes. VERIFIED.
- **No `isolation` field** in `AgentDefinition` (the markdown frontmatter `isolation: worktree` exists — DOCS). Per-call `isolation: "worktree" | "remote"` exists on the model-facing **Agent tool input** (`sdk-tools.d.ts AgentInput`). VERIFIED.
- No per-subagent USD budget; `maxBudgetUsd` is per query. VERIFIED (absence).
- The delegation tool is named **`Agent`** in 2.1.x (types say "invoked via the Agent tool"; some comments still say Task). `AgentInput`: `{description, prompt, subagent_type?, model?: 'sonnet'|'opus'|'haiku'|'fable', run_in_background?, name?, isolation?}`; `team_name`, `mode` deprecated/ignored. VERIFIED.
- **`run_in_background` defaults to true** ("Agents run in the background by default"). For an orchestrator that needs results inline, instruct `run_in_background: false` or rely on `task_notification`. VERIFIED (schema comment).
- Note for this codebase: `lib/agent.ts` disallows `"Task"` on subagents to block recursion; the tool is now `Agent`. Whether `"Task"` is still aliased is UNSURE — add `"Agent"` to `disallowedTools` to be safe.

## 4. Messages emitted — VERIFIED (types + live run)

`SDKMessage` union includes: `assistant`, `user`, `result`, `system` (subtypes `init`, `task_started`, `task_updated`, `task_progress`, `task_notification`, `thinking_tokens`, compact boundary, status, api retry, hooks…), `stream_event` (partial), `rate_limit_event`, `tool_use_summary`, `prompt_suggestion`, etc.

**Result message** (`SDKResultSuccess`): `subtype:'success'`, `result`, `structured_output?`, `total_cost_usd`, `usage` (Anthropic BetaUsage), `modelUsage: Record<model, ModelUsage>`, `num_turns`, `duration_ms`, `duration_api_ms`, `ttft_ms?`, `stop_reason`, `terminal_reason?`, `permission_denials`, `session_id`.
Error variant subtypes: `error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries` with `errors: string[]` (still carries cost/usage).

`ModelUsage` = `{ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens }`. Live CLI 2.1.301 also emits `thinkingTokens`, `canonicalModel`, `provider`, `costBasis` (not yet in 0.3.217 types). Live result also carries an untyped **`subagent_stats`** object: `{spawned, requested:{background,foreground}, max_depth, completed, failed, killed, refused:{depth_limit,concurrency_limit,budget}, by_type:{echoer:1}}`. VERIFIED (live).

**Live evidence**: main=haiku, subagent `echoer` model=sonnet → `modelUsage` had two keys `claude-haiku-5-5` ($0.0166) and `claude-sonnet-5-5` ($0.0025); `total_cost_usd` = sum. So **modelUsage includes subagent spend**, split by model, not by agent.

**Subagent activity in stream**:
1. parent `assistant` with `tool_use` name `Agent` (id = `toolu_X`).
2. `system/task_started` `{task_id, tool_use_id:'toolu_X', subagent_type:'echoer', description, prompt}`.
3. subagent messages: `assistant`/`user` with **`parent_tool_use_id: 'toolu_X'`** and `subagent_type` / `task_description` set (text/thinking only with `forwardSubagentText`).
4. `system/task_progress` `{task_id, usage:{total_tokens, tool_uses, duration_ms}, last_tool_name, summary?}` periodically.
5. `system/task_notification` `{task_id, tool_use_id, status:'completed'|'failed'|'stopped', usage:{total_tokens,tool_uses,duration_ms}, summary, output_file}`.
6. parent `user` message with `tool_result` whose **`tool_use_result`** is `AgentOutput`: `{agentId, agentType, resolvedModel, modelsUsed?, totalTokens, totalToolUseCount, totalDurationMs, usage:{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,...}, toolStats?:{readCount, bashCount, editFileCount, linesAdded, linesRemoved,...}, worktreePath?, worktreeBranch?, status:'completed'}` (or `status:'async_launched'` with `outputFile` for background).

**Per-subagent token attribution**: use `tool_use_result.usage` (+ `resolvedModel`) on the Agent tool_result → compute cost with your own price table; or `task_notification.usage.total_tokens`. No per-subagent USD field exists. For exact USD per agent, run each "developer" as its own `query()` and read its `total_cost_usd`.

Hooks `SubagentStart {agent_id, agent_type}` / `SubagentStop {agent_id, agent_type, agent_transcript_path, last_assistant_message}`; every hook input has `agent_id?/agent_type?` (BaseHookInput). Post-hoc: `listSubagents(sessionId)`, `getSubagentMessages(sessionId, agentId)`.

## 5. Hooks (programmatic callbacks) — VERIFIED

`HookCallback = (input: HookInput, toolUseID: string|undefined, {signal}) => Promise<HookJSONOutput>`; matcher `{ matcher?: string; hooks: HookCallback[]; timeout?: number }`.
Events: `PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, MessageDisplay`.
Output: `{continue?, stopReason?, decision?:'approve'|'block', systemMessage?, reason?, hookSpecificOutput?}`; PreToolUse permission decision `'allow'|'deny'|'ask'|'defer'`. Async hooks: `{async:true}`.

## 6. In-process MCP tools — VERIFIED

```ts
tool(name, description, zodRawShape, handler(args, extra) => Promise<CallToolResult>, extras?: {annotations?, searchHint?, alwaysLoad?})
createSdkMcpServer({ name, version?, instructions?, tools?: SdkMcpToolDefinition[], alwaysLoad? }) // -> McpSdkServerConfigWithInstance
```
Tools appear as `mcp__<server>__<tool>`. Already used here (`lib/localTools.ts`, `mcpServers: { helm: localToolsServer }`).

## 7. Usage / rate limits — VERIFIED

- `getContextUsage()` → `{categories[], totalTokens, maxTokens, percentage, model, memoryFiles, mcpTools, agents, skills, messageBreakdown, isAutoCompactEnabled, autoCompactThreshold, ...}`.
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` → `{session:{total_cost_usd, total_api_duration_ms, total_lines_added, total_lines_removed, model_usage}, subscription_type, rate_limits_available, rate_limits:{five_hour, seven_day, seven_day_opus, seven_day_sonnet, model_scoped...}}` each `{utilization, resets_at}`.
- Stream `rate_limit_event` `{rate_limit_info:{status:'allowed'|'allowed_warning'|'rejected', resetsAt, rateLimitType:'five_hour'|'seven_day'|..., utilization, isUsingOverage, ...}}` — push-based, no polling needed (seen in live run).
- Both control methods require streaming-input mode; `lib/agent.ts` keeps the input generator open to avoid the teardown race (good pattern, keep it).

## 8. Non-Anthropic backends

- SDK/CLI recognise `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_GATEWAY`, `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` (strings present in sdk.mjs). `apiProvider` enum in types: `firstParty | bedrock | vertex | foundry | anthropicAws | anthropicGoogleCloud | mantle | gateway`. VERIFIED.
- Gateway base URLs: `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_AWS_BASE_URL`, `ANTHROPIC_VERTEX_BASE_URL`, `ANTHROPIC_FOUNDRY_BASE_URL`. DOCS.
- Bedrock: `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION` + AWS creds; Vertex: `CLAUDE_CODE_USE_VERTEX=1` + `CLOUD_ML_REGION` + `ANTHROPIC_VERTEX_PROJECT_ID`. DOCS (standard; exact secondary vars not re-fetched → treat region/project names as UNSURE-minor).
- **Ollama** (docs.ollama.com): `ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY="" claude --model qwen3.5`; cloud: `ANTHROPIC_BASE_URL=https://ollama.com ANTHROPIC_AUTH_TOKEN=$OLLAMA_API_KEY`. Needs tool-capable model with 64k+ context; hosted WebSearch / advanced tool controls not fully supported. DOCS. Via SDK: pass these in `options.env` per query (so one developer can run on Ollama while others use Claude) — UNSURE (not live-tested, but `env` is passed straight to the subprocess).
- Caveats: Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway" (DOCS) → best-effort. Settings `env` blocks can override shell vars; with `settingSources` omitted, user settings load — use `settingSources: []` or explicit `env` for determinism. `total_cost_usd` for non-Claude models will be computed from Claude price tables or be 0 — UNSURE; track separately.
- Subscription auth: setting only `ANTHROPIC_BASE_URL` keeps OAuth subscription active; a gateway credential replaces it. DOCS.

## 9. Git worktrees for parallel developers

- CLI: `-w, --worktree [name]` → `.claude/worktrees/<name>/`, branch `worktree-<name>`; `--tmux` companion. `claude -p --worktree` skips trust check; **-p runs never auto-clean their worktrees** (use `git worktree remove`, maybe `git worktree unlock`). VERIFIED (help) + DOCS.
- Settings `worktree: { symlinkDirectories?: string[] (e.g. node_modules), sparsePaths?, baseRef?: 'fresh'|'head', bgIsolation? }` — passable via SDK `settings` option. VERIFIED (types). Default base `fresh` = `origin/<default>`; use `'head'` to include local unpushed work.
- `.worktreeinclude` (gitignore syntax) copies gitignored files like `.env`. DOCS.
- Subagent isolation: model can call `Agent({isolation:'worktree'})`; file-defined agents can set frontmatter `isolation: worktree`; result carries `worktreePath`/`worktreeBranch`. Programmatic `AgentDefinition` has no isolation field. VERIFIED.
- SDK has **no `worktree` option**; options: (a) create worktrees yourself (`git worktree add`) and set `cwd` per `query()` — simplest and most controllable; (b) `extraArgs: { worktree: 'dev-1' }` — UNSURE (plausible, not tested).
- Worktree enforcement blocks Edit/Write/Bash targeting main checkout. DOCS.

## 10. Headless CLI flags — VERIFIED against `claude --help` (2.1.301)

`-p/--print`, `--output-format text|json|stream-json`, `--input-format text|stream-json`, `--verbose` (needed with stream-json in -p), `--include-partial-messages`, `--include-hook-events`, `--forward-subagent-text`, `--replay-user-messages`, `--agents <json-or-file>`, `--agent <name>`, `--model`, `--fallback-model`, `--effort low|medium|high|xhigh|max`, `--max-budget-usd` (print only), `--json-schema <schema>`, `--permission-mode acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`, `--permission-prompts host|none`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--allowedTools`, `--disallowedTools`, `--tools`, `--system-prompt`, `--append-system-prompt`, `--add-dir`, `--mcp-config`, `--strict-mcp-config`, `--settings`, `--setting-sources`, `--plugin-dir`, `--resume`, `--continue`, `--fork-session`, `--session-id`, `--no-session-persistence`, `-w/--worktree`, `--bare`, `--restricted`, `--safe-mode`, `--bg`, `-n/--name`.
- **`--max-turns` is NOT in `--help`** but is accepted (hidden flag; SDK passes it; live run with `--max-turns 3` succeeded). Also hidden: `--max-thinking-tokens`, `--thinking`, `--task-budget`, `--permission-prompt-tool`. VERIFIED.
- Live: `claude -p ... --output-format json --json-schema '{...}'` → `result.structured_output: {"answer":42}`. VERIFIED.
- Note: `--permission-mode` CLI choice is `manual` where SDK type says `default`.

## 11. Multi-agent features in 2.1.x

- **Agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): lead + teammates, shared task list (`TaskCreate/TaskGet/TaskUpdate/TaskList`), mailbox `SendMessage`, hooks `TeammateIdle`/`TaskCreated`/`TaskCompleted`. **Not available in `-p` / Agent SDK** — "Claude doesn't spawn teammates" in non-interactive mode. DOCS. → Build your own orchestration over `query()`.
- Background agents: `claude --bg`, `claude agents --json`, `attach/logs/stop/rm/respawn`. VERIFIED (help). Could be used as process supervisor but SDK is cleaner.
- Named subagents addressable via `SendMessage({to:name})` while running (Agent tool `name`). VERIFIED (schema).
- `claude ultrareview` — cloud multi-agent review of a branch/PR. VERIFIED (help).
- Workflow tool, Monitor, Cron tools exist in tool schemas (sdk-tools.d.ts). VERIFIED (existence only).

---

## Snippet A — programmatic agents + budget cap + structured output

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const PlanSchema = {
  type: "object",
  properties: {
    tasks: { type: "array", items: { type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, files: { type: "array", items: { type: "string" } } },
      required: ["id", "title"] } },
  },
  required: ["tasks"],
};

const q = query({
  prompt: "Plan the feature in SPEC.md, delegate review to `reviewer`, return the task list.",
  options: {
    cwd: "/path/to/worktrees/planner",
    model: "opus",
    fallbackModel: "sonnet",
    effort: "high",
    maxTurns: 40,
    maxBudgetUsd: 2.0,                       // hard stop -> result.subtype 'error_max_budget_usd'
    permissionMode: "acceptEdits",           // or bypassPermissions + allowDangerouslySkipPermissions: true
    settingSources: ["project"],             // deterministic: CLAUDE.md only, no user settings
    systemPrompt: { type: "preset", preset: "claude_code", append: "You are the PLANNER in a software factory." },
    tools: ["Read", "Grep", "Glob", "Bash", "Agent"],
    agents: {
      reviewer: {
        description: "Reviews a plan for gaps and risks",
        prompt: "You are a strict senior reviewer...",
        model: "haiku",
        tools: ["Read", "Grep", "Glob"],
        disallowedTools: ["Agent", "Task"],  // no recursion
        maxTurns: 10,
        effort: "medium",
      },
    },
    outputFormat: { type: "json_schema", schema: PlanSchema },
    forwardSubagentText: true,
    agentProgressSummaries: true,
    abortController: new AbortController(),
  },
});

for await (const m of q) {
  if (m.type === "result") {
    if (m.subtype === "success") console.log(m.structured_output, m.total_cost_usd);
    else console.error(m.subtype, m.errors);
  }
}
```

## Snippet B — per-model and per-subagent token usage from the stream

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type AgentUsage = { agentType: string; model?: string; input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };

export async function collectUsage(stream: AsyncIterable<SDKMessage>) {
  const toolUseToAgent = new Map<string, string>();      // toolu_X -> subagent_type
  const perSubagent = new Map<string, AgentUsage>();     // keyed by Agent tool_use_id
  let perModel: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }> = {};
  let totalCost = 0;

  for await (const m of stream) {
    if (m.type === "system" && m.subtype === "task_started" && m.tool_use_id) {
      toolUseToAgent.set(m.tool_use_id, m.subagent_type ?? "unknown");
    }
    if (m.type === "system" && m.subtype === "task_progress") {
      // live heartbeat: m.usage.total_tokens, m.last_tool_name, m.summary
    }
    // Agent tool_result in the PARENT thread carries the subagent's final usage
    if (m.type === "user" && m.parent_tool_use_id === null && m.tool_use_result && typeof m.tool_use_result === "object") {
      const r = m.tool_use_result as any;
      if (r.status === "completed" && r.agentId && r.usage) {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        const tr = content.find((b: any) => b.type === "tool_result") as any;
        perSubagent.set(tr?.tool_use_id ?? r.agentId, {
          agentType: r.agentType ?? toolUseToAgent.get(tr?.tool_use_id) ?? "unknown",
          model: r.resolvedModel,
          input: r.usage.input_tokens, output: r.usage.output_tokens,
          cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0,
          totalTokens: r.totalTokens,
        });
      }
    }
    if (m.type === "result") {
      perModel = m.modelUsage;          // includes subagent spend, split by model id
      totalCost = m.total_cost_usd;     // parent + subagents
    }
  }
  return { perModel, perSubagent: [...perSubagent.values()], totalCost };
}
```
Note: subagents launched in background (`status:'async_launched'`) report final usage only via `system/task_notification.usage` (total_tokens only), possibly after the parent's `result` — keep iterating / keep the input stream open.

## Decision notes for the factory

1. Run each "developer" as its own `query()` with `cwd` = a pre-created git worktree → exact per-dev `total_cost_usd`, `maxBudgetUsd`, `abortController`, model choice, and backend (`env`). Use in-session `agents` only for cheap helpers (reviewers, researchers).
2. Agent teams are interactive-only; do not plan around them for headless.
3. Upgrade SDK 0.3.217 → 0.3.301 to match the CLI 2.1.301 (types lag live fields like `subagent_stats`, `thinkingTokens`).
4. Default `settingSources` loads user settings/plugins/hooks (incl. this machine's ECC/claude-mem hooks) — pass explicit `settingSources` for reproducible demo runs.
