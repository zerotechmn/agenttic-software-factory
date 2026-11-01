import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportAgents } from "../src/exportAgents.ts";

describe("exportAgents", () => {
  it("writes one Claude Code subagent per role plus a FACTORY.md playbook", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-exp-"));
    const files = exportAgents(dir);
    expect(files.length).toBe(11);
    const dev = readFileSync(join(dir, ".claude/agents/forge-dev.md"), "utf8");
    expect(dev).toMatch(/^---\nname: forge-dev\ndescription: .+\nmodel: sonnet\ntools: .*Bash/m);
    expect(dev).toContain("# Role: DEVELOPER");
    expect(existsSync(join(dir, "FACTORY.md"))).toBe(true);
    expect(readFileSync(join(dir, "FACTORY.md"), "utf8")).toContain("forge-architect");
  });
});
