import type { AgentRequest, AgentResult, AgentRunner } from "../agent.ts";

export type Script = (req: AgentRequest, call: number) => Promise<Partial<AgentResult> | void> | Partial<AgentResult> | void;

/** Scripted runner for pipeline tests: zero tokens, deterministic, records every call. */
export class FakeAgentRunner implements AgentRunner {
  calls: AgentRequest[] = [];
  private counts = new Map<string, number>();

  constructor(private scripts: Partial<Record<string, Script>>, private usdPerCall = 0.1, private onSpend?: (role: string, usd: number, tokens?: { in: number; out: number; cacheRead: number; model?: string }) => void) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push(req);
    const key = req.taskId ? `${req.role}:${req.taskId}` : req.role;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    const script = this.scripts[key] ?? this.scripts[req.role];
    const extra = (script ? await script(req, n) : undefined) ?? {};
    this.onSpend?.(req.role, this.usdPerCall, { in: 10, out: 5, cacheRead: 0, model: req.model });
    return {
      ok: true,
      text: "",
      sessionId: `sess-${key}-${n}`,
      usd: this.usdPerCall,
      tokensIn: 10,
      tokensOut: 5,
      cacheRead: 0,
      subtype: "success",
      output: { status: "DONE", summary: "ok", filesChanged: [], concerns: [] },
      ...extra,
    };
  }

  callsFor(role: string, taskId?: string): AgentRequest[] {
    return this.calls.filter((c) => c.role === role && (taskId === undefined || c.taskId === taskId));
  }
}
