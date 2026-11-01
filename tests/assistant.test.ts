import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistant, assistantOps, listProposals, resolveProposal } from "../src/console/assistant.ts";
import { newState, saveState } from "../src/state.ts";
import type { QueryFn } from "../src/agent.ts";

function root() {
  const r = mkdtempSync(join(tmpdir(), "forge-asst-"));
  saveState(join(r, "alpha"), newState("alpha"));
  return r;
}
const skillRoot = () => {
  const s = mkdtempSync(join(tmpdir(), "forge-askills-"));
  for (const n of ["diagnosing-bugs", "research", "xlsx"]) {
    mkdirSync(join(s, n), { recursive: true });
    writeFileSync(join(s, n, "SKILL.md"), `---\nname: ${n}\ndescription: does ${n} things\n---\nbody`);
  }
  return s;
};

describe("assistant ops", () => {
  it("lists all available skills with descriptions and enables one on request", () => {
    process.env.FORGE_SKILL_ROOTS = skillRoot();
    const r = root();
    const ops = assistantOps(r, () => {});
    expect(ops.list_skills("xls").map((s) => s.name)).toEqual(["xlsx"]);
    expect(ops.enable_skill("xlsx")).toMatch(/enabled/);
    expect(ops.enabledSkills()).toContain("xlsx");
    expect(ops.enable_skill("nope")).toMatch(/no skill/);
  });

  it("starts a run and reports run status through the same safe functions as the console", () => {
    const r = root();
    const spawned: string[][] = [];
    const ops = assistantOps(r, (a) => spawned.push(a));
    // spending actions are only proposed; nothing starts until the operator confirms
    expect(ops.start_run("Todo", "# Brief: todo app", 8)).toMatch(/proposed/);
    expect(spawned).toHaveLength(0);
    const [prop] = listProposals(r);
    expect(prop).toMatchObject({ kind: "start", run: "todo", budget: 8 });
    expect(resolveProposal(r, prop.id, true, (a) => spawned.push(a))).toMatch(/started run todo/);
    expect(spawned[0]).toContain("--budget");
    expect(listProposals(r)).toHaveLength(0);
    mkdirSync(join(r, "todo", ".forge"), { recursive: true }); // what the real forge process would create
    ops.resume_run("todo");
    const [p2] = listProposals(r);
    expect(resolveProposal(r, p2.id, false, (a) => spawned.push(a))).toMatch(/dismissed/);
    expect(spawned).toHaveLength(1);
    expect(ops.run_status("alpha").phase).toBe("intake");
  });
});

describe("assistant agent", () => {
  it("runs scoped: factory tools via MCP, read-only file tools, no shell/write, persistent session", async () => {
    process.env.FORGE_SKILL_ROOTS = skillRoot();
    const r = root();
    const seen: any[] = [];
    const queryFn: QueryFn = async function* (args) {
      seen.push(args.options);
      yield { type: "result", subtype: "success", result: "all good", total_cost_usd: 0.02, session_id: "asst-1", usage: {} } as any;
    };
    const ask = createAssistant({ root: r, spawn: () => {}, queryFn });
    expect((await ask("hi")).reply).toBe("all good");
    await ask("again");
    const o = seen[0];
    expect(Object.keys(o.mcpServers)).toContain("forge");
    expect(o.tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep"]));
    expect(o.tools).not.toContain("Bash");
    expect(o.tools).not.toContain("Write");
    // no permission bypass: anything not pre-approved is denied outright
    expect(o.permissionMode).toBe("dontAsk");
    expect(o.allowDangerouslySkipPermissions).toBeFalsy();
    expect(o.allowedTools).toEqual(expect.arrayContaining(["Read", "mcp__forge__run_status"]));
    expect(o.allowedTools).not.toContain("Bash");
    expect(o.skills).toContain("diagnosing-bugs");
    expect(seen[1].resume).toBe("asst-1");
    expect(existsSync(join(r, ".console", "assistant.json"))).toBe(true);
  });
});
