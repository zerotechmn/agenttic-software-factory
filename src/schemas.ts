import { z } from "zod";

export const AgentStatus = z.object({
  status: z.enum(["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"]),
  summary: z.string().describe("At most 15 lines: what you did and how you verified it"),
  filesChanged: z.array(z.string()),
  concerns: z.array(z.string()).describe("Anything the orchestrator should know; empty if none"),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const Feature = z.object({
  id: z.string().describe("F1, F2, ..."),
  title: z.string(),
  priority: z.enum(["must", "should", "could"]),
  story: z.string().describe("As a <user>, I want <goal> so that <reason>"),
  acceptance: z.array(z.string()).min(1).describe("Concrete, testable Given/When/Then criteria"),
  passes: z.boolean(),
  status: z.enum(["working", "partial", "missing"]).optional().describe("Set by QA"),
});
export const ResearchQuestion = z.object({
  id: z.string().describe("R1, R2, ..."),
  topic: z.string().regex(/^[a-z0-9-]{2,30}$/).describe("kebab slug; questions sharing a topic go to one Researcher"),
  question: z.string(),
  why: z.string().describe("Which decision this unblocks"),
  consumers: z.array(z.enum(["architect", "uiux", "dev"])).min(1),
  featureIds: z.array(z.string()),
});
export type ResearchQuestion = z.infer<typeof ResearchQuestion>;

export const Prd = z.object({
  product: z.string().describe("Product name"),
  pitch: z.string().describe("One sentence"),
  users: z.array(z.string()),
  features: z.array(Feature).min(1),
  outOfScope: z.array(z.string()),
  openQuestions: z.array(z.object({
    id: z.string().describe("Q1, Q2, ..."),
    question: z.string().describe("An ambiguity in the brief that changes what gets built"),
    assumption: z.string().describe("What you build if nobody answers"),
    featureIds: z.array(z.string()).default([]),
  })).max(8).default([]).describe("Ask the client only what genuinely changes the product; each with the assumption you proceed on"),
  researchQuestions: z.array(ResearchQuestion).max(12).default([]).describe("External facts the build needs (APIs, datasets, versions, terms). Never about the house stack. Empty if none."),
});
export type Prd = z.infer<typeof Prd>;

export const PlannedTask = z.object({
  id: z.string().describe("T1, T2, ..."),
  title: z.string(),
  description: z.string().describe("What to build, which contracts to use, and how to verify"),
  deps: z.array(z.string()),
  lanes: z.array(z.string()).min(1).describe("Files/globs this task may write, e.g. src/server/routes/notes.ts"),
  acceptance: z.array(z.string()),
  featureIds: z.array(z.string()),
});
export const TaskPlan = z.object({ tasks: z.array(PlannedTask).min(1) });
export type TaskPlan = z.infer<typeof TaskPlan>;

export const ReviewVerdict = z.object({
  verdict: z.enum(["approve", "reject"]),
  issues: z.array(
    z.object({
      severity: z.enum(["critical", "major", "minor"]),
      file: z.string().optional(),
      message: z.string(),
      fix: z.string().describe("How to fix it, concretely"),
    }),
  ),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const QaReport = z.object({
  score: z.number().min(0).max(10).describe("Overall product quality 0-10 against the rubric"),
  features: z.array(z.object({ id: z.string(), passes: z.boolean(), status: z.enum(["working", "partial", "missing"]).optional().describe("working = every acceptance check works; partial = some work; missing = not there or broken"), evidence: z.string() })),
  failures: z.array(
    z.object({
      title: z.string(),
      steps: z.string(),
      expected: z.string(),
      actual: z.string(),
      suspectedFiles: z.array(z.string()),
      featureId: z.string().optional(),
    }),
  ),
  visual: z
    .object({
      score: z.number().min(0).max(10).describe("Visual craft judged from your screenshots, strict"),
      issues: z.array(z.object({ title: z.string(), fix: z.string(), suspectedFiles: z.array(z.string()) })),
    })
    .optional(),
});
export type QaReport = z.infer<typeof QaReport>;

export const ResearchStatus = z.object({
  status: z.enum(["DONE", "PARTIAL", "BLOCKED"]),
  topic: z.string(),
  file: z.string().describe("docs/research/<topic>.md"),
  summary: z.string().describe("At most 5 lines"),
  findings: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string().describe("One or two sentences, with [S#] citations"),
      confidence: z.enum(["high", "medium", "low", "unknown"]),
      sources: z.array(z.object({ id: z.string(), url: z.string(), tier: z.enum(["T1", "T2", "T3", "T4"]) })),
    }),
  ),
  prdImpact: z.array(z.string()).describe("Findings that make a PRD feature infeasible or change it; empty if none"),
  concerns: z.array(z.string()).describe("Prompt injection seen, paywalls, blocked sites; empty if none"),
});
export type ResearchStatus = z.infer<typeof ResearchStatus>;

export const DeployReport = z.object({
  ok: z.boolean(),
  url: z.string().optional(),
  method: z.enum(["docker", "node"]),
  notes: z.string(),
});
export type DeployReport = z.infer<typeof DeployReport>;

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export const PrdCritique = z.object({
  coverage: z.array(z.object({
    requirement: z.string().describe("A requirement from the brief, quoted or tightly paraphrased"),
    featureIds: z.array(z.string()).describe("PRD features that deliver it; empty if none"),
  })),
  uncovered: z.array(z.string()).describe("Brief requirements no feature (or a feature too weak) delivers"),
  invented: z.array(z.object({ featureId: z.string(), why: z.string() })).describe("Must-have features the brief never asked for"),
  stackConflicts: z.array(z.string()).default([]).describe("Brief requirements the house stack cannot meet (a required language, framework, platform or hosting); empty if none"),
});
export type PrdCritique = z.infer<typeof PrdCritique>;
