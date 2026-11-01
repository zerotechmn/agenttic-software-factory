import { fetchRuns } from "./api";
import type { ForgeEvent } from "./director";
import { RUN_PATHS, withRun } from "./shared/contracts";

export type Mode = "live" | "replay";

/** Replaying a recorded run (`?replay=1`) rather than the bundled demo. */
export const isRunReplay = (): boolean => new URLSearchParams(location.search).has("replay");
export interface Feed { mode: Mode; setSpeed(s: number): void; restart(): void }

/** Replay pacing: long stretches shrink to ≤2.5 s, and the research prelude (before the first task_status) to ≤0.5 s so the board starts moving early. */
export function replayGap(cur: ForgeEvent, next: ForgeEvent, boardStarted: boolean): number {
  return Math.min(boardStarted ? 2500 : 500, Math.max(60, next.ts - cur.ts));
}

/** One backlog `task_status` per task id in a state object: rewinds the board to the start of a replay. */
export function boardResetEvents(state: unknown): ForgeEvent[] {
  const list = (state as { tasks?: { id?: unknown }[] } | null)?.tasks;
  if (!Array.isArray(list)) return [];
  const ids = [...new Set(list.flatMap((t) => (typeof t?.id === "string" ? [t.id] : [])))];
  return ids.map((taskId) => ({ ts: 0, run: "replay", phase: "research", kind: "task_status", taskId, status: "backlog" }) as ForgeEvent);
}

/** Live SSE from FORGE when a run is being served; otherwise replay the recorded run. */
export async function startFeed(onEvent: (e: ForgeEvent, history?: boolean) => void, onMode: (m: Mode, state: unknown) => void, onReset: () => void, onConn?: (ok: boolean, why?: string) => void): Promise<Feed> {
  const getState = async (): Promise<{ run?: string } | null> => {
    try {
      const r = await fetch(withRun(RUN_PATHS.state), { signal: AbortSignal.timeout(4000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null; // no FORGE here (or busy)
    }
  };
  // ?replay=1 (with ?run=<name>) replays a recorded FORGE run from its event log instead of following it live.
  const runReplay = isRunReplay();
  let state = runReplay ? null : await getState();
  // Under `forge console` never fall back to the recorded demo: a slow or restarting console would show a fake run.
  if (!runReplay && !state?.run && (await fetchRuns())) {
    onConn?.(false, "connecting to FORGE… (no run yet? start one with + New job)");
    while (!state?.run) {
      await new Promise((r) => setTimeout(r, 3000));
      state = await getState();
    }
    onConn?.(true);
  }
  if (state?.run) {
    onMode("live", state);
    // FORGE first replays the whole history: apply it instantly, animate only what happens from now on.
    const connected = Date.now();
    const es = new EventSource(withRun(RUN_PATHS.events));
    // On reconnect FORGE replays the whole history again: skip what we already applied, so nothing animates twice.
    let seen = 0, idx = 0;
    es.onopen = () => { idx = 0; onConn?.(true); };
    es.onerror = () => onConn?.(false, "connection to FORGE lost: reconnecting…");
    es.onmessage = (m) => {
      if (idx++ < seen) return;
      seen++;
      const e = JSON.parse(m.data) as ForgeEvent;
      onEvent(e, e.ts < connected - 1500);
    };
    return { mode: "live", setSpeed: () => {}, restart: () => {} };
  }

  const lines = (await (await fetch(runReplay ? withRun(`/doc?path=${encodeURIComponent(".forge/events.jsonl")}`) : "sample-run.jsonl")).text()).split("\n").filter(Boolean);
  const events: ForgeEvent[] = lines.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const meta = runReplay ? null : await fetch("sample-meta.json").then((r) => r.json()).catch(() => null);
  const sampleState = await fetch(runReplay ? withRun(RUN_PATHS.state) : "sample-state.json").then((r) => r.json()).catch(() => null);
  onMode("replay", runReplay ? sampleState : meta ? { prd: { product: meta.product }, budgetUsd: meta.budgetUsd } : null);
  let speed = 1, i = 0, timer: ReturnType<typeof setTimeout> | undefined;
  // Replay on a compressed clock: long idle stretches (pauses, overnight waits) shrink to ≤2.5 s.
  let virtualTs = 0;
  let boardStarted = false;
  // a new loop starts with every task back in the backlog; the director is replaced right after, so it never sees these
  const rewind = () => { for (const e of boardResetEvents(sampleState)) onEvent(e); boardStarted = false; onReset(); };
  const next = () => {
    // the demo loops; a recorded run stops on its last event (↺ restarts it)
    if (i >= events.length) { if (!runReplay) timer = setTimeout(() => { i = 0; virtualTs = 0; rewind(); next(); }, 6000); return; }
    const e = events[i++];
    if (e.kind === "task_status") boardStarted = true;
    onEvent({ ...e, ts: virtualTs });
    const gap = i < events.length ? replayGap(e, events[i], boardStarted) : 0;
    virtualTs += gap;
    timer = setTimeout(next, gap / speed);
  };
  // a recorded run starts with every task back in the backlog, like the demo loop
  if (runReplay) for (const e of boardResetEvents(sampleState)) onEvent(e);
  next();
  return {
    mode: "replay",
    setSpeed: (s) => { speed = s; },
    restart: () => { if (timer) clearTimeout(timer); i = 0; virtualTs = 0; rewind(); next(); },
  };
}
