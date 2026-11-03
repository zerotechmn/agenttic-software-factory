// Typed model for the factory dashboard. Everything the UI shows is derived from AgentEvent[]
// (see project.ts), so a real orchestrator only has to produce these events.

export const ROLES = [
  'orchestrator',
  'pm',
  'researcher',
  'architect',
  'designer',
  'dev1',
  'dev2',
  'dev3',
  'reviewer',
  'final_reviewer',
  'integrator',
  'qa',
  'devops',
] as const
export type Role = (typeof ROLES)[number]

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'

export const TASK_STATUSES = ['backlog', 'ready', 'in_progress', 'review', 'done', 'blocked'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'blocked' | 'completed' | 'failed'

export const CHECK_NAMES = ['lint', 'typecheck', 'tests', 'build', 'review', 'gate'] as const
export type CheckName = (typeof CHECK_NAMES)[number]
export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail'

/** Static task contract (what tasks.json would hold). Status lives in the projection, not here. */
export interface TaskContract {
  id: string
  title: string
  description: string
  ownerRole: Role
  dependencies: string[]
  inputs: string[] // artifact ids read
  expectedOutputs: string[] // artifact ids written
  acceptanceCriteria: string[]
  branchOrWorktree?: string // only for tasks that change code
}

/** A task as the dashboard sees it right now: contract + derived state. */
export interface Task extends TaskContract {
  status: TaskStatus
  latestCheckStatus: CheckStatus
  fixAttempts: number
  startedAt?: number // sim ms
  finishedAt?: number // sim ms
}

export interface Artifact {
  id: string // file-like id, e.g. "spec.md"
  title: string
  kind: 'doc' | 'contract' | 'plan' | 'report'
  producedBy: Role
  content: string // demo content only
}

export const EVENT_TYPES = [
  'artifact.published',
  'task.assigned',
  'task.started',
  'task.blocked',
  'task.completed',
  'check.started',
  'check.failed',
  'check.passed',
  'fix.requested',
  'review.requested',
  'review.completed',
  'run.completed',
  'agent.started',
  'agent.stopped',
  'message.routed',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Control = tells an agent to do something; artifact = durable output; status = observability only. */
export type MessageKind = 'control' | 'artifact' | 'status'
export const MESSAGE_KIND: Record<EventType, MessageKind> = {
  'task.assigned': 'control',
  'fix.requested': 'control',
  'review.requested': 'control',
  'artifact.published': 'artifact',
  'task.started': 'status',
  'task.blocked': 'status',
  'task.completed': 'status',
  'check.started': 'status',
  'check.failed': 'status',
  'check.passed': 'status',
  'review.completed': 'status',
  'run.completed': 'status',
  'agent.started': 'status',
  'agent.stopped': 'status',
  'message.routed': 'control',
}

/** The one event shape the dashboard consumes. Optional fields are marked with `?`. */
export interface AgentEvent {
  id: string
  runId: string
  timestamp: string // ISO 8601, run start + simulated offset
  simMs: number // offset from run start; orders events and drives timelines
  sender: Role
  recipient?: Role
  type: EventType
  taskId?: string
  summary: string
  artifactReferences: string[]
  source: string // which adapter produced it, e.g. "mock-adapter"
  simulated: boolean
  check?: { name: CheckName; status: CheckStatus }
  verdict?: 'approved' | 'changes_requested'
}

export interface Rejection {
  reason: string
  raw: unknown
}
