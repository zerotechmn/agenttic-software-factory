import { describe, it, expect } from "vitest";
import { loadRole, ROLE_NAMES } from "../src/roles.ts";
import { AgentStatus, Prd, TaskPlan, ReviewVerdict, QaReport, jsonSchema } from "../src/schemas.ts";

describe("roles", () => {
  it.each(ROLE_NAMES)("%s loads with a substantial body and turn cap", (name) => {
    const r = loadRole(name);
    expect(r.body.length).toBeGreaterThan(200);
    expect(r.maxTurns).toBeGreaterThan(0);
  });
  it("parses the tools list from frontmatter", () => {
    expect(loadRole("reviewer").tools).toContain("Read");
    expect(loadRole("reviewer").tools).not.toContain("Write");
  });
});

describe("schemas", () => {
  it.each([["AgentStatus", AgentStatus], ["Prd", Prd], ["TaskPlan", TaskPlan], ["ReviewVerdict", ReviewVerdict], ["QaReport", QaReport]] as const)(
    "%s converts to an object JSON schema",
    (_n, s) => {
      expect(jsonSchema(s).type).toBe("object");
    },
  );
  it("rejects a QA score above 10", () => {
    expect(QaReport.safeParse({ score: 11, features: [], failures: [] }).success).toBe(false);
  });
});

describe("researcher role", () => {
  it("declares its MCP servers and web tools, and no shell", () => {
    const r = loadRole("researcher");
    expect(r.mcp).toEqual(["scrapling", "context7"]);
    expect(r.tools).toContain("WebSearch");
    expect(r.tools).not.toContain("Bash");
  });
  it("PRD research questions default to none", () => {
    const p = Prd.parse({ product: "x", pitch: "p", users: [], outOfScope: [], features: [{ id: "F1", title: "t", priority: "must", story: "s", acceptance: ["a"], passes: false }] });
    expect(p.researchQuestions).toEqual([]);
  });
});
