import { TASK_STATUSES, type Task } from '../domain/types'
import { AGENTS } from '../realm/realm'
import { CHECK_ICON, TASK_STATUS_LABEL } from './format'
import type { Select, Selection } from './selection'

export function TaskBoard({ tasks, selection, onSelect }: { tasks: Task[]; selection: Selection; onSelect: Select }) {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const agentSel = selection?.kind === 'agent' ? selection.id : null
  return (
    <section className="panel board-panel" aria-labelledby="board-h">
      <header className="panel-h">
        <h2 id="board-h">Task board</h2>
        <p className="hint">Live task status, grouped by stage. Select a task for details.</p>
      </header>
      <div className="board">
        {TASK_STATUSES.map(st => {
          const col = tasks.filter(t => t.status === st)
          return (
            <section key={st} className={`col col-${st}`} aria-label={`${TASK_STATUS_LABEL[st]}: ${col.length}`}>
              <h3>{TASK_STATUS_LABEL[st]} <span className="count">{col.length}</span></h3>
              {col.length === 0 && <p className="empty-col">—</p>}
              {col.map(t => {
                const owner = AGENTS[t.ownerRole]
                const sel = (selection?.kind === 'task' && selection.id === t.id) || agentSel === t.ownerRole
                return (
                  <button key={t.id} className={`task${sel ? ' selected' : ''}`} style={{ '--c': owner.color } as React.CSSProperties}
                          onClick={() => onSelect({ kind: 'task', id: t.id })}>
                    <span className="task-top">
                      <span className="tid">{t.id}</span>
                      <span className={`check c-${t.latestCheckStatus}`} title={`latest check: ${t.latestCheckStatus}`}>
                        {CHECK_ICON[t.latestCheckStatus]}
                      </span>
                    </span>
                    <span className="task-title">{t.title}</span>
                    <span className="task-desc">{t.description}</span>
                    <span className="task-meta">
                      <span className="owner"><i style={{ background: owner.color }} />{owner.name}</span>
                      {t.branchOrWorktree && <span className="wt">⎇ {t.branchOrWorktree}</span>}
                      {t.fixAttempts > 0 && <span className="fix">fix {t.fixAttempts}</span>}
                    </span>
                    {t.dependencies.length > 0 && (
                      <span className="deps">
                        needs {t.dependencies.map(d => (
                          <span key={d} className={byId.get(d)?.status === 'done' ? 'dep ok' : 'dep'}>{d}</span>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </section>
  )
}
