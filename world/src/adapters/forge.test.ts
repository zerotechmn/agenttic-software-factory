import { describe, expect, it } from 'vitest'
import { forgeView, type ForgeState, type ForgeEvent } from './forge'
describe('FORGE adapter', () => {
  const state: ForgeState = { run: 'real', phase: 'build', startedAt: 1000, tasks: [{ id: 'a', title: 'A', status: 'merged' }, { id: 'b', title: 'B', status: 'running' }] }
  const event = (kind: string, taskId: string, ts: number): ForgeEvent => ({ kind, taskId, ts, role: 'dev', run: 'real' })
  it('maps authoritative task states and keeps simultaneous workers independent', () => {
    const view = forgeView(state, [event('agent_start', 'a', 1000), event('agent_start', 'b', 1100), event('agent_done', 'a', 1200)], 2000)
    expect(view.tasks.map(t => t.status)).toEqual(['done', 'in_progress'])
    expect(view.active).toBe(1)
    expect([...view.activeRoles]).toEqual(['dev2'])
    expect(view.events[0].simulated).toBe(false)
    expect(view.elapsed).toBe(1000)
  })
  it('freezes completed elapsed time at the last event', () => {
    expect(forgeView({ ...state, phase: 'done' }, [event('agent_done', 'b', 1500)], 9000)).toMatchObject({ elapsed: 500, active: 0 })
  })
})
