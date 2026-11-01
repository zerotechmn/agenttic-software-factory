import { join } from "node:path";
import { writeFile } from "./ctx.ts";
import { loadRole, ROLE_NAMES } from "./roles.ts";

const PLAYBOOK = `# FACTORY.md: run the FORGE pipeline by hand (plan B)

Use this when the \`forge\` orchestrator can't run. Open Claude Code in this repo and drive the same roles as subagents.
Handoffs are the same files the orchestrator uses.

1. **forge-product**: "Read docs/brief.md and produce docs/prd.json, docs/prd.md, .forge/holdout/scenarios.md."
2. **forge-architect** and **forge-uiux** (in parallel): architecture, contracts, stubs, docs/tasks.json; design.md + theme.
3. Gate: \`npm run check\` must pass. Make tasks that share lanes sequential.
4. For each ready task in docs/tasks.json: **forge-dev** with the task text (run independent tasks in parallel with
   \`isolation: worktree\`), then \`npm run check\`, then **forge-reviewer** on the diff. On failure, send the output back to forge-dev (max 3, then switch to opus).
5. Merge each approved task and run \`npm run check\` on main after each merge. If something conflicts, use **forge-integrator**.
6. **forge-qa** against \`npm run build && PORT=8790 npm start\`. Turn failures into new dev tasks. Repeat until must-haves pass and the score is ≥ 7.
7. **forge-final_reviewer**, then **forge-devops**.
`;

/** Write the role definitions as Claude Code subagents (.claude/agents) + a manual playbook. */
export function exportAgents(dir: string): string[] {
  const files: string[] = [];
  for (const name of ROLE_NAMES) {
    const r = loadRole(name);
    const fm = [`name: forge-${name}`, `description: ${r.description}`, r.model ? `model: ${r.model}` : "", r.tools ? `tools: ${r.tools.join(", ")}` : "", r.skills?.length ? `skills: ${r.skills.join(", ")}` : ""].filter(Boolean);
    const path = join(dir, ".claude", "agents", `forge-${name}.md`);
    writeFile(path, `---\n${fm.join("\n")}\n---\n\n${r.body}\n`);
    files.push(path);
  }
  const playbook = join(dir, "FACTORY.md");
  writeFile(playbook, PLAYBOOK);
  files.push(playbook);
  return files;
}
