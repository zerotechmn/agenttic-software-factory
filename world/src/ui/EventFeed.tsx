import { EVENT_TYPES, MESSAGE_KIND, ROLES, type AgentEvent, type EventType, type Role } from '../domain/types'
import { AGENTS } from '../realm/realm'
import { clockTime, EVENT_LABEL, simTime } from './format'
import type { Select } from './selection'

export interface FeedFilter {
  role: Role | 'all'
  type: EventType | 'all'
}

interface Props {
  events: AgentEvent[]
  filter: FeedFilter
  onFilter: (f: FeedFilter) => void
  onSelect: Select
}

export function EventFeed({ events, filter, onFilter, onSelect }: Props) {
  const shown = events
    .filter(e => filter.role === 'all' || e.sender === filter.role || e.recipient === filter.role)
    .filter(e => filter.type === 'all' || e.type === filter.type)
    .slice()
    .reverse()
  return (
    <section className="panel feed" aria-labelledby="feed-h">
      <header className="panel-h feed-h">
        <h2 id="feed-h">Communication &amp; handoffs</h2>
        <div className="filters">
          <label>
            Agent
            <select value={filter.role} onChange={e => onFilter({ ...filter, role: e.target.value as FeedFilter['role'] })}>
              <option value="all">All agents</option>
              {ROLES.map(r => <option key={r} value={r}>{AGENTS[r].name} · {AGENTS[r].title}</option>)}
            </select>
          </label>
          <label>
            Type
            <select value={filter.type} onChange={e => onFilter({ ...filter, type: e.target.value as FeedFilter['type'] })}>
              <option value="all">All types</option>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </header>
      <p className="legend">
        <span className="kind k-control">control</span> tells an agent what to do ·{' '}
        <span className="kind k-artifact">artifact</span> durable output in the shared workspace ·{' '}
        <span className="kind k-status">status</span> observability only
      </p>
      <ol className="events" aria-live="polite" aria-relevant="additions">
        {shown.length === 0 && (
          <li className="empty">{events.length ? 'No events match these filters.' : 'No events yet. Press “Start demo run”.'}</li>
        )}
        {shown.map(e => {
          const from = AGENTS[e.sender]
          const to = e.recipient ? AGENTS[e.recipient] : undefined
          const kind = MESSAGE_KIND[e.type]
          return (
            <li key={e.id} className={`event t-${e.type.replace('.', '-')}`}>
              <span className="ev-time">
                <strong>{simTime(e.simMs)}</strong>
                <span className="muted small">{clockTime(e.timestamp)}</span>
              </span>
              <span className="ev-body">
                <span className="ev-route">
                  <span className="who" style={{ color: from.color }}>{from.name}</span>
                  {to && <><span className="arrow" aria-label="to">→</span><span className="who" style={{ color: to.color }}>{to.name}</span></>}
                  <span className={`kind k-${kind}`}>{kind}</span>
                  <span className="ev-type">{EVENT_LABEL[e.type]}</span>
                  {e.taskId && <button className="mini" onClick={() => onSelect({ kind: 'task', id: e.taskId! })}>{e.taskId}</button>}
                  {e.check && <span className={`mini c-${e.check.status}`}>{e.check.name}: {e.check.status}</span>}
                  {e.simulated && <span className="sim-tag" title={`source: ${e.source}`}>SIM</span>}
                </span>
                <span className="ev-summary">{e.summary}</span>
                {e.artifactReferences.length > 0 && (
                  <span className="refs">
                    {e.artifactReferences.map(a => (
                      <button key={a} className="artifact-link" onClick={() => onSelect({ kind: 'artifact', id: a })}>📄 {a}</button>
                    ))}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
