import { useEffect, useRef } from 'react'
import type { AgentView } from '../domain/project'
import type { AgentEvent, Task } from '../domain/types'
import { AGENTS, cardArt, DISTRICTS, homeArt } from '../realm/realm'
import { ARTIFACTS } from '../sim/scenario'
import { Avatar } from './Avatar'
import { AGENT_STATUS_LABEL, EVENT_LABEL, simTime, TASK_STATUS_LABEL } from './format'
import type { Select, Selection } from './selection'

interface Props {
  selection: Selection
  tasks: Task[]
  agents: AgentView[]
  events: AgentEvent[]
  published: Map<string, AgentEvent>
  onSelect: Select
}

function MiniLog({ events }: { events: AgentEvent[] }) {
  if (!events.length) return <p className="muted small">No events yet.</p>
  return (
    <ol className="mini-log">
      {events.slice(-10).reverse().map(e => (
        <li key={e.id}><span className="muted">{simTime(e.simMs)}</span> <b>{EVENT_LABEL[e.type]}</b> {e.summary}</li>
      ))}
    </ol>
  )
}

export function Drawer({ selection, tasks, agents, events, published, onSelect }: Props) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!selection) return
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSelect(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onSelect])
  if (!selection) return null

  const artBtn = (id: string) =>
    ARTIFACTS.some(a => a.id === id)
      ? <button key={id} className="artifact-link" onClick={() => onSelect({ kind: 'artifact', id })}>📄 {id}</button>
      : <code key={id}>{id}</code>

  let body: React.ReactNode = null
  let title = ''
  if (selection.kind === 'task') {
    const t = tasks.find(x => x.id === selection.id)
    if (!t) return null
    const owner = AGENTS[t.ownerRole]
    title = `${t.id} · ${t.title}`
    body = (
      <>
        <p className="row-chips">
          <span className={`chip ts-${t.status}`}>{TASK_STATUS_LABEL[t.status]}</span>
          <button className="mini" onClick={() => onSelect({ kind: 'agent', id: t.ownerRole })}>owner: {owner.name} ({owner.title})</button>
          <span className={`mini c-${t.latestCheckStatus}`}>latest check: {t.latestCheckStatus}</span>
          {t.fixAttempts > 0 && <span className="mini fix">fix attempts: {t.fixAttempts}</span>}
        </p>
        <p>{t.description}</p>
        <dl className="kv">
          <dt>Dependencies</dt>
          <dd>{t.dependencies.length ? t.dependencies.map(d => {
            const dep = tasks.find(x => x.id === d)!
            return <button key={d} className={`mini dep${dep.status === 'done' ? ' ok' : ''}`} onClick={() => onSelect({ kind: 'task', id: d })}>{d}: {TASK_STATUS_LABEL[dep.status]}</button>
          }) : 'none'}</dd>
          <dt>Inputs</dt><dd>{t.inputs.map(artBtn)}</dd>
          <dt>Expected outputs</dt><dd>{t.expectedOutputs.map(artBtn)}</dd>
          <dt>Branch / worktree</dt><dd>{t.branchOrWorktree ?? 'none (docs only)'}</dd>
          <dt>Started / finished</dt><dd>{simTime(t.startedAt)} / {simTime(t.finishedAt)}</dd>
        </dl>
        <h3 className="sub-h">Acceptance criteria</h3>
        <ul className="ac">{t.acceptanceCriteria.map(a => <li key={a}>{a}</li>)}</ul>
        <h3 className="sub-h">Events for {t.id}</h3>
        <MiniLog events={events.filter(e => e.taskId === t.id)} />
      </>
    )
  } else if (selection.kind === 'agent') {
    const a = agents.find(x => x.role === selection.id)
    if (!a) return null
    const p = AGENTS[a.role]
    title = `${p.name} · ${p.title}`
    body = (
      <>
        <div className="agent-hero" style={{ '--c': p.color } as React.CSSProperties}>
          {cardArt(p) ? <img className="hero-card" src={cardArt(p)} alt={`${p.name} card`} /> : <Avatar role={a.role} status={a.status} size={88} />}
          <div>
            <span className={`chip st-${a.status}`}>{AGENT_STATUS_LABEL[a.status]}</span>{' '}
            <span className={`rarity r-${p.rarity}`}>{p.rarity} · {p.model}</span>
            <p>{a.message ?? 'Nothing yet.'}</p>
            <p className="muted small">Last activity {simTime(a.lastActivityMs)}</p>
          </div>
        </div>
        {homeArt(p) && (
          <figure className="home">
            <img src={homeArt(p)} alt={`${p.name}'s home`} loading="lazy" />
            <figcaption className="muted small">{p.name}’s home · {DISTRICTS[p.district].label}</figcaption>
          </figure>
        )}
        <h3 className="sub-h">Owned tasks</h3>
        <ul className="owned">
          {tasks.filter(t => t.ownerRole === a.role).map(t => (
            <li key={t.id}><button className="mini" onClick={() => onSelect({ kind: 'task', id: t.id })}>{t.id}</button> {t.title} — {TASK_STATUS_LABEL[t.status]}</li>
          ))}
          {!tasks.some(t => t.ownerRole === a.role) && <li className="muted small">Coordinates; owns no build task.</li>}
        </ul>
        <h3 className="sub-h">Recent messages</h3>
        <MiniLog events={events.filter(e => e.sender === a.role || e.recipient === a.role)} />
      </>
    )
  } else {
    const art = ARTIFACTS.find(x => x.id === selection.id)
    if (!art) return null
    const ev = published.get(art.id)
    title = art.id
    body = (
      <>
        <p className="row-chips">
          <span className="mini">{art.kind}</span>
          <span className="mini">by {AGENTS[art.producedBy].name}</span>
          <span className="mini">{ev ? `published ${simTime(ev.simMs)}` : 'referenced, not published yet'}</span>
        </p>
        <p className="demo-banner">Demo content, written by hand for this prototype. No agent produced this file.</p>
        <pre className="art-content">{art.content}</pre>
      </>
    )
  }

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title">
      <header className="drawer-h">
        <h2 id="drawer-title">{title}</h2>
        <span className="demo-badge small">Demo / Simulated</span>
        <button ref={close} className="btn ghost" onClick={() => onSelect(null)} aria-label="Close details">✕</button>
      </header>
      <div className="drawer-body">{body}</div>
    </aside>
  )
}
