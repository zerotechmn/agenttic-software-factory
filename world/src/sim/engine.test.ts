import { describe, expect, it } from 'vitest'
import { fixLoops, project } from '../domain/project'
import { initialState, reducer, scriptLength, type Action, type SimState } from './engine'
import { TASKS } from './scenario'

const run = (s: SimState, ...actions: Action[]) => actions.reduce(reducer, s)
const start = (variant: SimState['variant'] = 'happy') => run(initialState(variant), { type: 'start', nowMs: Date.UTC(2026, 9, 29, 9) })
const toEnd = (s: SimState) => run(s, { type: 'tick', realMs: scriptLength(s.variant) + 1000 })
const view = (s: SimState) => project(TASKS, s.events)

describe('controls', () => {
  it('start emits the first event and ticks advance simulated time', () => {
    const s = start()
    expect(s.status).toBe('running')
    expect(s.events.map(e => e.type)).toEqual(['artifact.published'])
    const later = run(s, { type: 'tick', realMs: 10_000 })
    expect(later.simMs).toBe(10_000)
    expect(later.events.length).toBeGreaterThan(3)
  })

  it('pause freezes time and resume continues', () => {
    const paused = run(start(), { type: 'pause' }, { type: 'tick', realMs: 50_000 })
    expect(paused.status).toBe('paused')
    expect(paused.simMs).toBe(0)
    expect(paused.events).toHaveLength(1)
    const resumed = run(paused, { type: 'resume' }, { type: 'tick', realMs: 5_000 })
    expect(resumed.status).toBe('running')
    expect(resumed.simMs).toBe(5_000)
  })

  it('speed multiplies simulated time', () => {
    const s = run(start(), { type: 'speed', speed: 4 }, { type: 'tick', realMs: 1_000 })
    expect(s.simMs).toBe(4_000)
  })

  it('reset returns exactly to the initial state, keeping speed and scenario', () => {
    const s = run(start('retry-exhausted'), { type: 'speed', speed: 2 }, { type: 'tick', realMs: 30_000 }, { type: 'reset' })
    expect(s).toEqual(initialState('retry-exhausted', 2))
  })

  it('a reset run replays identically', () => {
    const a = toEnd(start())
    const b = toEnd(run(a, { type: 'reset' }, { type: 'start', nowMs: Date.UTC(2026, 9, 29, 9) }))
    expect(b.events).toEqual(a.events)
  })

  it('malformed external records are rejected, not stored', () => {
    const s = run(start(), { type: 'ingest', raw: { type: 'task.started', sender: 'nobody' } })
    expect(s.events).toHaveLength(1)
    expect(s.rejected).toHaveLength(1)
    expect(s.status).toBe('running')
  })
})

describe('demo scenario', () => {
  it('runs the three developer lanes at the same time', () => {
    expect(view(run(start(), { type: 'tick', realMs: 50_000 })).tasks.filter(t => t.status === 'in_progress').map(t => t.id)).toEqual(['T5', 'T6', 'T7'])
  })

  it('happy path: fail -> fix requested -> retest -> pass, then completes', () => {
    const s = toEnd(start())
    expect(s.status).toBe('completed')
    expect(s.rejected).toEqual([])
    const p = view(s)
    expect(p.violations).toEqual([])
    expect(p.tasks.every(t => t.status === 'done')).toBe(true)
    const tests = p.checks.tests.history.filter(h => h.status !== 'running').map(h => `${h.status}:${h.taskId}`)
    expect(tests).toEqual(['fail:T5', 'pass:T5', 'pass:T9'])
    const order = s.events.filter(e => e.taskId === 'T5' && ['check.failed', 'fix.requested', 'check.passed', 'review.completed'].includes(e.type))
    expect(order.map(e => e.type).slice(-4)).toEqual(['check.failed', 'fix.requested', 'check.passed', 'review.completed'])
  })

  it('fixLoops pairs each failure with its fix, retest and result', () => {
    const happy = fixLoops(toEnd(start()).events)
    expect(happy).toHaveLength(1)
    expect(happy[0].fix?.recipient).toBe('dev1')
    expect(happy[0].result?.type).toBe('check.passed')
    const exhausted = fixLoops(toEnd(start('retry-exhausted')).events)
    expect(exhausted.map(l => l.result?.type)).toEqual(['check.failed', 'check.failed', undefined])
  })

  it('T5 is not done while its retest is still failing', () => {
    let s = start()
    while (!s.events.some(e => e.type === 'fix.requested')) s = run(s, { type: 'tick', realMs: 500 })
    expect(view(s).tasks.find(t => t.id === 'T5')!.status).toBe('in_progress')
  })

  it('retry-exhausted variant stops the run as failed', () => {
    const s = toEnd(start('retry-exhausted'))
    expect(s.status).toBe('failed')
    expect(view(s).failure).toMatch(/Retry budget exhausted: T5/)
  })
})
