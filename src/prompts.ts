import type { SecurityReport } from "./security.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./types.ts";
import type { Prd, QaReport, ResearchQuestion } from "./schemas.ts";

const FOOTER = "When finished, reply ONLY with the JSON object required by the output schema.";

export function depsPrompt(t: Task, requests: { name: string; version?: string; why: string; facts: string }[]): string {
  return [
    `Dispatch: ARCHITECT, dependency request from the developer of task ${t.id} (${t.title}).`,
    "Decide each package by your role's Dependencies rules. Don't edit or install anything: the orchestrator installs what you approve on main.",
    "",
    ...requests.map((r) => `## ${r.name}${r.version ? `@${r.version}` : ""}\nWhy: ${r.why}\nnpm facts: ${r.facts}`),
    "",
    "Installed now: see package.json. Architecture: docs/architecture.md.",
    FOOTER,
  ].join("\n");
}

export function productPrompt(timebox: string, retryError?: string): string {
  return [
    "Dispatch: PRODUCT.",
    "Read docs/brief.md and CLAUDE.md. Write docs/prd.json, docs/prd.md and .forge/holdout/scenarios.md as your role describes.",
    `Time box for building the whole product: ${timebox}. Scope accordingly.`,
    "docs/prd.json must match: { product, pitch, users[], features[{ id, title, priority: must|should|could, story, acceptance[], passes:false }], outOfScope[], researchQuestions[{ id, topic, question, why, consumers[], featureIds[] }] }.",
    "openQuestions: real ambiguities in the brief that change what gets built (0–6), each with the assumption you build on if nobody answers. Write the PRD on those assumptions now; never wait.",
    "researchQuestions: only external facts the build depends on (third-party APIs, datasets, licenses, current library versions beyond the house stack). Usually 0–4. Never ask about the house stack.",
    retryError ? `\nYour previous docs/prd.json ${retryError.startsWith("An independent critic") ? "needs changes" : "was invalid"}: ${retryError}\nFix the file.` : "",
    FOOTER,
  ].join("\n");
}

export function architectPrompt(concurrency: number, retryError?: string): string {
  return [
    "Dispatch: ARCHITECT.",
    "Inputs: docs/brief.md, docs/prd.json, CLAUDE.md, the template source. Produce everything your role owns.",
    `Up to ${concurrency} developers will work in parallel; maximize independent tasks while keeping lanes disjoint.`,
    "docs/tasks.json must match: { tasks: [{ id, title, description, deps[], lanes[], acceptance[], featureIds[] }] }.",
    "Run `npm run check` before finishing; it must pass with your contracts and stubs (stub tests may be skipped with it.todo, never deleted).",
    retryError ? `\nThe orchestrator rejected your previous output:\n${retryError}\nFix it.` : "",
    FOOTER,
  ].join("\n");
}

export function uiuxPrompt(feedback?: string): string {
  return [
    "Dispatch: UI/UX.",
    "Inputs: docs/brief.md, docs/prd.json, CLAUDE.md, src/web. Produce docs/design.md and the theme/primitives as your role describes.",
    "Required research before you design (the orchestrator checks the tool log):",
    '1. Invoke the `frontend-design` skill (Skill tool) and follow it for the aesthetic direction.',
    '2. Run the design database: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<product type> <audience> <mood>" --design-system -p "<Product>"` (add `--domain ux` for usability rules).',
    "3. In docs/design.md add a `## Design sources` section: what each source recommended and what you took or rejected, and why.",
    "Fill the desktop width: no layout that leaves half the screen empty at 1920px.",
    feedback ? `\nThe orchestrator sent you back: ${feedback}` : "",
    FOOTER,
  ].join("\n");
}

/**
 * Shared context every developer needs, placed FIRST in the dispatch so parallel developers share one
 * cached prompt prefix and don't spend tool calls re-reading the same files.
 */
