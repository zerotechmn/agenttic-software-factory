import {
  CHECK_NAMES,
  ROLES,
  type AgentEvent,
  type AgentStatus,
  type CheckName,
  type CheckStatus,
  type Role,
  type RunStatus,
  type Task,
  type TaskContract,
} from './types'

/** A task may be sent back for fixing this many times; the next fix request fails the run. */
export const MAX_FIX_ATTEMPTS = 2

export interface CheckState {
  status: CheckStatus
  history: { status: CheckStatus; simMs: number; taskId?: string; eventId: string }[]
}

export interface Projection {
  tasks: Task[]
  checks: Record<CheckName, CheckState>
  violations: string[] // events that broke a rule; they are shown, never applied
  failure?: string // set when a guardrail stops the run
  completed: boolean
  publishedArtifacts: Map<string, AgentEvent> // artifact id -> latest publishing event
}

const depsDone = (t: Task, byId: Map<string, Task>) => t.dependencies.every(d => byId.get(d)?.status === 'done')

/** Backlog <-> ready is derived: a task is ready exactly when every dependency is done. */
function refreshReadiness(tasks: Task[], byId: Map<string, Task>) {
  for (const t of tasks) {
    if (t.status === 'backlog' && depsDone(t, byId)) t.status = 'ready'
    else if (t.status === 'ready' && !depsDone(t, byId)) t.status = 'backlog'
  }
}

/** Replay events over the task contracts. Pure: same inputs, same output. */
export function project(contracts: TaskContract[], events: AgentEvent[]): Projection {
  const tasks: Task[] = contracts.map(c => ({ ...c, status: 'backlog', latestCheckStatus: 'pending', fixAttempts: 0 }))
  const byId = new Map(tasks.map(t => [t.id, t]))
  const checks = Object.fromEntries(CHECK_NAMES.map(n => [n, { status: 'pending', history: [] }])) as unknown as Record<
    CheckName,
    CheckState
  >
  const violations: string[] = []
  const publishedArtifacts = new Map<string, AgentEvent>()
  let failure: string | undefined
  let completed = false
  refreshReadiness(tasks, byId)

  for (const e of events) {
    if (failure) break // nothing applies after a guardrail stop
    const t = e.taskId ? byId.get(e.taskId) : undefined
    const reject = (why: string) => violations.push(`${e.id}: ${why}`)
    if (e.taskId && !t) {
      reject(`unknown task ${e.taskId}`)
      continue
    }
    if (e.check) {
      const c = checks[e.check.name]
      c.status = e.check.status
      c.history.push({ status: e.check.status, simMs: e.simMs, taskId: e.taskId, eventId: e.id })
      if (t) t.latestCheckStatus = e.check.status
    }
    switch (e.type) {
      case 'artifact.published':
        for (const a of e.artifactReferences) publishedArtifacts.set(a, e)
        break
      case 'task.started':
        if (t!.status === 'ready' || (t!.status === 'blocked' && depsDone(t!, byId))) {
          t!.status = 'in_progress'
          t!.startedAt ??= e.simMs
        } else if (t!.status === 'in_progress') {
          // a fix round resuming work: already in progress
        } else {
          const waiting = t!.dependencies.filter(d => byId.get(d)?.status !== 'done')
          reject(`${t!.id} cannot start from ${t!.status}${waiting.length ? `; waiting on ${waiting.join(', ')}` : ''}`)
        }
        break
      case 'task.blocked':
        if (t!.status === 'in_progress' || t!.status === 'ready') t!.status = 'blocked'
        else reject(`${t!.id} cannot be blocked from ${t!.status}`)
        break
      case 'task.completed':
      case 'review.requested':
        if (t!.status === 'in_progress') t!.status = 'review'
        else reject(`${t!.id} cannot go to review from ${t!.status}`)
        break
      case 'review.completed':
        if (t!.status !== 'review') reject(`${t!.id} is not in review`)
        else if (e.verdict === 'changes_requested') t!.status = 'in_progress'
        else if (t!.latestCheckStatus === 'fail' || t!.latestCheckStatus === 'running')
          reject(`${t!.id} cannot be approved while its latest check is ${t!.latestCheckStatus}`)
        else {
          t!.status = 'done'
          t!.finishedAt = e.simMs
        }
        break
      case 'fix.requested':
        t!.fixAttempts += 1
        if (t!.fixAttempts > MAX_FIX_ATTEMPTS) {
          t!.status = 'blocked'
          failure = `Retry budget exhausted: ${t!.id} failed after ${MAX_FIX_ATTEMPTS} fix attempts. Run stopped for a human.`
        } else {
          t!.status = 'in_progress'
          t!.finishedAt = undefined
        }
        break
      case 'run.completed':
        if (tasks.every(x => x.status === 'done')) completed = true
        else reject('run.completed while tasks are unfinished')
        break
      default:
        break // task.assigned and check.* carry no extra state change
    }
    refreshReadiness(tasks, byId)
  }
  return { tasks, checks, violations, failure, completed, publishedArtifacts }
}

