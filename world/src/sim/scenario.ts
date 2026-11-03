import type { MockLogLine } from '../adapters/adapter'
import type { Artifact, TaskContract } from '../domain/types'

// Demo scenario: the FORGE realm builds "Teamtrack", a small team task tracker.
// Everything here is scripted demo data; no agent, model or repository is involved.
// Who the roles are (names, art, districts) lives in src/realm/realm.ts.

export const PROJECT_NAME = 'Teamtrack — team task tracker'

export const TASKS: TaskContract[] = [
  {
    id: 'T1', title: 'PRD & acceptance', ownerRole: 'pm', dependencies: [],
    description: 'Turn the brief into the PRD: must/should/could features, user stories, Given/When/Then acceptance and hidden QA scenarios.',
    inputs: ['brief.md'], expectedOutputs: ['prd.md', 'holdout'],
    acceptanceCriteria: ['3–5 Must features', 'Every Must has Given/When/Then', 'Open questions listed with assumptions'],
  },
  {
    id: 'T2', title: 'External research', ownerRole: 'researcher', dependencies: ['T1'],
    description: 'Answer the PRD’s external-fact questions with cited sources.',
    inputs: ['prd.md'], expectedOutputs: ['research.md'],
    acceptanceCriteria: ['Every external question answered', 'Each answer has a source link'],
  },
  {
    id: 'T3', title: 'Architecture & frozen contract', ownerRole: 'architect', dependencies: ['T1', 'T2'],
    description: 'Components, data model, API table and the shared contract so three developers can work in parallel.',
    inputs: ['prd.md', 'research.md'], expectedOutputs: ['architecture.md', 'contracts.ts', 'tasks.json'],
    acceptanceCriteria: ['Every endpoint typed in contracts.ts', 'Each file lane has exactly one owner', '4–12 tasks with dependencies'],
  },
  {
    id: 'T4', title: 'Screens & design system', ownerRole: 'designer', dependencies: ['T1'],
    description: 'Board and task-detail screens, tokens and component list.',
    inputs: ['prd.md'], expectedOutputs: ['design.md'],
    acceptanceCriteria: ['Board, detail and empty states drawn', 'Tokens meet WCAG AA contrast'],
  },
  {
    id: 'T5', title: 'Lane A · Tasks API', ownerRole: 'dev1', dependencies: ['T3'], branchOrWorktree: 'factory/T5-api',
    description: 'Hono routes for tasks with zod validation and Drizzle persistence.',
    inputs: ['contracts.ts'], expectedOutputs: ['src/server/tasks/*'],
    acceptanceCriteria: ['Matches contracts.ts', 'Invalid input returns 400 { error }', 'Unit test per route'],
  },
  {
    id: 'T6', title: 'Lane B · Board UI', ownerRole: 'dev2', dependencies: ['T3', 'T4'], branchOrWorktree: 'factory/T6-ui',
    description: 'Kanban board: create, assign and move tasks, built against the contract.',
    inputs: ['contracts.ts', 'design.md'], expectedOutputs: ['src/web/board/*'],
    acceptanceCriteria: ['Create, assign and move a task', 'Design tokens only', 'Keyboard accessible'],
  },
  {
    id: 'T7', title: 'Lane C · Activity log & seed', ownerRole: 'dev3', dependencies: ['T3'], branchOrWorktree: 'factory/T7-activity',
    description: 'Activity feed endpoint and demo seed data.',
    inputs: ['contracts.ts'], expectedOutputs: ['src/server/activity/*', 'seed.ts'],
    acceptanceCriteria: ['Every task change is logged', 'Seed loads 3 members and 8 tasks'],
  },
  {
    id: 'T8', title: 'Integrate lanes', ownerRole: 'integrator', dependencies: ['T5', 'T6', 'T7'],
    description: 'Merge the three approved lanes into main in dependency order, gate after each merge.',
    inputs: ['tasks.json'], expectedOutputs: ['main'],
    acceptanceCriteria: ['No merge conflicts left', 'Gate green after every merge'],
  },
  {
    id: 'T9', title: 'QA on hidden scenarios', ownerRole: 'qa', dependencies: ['T8'], branchOrWorktree: 'factory/T9-qa',
    description: 'Run the hidden scenarios end to end and report failures with the responsible lane.',
    inputs: ['holdout'], expectedOutputs: ['test-report.json'],
    acceptanceCriteria: ['Every Must scenario run', 'Failures name the responsible task'],
  },
  {
    id: 'T10', title: 'Final review', ownerRole: 'final_reviewer', dependencies: ['T9'],
    description: 'Whole-diff review for correctness, contract drift and security before release.',
    inputs: ['contracts.ts', 'test-report.json'], expectedOutputs: ['review-report.md'],
    acceptanceCriteria: ['No blocking findings', 'Secrets and input validation checked'],
  },
  {
    id: 'T11', title: 'Preview deploy', ownerRole: 'devops', dependencies: ['T10'],
    description: 'Build and publish a preview for the demo.',
    inputs: ['review-report.md'], expectedOutputs: ['preview'],
    acceptanceCriteria: ['Production build succeeds', 'Smoke test passes on the preview'],
  },
]

