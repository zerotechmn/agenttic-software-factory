import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_ROOT } from "./config.ts";
import type { Role } from "./types.ts";

export const ROLE_NAMES = ["product", "researcher", "architect", "uiux", "dev", "reviewer", "integrator", "qa", "final_reviewer", "devops"] as const satisfies readonly Role[];

export interface RoleDef {
  name: Role;
  model?: string;
  maxTurns: number;
  /** Per-call wall-clock cap in minutes (heavy roles). */
  timeoutMin?: number;
  tools?: string[];
  /** Skills this role may use (copied into its working dir; all others stay hidden). */
  skills?: string[];
  /** MCP servers (keys of src/mcp.ts) this role gets. */
  mcp?: string[];
  description: string;
  body: string;
}

export function parseRole(name: Role, text: string): RoleDef {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`role ${name}: missing frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    name,
    model: meta.model || undefined,
    maxTurns: Number(meta.maxTurns ?? 40),
    timeoutMin: meta.timeoutMin ? Number(meta.timeoutMin) : undefined,
    tools: meta.tools ? meta.tools.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    skills: meta.skills ? meta.skills.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    mcp: meta.mcp ? meta.mcp.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    description: meta.description ?? name,
    body: m[2].trim(),
  };
}

export function loadRole(name: Role): RoleDef {
  return parseRole(name, readFileSync(join(FACTORY_ROOT, "roles", `${name}.md`), "utf8"));
}
