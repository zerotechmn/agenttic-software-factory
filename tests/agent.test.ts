import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { SdkAgentRunner, UsageLimitError, type QueryFn } from "../src/agent.ts";
import { EventBus } from "../src/events.ts";
import { Budget } from "../src/budget.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { newState } from "../src/state.ts";

function setup(queryFn: QueryFn) {
  const dir = mkdtempSync(join(tmpdir(), "forge-agent-"));
  const state = newState("r");
  const bus = new EventBus(join(dir, "events.jsonl"), "r");
  const budget = new Budget({ ...DEFAULT_CONFIG, budgetUsd: 10 }, state);
  const runner = new SdkAgentRunner(bus, budget, () => state.phase, queryFn, [0, 0, 0]);
  return { state, bus, runner, file: join(dir, "events.jsonl") };
}

const result = (over: Record<string, unknown> = {}) => ({
  type: "result", subtype: "success", result: "done", total_cost_usd: 0.25, session_id: "s1", num_turns: 3,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 },
  structured_output: { answer: 42 }, ...over,
});
const assistant = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "working" }, { type: "tool_use", id: "t", name: "Bash", input: { command: "npm test" } }], usage: { input_tokens: 5, output_tokens: 2 } } };
const req = { role: "dev" as const, taskId: "T1", cwd: "/tmp", prompt: "do it", model: "sonnet", maxTurns: 5, maxBudgetUsd: 1, schema: z.object({ answer: z.number() }) };

describe("SdkAgentRunner", () => {
  it("returns validated structured output and records spend and events", async () => {
    const { state, runner, file } = setup(async function* () { yield assistant as any; yield result() as any; });
    const r = await runner.run(req);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ answer: 42 });
    expect(r.sessionId).toBe("s1");
    expect(state.spend.byRole.dev).toBe(0.25);
    const kinds = EventBus.readAll(file).map((e) => e.kind);
    expect(kinds).toEqual(["agent_start", "say", "tool", "agent_done"]);
  });

  it("treats structured output that fails the schema as a failed attempt", async () => {
    const { runner } = setup(async function* () { yield result({ structured_output: { answer: "x" } }) as any; });
    const r = await runner.run(req);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^invalid_output/);
  });

  it("retries a transient 429 thrown by the SDK", async () => {
    let calls = 0;
    const { runner } = setup(async function* () {
      calls++;
      if (calls === 1) throw new Error("API Error: 429 rate_limit_error");
      yield result() as any;
    });
    const r = await runner.run(req);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not retry a non-transient error and reports it", async () => {
    let calls = 0;
    const { runner } = setup(async function* () { calls++; throw new Error("Invalid API key"); });
    const r = await runner.run(req);
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
    expect(r.error).toContain("Invalid API key");
  });

  it("keeps the subtype and records spend when max turns is hit", async () => {
    const { state, runner } = setup(async function* () {
      yield result({ subtype: "error_max_turns", structured_output: undefined, errors: ["max turns"], total_cost_usd: 0.4 }) as any;
    });
    const r = await runner.run(req);
    expect(r.ok).toBe(false);
    expect(r.subtype).toBe("error_max_turns");
    expect(state.spend.usd).toBe(0.4);
  });

  it("passes the role's model, caps and isolation options to the SDK", async () => {
    let seen: any;
    const { runner } = setup(async function* (args) { seen = args.options; yield result() as any; });
    await runner.run(req);
    expect(seen.model).toBe("sonnet");
    expect(seen.maxTurns).toBe(5);
    expect(seen.maxBudgetUsd).toBe(1);
    expect(seen.settingSources).toEqual(["project"]);
    expect(seen.disallowedTools).toEqual(expect.arrayContaining(["Agent", "Task"]));
    expect(seen.outputFormat.type).toBe("json_schema");
    expect(seen.systemPrompt.append).toContain("DEVELOPER");
  });
});

describe("SdkAgentRunner cap errors", () => {
  it("uses the result message and records spend when the SDK throws after a budget cap", async () => {
    const { state, runner } = setup(async function* () {
      yield result({ subtype: "error_max_budget_usd", structured_output: undefined, errors: ["budget"], total_cost_usd: 0.64 }) as any;
      throw new Error("Claude Code returned an error result: Reached maximum budget ($0.64)");
    });
    const r = await runner.run(req);
    expect(r.subtype).toBe("error_max_budget_usd");
    expect(state.spend.usd).toBe(0.64);
  });
  it("maps a bare 'Reached maximum budget' exception to the budget subtype", async () => {
    const { runner } = setup(async function* () { throw new Error("Claude Code returned an error result: Reached maximum budget ($0.64)"); });
    const r = await runner.run(req);
    expect(r.subtype).toBe("error_max_budget_usd");
  });
});