export const ARTIFACTS: Artifact[] = [
  { id: 'brief.md', title: 'Brief', kind: 'doc', producedBy: 'orchestrator', content:
    '# Brief (demo)\nA small team needs one place to create tasks, assign them and see progress on a board.\n\nDemo journey: create task → assign → move to Done.' },
  { id: 'prd.md', title: 'PRD', kind: 'doc', producedBy: 'pm', content:
    '# PRD (demo)\n## Must\n1. Create a task\n2. Assign a task to a member\n3. Move a task between columns\n\n## Acceptance (excerpt)\n- AC-1 Given an empty board, When I create "Write docs", Then it appears in Backlog\n- AC-3 Given a task, When I PATCH it with an empty assignee, Then I get 400 { error }\n\n## Rulings (no client answer in time)\n- Single workspace, no auth\n- English UI only' },
  { id: 'holdout', title: 'Hidden QA scenarios', kind: 'report', producedBy: 'pm', content:
    '(hidden)\nThe QA scenarios live in .forge/holdout/scenarios.md.\nDevelopers never see them; only QA runs them. This demo does not show their content.' },
  { id: 'research.md', title: 'Research', kind: 'doc', producedBy: 'researcher', content:
    '# Research (demo)\n- Q: Can we email assignees? A: Out of scope for v1 (PRD non-goal). Source: prd.md\n- Q: SQLite write concurrency for a small team? A: WAL mode is enough. Source: sqlite.org/wal.html' },
  { id: 'architecture.md', title: 'Architecture', kind: 'doc', producedBy: 'architect', content:
    '# Architecture (demo)\n- React + Vite + Tailwind web, Hono on Node, SQLite + Drizzle\n- Lanes: src/server/tasks → Tuvshu, src/web/board → Anar, src/server/activity → Mada\n- Shared types in src/shared/contracts.ts (frozen after T3)' },
  { id: 'contracts.ts', title: 'Frozen contract', kind: 'contract', producedBy: 'architect', content:
    '// src/shared/contracts.ts (demo)\nexport const Task = z.object({\n  id: z.string(), title: z.string().min(1),\n  status: z.enum(["todo", "doing", "done"]),\n  assignee: z.string().min(1).optional(),\n})\n// GET /api/tasks · POST /api/tasks · PATCH /api/tasks/:id · GET /api/activity' },
  { id: 'tasks.json', title: 'Task plan', kind: 'plan', producedBy: 'architect', content:
    '{\n  "tasks": ["T5", "T6", "T7"],\n  "parallel": [["T5", "T6", "T7"]],\n  "note": "demo plan; see the task board for contracts"\n}' },
  { id: 'design.md', title: 'Design system', kind: 'doc', producedBy: 'designer', content:
    '# Design (demo)\n- Colours: ink #1d1b2e, surface #fffaf3, accent #7c5cff\n- Spacing 4/8/12/16/24\n- Components: Column, TaskCard, AssigneeChip, EmptyState' },
  { id: 'test-report.json', title: 'Test report', kind: 'report', producedBy: 'qa', content:
    '{\n  "demo": true,\n  "suite": "hidden scenarios",\n  "runs": [\n    { "run": 1, "passed": 11, "failed": 1, "failing": ["AC-3 PATCH empty assignee -> 500, expected 400 (T5)"] },\n    { "run": 2, "passed": 12, "failed": 0 }\n  ]\n}' },
  { id: 'review-report.md', title: 'Review report', kind: 'report', producedBy: 'final_reviewer', content:
    '# Final review (demo)\n- Blocking: none\n- Important: rate-limit POST /api/tasks later (logged as follow-up)\n- Security: zod at every boundary; no secrets in the diff' },
]

export type Variant = 'happy' | 'retry-exhausted'

