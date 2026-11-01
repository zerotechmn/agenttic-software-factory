import { query, type Options, type SDKMessage, type HookCallbackMatcher, type HookEvent, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import type { Budget } from "./budget.ts";
import type { EventBus } from "./events.ts";
import { lessonsFor } from "./lessons.ts";
import { loadRole } from "./roles.ts";
import { jsonSchema } from "./schemas.ts";
import { Stopped } from "./ctx.ts";
import { installSkills, skillsFor } from "./skills.ts";
import type { Phase, Role } from "./types.ts";

export interface AgentRequest {
  role: Role;
  taskId?: string;
  cwd: string;
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  schema?: z.ZodType;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  resume?: string;
  extraDirs?: string[];
  env?: Record<string, string | undefined>;
  mcpServers?: Record<string, McpServerConfig>;
  /** Wall-clock cap for this call; defaults to the role's `timeoutMin`, then the runner default. */
  timeoutMs?: number;
}

export interface AgentResult {
  ok: boolean;
  output?: unknown;
  text: string;
  sessionId?: string;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  error?: string;
  subtype: string;
}

export interface AgentRunner {
  run(req: AgentRequest): Promise<AgentResult>;
}

export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

const USAGE_LIMIT = /hit your (session|usage|weekly|daily|5-hour|opus) limit|usage limit (reached|exceeded)|limit · resets/i;

/** Next occurrence of the clock time in "resets 6:50pm" (local time). */
export function parseResetTime(text: string, now: Date = new Date()): Date | undefined {
  const m = text.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if ((m[3] ?? "").toLowerCase() === "pm") h += 12;
  if (!m[3] && Number(m[1]) >= 12) h = Number(m[1]);
  const d = new Date(now);
  d.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

const TRANSIENT = /\b429\b|rate.?limit|overloaded|\b5\d\d\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;
const NO_RECURSION = ["Agent", "Task"];
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function describeTool(name: string, input: Record<string, unknown>): string {
  const v = input.skill ?? input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.libraryName ?? input.description ?? "";
  return short(`${name} ${typeof v === "string" ? v : JSON.stringify(v)}`.trim(), 160);
}

let seq = 0;

/** Full tool input for detail views, with long string fields capped (keeps event logs small). */
function capInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === "string" && v.length > 2000 ? v.slice(0, 2000) + "…" : v;
  }
  return out;
}

/** A subscription usage limit that did not lift within the max pause: halt the run cleanly (resume later). */
export class UsageLimitError extends Stopped {
  constructor(public detail: string) {
    super();
    this.message = `usage limit did not lift (${detail}); run halted — \`forge resume\` continues`;
  }
}

type EventBase = { phase: Phase; role: Role; taskId?: string; agentId: string; model: string };

export class SdkAgentRunner implements AgentRunner {
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  now: () => Date = () => new Date();
  /** Longest total wait for a subscription usage limit to reset before giving up. */
  maxPauseMs = 6 * 3_600_000;
  /** Checked while paused (e.g. the STOP file). */
  shouldAbort: () => boolean = () => false;
  /** Wall-clock cap per agent call; a hung stream must never stall a lane. */
  timeoutMs = 30 * 60_000;
  /** Abort when the SDK stream shows no activity for this long (a hung tool, MCP call or API stall). */
  idleMs = 10 * 60_000;
  /** How often to re-probe while paused on a usage limit (FORGE_PROBE_MIN), capped by the stated reset time. */
  probeMs = Number(process.env.FORGE_PROBE_MIN ?? 10) * 60_000;
  private rates = new Map<string, number>();

