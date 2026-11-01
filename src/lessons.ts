import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { FACTORY_ROOT } from "./config.ts";
import { EventBus } from "./events.ts";

/**
 * Cross-run learning, modeled on ECC's instincts: small lessons with a confidence score.
 * New lessons start as candidates (0.3); each run that hits the same mistake again reinforces them,
 * and lessons at 0.5+ are injected into that role's system prompt. At 0.85+ seen in 3+ runs they can be
 * promoted into the role file by the operator (`forge lessons promote <id>`). The orchestrator applies
 * every change; the learner agent only proposes.
 */
export interface Lesson {
  id: string;
  role: string;
  trigger: string;
  lesson: string;
  confidence: number;
  runs: string[];
  status: "candidate" | "active" | "promoted" | "retired";
  source: "seed" | "learned";
  updatedAt: string;
}

export const ACTIVE_AT = 0.5;
export const PROMOTE_AT = 0.85;
const STEP_UP = 0.15;
const STEP_DOWN = 0.2;
const clamp = (n: number) => Math.round(Math.min(0.9, Math.max(0, n)) * 100) / 100;

export const LearnerOutput = z.object({
  reinforce: z.array(z.object({ id: z.string(), evidence: z.string() })).describe("Existing lesson ids this run's evidence shows happening again"),
  contradict: z.array(z.object({ id: z.string(), evidence: z.string() })).describe("Existing lesson ids this run shows to be wrong or harmful"),
  add: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{3,50}$/).describe("kebab-case slug"),
    role: z.enum(["product", "architect", "uiux", "dev", "reviewer", "qa", "final_reviewer", "devops", "researcher", "integrator"]),
    trigger: z.string().describe("When this applies, e.g. 'when planning file lanes'"),
    lesson: z.string().describe("One imperative sentence the role should follow"),
    evidence: z.string().describe("The event or ruling that shows the mistake"),
  })).max(5).describe("New lessons for mistakes not covered by an existing lesson; only recurring, generalizable ones"),
});
export type LearnerOutput = z.infer<typeof LearnerOutput>;

export const lessonsFile = () => process.env.FORGE_LESSONS ?? join(FACTORY_ROOT, "lessons", "lessons.json");

export function loadLessons(file = lessonsFile()): Lesson[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Lesson[]) : [];
}

export function saveLessons(lessons: Lesson[], file = lessonsFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(lessons, null, 2) + "\n");
}

const statusFor = (l: Lesson): Lesson["status"] => (l.status === "promoted" ? "promoted" : l.confidence < 0.2 ? "retired" : l.confidence >= ACTIVE_AT ? "active" : "candidate");

/** The block appended to a role's system prompt. Stable within a run, so prompt caching still works. */
export function lessonsFor(role: string, lessons = loadLessons()): string {
  const mine = lessons.filter((l) => l.role === role && l.status === "active").sort((a, b) => b.confidence - a.confidence).slice(0, 8);
  if (!mine.length) return "";
  return ["", "## Lessons from earlier FORGE runs", ...mine.map((l) => `- ${l.trigger}: ${l.lesson}`)].join("\n");
}

export interface LearnResult { added: string[]; reinforced: string[]; contradicted: string[] }

export function applyLearning(lessons: Lesson[], out: LearnerOutput, run: string, now = new Date()): LearnResult {
  const at = now.toISOString();
  const res: LearnResult = { added: [], reinforced: [], contradicted: [] };
  const byId = new Map(lessons.map((l) => [l.id, l]));
  for (const r of out.reinforce) {
    const l = byId.get(r.id);
    if (!l || l.runs.includes(run)) continue;
    l.confidence = clamp(l.confidence + STEP_UP);
    l.runs.push(run);
    l.updatedAt = at;
    l.status = statusFor(l);
    res.reinforced.push(l.id);
  }
  for (const r of out.contradict) {
    const l = byId.get(r.id);
    if (!l) continue;
    l.confidence = clamp(l.confidence - STEP_DOWN);
    l.updatedAt = at;
    l.status = statusFor(l);
    res.contradicted.push(l.id);
  }
  for (const a of out.add) {
    if (byId.has(a.id)) continue;
    const l: Lesson = { id: a.id, role: a.role, trigger: a.trigger, lesson: a.lesson, confidence: 0.3, runs: [run], status: "candidate", source: "learned", updatedAt: at };
    lessons.push(l);
    byId.set(l.id, l);
    res.added.push(l.id);
  }
  return res;
}

export function promotable(lessons: Lesson[]): Lesson[] {
  return lessons.filter((l) => l.status === "active" && l.confidence >= PROMOTE_AT && l.runs.length >= 3);
}

/** Append a lesson to its role file's "Learned rules" section and mark it promoted. */
export function promote(id: string, lessons = loadLessons(), rolesDir = join(FACTORY_ROOT, "roles")): Lesson {
  const l = lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  const file = join(rolesDir, `${l.role}.md`);
  let body = readFileSync(file, "utf8");
  if (!body.includes("## Learned rules")) body = body.trimEnd() + "\n\n## Learned rules\n";
  body = body.trimEnd() + `\n- ${l.trigger}: ${l.lesson} <!-- lesson:${l.id} -->\n`;
  writeFileSync(file, body);
  l.status = "promoted";
  l.updatedAt = new Date().toISOString();
  return l;
}

/** The mistakes a run made, compressed for the learner: failed gates, rejections, guard denials, parks, rulings. */
export function runEvidence(dir: string, max = 6000): string {
  const events = EventBus.readAll(join(dir, ".forge", "events.jsonl"));
  const lines: string[] = [];
  for (const e of events) {
    const bad =
      (e.kind === "gate" && e.status === "fail") || (e.kind === "review" && e.status === "reject") || e.kind === "task_fail" ||
      e.kind === "guard_deny" || e.kind === "ruling" || e.kind === "retry" || (e.kind === "qa_result" && !/\b0 failures/.test(e.text ?? "")) ||
      (e.kind === "agent_done" && e.status === "fail") || (e.kind === "task_status" && e.status === "parked");
    if (bad) lines.push(`[${e.phase}] ${e.kind}${e.status ? `/${e.status}` : ""} ${e.role ?? ""}${e.taskId ? ` ${e.taskId}` : ""}: ${(e.text ?? "").replace(/\s+/g, " ").slice(0, 240)}`);
  }
  const ledger = join(dir, ".forge", "ledger.md");
  if (existsSync(ledger)) for (const l of readFileSync(ledger, "utf8").split("\n")) if (l.includes("RULING:")) lines.push(`ledger ${l.slice(0, 240)}`);
  const seen = new Set<string>();
  const out = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  let text = out.join("\n");
  if (text.length > max) text = text.slice(0, max) + `\n… (${out.length} lines total)`;
  return text;
}
