import { CHECK_NAMES, EVENT_TYPES, ROLES, type AgentEvent } from './types'

export type Parsed = { ok: true; event: AgentEvent } | { ok: false; reason: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && list.includes(v as T)

/** Boundary check for anything that claims to be an AgentEvent. Never throws. */
export function parseEvent(raw: unknown): Parsed {
  const bad = (reason: string): Parsed => ({ ok: false, reason })
  if (!isObj(raw)) return bad('not an object')
  const e = raw
  for (const k of ['id', 'runId', 'timestamp', 'summary', 'source'] as const) {
    if (!isStr(e[k])) return bad(`missing or empty "${k}"`)
  }
  if (Number.isNaN(Date.parse(e.timestamp as string))) return bad('timestamp is not a date')
  if (typeof e.simMs !== 'number' || !Number.isFinite(e.simMs) || e.simMs < 0) return bad('simMs must be a number >= 0')
  if (!oneOf(ROLES, e.sender)) return bad(`unknown sender "${String(e.sender)}"`)
  if (e.recipient !== undefined && !oneOf(ROLES, e.recipient)) return bad(`unknown recipient "${String(e.recipient)}"`)
  if (!oneOf(EVENT_TYPES, e.type)) return bad(`unknown type "${String(e.type)}"`)
  if (e.taskId !== undefined && !isStr(e.taskId)) return bad('taskId must be a non-empty string')
  if (!Array.isArray(e.artifactReferences) || !e.artifactReferences.every(isStr)) return bad('artifactReferences must be string[]')
  if (typeof e.simulated !== 'boolean') return bad('simulated must be boolean')
  if (e.check !== undefined) {
    if (!isObj(e.check) || !oneOf(CHECK_NAMES, e.check.name) || !oneOf(['pending', 'running', 'pass', 'fail'], e.check.status))
      return bad('check must be {name, status}')
  }
  if (e.verdict !== undefined && !oneOf(['approved', 'changes_requested'], e.verdict)) return bad('bad verdict')
  const needsTask = ['task.assigned', 'task.started', 'task.blocked', 'task.completed', 'fix.requested', 'review.requested', 'review.completed']
  if (needsTask.includes(e.type as string) && e.taskId === undefined) return bad(`${String(e.type)} needs taskId`)
  if (['check.started', 'check.failed', 'check.passed'].includes(e.type as string) && e.check === undefined)
    return bad(`${String(e.type)} needs check`)
  if (e.type === 'review.completed' && e.verdict === undefined) return bad('review.completed needs verdict')
  return { ok: true, event: e as unknown as AgentEvent }
}
