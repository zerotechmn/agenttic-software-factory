import type { ForgeTask, Prd } from '../ui/WorkspacePanels'
import type { AgentEvent, Role, Task } from '../domain/types'
import type { AgentView } from '../domain/project'

export interface ForgeEvent { ts: number; run: string; kind: string; role?: string; agentId?: string; taskId?: string; text?: string; status?: string }
export interface ForgeState {
  run?: string; phase?: string; startedAt?: number; systemicHalt?: string;
  tasks?: ForgeTask[]; prd?: Prd | null; done?: string[];
  spend?: { usd: number; tokens?: { in: number; out: number; cacheRead: number; cacheWrite?: number } };
}
export const roleOf = (e: ForgeEvent, state: ForgeState): Role => {
  if (e.role === 'dev') {
    const slot = Math.max(0, (state.tasks ?? []).findIndex(t => t.id === e.taskId)) % 3
    return (['dev1', 'dev2', 'dev3'] as const)[slot]
  }
  const map: Record<string, Role> = { product: 'pm', uiux: 'designer', architect: 'architect', researcher: 'researcher', reviewer: 'reviewer', final_reviewer: 'final_reviewer', integrator: 'integrator', qa: 'qa', devops: 'devops' }
  return map[e.role ?? ''] ?? 'orchestrator'
}
export function forgeView(state: ForgeState, raw: ForgeEvent[], now: number) {
  const start = state.startedAt ?? raw[0]?.ts ?? now
  const end = state.phase === 'done' ? raw.at(-1)?.ts ?? start : now
  const elapsed = Math.max(0, end - start)
  const tasks: Task[] = (state.tasks ?? []).map((t, i) => ({
    id: t.id, title: t.title, description: t.description ?? '', ownerRole: (['dev1', 'dev2', 'dev3'] as const)[i % 3],
    status: ({ running: 'in_progress', merged: 'done', parked: 'blocked' } as const)[t.status as 'running' | 'merged' | 'parked'] ?? (['ready', 'review', 'blocked'].includes(t.status) ? t.status as 'ready' | 'review' | 'blocked' : 'backlog'),
    dependencies: t.deps ?? [], acceptanceCriteria: t.acceptance ?? [], inputs: [], expectedOutputs: [], branchOrWorktree: t.branch,
    latestCheckStatus: 'pending', fixAttempts: Math.max(0, (t.attempts ?? 1) - 1),
  }))
  const events: AgentEvent[] = raw.map((e, i) => ({
    id: `forge-${i}`, runId: e.run, timestamp: new Date(e.ts).toISOString(), simMs: Math.max(0, e.ts - start),
    sender: roleOf(e, state), taskId: e.taskId, type: e.kind === 'agent_start' ? 'agent.started' : e.kind === 'agent_done' ? 'agent.stopped' : 'message.routed',
    summary: e.text || [e.kind, e.taskId, e.status].filter(Boolean).join(' · '), artifactReferences: [], source: 'FORGE', simulated: false,
  }))
  // Pair lifecycle records by worker identity, so simultaneous workers remain active independently.
  const working = new Map<string, Role>()
  for (const e of raw) {
    const key = `${e.role}:${e.agentId ?? ''}:${e.taskId ?? ''}`
    if (e.kind === 'agent_start') working.set(key, roleOf(e, state))
    if (e.kind === 'agent_done') working.delete(key)
  }
  const activeRoles = new Set(working.values())
  return { tasks, events, elapsed, activeRoles, active: state.phase === 'done' ? 0 : working.size }
}
export function liveAgents(agents: AgentView[], activeRoles: Set<Role>, finished: boolean): AgentView[] {
  return agents.map(a => ({ ...a, status: finished ? (a.status === 'idle' ? 'idle' : 'completed') : activeRoles.has(a.role) ? 'working' : a.status === 'working' ? 'waiting' : a.status }))
}
