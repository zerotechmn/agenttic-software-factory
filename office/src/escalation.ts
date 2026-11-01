import type { Command } from "./director";
import { SEATS } from "./map";
import { buildGrid, seatCell, type Grid } from "./path";

const HELPER = "final_reviewer";

/**
 * Pure escalation helper logic: `note` events "escalate <taskId> …" send final_reviewer to that task's dev pod
 * with a SENIOR tag; merged/parked releases her. `podFor` returns the pod key (dev:1..3) of a running task.
 */
export class Escalation {
  private helping?: string; // task she is currently helping with
  private grid?: Grid;

  constructor(private podFor: (taskId: string) => string | undefined) {}

  /** A walkable tile within 2 tiles of the pod's seat, preferring the front of the desk. */
  private spotNear(pod: string): { x: number; y: number } | undefined {
    const seat = SEATS[pod];
    if (!seat) return undefined;
    const grid = (this.grid ??= buildGrid());
    const c = seatCell(seat);
    const cands: { x: number; y: number; d: number }[] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const x = c.x + dx, y = c.y + dy;
        if (grid.walkable(x, y)) cands.push({ x, y, d: Math.abs(dx) + Math.abs(dy) * 1.01 - (dy > 0 ? 0.5 : 0) });
      }
    cands.sort((a, b) => a.d - b.d);
    return cands[0] && { x: cands[0].x, y: cands[0].y };
  }

  /** Called for every `note` event. */
  onNote(text: string): Command[] {
    const m = /^\s*escalate\s+(\S+)/i.exec(text);
    if (!m) return [];
    const taskId = m[1].replace(/[.,:;!?]+$/, "");
    const pod = this.podFor(taskId);
    const to = pod && this.spotNear(pod);
    if (!pod || !to) return [];
    const first = this.helping === undefined;
    this.helping = taskId;
    const out: Command[] = [{ type: "walk", agent: HELPER, to, reason: "escalation" }];
    if (first) out.push({ type: "tag", agent: HELPER, text: "SENIOR" });
    return out;
  }

  /** Called for every task_status event, before the director frees the pod. */
  onTaskStatus(taskId: string, status: string): Command[] {
    if ((status !== "merged" && status !== "parked") || this.helping !== taskId) return [];
    this.helping = undefined;
    return [{ type: "tag", agent: HELPER, text: null }, { type: "home", agent: HELPER, work: false }];
  }
}
