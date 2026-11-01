import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PHASES, type RunState, type Task } from "./types.ts";

/** Operator backlog requests (from the office UI or `POST /task`), turned into tasks by the orchestrator. */
export interface BacklogRequest { id: string; ts: number; title: string; description?: string; lanes?: string[] }

const file = (dir: string) => join(dir, ".forge", "requests.jsonl");

export function addRequest(dir: string, r: Omit<BacklogRequest, "id" | "ts">): BacklogRequest {
  const full = { id: randomUUID(), ts: Date.now(), ...r };
  mkdirSync(join(dir, ".forge"), { recursive: true });
  appendFileSync(file(dir), JSON.stringify(full) + "\n");
  return full;
}

function readAll(dir: string): BacklogRequest[] {
  if (!existsSync(file(dir))) return [];
  return readFileSync(file(dir), "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as BacklogRequest];
    } catch {
      return [];
    }
  });
}

export function pendingRequests(dir: string, state: RunState): BacklogRequest[] {
  const taken = new Set(state.requestsTaken ?? []);
  return readAll(dir).filter((r) => !taken.has(r.id));
}

/** Convert pending requests into backlog tasks (OP-n). Does not change phases. */
export function takeRequests(dir: string, state: RunState, defaultLanes: string[] = ["src/**"]): Task[] {
  const pending = pendingRequests(dir, state);
  const n0 = state.tasks.filter((t) => t.id.startsWith("OP-")).length;
  const added: Task[] = pending.map((r, i) => ({
    id: `OP-${n0 + i + 1}`,
    title: r.title.slice(0, 80),
    description: `Operator request: ${r.title}${r.description ? `\n${r.description}` : ""}\nKeep everything that already works; verify with npm run check.`,
    deps: i ? [`OP-${n0 + i}`] : [],
    lanes: r.lanes?.length ? r.lanes : defaultLanes,
    acceptance: [r.description ?? r.title],
    kind: "fix",
    status: "backlog",
    attempts: 0,
    escalations: 0,
    featureIds: [],
  }));
  state.tasks.push(...added);
  state.requestsTaken = [...(state.requestsTaken ?? []), ...pending.map((r) => r.id)];
  return added;
}

/** For a run past its build: take requests and reopen build → report. */
export function reopenForRequests(dir: string, state: RunState): Task[] {
  const added = takeRequests(dir, state);
  if (added.length) {
    const buildIdx = PHASES.indexOf("build");
    state.done = state.done.filter((p) => PHASES.indexOf(p as (typeof PHASES)[number]) < buildIdx);
    state.qaRounds = [];
    state.phase = "build";
  }
  return added;
}
