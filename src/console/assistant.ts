import { createSdkMcpServer, query, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { QueryFn } from "../agent.ts";
import { FACTORY_ROOT } from "../config.ts";
import { guardHooks } from "../guard.ts";
import { parseRole } from "../roles.ts";
import { installSkills, listAllSkills } from "../skills.ts";
import { actions, listRuns, runDir, runStatus, slug, startRun } from "./runs.ts";

interface AssistantState { sessionId?: string; skills: string[] }

const statePath = (root: string) => join(root, ".console", "assistant.json");
const loadAs = (root: string): AssistantState => {
  try {
    return JSON.parse(readFileSync(statePath(root), "utf8"));
  } catch {
    return { skills: [] };
  }
};
const saveAs = (root: string, s: AssistantState) => {
  mkdirSync(join(root, ".console"), { recursive: true });
  writeFileSync(statePath(root), JSON.stringify(s, null, 2));
};

/** A spending action the assistant proposed; it runs only when the operator confirms it in the console. */
export interface Proposal { id: string; kind: "start" | "resume"; run: string; brief?: string; budget?: number; from?: string; at: string }

const propPath = (root: string) => join(root, ".console", "proposals.json");
export const listProposals = (root: string): Proposal[] => {
  try {
    return JSON.parse(readFileSync(propPath(root), "utf8"));
  } catch {
    return [];
  }
};
const saveProps = (root: string, p: Proposal[]) => {
  mkdirSync(join(root, ".console"), { recursive: true });
  writeFileSync(propPath(root), JSON.stringify(p, null, 2));
};
function propose(root: string, p: Omit<Proposal, "id" | "at">): Proposal {
  const all = listProposals(root);
  const full = { ...p, id: `P-${Date.now().toString(36)}${all.length}`, at: new Date().toISOString() };
  saveProps(root, [...all, full]);
  return full;
}

/** Operator's decision on a proposal (the console's Confirm / Dismiss buttons). */
export function resolveProposal(root: string, id: string, confirm: boolean, spawn: (args: string[]) => void): string {
  const all = listProposals(root);
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error(`no proposal ${id}`);
  saveProps(root, all.filter((x) => x.id !== id));
  if (!confirm) return `dismissed ${p.kind} ${p.run}`;
  if (p.kind === "start") return `started run ${startRun(root, { name: p.run, brief: p.brief ?? "", budget: p.budget ?? 10, from: p.from }, spawn).name} (budget $${p.budget ?? 10})`;
  spawn(["resume", runDir(root, p.run), "--no-serve"]);
  return `resuming ${p.run}`;
}

/** The assistant's actions: the same safe functions the console UI uses. */
export function assistantOps(root: string, spawn: (args: string[]) => void) {
  return {
    list_runs: () => listRuns(root).map(({ dir: _d, ...r }) => r),
    run_status: (run: string) => runStatus(root, run),
    start_run: (name: string, brief: string, budget = 10, from?: string) => {
      const run = slug(name);
      if (listRuns(root).some((r) => r.name === run)) throw new Error(`run ${run} already exists`);
      return `proposed starting run ${run} (budget $${budget}); the operator must click Confirm in the console (${propose(root, { kind: "start", run, brief, budget, from }).id})`;
    },
    add_backlog: (run: string, title: string, description?: string) => (actions.addBacklog(root, run, title, description), `queued "${title}" for ${run}`),
    send_note: (run: string, role: string | undefined, text: string) => (actions.note(root, run, role, text), `note queued for ${role ?? "the next agent"} in ${run}`),
    iterate_run: (run: string, items: string[]) => `added ${actions.iterate(root, run, items).map((t) => t.id).join(", ")} to ${run}; call resume_run to build them`,
    resume_run: (run: string) => (runDir(root, run), `proposed resuming ${run}; the operator must click Confirm in the console (${propose(root, { kind: "resume", run }).id})`),
    stop_run: (run: string) => (actions.stop(root, run), `stop requested for ${run} (halts at the next checkpoint)`),
    list_skills: (q = "") => listAllSkills(q).slice(0, 40),
    enable_skill: (name: string) => {
      if (!listAllSkills().some((s) => s.name === name)) return `no skill named ${name}; try list_skills`;
      const s = loadAs(root);
      if (!s.skills.includes(name)) s.skills.push(name);
      saveAs(root, s);
      return `enabled ${name}; available from the next message`;
    },
    enabledSkills: () => loadAs(root).skills,
  };
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1).slice(0, 20000) }] });
const safe = <A extends unknown[]>(fn: (...a: A) => unknown) => async (...a: A) => {
  try {
    return text(fn(...a));
  } catch (e) {
    return { ...text(`error: ${(e as Error).message}`), isError: true };
  }
};

const FORGE_TOOLS = ["list_runs", "run_status", "start_run", "add_backlog", "send_note", "iterate_run", "resume_run", "stop_run", "list_skills", "enable_skill"];

