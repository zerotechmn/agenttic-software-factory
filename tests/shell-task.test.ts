import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellTask } from "../src/phases/design.ts";
import type { Task } from "../src/types.ts";

const task = (id: string, lanes: string[]): Task => ({ id, title: id, description: "", deps: [], lanes, acceptance: [], kind: "feature", status: "backlog", attempts: 0, escalations: 0, featureIds: [] });

function project(design = true): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-shell-"));
  mkdirSync(join(dir, "src", "web"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "src", "web", "App.tsx"), "export default function App() { return <header>template</header>; }\n");
  if (design) writeFileSync(join(dir, "docs", "design.md"), "## App shell (App.tsx)\nUse TopBar + Wordmark.\n");
  return dir;
}

describe("shell task", () => {
  it("wires the design into App.tsx after every web task when no task owns it", () => {
    const t = shellTask(project(), [task("T1", ["src/server/**"]), task("T4", ["src/web/components/layout/**"]), task("T5", ["src/web/pages/Catalog.tsx"])])!;
    expect(t.id).toBe("SHELL");
    expect(t.lanes).toEqual(["src/web/App.tsx"]);
    expect(t.deps).toEqual(["T4", "T5"]);
    expect(t.description).toMatch(/docs\/design\.md/);
  });

  it("stays out of the way when a task already owns the shell, or there is no design", () => {
    expect(shellTask(project(), [task("T4", ["src/web/**"])])).toBeNull();
    expect(shellTask(project(), [task("T4", ["src/web/App.tsx"])])).toBeNull();
    expect(shellTask(project(false), [task("T1", ["src/server/**"])])).toBeNull();
  });
});