describe("SdkAgentRunner usage limits", () => {
  it("pauses until the reset time on a subscription limit, then retries the same call", async () => {
    let calls = 0;
    const limitMsg = "You've hit your session limit · resets 6:50pm (Asia/Ulaanbaatar)";
    const queryFn: QueryFn = async function* () {
      calls++;
      if (calls === 1) {
        yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: limitMsg }] } } as any;
        yield result({ result: limitMsg, structured_output: undefined, total_cost_usd: 0 }) as any;
        return;
      }
      yield result() as any;
    };
    const { runner, file } = setup(queryFn);
    const slept: number[] = [];
    runner.sleep = async (ms) => { slept.push(ms); };
    runner.now = () => new Date("2026-10-16T14:30:00");
    const r = await runner.run(req);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    const total = slept.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(10 * 60_000); // probes again within 10 min, even though reset is hours away
    expect(EventBus.readAll(file).some((e) => e.kind === "paused")).toBe(true);
  });

  it("halts the run (UsageLimitError) after the max pause instead of burning task attempts", async () => {
    const limitMsg = "You've hit your usage limit";
    const { runner } = setup(async function* () { yield result({ result: limitMsg, structured_output: undefined }) as any; });
    runner.sleep = async () => {};
    runner.maxPauseMs = 60_000;
    await expect(runner.run(req)).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("stops pausing when shouldAbort says so", async () => {
    const { runner } = setup(async function* () { yield result({ result: "You've hit your session limit · resets 6:50pm", structured_output: undefined }) as any; });
    runner.sleep = async () => {};
    runner.shouldAbort = () => true;
    await expect(runner.run(req)).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("does not mistake a successful summary that mentions usage limits for a real limit", async () => {
    const { runner } = setup(async function* () { yield result({ result: "Added: returns 429 when usage limit exceeded", structured_output: { answer: 1 } }) as any; });
    const slept: number[] = [];
    runner.sleep = async (ms) => { slept.push(ms); };
    const r = await runner.run(req);
    expect(r.ok).toBe(true);
    expect(slept).toEqual([]);
  });
});

import { parseResetTime } from "../src/agent.ts";
describe("parseResetTime", () => {
  it("finds the next occurrence of the reset clock time", () => {
    const now = new Date("2026-10-16T14:30:00");
    expect(parseResetTime("resets 6:50pm (Asia/Ulaanbaatar)", now)?.getHours()).toBe(18);
    expect(parseResetTime("resets 9am", now)?.getDate()).toBe(17);
    expect(parseResetTime("no time here", now)).toBeUndefined();
  });
});

describe("SdkAgentRunner spend and timeouts", () => {
  it("estimates spend for a call that dies without a result, from earlier calls' cost per token", async () => {
    let n = 0;
    const { state, runner } = setup(async function* () {
      n++;
      if (n === 1) { yield { ...assistant, message: { ...assistant.message, usage: { input_tokens: 100, output_tokens: 100 } } } as any; yield result({ total_cost_usd: 0.2, usage: { input_tokens: 100, output_tokens: 100 } }) as any; return; }
      yield { ...assistant, message: { ...assistant.message, usage: { input_tokens: 100, output_tokens: 100 } } } as any;
      throw new Error("Invalid API key");
    });
    await runner.run(req);
    const before = state.spend.usd;
    const r = await runner.run(req);
    expect(r.ok).toBe(false);
    expect(state.spend.usd).toBeGreaterThan(before);
  });

  it("aborts a call that exceeds its wall-clock timeout", async () => {
    const { runner } = setup(async function* (args) {
      await new Promise<void>((resolve) => args.options.abortController!.signal.addEventListener("abort", () => resolve()));
      throw new Error("aborted by user");
    });
    runner.timeoutMs = 50;
    const t0 = Date.now();
    const r = await runner.run(req);
    expect(r.ok).toBe(false);
    expect(r.subtype).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("SdkAgentRunner caching", () => {
  it("keeps the system prompt static across worktrees so prompt caching hits", async () => {
    let seen: any;
    const { runner } = setup(async function* (args) { seen = args.options; yield result() as any; });
    await runner.run(req);
    expect(seen.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code", excludeDynamicSections: true, snapshot: true });
  });
});

describe("SdkAgentRunner MCP isolation", () => {
  it("never loads the user's cloud connectors; only the MCP servers a role asks for", async () => {
    let seen: any;
    const { runner } = setup(async function* (args) { seen = args.options; yield result() as any; });
    await runner.run({ ...req, mcpServers: { scrapling: { type: "stdio", command: "x", args: [] } } });
    expect(seen.strictMcpConfig).toBe(true);
    expect(Object.keys(seen.mcpServers)).toEqual(["scrapling"]);
  });
});

describe("SdkAgentRunner usage-limit accounting", () => {
  it("refunds the reported cost of a call that only returned a usage-limit message", async () => {
    let n = 0;
    const limitMsg = "You've hit your session limit · resets 4:50am";
    const { state, runner } = setup(async function* () {
      n++;
      if (n === 1) { yield result({ result: limitMsg, structured_output: undefined, total_cost_usd: 0.38 }) as any; return; }
      yield result({ total_cost_usd: 0.1 }) as any;
    });
    runner.sleep = async () => {};
    runner.now = () => new Date("2026-10-17T02:30:00");
    await runner.run(req);
    expect(state.spend.usd).toBeCloseTo(0.1, 6);
  });

  it("probes at the configured interval but never past the stated reset", async () => {
    let n = 0;
    const { runner } = setup(async function* () {
      n++;
      if (n === 1) { yield result({ result: "You've hit your session limit · resets 2:40am", structured_output: undefined }) as any; return; }
      yield result() as any;
    });
    const slept: number[] = [];
    runner.sleep = async (ms) => { slept.push(ms); };
    runner.now = () => new Date("2026-10-17T02:30:00");
    runner.probeMs = 30 * 60_000;
    await runner.run(req);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(11 * 60_000); // reset in 10 min + 1 min margin, not 30
  });
});

describe("SdkAgentRunner idle watchdog", () => {
  it("aborts a stalled stream after the idle limit even though the total timeout is far away", async () => {
    const { runner } = setup(async function* (args) {
      yield assistant as any;
      await new Promise<void>((resolve) => args.options.abortController!.signal.addEventListener("abort", () => resolve()));
      throw new Error("aborted");
    });
    runner.idleMs = 60;
    runner.timeoutMs = 60_000;
    const r = await runner.run(req);
    expect(r.subtype).toBe("timeout");
    expect(r.error).toMatch(/no activity/);
  });
  it("uses a per-request timeout when given", async () => {
    let seen = 0;
    const { runner } = setup(async function* (args) {
      const t0 = Date.now();
      await new Promise<void>((resolve) => args.options.abortController!.signal.addEventListener("abort", () => resolve()));
      seen = Date.now() - t0;
      throw new Error("aborted");
    });
    runner.idleMs = 60_000;
    const r = await runner.run({ ...req, timeoutMs: 80 });
    expect(r.subtype).toBe("timeout");
    expect(seen).toBeLessThan(2000);
  });
});

describe("SdkAgentRunner pause uses the wall clock", () => {
  it("resumes right after a long machine sleep once the wait has passed in real time", async () => {
    let n = 0;
    const { runner } = setup(async function* () {
      n++;
      if (n === 1) { yield result({ result: "You've hit your session limit · resets 9:40pm", structured_output: undefined }) as any; return; }
      yield result() as any;
    });
    let clock = new Date("2026-10-17T18:26:00").getTime();
    runner.now = () => new Date(clock);
    runner.probeMs = 30 * 60_000;
    let sleeps = 0;
    runner.sleep = async () => { sleeps++; clock += 5 * 3_600_000; }; // the Mac slept for 5 hours during one 30 s step
    const r = await runner.run(req);
    expect(r.ok).toBe(true);
    expect(sleeps).toBe(1);
  });
});

describe("SdkAgentRunner skills", () => {
  it("passes the role's skills (and the Skill tool) and hides every other skill", async () => {
    let seen: any;
    const { runner } = setup(async function* (args) { seen = args.options; yield result() as any; });
    await runner.run({ ...req, role: "reviewer", cwd: mkdtempSync(join(tmpdir(), "forge-rs-")) });
    expect(seen.skills).toEqual(expect.arrayContaining(["security-review", "coding-standards"]));
    expect(seen.tools).toContain("Skill");
  });
});

describe("SdkAgentRunner event detail", () => {
  it("keeps up to ~1500 chars of what agents say and the full (capped) tool input for detail views", async () => {
    const long = "x".repeat(1400);
    const { runner, file } = setup(async function* () {
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: long }, { type: "tool_use", id: "t", name: "Bash", input: { command: "npm test -- " + "y".repeat(500) } }] } } as any;
      yield result() as any;
    });
    await runner.run(req);
    const ev = EventBus.readAll(file);
    expect(ev.find((e) => e.kind === "say")!.text!.length).toBeGreaterThanOrEqual(1400);
    const tool = ev.find((e) => e.kind === "tool")!;
    expect(JSON.stringify((tool.data as { input: unknown }).input)).toContain("y".repeat(500));
  });
});