export function contextPack(dir: string): string {
  const read = (rel: string, max: number) => {
    const p = join(dir, rel);
    if (!existsSync(p)) return "";
    const s = readFileSync(p, "utf8");
    return s.length > max ? s.slice(0, max) + "\n… (truncated; read the file for the rest)" : s;
  };
  const contracts = read("src/shared/contracts.ts", 12000);
  const arch = read("docs/architecture.md", 8000);
  const research = read("docs/research/INDEX.md", 4000);
  if (!contracts && !arch && !research) return "";
  return [
    "# Shared context (identical for every developer; already loaded, don't re-read these files)",
    contracts ? `## src/shared/contracts.ts (frozen)\n\`\`\`ts\n${contracts}\n\`\`\`` : "",
    arch ? `## docs/architecture.md\n${arch}` : "",
    research ? `## docs/research/INDEX.md (verified external facts; details in docs/research/)\n${research}` : "",
    "---",
  ].filter(Boolean).join("\n\n");
}

export function devPrompt(t: Task, feedback?: string, pack = ""): string {
  return [
    pack,
    `Dispatch: DEVELOPER — task ${t.id}: ${t.title}`,
    "",
    "## Task",
    t.description,
    "",
    `## Your lanes (the only files you may create/edit)\n${t.lanes.map((l) => `- ${l}`).join("\n")}`,
    "- plus new unit tests under tests/unit/ for this task",
    "",
    t.acceptance.length ? `## Acceptance\n${t.acceptance.map((a) => `- ${a}`).join("\n")}` : "",
    t.featureIds.length ? `\nPRD features: ${t.featureIds.join(", ")} (see docs/prd.json)` : "",
    pack
      ? "\nThe contracts and architecture are above. Read docs/design.md only for UI tasks. Run `npm run check` before you finish."
      : "\nRead CLAUDE.md, docs/architecture.md, docs/design.md and src/shared/contracts.ts first. Run `npm run check` before you finish.",
    feedback ? `\n## FEEDBACK FROM YOUR LAST ATTEMPT — fix the root cause\n${feedback}` : "",
    FOOTER,
  ].join("\n");
}

export function reviewPrompt(t: Task, base: string, diff = ""): string {
  return [
    `Dispatch: REVIEW task ${t.id}: ${t.title}`,
    diff
      ? `The diff (\`git diff ${base}..HEAD\`) is below; read other files only if you must. Changed files must stay within lanes: ${t.lanes.join(", ")} (+ tests/unit/**).\n\n\`\`\`diff\n${diff}\n\`\`\``
      : `Diff to review: \`git diff ${base}..HEAD\` (run it). Changed files must stay within lanes: ${t.lanes.join(", ")} (+ tests/unit/**).`,
    "",
    "## Task brief",
    t.description,
    t.acceptance.length ? `\nAcceptance:\n${t.acceptance.map((a) => `- ${a}`).join("\n")}` : "",
    "\nThe deterministic gate (typecheck, lint, unit tests) already passed.",
    "Judge only files the developer may write (its lanes + tests/unit/**). Never reject for a missing or unchanged file outside them: e2e specs (tests/e2e/**) are written later by QA.",
    "Reply ONLY with { verdict: approve|reject, issues: [{ severity, file?, message, fix }] }.",
  ].join("\n");
}

export function integratorPrompt(t: Task): string {
  return [
    `Dispatch: INTEGRATOR for task ${t.id}: ${t.title}.`,
    "Your worktree has `main` merged in with conflicts. Resolve them, `git add` and `git commit --no-edit`, then run `npm run check`.",
    `Task brief: ${t.description}`,
    FOOTER,
  ].join("\n");
}

/** Later operator decisions win over the PRD: QA and reviewers must not file them as defects. */
export function changeRequestsBlock(crs: string[] = []): string {
  return crs.length ? `\nOperator change requests (newer than the PRD and brief; where they conflict, THESE are correct, never report them as defects):\n${crs.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n` : "";
}