export function createAssistant(o: { root: string; spawn: (args: string[]) => void; queryFn?: QueryFn; model?: string }) {
  const ops = assistantOps(o.root, o.spawn);
  const role = parseRole("dev", readFileSync(join(FACTORY_ROOT, "roles", "assistant.md"), "utf8"));
  const workspace = join(o.root, ".console", "workspace");
  mkdirSync(workspace, { recursive: true });
  const forge = createSdkMcpServer({
    name: "forge",
    tools: [
      tool("list_runs", "List all factory runs (newest first) with phase, spend and product.", {}, safe(() => ops.list_runs())),
      tool("run_status", "Diagnosis inputs for one run: phase, tasks, spend, rulings, recent ledger, last QA failures.", { run: z.string() }, safe(({ run }: { run: string }) => ops.run_status(run))),
      tool("start_run", "Propose a new factory run from a brief (markdown). The operator confirms it with a button in the console.", { name: z.string(), brief: z.string(), budget: z.number().optional(), from: z.string().optional().describe("existing app dir to improve") }, safe(({ name, brief, budget, from }: { name: string; brief: string; budget?: number; from?: string }) => ops.start_run(name, brief, budget, from))),
      tool("add_backlog", "Queue a backlog item for a run (picked up during its build).", { run: z.string(), title: z.string(), description: z.string().optional() }, safe(({ run, title, description }: { run: string; title: string; description?: string }) => ops.add_backlog(run, title, description))),
      tool("send_note", "Send a note to a role's next agent call in a run.", { run: z.string(), role: z.string().optional(), text: z.string() }, safe(({ run, role, text: t }: { run: string; role?: string; text: string }) => ops.send_note(run, role, t))),
      tool("iterate_run", "Add improvement tasks to a run (reopens build). Then propose resume_run.", { run: z.string(), items: z.array(z.string()).min(1) }, safe(({ run, items }: { run: string; items: string[] }) => ops.iterate_run(run, items))),
      tool("resume_run", "Propose resuming a stopped or finished run (the operator confirms it in the console).", { run: z.string() }, safe(({ run }: { run: string }) => ops.resume_run(run))),
      tool("stop_run", "Ask a run to stop at its next checkpoint.", { run: z.string() }, safe(({ run }: { run: string }) => ops.stop_run(run))),
      tool("list_skills", "Search the skills bundled with FORGE.", { query: z.string().optional() }, safe(({ query: q }: { query?: string }) => ops.list_skills(q ?? ""))),
      tool("enable_skill", "Enable an installed skill for this assistant (from the next message).", { name: z.string() }, safe(({ name }: { name: string }) => ops.enable_skill(name))),
    ],
  });
  const queryFn = o.queryFn ?? (query as unknown as QueryFn);

  return async (message: string): Promise<{ reply: string; usd: number }> => {
    const st = loadAs(o.root);
    const skills = installSkills(workspace, [...new Set([...(role.skills ?? []), ...st.skills])]);
    const options: Options = {
      cwd: workspace,
      model: o.model ?? role.model ?? "sonnet",
      maxTurns: role.maxTurns,
      maxBudgetUsd: 1,
      // no bypass: only the listed tools are pre-approved, everything else is denied without asking
      permissionMode: "dontAsk",
      allowedTools: [...(role.tools ?? []), "Skill", "mcp__forge__*", ...FORGE_TOOLS.map((t) => `mcp__forge__${t}`)],
      settingSources: ["project"],
      strictMcpConfig: true,
      // the role file says ~/factory and ~/forge-runs: give it this machine's real folders
      systemPrompt: { type: "preset", preset: "claude_code", append: role.body.replaceAll("~/factory", FACTORY_ROOT).replaceAll("~/forge-runs", o.root), excludeDynamicSections: true },
      tools: [...(role.tools ?? []), "Skill"],
      skills,
      mcpServers: { forge },
      additionalDirectories: [FACTORY_ROOT, o.root],
      // read-only, and only inside the factory and the runs: never the rest of the machine
      hooks: guardHooks({ root: workspace, writable: [], readonlyGlobs: ["**"], readRoots: [FACTORY_ROOT, o.root, workspace], allowBash: false }),
      ...(st.sessionId ? { resume: st.sessionId } : {}),
    };
    let reply = "";
    let usd = 0;
    for await (const m of queryFn({ prompt: message, options })) {
      if (m.type === "result") {
        reply = "result" in m && typeof m.result === "string" ? m.result : `(${m.subtype})`;
        usd = m.total_cost_usd ?? 0;
        saveAs(o.root, { ...loadAs(o.root), sessionId: m.session_id });
      }
    }
    return { reply: reply || "(no reply)", usd };
  };
}

export const assistantExists = () => existsSync(join(FACTORY_ROOT, "roles", "assistant.md"));
