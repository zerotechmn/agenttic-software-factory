import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import './App.css'
import './world.css'
import { deriveAgents, project } from './domain/project'
import { initialState, reducer } from './sim/engine'
import { TASKS } from './sim/scenario'
import { RealmMap } from './realm/RealmMap'
import { DistrictScene } from './realm/DistrictScene'
import { AGENTS, type DistrictId } from './realm/realm'
import { TaskBoard } from './ui/TaskBoard'
import { EventFeed, type FeedFilter } from './ui/EventFeed'
import { Drawer } from './ui/Drawer'
import { simTime } from './ui/format'
import type { Selection } from './ui/selection'
import { forgeView, liveAgents } from './adapters/forge'
import { useForge } from './adapters/useForge'
import { DocsPanel, PrdPanel, TasksPanel } from './ui/WorkspacePanels'

type Panel = 'messages' | 'board' | 'feed' | 'prd' | 'tasks' | 'docs'
const PANELS: { id: Panel; label: string; title: string; icon: string }[] = [
  { id: 'messages', label: 'Messages', title: 'Latest messages', icon: '☰' },
  { id: 'board', label: 'Board', title: 'Task board', icon: '▦' },
  { id: 'feed', label: 'Feed', title: 'Activity feed', icon: '≋' },
  { id: 'prd', label: 'PRD', title: 'Product requirements', icon: '◇' },
  { id: 'tasks', label: 'Tasks', title: 'Tasks', icon: '✓' },
  { id: 'docs', label: 'Docs', title: 'Documents', icon: '▤' },
]
export default function App() {
  const params = new URLSearchParams(location.search)
  const [demo, setDemo] = useState(params.get('mode') === 'demo')
  const [run, setRun] = useState(params.get('run') ?? '')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [district, setDistrict] = useState<DistrictId | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const select = useCallback((s: Selection) => setSelection(s), [])
  const [filter, setFilter] = useState<FeedFilter>({ role: 'all', type: 'all' })
  const [sim, dispatch] = useReducer(reducer, undefined, () => initialState('happy', 1))
  const [now, setNow] = useState(Date.now())
  const live = useForge(!demo, run)
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); dispatch({ type: 'tick', realMs: 1000 }) }, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    if (run) url.searchParams.set('run', run); else url.searchParams.delete('run')
    if (demo) url.searchParams.set('mode', 'demo'); else url.searchParams.delete('mode')
    history.replaceState(null, '', url)
    setSelection(null); setDistrict(null)
  }, [run, demo])
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPanel(null); setDistrict(null) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const forge = useMemo(() => forgeView(live.state, live.events, now), [live.state, live.events, now])
  const projection = useMemo(() => project(TASKS, sim.events), [sim.events])
  const tasks = demo ? projection.tasks : forge.tasks
  const events = demo ? sim.events : forge.events
  const status = demo ? sim.status : live.state.phase === 'done' ? 'completed' : live.state.systemicHalt ? 'failed' : live.connected ? 'running' : 'idle'
  const agents = liveAgents(deriveAgents(tasks, events, status), demo ? new Set(deriveAgents(tasks, events, status).filter(a => a.status === 'working').map(a => a.role)) : forge.activeRoles, status === 'completed')
  const elapsed = demo ? sim.simMs : forge.elapsed
  const done = tasks.filter(t => t.status === 'done').length
  const active = demo ? agents.filter(a => a.status === 'working').length : forge.active
  const tokens = live.state.spend?.tokens
  const tokenTotal = tokens ? tokens.in + tokens.out + tokens.cacheRead + (tokens.cacheWrite ?? 0) : undefined
  const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const messages = events.filter(e => demo ? e.type === 'message.routed' || e.type === 'artifact.published' : ['say', 'operator_say', 'handoff'].includes(live.events[Number(e.id.replace('forge-', ''))]?.kind)).slice(-40).reverse()
  return <div className="world-shell">
    <header className="world-hud">
      <a className="world-brand" href="/world/" aria-label="FORGE World home"><span className="world-mark">F</span><span>FORGE <b>WORLD</b></span></a>
      <span className={`connection ${demo ? 'demo' : live.connected ? 'online' : ''}`}><i />{demo ? 'Demo' : live.connected ? 'Live' : 'Connecting'}</span>
      <div className="world-metrics" aria-label="Run overview">
        <div><span>Tokens</span><strong title="Input + output + cache tokens">{demo || tokenTotal === undefined ? '—' : compact(tokenTotal)}</strong></div>
        <div><span>Cost</span><strong>{demo || live.state.spend?.usd === undefined ? '—' : `$${live.state.spend.usd.toFixed(2)}`}</strong></div>
        <div><span>Time</span><strong>{simTime(elapsed)}</strong></div>
        <div><span>Tasks</span><strong>{done}<small> / {tasks.length}</small></strong></div>
        <div><span>Active agents</span><strong><i className={active ? 'active-dot' : ''} />{active}</strong></div>
      </div>
      <a className="office-link" href={`/office/${run ? `?run=${encodeURIComponent(run)}` : ''}`}>Office ↗</a>
    </header>
    <main className="world-stage" aria-label="Interactive factory world">
      <div className="world-canvas">
        {district ? <DistrictScene district={district} agents={agents} tasks={tasks} events={events} simMs={elapsed} onBack={() => setDistrict(null)} onSelect={select} /> : <RealmMap agents={agents} events={events} simMs={elapsed} onSelect={select} onDistrict={setDistrict} />}
      </div>
      <div className="world-runbar">
        {district && <button className="world-map-back" onClick={() => setDistrict(null)}>← Map</button>}
        {live.runs.length > 0 && !demo ? <select aria-label="Select run" value={run} onChange={e => setRun(e.target.value)}><option value="">Latest run</option>{live.runs.map(r => <option key={r.name} value={r.name}>{r.product ?? r.name}</option>)}</select> : <strong>{demo ? 'Demo realm' : live.state.run ?? 'FORGE realm'}</strong>}
        <span>{demo ? sim.status : live.state.phase ?? 'Awaiting run'}</span>
        <div className="run-progress" role="progressbar" aria-label="Completed tasks" aria-valuenow={done} aria-valuemin={0} aria-valuemax={tasks.length || 1}><i style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div>
      </div>
      {!demo && live.error && <div className="world-notice" role="alert">{live.error}</div>}
      {!demo && live.state.systemicHalt && <div className="world-notice" role="alert">{live.state.systemicHalt}</div>}
      <nav className="world-tabs" aria-label="World panels">{PANELS.map(p => <button key={p.id} aria-expanded={panel === p.id} aria-controls="world-sidepanel" className={panel === p.id ? 'selected' : ''} onClick={() => setPanel(panel === p.id ? null : p.id)}><span aria-hidden="true">{p.icon}</span>{p.label}{p.id === 'board' && <small>{tasks.length}</small>}</button>)}</nav>
      {panel && <aside className={`world-sidepanel ${panel}`} id="world-sidepanel" aria-label={panel}>
        <header><div><span>RUN WORKSPACE</span><h2>{PANELS.find(p => p.id === panel)?.title}</h2></div><button aria-label="Close panel" onClick={() => setPanel(null)}>×</button></header>
        <div className="world-panel-body">
          {panel === 'messages' && (messages.length ? <ol className="world-messages">{messages.map(e => <li key={e.id}><button onClick={() => select({ kind: 'agent', id: e.sender })}><span className="message-meta"><b>{AGENTS[e.sender].name}</b><time>{simTime(e.simMs)}</time></span><p>{e.summary}</p>{e.taskId && <small>{e.taskId}</small>}</button></li>)}</ol> : <div className="world-empty"><h3>Ready to listen</h3><p>Agent messages and handoffs appear here as the run progresses.</p></div>)}
          {panel === 'prd' && <PrdPanel key={`${run}:${demo}`} state={live.state} demo={demo} run={run} />}
          {panel === 'tasks' && <TasksPanel key={`${run}:${demo}`} tasks={tasks} rawTasks={demo ? tasks.map(t => ({ ...t, acceptance: t.acceptanceCriteria, deps: t.dependencies })) : live.state.tasks ?? []} events={demo ? [] : live.events} demo={demo} run={run} />}
          {panel === 'docs' && <DocsPanel key={`${run}:${demo}`} run={run} demo={demo} />}
          {panel === 'board' && <TaskBoard tasks={tasks} selection={selection} onSelect={select} />}
          {panel === 'feed' && <EventFeed events={events} filter={filter} onFilter={setFilter} onSelect={select} />}
        </div>
      </aside>}
      <footer className="world-dock"><span>Click a district to explore · Click an agent for details</span><div><button aria-pressed={demo} onClick={() => setDemo(!demo)}>{demo ? 'Switch to live' : 'Try demo'}</button>{demo && <><button onClick={() => dispatch({ type: sim.status === 'idle' ? 'start' : sim.status === 'running' ? 'pause' : 'resume', nowMs: Date.now() })} disabled={sim.status === 'completed'}>{sim.status === 'running' ? 'Pause' : sim.status === 'paused' ? 'Resume' : 'Start'}</button><button onClick={() => dispatch({ type: 'reset' })}>Reset</button></>}<button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}) }} aria-label="Toggle fullscreen">⛶</button></div></footer>
    </main>
    <Drawer selection={selection} tasks={tasks} agents={agents} events={events} published={new Map()} onSelect={select} />
  </div>
}