/** Share of tasks that are done (0..1). Review/in-progress work is not counted until approved. */
export const progress = (tasks: Task[]) => (tasks.length ? tasks.filter(t => t.status === 'done').length / tasks.length : 0)

export interface AgentView {
  role: Role
  status: AgentStatus
  currentTask?: Task
  lastActivityMs?: number
  message?: string
}

const ORDER: Task['status'][] = ['in_progress', 'blocked', 'review', 'ready']

export function deriveAgents(tasks: Task[], events: AgentEvent[], run: RunStatus, failure?: string): AgentView[] {
  return ROLES.map(role => {
    const owned = tasks.filter(t => t.ownerRole === role)
    const mine = events.filter(e => e.sender === role || e.recipient === role)
    const last = mine.at(-1)
    const said = events.filter(e => e.sender === role).at(-1)
    // A reviewer owns no task: it is busy with whatever review was last requested from it.
    const reviewing = tasks.find(t => t.status === 'review' &&
      events.filter(e => e.type === 'review.requested' && e.taskId === t.id).at(-1)?.recipient === role)
    const currentTask = ORDER.map(s => owned.find(t => t.status === s)).find(Boolean) ?? reviewing
    let status: AgentStatus = 'idle'
    if (run === 'idle') status = 'idle' // nothing is assigned before the run starts
    else if (role === 'orchestrator') {
      status = ({ idle: 'idle', running: 'working', paused: 'waiting', completed: 'completed', failed: 'failed' } as const)[run]
    } else if (failure && owned.some(t => t.status === 'blocked')) status = 'failed'
    else if (currentTask?.status === 'in_progress' || (reviewing && currentTask === reviewing))
      status = run === 'running' ? 'working' : 'waiting'
    else if (currentTask?.status === 'blocked') status = 'blocked'
    else if (currentTask) status = 'waiting'
    else if (owned.length && owned.every(t => t.status === 'done')) status = 'completed'
    else if (!owned.length && run === 'completed' && last) status = 'completed'
    return {
      role,
      status,
      currentTask,
      lastActivityMs: last?.simMs,
      message: role === 'orchestrator' && failure ? failure : said?.summary ?? (last ? `Received: ${last.summary}` : undefined),
    }
  })
}

export interface FixLoop {
  failed: AgentEvent
  fix?: AgentEvent
  retest?: AgentEvent
  result?: AgentEvent
}

/** Pair every failed check with the fix request, retest and result that followed it for the same task. */
export function fixLoops(events: AgentEvent[]): FixLoop[] {
  return events.flatMap((e, i) => {
    if (e.type !== 'check.failed') return []
    const after = events.slice(i + 1).filter(x => x.taskId === e.taskId)
    const fix = after.find(x => x.type === 'fix.requested')
    const afterFix = fix ? after.slice(after.indexOf(fix) + 1) : []
    const retest = afterFix.find(x => x.type === 'check.started')
    const result = retest ? afterFix.slice(afterFix.indexOf(retest) + 1).find(x => x.type === 'check.passed' || x.type === 'check.failed') : undefined
    return [{ failed: e, fix, retest, result }]
  })
}
