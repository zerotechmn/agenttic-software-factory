import type { Task } from "./types.ts";

const DONE = new Set<Task["status"]>(["merged", "parked"]);
const ACTIVE = new Set<Task["status"]>(["running", "review", "merged", "parked", "blocked"]);

export function readyTasks(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter(
    (t) => !ACTIVE.has(t.status) && t.deps.every((d) => {
      const dep = byId.get(d);
      return !dep || DONE.has(dep.status);
    }),
  );
}

const globRe = (g: string) =>
  new RegExp(
    "^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*") + "$",
  );
const isGlob = (s: string) => s.includes("*");
const staticPrefix = (g: string) => g.slice(0, g.indexOf("*"));

export function lanesOverlap(a: string, b: string): boolean {
  if (!isGlob(a) && !isGlob(b)) return a === b;
  if (isGlob(a) && !isGlob(b)) return globRe(a).test(b);
  if (!isGlob(a) && isGlob(b)) return globRe(b).test(a);
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

function reach(tasks: Task[]): (from: string, to: string) => boolean {
  const deps = new Map(tasks.map((t) => [t.id, t.deps]));
  const memo = new Map<string, Set<string>>();
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    if (memo.has(id)) return memo.get(id)!;
    const out = new Set<string>();
    for (const d of deps.get(id) ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.add(d);
      for (const x of ancestors(d, seen)) out.add(x);
    }
    memo.set(id, out);
    return out;
  };
  return (from, to) => ancestors(from).has(to);
}

/** Pairs of tasks that could run concurrently and would write the same files: [a, b, lane]. */
export function laneConflicts(tasks: Task[]): [string, string, string][] {
  const open = tasks.filter((t) => !DONE.has(t.status));
  const dependsOn = reach(tasks);
  const out: [string, string, string][] = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      if (dependsOn(a.id, b.id) || dependsOn(b.id, a.id)) continue;
      const lane = a.lanes.find((la) => b.lanes.some((lb) => lanesOverlap(la, lb)));
      if (lane) out.push([a.id, b.id, lane]);
    }
  }
  return out;
}

/** Paths a developer can never write, whatever its lanes say (the guard enforces it). */
export const DEV_FORBIDDEN: Record<string, string> = {
  "tests/e2e/**": "QA writes the e2e specs from the acceptance criteria",
  "tests/acceptance/**": "QA owns acceptance tests",
  "docs/**": "docs are written by Product and the Architect",
  ".forge/**": "factory state",
};

export function validatePlan(tasks: Pick<Task, "id" | "deps" | "lanes">[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) errs.push(`duplicate id ${t.id}`);
    ids.add(t.id);
    if (!t.lanes.length) errs.push(`task ${t.id} has no lanes`);
    for (const l of t.lanes) {
      const g = Object.keys(DEV_FORBIDDEN).find((f) => lanesOverlap(l, f));
      if (g) errs.push(`task ${t.id}: lane ${l} is not writable by developers (${DEV_FORBIDDEN[g]}); remove it from the task and its acceptance`);
    }
  }
  for (const t of tasks) for (const d of t.deps) if (!ids.has(d)) errs.push(`task ${t.id}: unknown dependency ${d}`);
  const state = new Map<string, 1 | 2>();
  const deps = new Map(tasks.map((t) => [t.id, t.deps]));
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      errs.push(`dependency cycle: ${[...path, id].join(" → ")}`);
      return;
    }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (ids.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const t of tasks) visit(t.id, []);
  return errs;
}

/** Ruling helper: make each conflicting pair sequential (b waits for a). */
export function serializeConflicts(tasks: Task[], conflicts: [string, string, string][]): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const [a, b] of conflicts) {
    const tb = byId.get(b);
    if (tb && !tb.deps.includes(a)) tb.deps.push(a);
  }
}

/** Review findings a developer can act on: ones about files it may not write would loop forever. */
export function actionableIssues<I extends { file?: string }>(issues: I[], readonly: string[]): { keep: I[]; dropped: I[] } {
  const blocked = (i: I) => !!i.file && readonly.some((g) => lanesOverlap(i.file!.replace(/^\.\//, ""), g));
  return { keep: issues.filter((i) => !blocked(i)), dropped: issues.filter(blocked) };
}