  constructor(
    private bus: EventBus,
    private budget: Budget,
    private phase: () => Phase,
    private queryFn: QueryFn = query as unknown as QueryFn,
    private backoffMs: number[] = [2000, 8000, 30000],
  ) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    this.budget.hold(req.maxBudgetUsd);
    try {
      return await this.runPausing(req);
    } finally {
      this.budget.release(req.maxBudgetUsd);
    }
  }

  private async runPausing(req: AgentRequest): Promise<AgentResult> {
    let paused = 0;
    for (;;) {
      const r = await this.runWithRetries(req);
      // Only a failed call can be a usage limit; a successful summary may legitimately mention limits.
      const limitText = r.ok ? undefined : [r.text, r.error].find((t) => t && t.length < 600 && USAGE_LIMIT.test(t));
      if (!limitText) return r;
      // A limit message did no work: don't let its reported cost eat the build budget.
      if (r.usd) this.budget.record(req.role, -r.usd, false, this.phase());
      const left = this.maxPauseMs - paused;
      if (left <= 0 || this.shouldAbort()) throw new UsageLimitError(limitText.slice(0, 200));
      const reset = parseResetTime(limitText, this.now());
      // Probe every 10 min: limits sometimes lift (or apply per model) well before the stated reset.
      const wait = Math.min(left, this.probeMs, reset ? reset.getTime() - this.now().getTime() + 60_000 : Infinity);
      this.bus.emit({ phase: this.phase(), kind: "paused", role: req.role, taskId: req.taskId, text: `usage limit hit; retrying in ${Math.round(wait / 60000)} min${reset ? ` (stated reset ${reset.toTimeString().slice(0, 5)})` : ""}` });
      // Count real time too: if the machine slept through the wait, resume as soon as it wakes.
      const until = this.now().getTime() + wait;
      for (let waited = 0; waited < wait && this.now().getTime() < until && !this.shouldAbort(); ) {
        const step = Math.min(30_000, wait - waited);
        await this.sleep(step);
        waited += step;
      }
      paused += wait;
      this.bus.emit({ phase: this.phase(), kind: "resumed", role: req.role, taskId: req.taskId });
    }
  }

  private async runWithRetries(req: AgentRequest): Promise<AgentResult> {
    let lastError = "";
    for (let attempt = 0; attempt <= this.backoffMs.length; attempt++) {
      try {
        const r = await this.once(req);
        if (!r.ok && r.subtype === "error_during_execution" && TRANSIENT.test(r.error ?? "") && attempt < this.backoffMs.length) {
          lastError = r.error ?? "";
        } else {
          return r;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!TRANSIENT.test(lastError) || attempt === this.backoffMs.length) break;
      }
      this.bus.emit({ phase: this.phase(), kind: "retry", role: req.role, taskId: req.taskId, text: short(lastError, 200) });
      await new Promise((res) => setTimeout(res, this.backoffMs[attempt]));
    }
    this.bus.emit({ phase: this.phase(), kind: "agent_done", role: req.role, taskId: req.taskId, status: "error", text: short(lastError, 300) });
    return { ok: false, text: lastError, usd: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, error: lastError, subtype: "exception" };
  }

  private async once(req: AgentRequest): Promise<AgentResult> {
    const role = loadRole(req.role);
    const agentId = `${req.role}${req.taskId ? `:${req.taskId}` : ""}#${++seq}`;
    const phase = this.phase();
    const base: EventBase = { phase, role: req.role, taskId: req.taskId, agentId, model: req.model };
    this.bus.emit({ ...base, kind: "agent_start", text: short(req.prompt, 300) });

    const abortController = new AbortController();
    let timedOut: false | "total" | "idle" = false;
    const totalMs = req.timeoutMs ?? (role.timeoutMin ? role.timeoutMin * 60_000 : this.timeoutMs);
    const timer = setTimeout(() => {
      timedOut = "total";
      abortController.abort();
    }, totalMs);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        timedOut = "idle";
        abortController.abort();
      }, this.idleMs);
    };
    touch();
    // Only this role's skills, copied into its working dir; every other skill stays hidden.
    const skills = installSkills(req.cwd, skillsFor(role, req.cwd));
    const tools = role.tools ? (skills.length && !role.tools.includes("Skill") ? [...role.tools, "Skill"] : role.tools) : undefined;
    const options: Options = {
      cwd: req.cwd,
      skills,
      model: req.model,
      maxTurns: req.maxTurns,
      maxBudgetUsd: req.maxBudgetUsd,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: role.body + lessonsFor(req.role), excludeDynamicSections: true, snapshot: true },
      disallowedTools: NO_RECURSION,
      abortController,
      // Never inherit the user's claude.ai connectors (~110 tools, ~100k tokens/call, email/drive actions).
      strictMcpConfig: true,
      mcpServers: req.mcpServers ?? {},
      ...(tools ? { tools } : {}),
      ...(req.hooks ? { hooks: req.hooks } : {}),
      ...(req.schema ? { outputFormat: { type: "json_schema", schema: jsonSchema(req.schema) } } : {}),
      ...(req.resume ? { resume: req.resume } : {}),
      ...(req.extraDirs?.length ? { additionalDirectories: req.extraDirs } : {}),
      env: { ...process.env, ...(req.env ?? {}) },
    };

    let final: Extract<SDKMessage, { type: "result" }> | undefined;
    const streamed = { tokens: 0, touch };
    try {
      await this.consume(req, options, base, (m) => (final = m), streamed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The SDK throws *after* yielding the result when a cap is hit; keep that result (and its spend).
      if (!final) {
        const estimate = this.estimate(req.model, streamed.tokens);
        const subtype = timedOut ? "timeout" : /maximum budget/i.test(msg) ? "error_max_budget_usd" : /maximum (number of )?turns/i.test(msg) ? "error_max_turns" : undefined;
        if (!subtype) {
          this.budget.record(req.role, estimate, false, phase);
          throw err;
        }
        const how = timedOut as false | "total" | "idle"; // set inside timer callbacks; TS can't see that
        const error = how === "idle" ? `no activity for ${Math.round(this.idleMs / 60000)} min (stalled)` : timedOut ? `timed out after ${Math.round(totalMs / 60000)} min` : msg;
        final = { type: "result", subtype, errors: [error], total_cost_usd: estimate, usage: {}, session_id: undefined } as unknown as Extract<SDKMessage, { type: "result" }>;
      }
    } finally {
      clearTimeout(timer);
      if (idle) clearTimeout(idle);
    }
    if (!final) {
      this.budget.record(req.role, this.estimate(req.model, streamed.tokens), false, phase);
      if (timedOut) final = { type: "result", subtype: "timeout", errors: ["timed out"], total_cost_usd: 0, usage: {} } as unknown as Extract<SDKMessage, { type: "result" }>;
    }
    return this.finish(req, base, phase, final);
  }

  /** Lower-bound cost for a call that never reported one, from the observed $/token of earlier calls on this model. */
  private estimate(model: string, tokens: number): number {
    return tokens * (this.rates.get(model) ?? 0);
  }

  private async consume(req: AgentRequest, options: Options, base: EventBase, onResult: (m: Extract<SDKMessage, { type: "result" }>) => void, streamed: { tokens: number; touch: () => void }): Promise<void> {
    for await (const m of this.queryFn({ prompt: req.prompt, options })) {
      streamed.touch();
      if (m.type === "assistant" && !m.parent_tool_use_id) {
        const usage = (m.message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        streamed.tokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
        for (const block of m.message.content as unknown as Array<Record<string, unknown>>) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            this.bus.emit({ ...base, kind: "say", text: short(block.text.trim(), 1500), tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens });
          } else if (block.type === "tool_use") {
            this.bus.emit({ ...base, kind: "tool", text: describeTool(String(block.name), (block.input ?? {}) as Record<string, unknown>), data: { tool: block.name, input: capInput(block.input) } });
          }
        }
      } else if (m.type === "result") {
        onResult(m);
      }
    }
  }

  private finish(req: AgentRequest, base: EventBase, phase: Phase, final: Extract<SDKMessage, { type: "result" }> | undefined): AgentResult {
    if (!final) throw new Error("agent stream ended without a result message");

    const usd = final.total_cost_usd ?? 0;
    // `usage` covers the main loop only; modelUsage covers every model call of the query (helpers included), by exact
    // model id, so prefer it for tokens. Cache writes are kept apart from plain input so the hit rate stays honest.
    const byModel = Object.entries((final as { modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }> }).modelUsage ?? {})
      .map(([model, m]) => ({ model, in: m.inputTokens ?? 0, out: m.outputTokens ?? 0, cacheRead: m.cacheReadInputTokens ?? 0, cacheWrite: m.cacheCreationInputTokens ?? 0, usd: m.costUSD ?? 0 }));
    const main = (final.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    const sum = (k: "in" | "out" | "cacheRead" | "cacheWrite") => byModel.reduce((a, m) => a + m[k], 0);
    const usage = byModel.length
      ? { input_tokens: sum("in"), output_tokens: sum("out"), cache_read_input_tokens: sum("cacheRead"), cache_creation_input_tokens: sum("cacheWrite") }
      : main;
    const tokensIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    this.budget.record(req.role, usd, false, phase, { in: usage.input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, out: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, model: req.model, byModel });
    const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    if (usd > 0 && tokens > 0) this.rates.set(req.model, usd / tokens);
    const out: AgentResult = {
      ok: final.subtype === "success",
      text: "result" in final && typeof final.result === "string" ? final.result : "",
      sessionId: final.session_id,
      usd,
      tokensIn,
      tokensOut: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      subtype: final.subtype,
    };
    if (!out.ok) out.error = ("errors" in final && Array.isArray(final.errors) ? final.errors.join("; ") : "") || final.subtype;

    if (out.ok && req.schema) {
      const raw = (final as { structured_output?: unknown }).structured_output ?? tryJson(out.text);
      const parsed = req.schema.safeParse(raw);
      if (parsed.success) out.output = parsed.data;
      else {
        out.ok = false;
        out.error = `invalid_output: ${short(parsed.error.message, 400)}`;
      }
    }
    this.bus.emit({
      ...base, kind: "agent_done", status: out.ok ? "ok" : "fail", usd, tokensIn: out.tokensIn, tokensOut: out.tokensOut, cacheRead: out.cacheRead, sessionId: out.sessionId,
      text: short(out.ok ? summaryOf(out.output) ?? out.text : out.error ?? "", 300),
    });
    return out;
  }
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]);
    } catch {
      return undefined;
    }
  }
}

function summaryOf(o: unknown): string | undefined {
  if (o && typeof o === "object" && "summary" in o && typeof (o as { summary: unknown }).summary === "string") return (o as { summary: string }).summary;
  return undefined;
}
