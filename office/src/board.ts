import type { ForgeEvent } from "./director";

export const STATUSES = ["backlog", "running", "review", "merged", "parked"] as const;
export type TaskStatus = (typeof STATUSES)[number];
export interface TaskRow { id: string; title: string; status: TaskStatus; attempts: number }

/** Map any FORGE status (ready, blocked, …) onto the five board statuses. */
export function normalizeStatus(s: string | undefined): TaskStatus {
  return (STATUSES as readonly string[]).includes(s ?? "") ? (s as TaskStatus) : "backlog";
}

/** Pure task-board model: seeded from /state (live) or sample-state.json (replay), updated by task events. */
export class TaskBoard {
  private rows: TaskRow[] = [];
  /** Rows already changed by an event: a late-arriving state must not overwrite them. */
  private touched = new Map<string, TaskRow[]>();

  /** Replace all rows from a `{ tasks: [...] }` state object; ignores anything malformed. */
  load(state: unknown): void {
    const list = (state as { tasks?: unknown } | null)?.tasks;
    if (!Array.isArray(list)) return;
    const kept = [...this.touched.values()].flat();
    this.rows = [];
    for (const t of list as Record<string, unknown>[]) {
      if (!t || typeof t.id !== "string" || this.touched.has(t.id)) continue;
      const attempts = typeof t.attempts === "number" && t.attempts >= 0 ? Math.floor(t.attempts) : 0;
      this.rows.push({ id: t.id, title: typeof t.title === "string" ? t.title : t.id, status: normalizeStatus(t.status as string), attempts });
    }
    this.rows.push(...kept);
  }

  /**
   * Apply one FORGE event. Returns true when a row was added or changed.
   * `task_status` sets the status (unknown ids get a row); `task_fail` adds an attempt;
   * a dev `agent_start` guarantees at least one attempt.
   */
  apply(e: ForgeEvent): boolean {
    if (!e.taskId) return false;
    const hits = this.rows.filter((r) => r.id === e.taskId);
    const mark = (changed: boolean): boolean => { if (changed) this.touched.set(e.taskId!, hits); return changed; };
    if (e.kind === "task_status") {
      const status = normalizeStatus(e.status);
      if (!hits.length) { const row = { id: e.taskId, title: e.taskId, status, attempts: 0 }; this.rows.push(row); this.touched.set(e.taskId, [row]); return true; }
      let changed = false;
      for (const r of hits) if (r.status !== status) { r.status = status; changed = true; }
      return mark(changed);
    }
    let changed = false;
    for (const r of hits) {
      if (e.kind === "task_fail") { r.attempts += 1; changed = true; }
      else if (e.kind === "agent_start" && e.role === "dev" && r.attempts < 1) { r.attempts = 1; changed = true; }
    }
    return mark(changed);
  }

  tasks(): TaskRow[] {
    return this.rows;
  }
}