const OPENING: MockLogLine[] = [
  { at: 0, kind: 'artifact.published', from: 'orchestrator', to: 'pm', msg: 'Brief received from the client', refs: ['brief.md'] },
  { at: 1, kind: 'task.assigned', from: 'orchestrator', to: 'pm', task: 'T1', msg: 'Write the PRD from brief.md' },
  { at: 2, kind: 'task.started', from: 'pm', task: 'T1', msg: 'Reading the brief, drafting user stories' },
  { at: 6, kind: 'task.blocked', from: 'pm', to: 'orchestrator', task: 'T1', msg: '❓ 2 open questions for the client; waiting in the lobby' },
  { at: 11, kind: 'task.assigned', from: 'orchestrator', to: 'pm', task: 'T1', msg: 'No answer in time: your assumptions stand and are logged as rulings' },
  { at: 12, kind: 'task.started', from: 'pm', task: 'T1', msg: 'Continuing with the assumptions' },
  { at: 16, kind: 'artifact.published', from: 'pm', to: 'orchestrator', task: 'T1', msg: 'Published prd.md and the hidden QA scenarios', refs: ['prd.md', 'holdout'] },
  { at: 17, kind: 'task.completed', from: 'pm', to: 'orchestrator', task: 'T1', msg: 'PRD ready for approval' },
  { at: 18, kind: 'review.completed', from: 'orchestrator', task: 'T1', verdict: 'approved', msg: 'PRD approved (human gate 1)' },
  { at: 19, kind: 'task.assigned', from: 'orchestrator', to: 'researcher', task: 'T2', msg: 'Check the external facts in prd.md', refs: ['prd.md'] },
  { at: 19.5, kind: 'task.assigned', from: 'orchestrator', to: 'designer', task: 'T4', msg: 'Design the screens from prd.md', refs: ['prd.md'] },
  { at: 20, kind: 'task.started', from: 'researcher', task: 'T2', msg: 'Searching sources for 2 questions' },
  { at: 20.5, kind: 'task.started', from: 'designer', task: 'T4', msg: 'Sketching board and detail screens' },
  { at: 27, kind: 'artifact.published', from: 'researcher', to: 'architect', task: 'T2', msg: 'Published research.md with cited sources', refs: ['research.md'] },
  { at: 28, kind: 'task.completed', from: 'researcher', to: 'orchestrator', task: 'T2', msg: 'Research done' },
  { at: 29, kind: 'review.completed', from: 'orchestrator', task: 'T2', verdict: 'approved', msg: 'Research accepted; architecture can start' },
  { at: 30, kind: 'task.assigned', from: 'orchestrator', to: 'architect', task: 'T3', msg: 'Design three parallel lanes', refs: ['prd.md', 'research.md'] },
  { at: 31, kind: 'task.started', from: 'architect', task: 'T3', msg: 'Modelling Task, routes and lanes' },
  { at: 36, kind: 'artifact.published', from: 'designer', to: 'dev2', task: 'T4', msg: 'Published design.md', refs: ['design.md'] },
  { at: 37, kind: 'task.completed', from: 'designer', to: 'orchestrator', task: 'T4', msg: 'Screens and tokens ready' },
  { at: 38, kind: 'review.completed', from: 'orchestrator', task: 'T4', verdict: 'approved', msg: 'Design accepted' },
  { at: 42, kind: 'artifact.published', from: 'architect', to: 'orchestrator', task: 'T3', msg: 'Published architecture.md, frozen contracts.ts and tasks.json', refs: ['architecture.md', 'contracts.ts', 'tasks.json'] },
  { at: 43, kind: 'task.completed', from: 'architect', to: 'orchestrator', task: 'T3', msg: 'Contract frozen' },
  { at: 44, kind: 'review.completed', from: 'orchestrator', task: 'T3', verdict: 'approved', msg: 'Plan approved (human gate 2): three lanes ready' },
  { at: 45, kind: 'task.assigned', from: 'orchestrator', to: 'dev1', task: 'T5', msg: 'Lane A: Tasks API', refs: ['contracts.ts'] },
  { at: 45.3, kind: 'task.assigned', from: 'orchestrator', to: 'dev2', task: 'T6', msg: 'Lane B: Board UI', refs: ['contracts.ts', 'design.md'] },
  { at: 45.6, kind: 'task.assigned', from: 'orchestrator', to: 'dev3', task: 'T7', msg: 'Lane C: Activity log & seed', refs: ['contracts.ts'] },
  { at: 46, kind: 'task.started', from: 'dev1', task: 'T5', msg: 'Started in worktree factory/T5-api' },
  { at: 46.5, kind: 'task.started', from: 'dev2', task: 'T6', msg: 'Started in worktree factory/T6-ui' },
  { at: 47, kind: 'task.started', from: 'dev3', task: 'T7', msg: 'Started in worktree factory/T7-activity' },
  { at: 52, kind: 'check.started', from: 'dev1', task: 'T5', check: ['typecheck', 'running'], msg: 'Typecheck on factory/T5-api' },
  { at: 54, kind: 'check.passed', from: 'dev1', task: 'T5', check: ['typecheck', 'pass'], msg: 'Typecheck clean' },
  { at: 57, kind: 'review.requested', from: 'dev3', to: 'reviewer', task: 'T7', msg: 'PR ready: factory/T7-activity' },
  { at: 58, kind: 'review.completed', from: 'reviewer', to: 'dev3', task: 'T7', verdict: 'approved', msg: 'Looks good, approved' },
  { at: 60, kind: 'review.requested', from: 'dev1', to: 'reviewer', task: 'T5', msg: 'PR ready: factory/T5-api, 14 unit tests green' },
  { at: 61, kind: 'review.completed', from: 'reviewer', to: 'dev1', task: 'T5', verdict: 'approved', msg: 'Approved' },
  { at: 62, kind: 'check.started', from: 'dev2', task: 'T6', check: ['lint', 'running'], msg: 'Lint on factory/T6-ui' },
  { at: 64, kind: 'check.passed', from: 'dev2', task: 'T6', check: ['lint', 'pass'], msg: 'Lint clean' },
  { at: 66, kind: 'review.requested', from: 'dev2', to: 'reviewer', task: 'T6', msg: 'PR ready: factory/T6-ui' },
  { at: 67, kind: 'review.completed', from: 'reviewer', to: 'dev2', task: 'T6', verdict: 'approved', msg: 'Approved' },
  { at: 68, kind: 'task.assigned', from: 'orchestrator', to: 'integrator', task: 'T8', msg: 'Merge lanes A, B, C into main' },
  { at: 69, kind: 'task.started', from: 'integrator', task: 'T8', msg: 'Merging T5 → T7 → T6, gate after each' },
  { at: 73, kind: 'task.completed', from: 'integrator', to: 'orchestrator', task: 'T8', msg: 'Three lanes merged into main' },
  { at: 74, kind: 'review.completed', from: 'orchestrator', task: 'T8', verdict: 'approved', msg: 'Main is green' },
  { at: 75, kind: 'task.assigned', from: 'orchestrator', to: 'qa', task: 'T9', msg: 'Run the hidden scenarios on main' },
  { at: 76, kind: 'task.started', from: 'qa', task: 'T9', msg: 'Opening the hidden scenarios', refs: ['holdout'] },
  { at: 77, kind: 'check.started', from: 'qa', task: 'T9', check: ['tests', 'running'], msg: 'Running 12 scenarios' },
  { at: 82, kind: 'check.failed', from: 'qa', to: 'orchestrator', task: 'T5', check: ['tests', 'fail'], msg: 'AC-3 failed: PATCH with empty assignee returns 500, expected 400', refs: ['test-report.json'] },
  { at: 83, kind: 'fix.requested', from: 'orchestrator', to: 'dev1', task: 'T5', msg: 'Fix 1/2: validate assignee; failing scenario attached', refs: ['test-report.json'] },
  { at: 84, kind: 'task.started', from: 'dev1', task: 'T5', msg: 'Fix round 1: reproducing AC-3 first' },
]

