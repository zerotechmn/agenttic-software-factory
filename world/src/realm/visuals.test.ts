import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../domain/types'
import { arcPoint, bubbleFor, BUBBLE_MS, FLIGHT_MS, flights, speeches } from './visuals'

let n = 0
const ev = (p: Partial<AgentEvent> & Pick<AgentEvent, 'type' | 'sender'>): AgentEvent => ({
  id: `v${++n}`, runId: 'r', timestamp: new Date(0).toISOString(), simMs: 0, summary: 's',
  artifactReferences: [], source: 'test', simulated: true, ...p,
})

describe('bubbleFor', () => {
  it('maps every kind of event to the agreed bubble', () => {
    expect(bubbleFor(ev({ type: 'task.assigned', sender: 'orchestrator', recipient: 'dev1', taskId: 'T5' }))).toBe('purple')
    expect(bubbleFor(ev({ type: 'review.requested', sender: 'dev1', recipient: 'reviewer', taskId: 'T5' }))).toBe('orange')
    expect(bubbleFor(ev({ type: 'artifact.published', sender: 'architect' }))).toBe('blue')
    expect(bubbleFor(ev({ type: 'check.failed', sender: 'qa', taskId: 'T5', check: { name: 'tests', status: 'fail' } }))).toBe('red')
    expect(bubbleFor(ev({ type: 'task.blocked', sender: 'pm', taskId: 'T1' }))).toBe('green')
    expect(bubbleFor(ev({ type: 'task.blocked', sender: 'devops', taskId: 'T11' }))).toBe('red')
    expect(bubbleFor(ev({ type: 'review.completed', sender: 'reviewer', taskId: 'T5', verdict: 'approved' }))).toBe('gold')
    expect(bubbleFor(ev({ type: 'review.completed', sender: 'reviewer', taskId: 'T5', verdict: 'changes_requested' }))).toBe('red')
    expect(bubbleFor(ev({ type: 'task.started', sender: 'dev1', taskId: 'T5' }))).toBeNull()
  })
})

describe('speeches', () => {
  it('keeps the newest line per speaker and drops old or future ones', () => {
    const events = [
      ev({ type: 'artifact.published', sender: 'pm', simMs: 1000, summary: 'old' }),
      ev({ type: 'task.completed', sender: 'pm', recipient: 'orchestrator', taskId: 'T1', simMs: 3000, summary: 'new' }),
      ev({ type: 'check.failed', sender: 'qa', taskId: 'T5', check: { name: 'tests', status: 'fail' }, simMs: 9000, summary: 'future' }),
    ]
    const at = speeches(events, 4000)
    expect(at.get('pm')?.text).toBe('new')
    expect(at.has('qa')).toBe(false)
    expect(speeches(events, 3000 + BUBBLE_MS + 1).has('pm')).toBe(false)
  })
})

describe('flights', () => {
  const handoff = ev({ type: 'task.assigned', sender: 'orchestrator', recipient: 'dev1', taskId: 'T5', simMs: 10_000 })

  it('flies only during the flight window and moves forward with the clock', () => {
    expect(flights([handoff], 9_999)).toEqual([])
    const start = flights([handoff], 10_000)[0]
    const mid = flights([handoff], 10_000 + FLIGHT_MS / 2)[0]
    expect(start.frame).toBe('idle')
    expect(mid.progress).toBeCloseTo(0.5)
    expect(flights([handoff], 10_000 + FLIGHT_MS * 0.95)[0].frame).toBe('arrive')
    expect(flights([handoff], 10_000 + FLIGHT_MS + 1)).toEqual([])
  })

  it('ignores events without a different recipient', () => {
    expect(flights([ev({ type: 'task.started', sender: 'dev1', taskId: 'T5', simMs: 0 })], 100)).toEqual([])
    expect(flights([ev({ type: 'artifact.published', sender: 'pm', simMs: 0 })], 100)).toEqual([])
  })
})

describe('arcPoint', () => {
  it('starts and ends at the anchors and lifts in the middle', () => {
    expect(arcPoint([10, 50], [90, 50], 0)).toEqual([10, 50])
    expect(arcPoint([10, 50], [90, 50], 1)[0]).toBeCloseTo(90)
    expect(arcPoint([10, 50], [90, 50], 0.5)[1]).toBeLessThan(50)
  })
})
