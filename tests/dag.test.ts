import { describe, it, expect } from "vitest";
import { readyTasks, laneConflicts, validatePlan, lanesOverlap, actionableIssues } from "../src/dag.ts";
import type { Task } from "../src/types.ts";

const t = (id: string, deps: string[] = [], lanes: string[] = [`src/${id}.ts`], status: Task["status"] = "backlog"): Task => ({
  id, title: id, description: "", deps, lanes, acceptance: [], kind: "feature", status, attempts: 0, escalations: 0, featureIds: [],
});

describe("readyTasks", () => {
  it("only returns tasks whose deps are merged", () => {
    const tasks = [t("a"), t("b", ["a"])];
    expect(readyTasks(tasks).map((x) => x.id)).toEqual(["a"]);
    tasks[0].status = "merged";
    expect(readyTasks(tasks).map((x) => x.id)).toEqual(["b"]);
  });
  it("treats a parked dependency as satisfied so the factory never deadlocks", () => {
    expect(readyTasks([t("a", [], undefined, "parked"), t("b", ["a"])]).map((x) => x.id)).toEqual(["b"]);
  });
  it("skips running, merged and parked tasks", () => {
    expect(readyTasks([t("a", [], undefined, "running"), t("b", [], undefined, "merged"), t("c", [], undefined, "parked")])).toEqual([]);
  });
});

describe("lanes", () => {
  it("detects overlapping globs", () => {
    expect(lanesOverlap("src/web/**", "src/web/App.tsx")).toBe(true);
    expect(lanesOverlap("src/web/pages/A.tsx", "src/web/pages/B.tsx")).toBe(false);
    expect(lanesOverlap("src/server/routes/*.ts", "src/server/routes/notes.ts")).toBe(true);
  });
  it("lists parallel tasks that share a lane", () => {
    const c = laneConflicts([t("a", [], ["src/web/App.tsx"]), t("b", [], ["src/web/**"])]);
    expect(c).toEqual([["a", "b", "src/web/App.tsx"]]);
  });
  it("ignores overlap when one task depends (transitively) on the other", () => {
    expect(laneConflicts([t("a", [], ["src/x.ts"]), t("m", ["a"]), t("b", ["m"], ["src/x.ts"])])).toEqual([]);
  });
  it("ignores parked and merged tasks", () => {
    expect(laneConflicts([t("a", [], ["src/x.ts"], "merged"), t("b", [], ["src/x.ts"])])).toEqual([]);
  });
});

describe("validatePlan", () => {
  it("accepts a valid plan", () => {
    expect(validatePlan([t("a"), t("b", ["a"])])).toEqual([]);
  });
  it("reports unknown deps, duplicates, empty lanes and cycles", () => {
    const errs = validatePlan([t("a", ["zz"]), t("a"), t("c", [], []), t("x", ["y"]), t("y", ["x"])]);
    expect(errs.join("\n")).toMatch(/unknown dependency zz/);
    expect(errs.join("\n")).toMatch(/duplicate id a/);
    expect(errs.join("\n")).toMatch(/c has no lanes/);
    expect(errs.join("\n")).toMatch(/cycle/);
  });
  it("rejects dev lanes the developer role can never write (QA owns e2e, docs are Product/Architect's)", () => {
    const errs = validatePlan([t("a", [], ["src/web/lobby.ts", "tests/e2e/lobby.spec.ts"]), t("b", [], ["docs/**"]), t("c", [], ["tests/unit/c.test.ts"])]);
    expect(errs.join("\n")).toMatch(/a: lane tests\/e2e\/lobby\.spec\.ts .*QA/);
    expect(errs.join("\n")).toMatch(/b: lane docs/);
    expect(errs.join("\n")).not.toMatch(/\bc:/);
  });
});

describe("actionableIssues", () => {
  it("drops review findings about files the developer is not allowed to write", () => {
    const issues = [
      { severity: "major" as const, file: "tests/e2e/x.spec.ts", message: "missing spec", fix: "add it" },
      { severity: "major" as const, file: "src/web/x.ts", message: "bug", fix: "fix it" },
      { severity: "major" as const, message: "no file", fix: "?" },
    ];
    const r = actionableIssues(issues, ["tests/e2e/**", "docs/**"]);
    expect(r.keep.map((i) => i.message)).toEqual(["bug", "no file"]);
    expect(r.dropped).toHaveLength(1);
  });
});