const HAPPY_END: MockLogLine[] = [
  { at: 89, kind: 'review.requested', from: 'dev1', to: 'reviewer', task: 'T5', msg: 'Fix pushed: zod check on assignee + regression test' },
  { at: 90, kind: 'check.started', from: 'qa', task: 'T5', check: ['tests', 'running'], msg: 'Re-running scenarios after the fix' },
  { at: 94, kind: 'check.passed', from: 'qa', to: 'orchestrator', task: 'T5', check: ['tests', 'pass'], msg: 'AC-3 passes; 12/12 green', refs: ['test-report.json'] },
  { at: 95, kind: 'review.completed', from: 'reviewer', to: 'integrator', task: 'T5', verdict: 'approved', msg: 'Fix approved; Ginkhma re-merged it' },
  { at: 96, kind: 'artifact.published', from: 'qa', to: 'final_reviewer', task: 'T9', msg: 'Published final test-report.json', refs: ['test-report.json'] },
  { at: 97, kind: 'check.passed', from: 'qa', task: 'T9', check: ['tests', 'pass'], msg: 'All scenarios green on main' },
  { at: 98, kind: 'task.completed', from: 'qa', to: 'orchestrator', task: 'T9', msg: 'QA passed' },
  { at: 99, kind: 'review.completed', from: 'orchestrator', task: 'T9', verdict: 'approved', msg: 'QA accepted' },
  { at: 100, kind: 'task.assigned', from: 'orchestrator', to: 'final_reviewer', task: 'T10', msg: 'Final review of the whole diff' },
  { at: 101, kind: 'task.started', from: 'final_reviewer', task: 'T10', msg: 'Reading the diff against contracts.ts', refs: ['contracts.ts'] },
  { at: 102, kind: 'check.started', from: 'final_reviewer', task: 'T10', check: ['review', 'running'], msg: 'Correctness and security pass' },
  { at: 107, kind: 'check.passed', from: 'final_reviewer', task: 'T10', check: ['review', 'pass'], msg: 'No blocking findings; 1 follow-up logged' },
  { at: 108, kind: 'artifact.published', from: 'final_reviewer', to: 'devops', task: 'T10', msg: 'Published review-report.md', refs: ['review-report.md'] },
  { at: 109, kind: 'task.completed', from: 'final_reviewer', to: 'orchestrator', task: 'T10', msg: 'Final review passed. Ship it.' },
  { at: 110, kind: 'review.completed', from: 'orchestrator', task: 'T10', verdict: 'approved', msg: 'Release approved' },
  { at: 111, kind: 'task.assigned', from: 'orchestrator', to: 'devops', task: 'T11', msg: 'Prepare the preview' },
  { at: 112, kind: 'task.started', from: 'devops', task: 'T11', msg: 'Checking the deploy target' },
  { at: 114, kind: 'task.blocked', from: 'devops', to: 'orchestrator', task: 'T11', msg: 'No hosting credentials in this demo; waiting for a human decision' },
  { at: 118, kind: 'task.assigned', from: 'orchestrator', to: 'devops', task: 'T11', msg: 'Human decision: use a local preview build' },
  { at: 119, kind: 'task.started', from: 'devops', task: 'T11', msg: 'Building locally' },
  { at: 120, kind: 'check.started', from: 'devops', task: 'T11', check: ['build', 'running'], msg: 'Production build' },
  { at: 124, kind: 'check.passed', from: 'devops', task: 'T11', check: ['build', 'pass'], msg: 'Build succeeded (simulated; nothing was deployed)' },
  { at: 125, kind: 'task.completed', from: 'devops', to: 'orchestrator', task: 'T11', msg: 'Preview is live (simulated)' },
  { at: 126, kind: 'review.completed', from: 'orchestrator', task: 'T11', verdict: 'approved', msg: 'Release gate passed (human gate 3)' },
  { at: 127, kind: 'run.completed', from: 'orchestrator', msg: 'All 11 tasks done; demo run complete' },
]

