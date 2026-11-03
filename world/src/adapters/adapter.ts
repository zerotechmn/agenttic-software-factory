import type { CheckName, CheckStatus, EventType, Role } from '../domain/types'

export interface AdapterContext {
  runId: string
  startedAtMs: number // wall-clock ms when the run started; timestamps = start + simulated offset
  seq: number // position of this record in the run, used for stable ids
}

/**
 * Converts one record from some orchestrator's own format (log line, webhook body, queue message)
 * into an AgentEvent-shaped object. The output is untrusted: the store validates it with parseEvent.
 * Only the mock adapter below exists today; a real one is written once the orchestrator is chosen.
 */
export interface OrchestratorAdapter<Raw> {
  readonly source: string
  translate(raw: Raw, ctx: AdapterContext): unknown
}

/** The pretend "orchestrator log" the simulator replays. Deliberately not the AgentEvent shape. */
export interface MockLogLine {
  at: number // seconds after run start
  kind: EventType
  from: Role
  to?: Role
  task?: string
  msg: string
  refs?: string[]
  check?: [CheckName, CheckStatus]
  verdict?: 'approved' | 'changes_requested'
}

export const mockAdapter: OrchestratorAdapter<MockLogLine> = {
  source: 'mock-adapter',
  translate(l, ctx) {
    const simMs = Math.round(l.at * 1000)
    return {
      id: `${ctx.runId}-${String(ctx.seq).padStart(3, '0')}`,
      runId: ctx.runId,
      timestamp: new Date(ctx.startedAtMs + simMs).toISOString(),
      simMs,
      sender: l.from,
      recipient: l.to,
      type: l.kind,
      taskId: l.task,
      summary: l.msg,
      artifactReferences: l.refs ?? [],
      source: 'mock-adapter',
      simulated: true,
      check: l.check ? { name: l.check[0], status: l.check[1] } : undefined,
      verdict: l.verdict,
    }
  },
}
