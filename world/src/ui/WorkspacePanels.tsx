import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ForgeEvent, ForgeState } from '../adapters/forge'
import type { Task } from '../domain/types'

export interface Prd {
  product?: string; pitch?: string; users?: string[]; outOfScope?: string[];
  features?: { id: string; title: string; priority: string; story?: string; acceptance?: string[]; passes?: boolean; status?: string }[];
  openQuestions?: { id: string; question: string; assumption: string }[];
}
export interface ForgeTask {
  id: string; title: string; description?: string; status: string; kind?: string; attempts?: number; escalated?: boolean;
  deps?: string[]; lanes?: string[]; acceptance?: string[]; featureIds?: string[]; feedback?: string; blocked?: string; branch?: string;
}
export function runUrl(path: string, run: string) {
  const url = new URL(path, location.origin)
  if (run) url.searchParams.set('run', run)
  return url.pathname + url.search
}
async function post(path: string, run: string, body: unknown) {
  const response = await fetch(runUrl(path, run), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Could not send (HTTP ${response.status}). Your text has been kept; try again.`)
}
function Field({ title, value }: { title: string; value?: string | string[] }) {
  if (!value || !value.length) return null
  return <section className="workspace-field"><h3>{title}</h3>{Array.isArray(value) ? <ul>{value.map((v, i) => <li key={i}>{v}</li>)}</ul> : <p>{value}</p>}</section>
}
function SubmitForm({ demo, children, submit, label, success }: { demo: boolean; children: ReactNode; submit: (form: HTMLFormElement) => Promise<void>; label: string; success: string }) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (demo || pending) return
    const form = e.currentTarget
    setPending(true); setMessage(''); setFailed(false)
    try { await submit(form); form.reset(); setMessage(success) }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not send. Try again.') }
    finally { setPending(false) }
  }
  return <form className="workspace-form" onSubmit={e => void onSubmit(e)}>
    <fieldset disabled={pending || demo}>{children}<button className="workspace-primary" type="submit">{pending ? 'Sending…' : label}</button></fieldset>
    {demo && <p className="workspace-muted">Switch to live to send changes to the factory.</p>}
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'workspace-error' : 'workspace-success'}>{message}</p>}
  </form>
}
export function PrdPanel({ state, demo, run }: { state: ForgeState; demo: boolean; run: string }) {
  const prd = state.prd
  if (!prd || demo) return <div className="world-empty"><h3>{demo ? 'PRD is available in live mode' : 'No PRD yet'}</h3><p>The Product agent’s requirements, features, and client questions appear here when ready.</p></div>
  const closed = state.done?.includes('product') ?? false
  return <div className="workspace-details">
    <h3 className="workspace-title">{prd.product ?? 'Product requirements'}</h3><p>{prd.pitch}</p>
    <Field title="Users" value={prd.users} />
    {!!prd.openQuestions?.length && <section className="workspace-field"><h3>Questions for the client</h3>
      {prd.openQuestions.map(q => <div className="workspace-question" key={q.id}><b>{q.id} · {q.question}</b><p className="workspace-muted">Assumption: {q.assumption}</p></div>)}
      <SubmitForm demo={demo} label={closed ? 'Send as a change request' : 'Send answers to Product'} success={closed ? 'Queued in the backlog for the factory.' : 'Answers sent to Product.'} submit={async form => {
        const text = String(new FormData(form).get('answers') ?? '').trim()
        if (!text) throw new Error('Enter your answers before sending.')
        await post(closed ? '/task' : '/say', run, closed ? { title: `Client answer: ${text}`.slice(0, 120), description: text } : { role: 'product', text })
      }}><label htmlFor="prd-answers">{closed ? 'Product phase is complete. Answers will become a change request.' : 'Your answers'}</label><textarea id="prd-answers" name="answers" rows={4} required maxLength={2000} placeholder="Q1: …" /></SubmitForm>
    </section>}
    {(prd.features ?? []).map(f => <section className="workspace-field" key={f.id}><div className="workspace-meta">{f.id} · {f.priority} · {f.status ?? (f.passes ? 'working' : 'not yet')}</div><h3>{f.title}</h3><p>{f.story}</p><Field title="Acceptance" value={f.acceptance} /></section>)}
    <Field title="Out of scope" value={prd.outOfScope} />
  </div>
}
export function TasksPanel({ tasks, rawTasks, events, demo, run }: { tasks: Task[]; rawTasks: ForgeTask[]; events: ForgeEvent[]; demo: boolean; run: string }) {
  const [selected, setSelected] = useState<string>()
  const task = rawTasks.find(t => t.id === selected)
  if (task) return <div className="workspace-details"><button className="workspace-back" onClick={() => setSelected(undefined)}>← All tasks</button><h3 className="workspace-title">{task.id} · {task.title}</h3><p className="workspace-meta">{task.status} · {task.kind ?? 'task'} · {task.attempts ?? 0} attempts{task.escalated ? ' · escalated' : ''}</p>
    <Field title="What to build" value={task.description} /><Field title="Acceptance" value={task.acceptance} /><Field title="File lanes" value={task.lanes} /><Field title="Depends on" value={task.deps} /><Field title="Features" value={task.featureIds} /><Field title="Branch" value={task.branch} /><Field title="Blocked" value={task.blocked} /><Field title="Latest feedback" value={task.feedback} />
    <section className="workspace-field"><h3>Task history</h3><ol className="workspace-history">{events.filter(e => e.taskId === task.id && !['tool', 'say'].includes(e.kind)).map((e, i) => <li key={i}><time>{new Date(e.ts).toLocaleTimeString()}</time> <b>{e.kind}</b> {e.role} {e.status}<p>{e.text}</p></li>)}</ol></section>
  </div>
  return <div className="workspace-details"><div className="workspace-task-list">{tasks.length ? tasks.map(t => <button key={t.id} onClick={() => setSelected(t.id)}><span><b>{t.id}</b> {t.title}</span><small>{rawTasks.find(raw => raw.id === t.id)?.status ?? t.status}</small></button>) : <p className="workspace-muted">No tasks yet. Add a request to the backlog below.</p>}</div>
    <section className="workspace-field"><h3>Add to backlog</h3><SubmitForm demo={demo} label="Add to backlog" success="Queued. The factory picks it up on its next build step." submit={async form => {
      const data = new FormData(form)
      const title = String(data.get('title') ?? '').trim()
      if (!title) throw new Error('Title is required.')
      await post('/task', run, { title, description: String(data.get('description') ?? '').trim() })
    }}><label htmlFor="task-title">Title</label><input id="task-title" name="title" required maxLength={120} placeholder="What should the factory build?" /><label htmlFor="task-description">Details</label><textarea id="task-description" name="description" rows={4} maxLength={2000} placeholder="Requirements and acceptance criteria" /></SubmitForm></section>
  </div>
}
interface VaultDoc { path: string; title: string; group: string; bytes: number }
export function DocsPanel({ run, demo }: { run: string; demo: boolean }) {
  const [docs, setDocs] = useState<VaultDoc[]>([])
  const [selected, setSelected] = useState<VaultDoc>()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (demo) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true); setError(''); setContent('')
    const load = async () => {
      try {
        const response = await fetch(runUrl(selected ? `/doc?path=${encodeURIComponent(selected.path)}` : '/docs', run), { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Could not load ${selected ? 'document' : 'documents'} (HTTP ${response.status}).`)
        if (selected) {
          let text = await response.text()
          if (selected.path.endsWith('.json')) try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* Preserve plain text. */ }
          if (!controller.signal.aborted) setContent(text.length > 400000 ? `${text.slice(0, 400000)}\n… Download for the full file.` : text)
        } else {
          const list: unknown = await response.json()
          if (!Array.isArray(list) || !list.every(d => typeof d.path === 'string' && typeof d.title === 'string' && typeof d.group === 'string' && typeof d.bytes === 'number')) throw new Error('Unexpected document list.')
          if (!controller.signal.aborted) setDocs(list)
        }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load documents.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [run, demo, selected, revision])
  if (demo) return <div className="world-empty"><h3>Documents are available in live mode</h3><p>Switch to live to browse the run’s PRD, designs, reports, and logs.</p></div>
  return <div className="workspace-details">
    <div className="workspace-doc-tools">{selected && <button className="workspace-back" onClick={() => setSelected(undefined)}>← All documents</button>}<button className="workspace-back" onClick={() => setRevision(r => r + 1)}>Refresh</button></div>
    {selected && <><h3 className="workspace-title">{selected.title}</h3><p className="workspace-meta">{selected.path}</p><a className="workspace-download" href={runUrl(`/doc?path=${encodeURIComponent(selected.path)}&download=1`, run)}>Download document ↓</a></>}
    {loading ? <p role="status">Loading {selected ? 'document' : 'documents'}…</p> : error ? <p role="alert" className="workspace-error">{error}</p> : selected ? <pre className="workspace-document">{content}</pre> : docs.length ? [...new Set(docs.map(d => d.group))].map(group => <section className="workspace-field" key={group}><h3>{group}</h3><ul className="workspace-doc-list">{docs.filter(d => d.group === group).map(d => <li key={d.path}><button onClick={() => setSelected(d)}><b>{d.title}</b><small>{d.path} · {new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(d.bytes / 1024)} KB</small></button><a href={runUrl(`/doc?path=${encodeURIComponent(d.path)}&download=1`, run)} aria-label={`Download ${d.title}`}>↓</a></li>)}</ul></section>) : <div className="world-empty"><h3>No documents yet</h3><p>Documents appear as each phase finishes. Use Refresh to check for new files.</p></div>}
  </div>
}
