import { useState } from 'react'
import type { AgentView } from '../domain/project'
import type { AgentEvent } from '../domain/types'
import { Avatar } from '../ui/Avatar'
import { AGENT_STATUS_LABEL } from '../ui/format'
import type { Select } from '../ui/selection'
import { Bubble } from './Bubble'
import { AGENTS, DISTRICTS, MAP_ART, parcelArt, type DistrictId } from './realm'
import { arcPoint, flights, speeches } from './visuals'

interface Props {
  agents: AgentView[]
  events: AgentEvent[]
  simMs: number
  onSelect: Select
  onDistrict: (d: DistrictId) => void
}

const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'anchors'
const at = ([x, y]: [number, number]) => ({ left: `${x}%`, top: `${y}%` })

/** The FORGE map: districts are hotspots, characters stand in their district, parcels fly on handoffs. */
export function RealmMap({ agents, events, simMs, onSelect, onDistrict }: Props) {
  const said = speeches(events, simMs)
  const flying = flights(events, simMs)
  const [probe, setProbe] = useState<string>('')

  return (
    <section className="panel realm" aria-labelledby="realm-h">
      <header className="panel-h">
        <h2 id="realm-h">FORGE realm</h2>
        <p className="hint">Click a district to enter it, or a character for details. Parcels show handoffs.</p>
      </header>
      <div
        className="map"
        onClick={DEBUG ? e => {
          const r = e.currentTarget.getBoundingClientRect()
          setProbe(`[${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}, ${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}]`)
        } : undefined}
      >
        <img className="map-img" src={MAP_ART.full} srcSet={`${MAP_ART.half} 836w, ${MAP_ART.full} 1672w`}
             sizes="(max-width: 900px) 100vw, 1500px" alt="Map of the FORGE realm with its ten districts" />

        {Object.values(DISTRICTS).filter(d => d.background).map(d => (
          <button key={d.id} className="district" style={at(d.anchor)} onClick={() => onDistrict(d.id)}>
            <span className="district-label">{d.label}</span>
          </button>
        ))}

        {agents.map(a => {
          const p = AGENTS[a.role]
          const s = said.get(a.role)
          return (
            <div key={a.role} className={`mc s-${a.status}${p.art ? '' : ' seal'}`} style={{ ...at(p.anchor), '--agent-color': p.color } as React.CSSProperties}>
              {s && <Bubble kind={s.kind} text={s.text} />}
              <button className="mc-btn" onClick={() => onSelect({ kind: 'agent', id: a.role })}
                      aria-label={`${p.name}, ${p.title}: ${AGENT_STATUS_LABEL[a.status]}${s ? `. Says: ${s.text}` : ''}`}>
                <Avatar role={a.role} status={a.status} size="100%" />
                <span className="mc-name">{p.name}</span>
              </button>
            </div>
          )
        })}

        {flying.map(f => {
          const [x, y] = arcPoint(AGENTS[f.from].anchor, AGENTS[f.to].anchor, f.progress)
          return <img key={f.id} className={`parcel p-${f.frame}`} src={parcelArt(f.frame)} alt="" style={at([x, y])} />
        })}

        {DEBUG && Object.values(AGENTS).map(a => (
          <span key={a.role} className="anchor-dot" style={at(a.anchor)} title={`${a.name} ${a.anchor.join(', ')}`} />
        ))}
      </div>
      {DEBUG && <p className="small">debug=anchors · last click: <code>{probe || 'click the map'}</code></p>}
    </section>
  )
}