export function qaPrompt(url: string, round: number, prd: Prd, prev?: QaReport, changeRequests: string[] = []): string {
  return [
    `Dispatch: QA round ${round}. The app is running at ${url} (BASE_URL).`,
    changeRequestsBlock(changeRequests),
    "Inputs: docs/prd.json, docs/design.md, .forge/holdout/scenarios.md.",
    `Features to verify: ${prd.features.map((f) => `${f.id} (${f.priority}) ${f.title}`).join("; ")}.`,
    prev ? `\nPrevious round scored ${prev.score}. Previously failing: ${prev.failures.map((f) => f.title).join("; ") || "none"}. Re-verify those first.` : "",
    `Visual check (required, do it FIRST, before your tests add data to the app): take screenshots with \`npx playwright screenshot --viewport-size=1920,1080 --wait-for-timeout=6000 ${url} .forge/qa/r${round}-desktop.png\` and \`--viewport-size=390,844\` (…-mobile.png), then Read both images and judge them strictly in \`visual\`.`,
    `Then run specs with: BASE_URL=${url} npx playwright test --reporter=line`,
    "Reply ONLY with the QA report JSON { score, features[{ id, passes, status: working|partial|missing, evidence }], failures[{ title, steps, expected, actual, suspectedFiles[], featureId? }], visual: { score, issues[{ title, fix, suspectedFiles[] }] } }. `visual` is required.",
  ].join("\n");
}

export function finalReviewPrompt(base: string, scan?: SecurityReport, changeRequests: string[] = []): string {
  const sec = scan ? scan.findings.filter((f) => f.severity !== "low").slice(0, 20) : [];
  return [
    "Dispatch: FINAL REVIEW of the whole product.",
    changeRequestsBlock(changeRequests),
    `Changes since scaffold: \`git diff ${base}..HEAD --stat\`, then read what matters. Inputs: docs/brief.md, docs/brief-coverage.json (if present), docs/prd.json, docs/architecture.md. A brief requirement the product does not deliver is a release blocker.`,
    ...(sec.length || (scan?.audit && !scan.audit.ok)
      ? ["## Automated security scan (verify each; real ones are blockers, false positives are not)", ...sec.map((f) => `- ${f.severity} ${f.rule} ${f.file}:${f.line}: ${f.text}`), ...(scan?.audit && !scan.audit.ok ? [`- npm audit: ${scan.audit.critical} critical, ${scan.audit.high} high in prod deps`] : [])]
      : []),
    "Reply ONLY with { verdict, issues: [{ severity, file?, message, fix }] }. Release blockers only.",
  ].join("\n");
}

export function devopsPrompt(image: string, port: number): string {
  return [
    "Dispatch: DEVOPS.",
    `Image name: ${image}. Container name: ${image}. Host port: ${port}.`,
    "Deploy main as your role describes and prove /api/health responds.",
    "Reply ONLY with { ok, url?, method: docker|node, notes }.",
  ].join("\n");
}

export function researcherPrompt(topic: string, qs: ResearchQuestion[], file: string): string {
  return [
    `Dispatch: RESEARCHER, topic "${topic}". Write your findings to ${file} (the only file you may write).`,
    "Context: docs/brief.md and docs/prd.json (read only what you need). The house stack in CLAUDE.md is decided; don't research it.",
    "## Questions",
    ...qs.map((q) => `- ${q.id}: ${q.question}\n  why: ${q.why} · used by: ${q.consumers.join(", ")} · features: ${q.featureIds.join(", ") || "-"}`),
    FOOTER,
  ].join("\n");
}

export function criticPrompt(): string {
  return [
    "Dispatch: PRD CRITIC.",
    "Read docs/brief.md (the client's words) and docs/prd.json (the Product agent's interpretation). Map every brief requirement to the features that deliver it.",
    "The house stack is fixed: a TypeScript web app (React + Vite + Tailwind, Hono on Node, SQLite + Drizzle), deployed with Docker or Node. List in stackConflicts any brief requirement it cannot meet: a required language or framework (e.g. Python, Django, Java, Next.js), a platform (native mobile, desktop), or hosting/infrastructure it cannot provide. A web app accessed from a phone is not a conflict.",
    "Reply ONLY with { coverage[{ requirement, featureIds[] }], uncovered[], invented[{ featureId, why }], stackConflicts[] }.",
  ].join("\n");
}
