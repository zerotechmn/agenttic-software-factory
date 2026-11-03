import type { AgentStatus, CheckStatus, EventType, TaskStatus } from '../domain/types'

/** Simulated offset as T+m:ss. */
export const simTime = (ms: number | undefined) => {
  if (ms === undefined) return '—'
  const s = Math.floor(ms / 1000)
  return `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog', ready: 'Ready', in_progress: 'In progress', review: 'Review', done: 'Done', blocked: 'Blocked',
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle', working: 'Working', waiting: 'Waiting', blocked: 'Blocked', completed: 'Completed', failed: 'Failed',
}

export const CHECK_ICON: Record<CheckStatus, string> = { pending: '○', running: '◌', pass: '✓', fail: '✕' }

export const EVENT_LABEL: Record<EventType, string> = {
  'artifact.published': 'Artifact published',
  'task.assigned': 'Task assigned',
  'task.started': 'Task started',
  'task.blocked': 'Task blocked',
  'task.completed': 'Task completed',
  'check.started': 'Check started',
  'check.failed': 'Check failed',
  'check.passed': 'Check passed',
  'fix.requested': 'Fix requested',
  'review.requested': 'Review requested',
  'review.completed': 'Review completed',
  'run.completed': 'Run completed',
  'agent.started': 'Agent started',
  'agent.stopped': 'Agent stopped',
  'message.routed': 'Message routed',
}
