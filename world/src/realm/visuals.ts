import { MESSAGE_KIND, type AgentEvent, type Role } from '../domain/types'

// Pure mapping from events to what the realm draws: which speech bubble, which parcel flight.
// Everything is computed from the simulated clock, so pause freezes bubbles and parcels too.

export type BubbleKind = 'purple' | 'green' | 'blue' | 'orange' | 'red' | 'gold'
export type ParcelFrame = 'idle' | 'fly' | 'swirl' | 'arrive'

export const BUBBLE_MS = 7000 // how long a line stays above a character (simulated ms)
export const FLIGHT_MS = 2400 // how long a parcel takes between two characters (simulated ms)

/** Which bubble an event speaks with, or null when it only changes a status glow. */
export function bubbleFor(e: AgentEvent): BubbleKind | null {
  switch (e.type) {
    case 'task.started':
    case 'check.started':
      return null
    case 'task.blocked':
      return e.sender === 'pm' ? 'green' : 'red' // a blocked PM is waiting on client answers
    case 'check.failed':
      return 'red'
    case 'check.passed':
    case 'run.completed':
      return 'gold'
    case 'review.completed':
      return e.verdict === 'approved' ? 'gold' : 'red'
    case 'artifact.published':
      return 'blue'
    default:
      return MESSAGE_KIND[e.type] === 'control' ? (e.sender === 'orchestrator' ? 'purple' : 'orange') : 'orange'
  }
}

const HANDOFFS = new Set(['artifact.published', 'task.assigned', 'fix.requested', 'review.requested', 'task.completed'])

/** A parcel flies only when something is handed to someone else. */
export const isHandoff = (e: AgentEvent) => HANDOFFS.has(e.type) && !!e.recipient && e.recipient !== e.sender

export interface Speech {
  role: Role
  kind: BubbleKind
  text: string
  eventId: string
}

/** The newest bubble per speaker that is still on screen at simMs. */
export function speeches(events: AgentEvent[], simMs: number): Map<Role, Speech> {
  const out = new Map<Role, Speech>()
  for (const e of events) {
    const kind = bubbleFor(e)
    if (!kind || simMs - e.simMs > BUBBLE_MS || e.simMs > simMs) continue
    out.set(e.sender, { role: e.sender, kind, text: e.summary, eventId: e.id })
  }
  return out
}

export interface Flight {
  id: string
  from: Role
  to: Role
  progress: number // 0..1
  frame: ParcelFrame
}

export function flights(events: AgentEvent[], simMs: number): Flight[] {
  const out: Flight[] = []
  for (const e of events) {
    const age = simMs - e.simMs
    if (!isHandoff(e) || age < 0 || age > FLIGHT_MS) continue
    const progress = age / FLIGHT_MS
    const frame: ParcelFrame = progress < 0.12 ? 'idle' : progress > 0.88 ? 'arrive' : Math.floor(progress * 8) % 2 ? 'swirl' : 'fly'
    out.push({ id: e.id, from: e.sender, to: e.recipient!, progress, frame })
  }
  return out
}

/** Point on a gentle arc between two map anchors (percent coordinates). */
export function arcPoint([x1, y1]: [number, number], [x2, y2]: [number, number], t: number): [number, number] {
  const lift = Math.min(12, Math.hypot(x2 - x1, y2 - y1) * 0.25)
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(Math.PI * t) * lift]
}
