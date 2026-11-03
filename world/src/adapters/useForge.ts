import { useEffect, useState } from 'react'
import type { ForgeEvent, ForgeState } from './forge'
export function useForge(enabled: boolean, run: string) {
  const [state, setState] = useState<ForgeState>({})
  const [events, setEvents] = useState<ForgeEvent[]>([])
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [runs, setRuns] = useState<{ name: string; product?: string }[]>([])
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    setState({}); setEvents([]); setConnected(false); setError('')
    const query = run ? `?run=${encodeURIComponent(run)}` : ''
    const load = async () => {
      try {
        const res = await fetch(`/state${query}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(res.status === 404 ? 'No run yet. Start a run from Office.' : `State: HTTP ${res.status}`)
        const next: ForgeState = await res.json()
        if (!Array.isArray(next.tasks)) throw new Error('Invalid FORGE state')
        if (!disposed) { setState(next); setError('') }
      } catch (e) { if (!disposed) setError(String(e instanceof Error ? e.message : e)) }
      try {
        const res = await fetch('/api/runs', { cache: 'no-store' })
        if (res.ok) { const next = await res.json(); if (!disposed && Array.isArray(next)) setRuns(next) }
      } catch { /* Single-run servers have no run picker. */ }
    }
    void load()
    const timer = setInterval(load, 2000)
    const source = new EventSource(`/events${query}`)
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = message => {
      try {
        const e: ForgeEvent = JSON.parse(message.data)
        if (typeof e.ts !== 'number' || typeof e.kind !== 'string' || typeof e.run !== 'string') return
        setEvents(previous => previous.some(x => JSON.stringify(x) === JSON.stringify(e)) ? previous : [...previous, e])
      } catch { /* Ignore incomplete records. */ }
    }
    return () => { disposed = true; source.close(); clearInterval(timer) }
  }, [enabled, run])
  return { state, events, error, connected, runs }
}
