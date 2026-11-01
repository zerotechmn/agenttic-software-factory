import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHASES, type RunState } from "./types.ts";

export const forgeDir = (projectDir: string) => join(projectDir, ".forge");
const statePath = (projectDir: string) => join(forgeDir(projectDir), "state.json");

export function newState(run: string): RunState {
  return {
    run,
    phase: "intake",
    startedAt: Date.now(),
    tasks: [],
    qaRounds: [],
    spend: { usd: 0, byRole: {}, byPhase: {}, local: 0, remote: 0 },
    landing: false,
    done: [],
  };
}

export function loadState(projectDir: string): RunState | null {
  const p = statePath(projectDir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RunState;
}

/** Atomic write: a crash mid-write leaves the previous state.json intact. */
export function saveState(projectDir: string, state: RunState): void {
  mkdirSync(forgeDir(projectDir), { recursive: true });
  const p = statePath(projectDir);
  writeFileSync(`${p}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${p}.tmp`, p);
}

/** Un-park every parked task (fresh attempt budget) and reopen build and every later phase. */
export function retryParked(state: RunState): number {
  let n = 0;
  for (const t of state.tasks) {
    if (t.status !== "parked") continue;
    Object.assign(t, { status: "backlog", attempts: 0, escalated: false, lastSignature: undefined, feedback: undefined, sessionId: undefined, blocked: undefined, blockedStreak: 0 });
    n++;
  }
  if (n) {
    const buildIdx = PHASES.indexOf("build");
    state.done = state.done.filter((p) => PHASES.indexOf(p as (typeof PHASES)[number]) < buildIdx);
  }
  return n;
}