// The fix never works: the third fix request trips the retry budget and stops the run.
const RETRY_EXHAUSTED_END: MockLogLine[] = [
  { at: 89, kind: 'review.requested', from: 'dev1', to: 'reviewer', task: 'T5', msg: 'Fix pushed: null check on assignee' },
  { at: 90, kind: 'check.started', from: 'qa', task: 'T5', check: ['tests', 'running'], msg: 'Re-running scenarios after fix 1' },
  { at: 94, kind: 'check.failed', from: 'qa', to: 'orchestrator', task: 'T5', check: ['tests', 'fail'], msg: 'AC-3 still failing: empty string slips past the null check', refs: ['test-report.json'] },
  { at: 95, kind: 'fix.requested', from: 'orchestrator', to: 'dev1', task: 'T5', msg: 'Fix 2/2, escalated to opus: reject empty strings too' },
  { at: 96, kind: 'task.started', from: 'dev1', task: 'T5', msg: 'Fix round 2 on opus' },
  { at: 102, kind: 'review.requested', from: 'dev1', to: 'reviewer', task: 'T5', msg: 'Fix pushed: trim + length check' },
  { at: 103, kind: 'check.started', from: 'qa', task: 'T5', check: ['tests', 'running'], msg: 'Re-running scenarios after fix 2' },
  { at: 107, kind: 'check.failed', from: 'qa', to: 'orchestrator', task: 'T5', check: ['tests', 'fail'], msg: 'AC-3 still failing: handler swallows the validation error', refs: ['test-report.json'] },
  { at: 108, kind: 'fix.requested', from: 'orchestrator', to: 'dev1', task: 'T5', msg: 'Fix 3 requested' },
]

export function script(variant: Variant): MockLogLine[] {
  return [...OPENING, ...(variant === 'happy' ? HAPPY_END : RETRY_EXHAUSTED_END)]
}
