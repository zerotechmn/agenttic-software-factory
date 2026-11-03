import { mockAdapter } from '../adapters/adapter'
import { project } from '../domain/project'
import type { AgentEvent, Rejection, RunStatus } from '../domain/types'
import { parseEvent } from '../domain/validate'
import { script, TASKS, type Variant } from './scenario'

// The single source of truth for the demo: run controls + the validated event log.
// Tasks, agents and checks are never stored; the UI derives them with project(TASKS, events).

export const SPEEDS = [0.5, 1, 2, 4, 8] as const

export interface SimState {
  runId: string
  variant: Variant
  status: RunStatus
  speed: number
  simMs: number // simulated time since start; only advances while running
  cursor: number // next script line to emit
  startedAtMs: number | null // wall clock at Start, used only to label timestamps
  events: AgentEvent[]
  rejected: Rejection[]
}

export type Action =
  | { type: 'start'; nowMs: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'speed'; speed: number }
  | { type: 'variant'; variant: Variant }
  | { type: 'tick'; realMs: number }
  | { type: 'ingest'; raw: unknown } // any external record; validated before it is stored

export const initialState = (variant: Variant = 'happy', speed = 1): SimState => ({
  runId: 'demo-run-001',
  variant,
  status: 'idle',
  speed,
  simMs: 0,
  cursor: 0,
  startedAtMs: null,
  events: [],
  rejected: [],
})

function append(s: SimState, raw: unknown[]): SimState {
  const events = [...s.events]
  const rejected = [...s.rejected]
  for (const r of raw) {
    const p = parseEvent(r)
    if (p.ok) events.push(p.event)
    else rejected.push({ reason: p.reason, raw: r })
  }
  const proj = project(TASKS, events)
  const status: RunStatus = proj.failure ? 'failed' : proj.completed ? 'completed' : s.status
  return { ...s, events, rejected, status }
}

export function reducer(s: SimState, a: Action): SimState {
  switch (a.type) {
    case 'start':
      if (s.status !== 'idle') return s
      return advance({ ...s, status: 'running', startedAtMs: a.nowMs }, 0)
    case 'pause':
      return s.status === 'running' ? { ...s, status: 'paused' } : s
    case 'resume':
      return s.status === 'paused' ? { ...s, status: 'running' } : s
    case 'reset':
      return initialState(s.variant, s.speed)
    case 'speed':
      return { ...s, speed: Math.min(16, Math.max(0.25, a.speed)) }
    case 'variant':
      return s.status === 'idle' ? { ...s, variant: a.variant } : s
    case 'tick':
      return s.status === 'running' ? advance(s, a.realMs * s.speed) : s
    case 'ingest':
      return append(s, [a.raw])
  }
}

/** Move simulated time forward and emit every script line that is now due. */
function advance(s: SimState, simDeltaMs: number): SimState {
  const lines = script(s.variant)
  const simMs = s.simMs + simDeltaMs
  const due: unknown[] = []
  let cursor = s.cursor
  while (cursor < lines.length && lines[cursor].at * 1000 <= simMs) {
    due.push(mockAdapter.translate(lines[cursor], { runId: s.runId, startedAtMs: s.startedAtMs ?? 0, seq: cursor }))
    cursor++
  }
  const next = { ...s, simMs, cursor }
  return due.length ? append(next, due) : next
}

export const scriptLength = (v: Variant) => script(v).at(-1)!.at * 1000
