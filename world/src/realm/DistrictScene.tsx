import { useEffect, useRef } from 'react'
import type { AgentView } from '../domain/project'
import type { AgentEvent, Task } from '../domain/types'
import { Avatar } from '../ui/Avatar'
import { AGENT_STATUS_LABEL, CHECK_ICON, TASK_STATUS_LABEL } from '../ui/format'
import type { Select } from '../ui/selection'
import { Bubble } from './Bubble'
import { AGENTS, agentsIn, bgArt, DISTRICTS, type DistrictId } from './realm'
import { speeches } from './visuals'

interface Props {
  district: DistrictId
  agents: AgentView[]
  tasks: Task[]
  events: AgentEvent[]
  simMs: number
  onBack: () => void
  onSelect: Select
}

/** Inside one district: its background, the characters who live there, what they say and work on. */
export function DistrictScene({ district, agents, tasks, events, simMs, onBack, onSelect }: Props) {
  const d = DISTRICTS[district]
  const residents = agentsIn(district).map(p => agents.find(a => a.role === p.role)!).filter(Boolean)
  const said = speeches(events, simMs)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => back.current?.focus(), [district])

  return (
    <section className="panel realm" aria-labelledby="scene-h">
      <header className="panel-h">
        <button ref={back} className="btn ghost" onClick={onBack}>← Map</button>
        <h2 id="scene-h">{d.label}</h2>
        <p className="hint">{residents.map(r => AGENTS[r.role].name).join(' · ')}</p>
      </header>
      <div className="scene" style={{ backgroundImage: `url(${bgArt(d)})` }}>
        <div className="stage">
          {residents.map(a => {
            const p = AGENTS[a.role]
            const s = said.get(a.role)
            const owned = tasks.filter(t => t.ownerRole === a.role)
            return (
              <div key={a.role} className={`resident s-${a.status}`} style={{ '--c': p.color, '--agent-color': p.color } as React.CSSProperties}>
                {s && <Bubble kind={s.kind} text={s.text} className="big" />}
                <button className="resident-btn" onClick={() => onSelect({ kind: 'agent', id: a.role })}
                        aria-label={`${p.name}, ${p.title}: ${AGENT_STATUS_LABEL[a.status]}`}>
                  <Avatar role={a.role} status={a.status} size="100%" />
                </button>
                <div className="plaque">
                  <span className="plaque-h"><strong>{p.name}</strong><span className={`chip st-${a.status}`}>{AGENT_STATUS_LABEL[a.status]}</span></span>
                  {owned.map(t => (
                    <button key={t.id} className="plaque-task" onClick={() => onSelect({ kind: 'task', id: t.id })}>
                      <span className={`check c-${t.latestCheckStatus}`}>{CHECK_ICON[t.latestCheckStatus]}</span>
                      {t.id} · {t.title} <em>{TASK_STATUS_LABEL[t.status]}</em>
                    </button>
                  ))}
                  {owned.length === 0 && <span className="muted small">Reviews other lanes</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
