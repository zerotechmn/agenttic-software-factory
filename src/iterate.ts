import { PHASES, type RunState, type Task } from "./types.ts";

/** Add operator-described improvements to a run (finished or not) and reopen build → report. */
export function iterate(state: RunState, issues: string[], lanes: string[] = ["src/**"]): Task[] {
  const n = 1 + Math.max(0, ...state.tasks.filter((t) => t.id.startsWith("IT")).map((t) => Number(t.id.slice(2).split("-")[0]) || 0));
  const added: Task[] = issues.map((text, i) => ({
    id: `IT${n}-${i + 1}`,
    title: text.length > 80 ? text.slice(0, 77) + "…" : text,
    description: `Operator-requested improvement: ${text}\nKeep everything that already works; verify with npm run check.`,
    deps: i ? [`IT${n}-${i}`] : [],
    lanes,
    acceptance: [text],
    kind: "fix",
    status: "backlog",
    attempts: 0,
    escalations: 0,
    featureIds: [],
  }));
  state.tasks.push(...added);
  (state.changeRequests ??= []).push(...issues);
  const buildIdx = PHASES.indexOf("build");
  state.done = state.done.filter((p) => PHASES.indexOf(p as (typeof PHASES)[number]) < buildIdx);
  state.qaRounds = [];
  state.phase = "build";
  return added;
}
