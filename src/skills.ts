import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import type { RoleDef } from "./roles.ts";
import { sh } from "./git.ts";
import { FACTORY_ROOT } from "./config.ts";

/**
 * Where skills are copied from: the skills bundled in this repo (skills/, with their licenses), so every machine
 * gets the same agents. FORGE_SKILL_ROOTS (colon-separated) adds more folders after them, e.g. ~/.claude/skills.
 */
export function roots(): string[] {
  const extra = process.env.FORGE_SKILL_ROOTS ? process.env.FORGE_SKILL_ROOTS.split(":").filter(Boolean) : [];
  return [join(FACTORY_ROOT, "skills"), ...extra];
}

/** Skills that no root provides (reported once per process, so a missing one is never silent). */
export function missingSkills(names: string[]): string[] {
  return names.filter((n) => !roots().some((r) => existsSync(join(r, n, "SKILL.md"))));
}
const warned = new Set<string>();

/** Stack-dependent extras: game/canvas skills only when the project actually uses Pixi. */
const PIXI_EXTRAS: Partial<Record<string, string[]>> = {
  dev: ["pixijs", "pixi-v8-pixel-games", "game-feel", "game-ai"],
  architect: ["pixijs", "pixi-v8-pixel-games"],
  uiux: ["pixi-v8-pixel-games", "game-feel"],
};

export function skillsFor(role: RoleDef, cwd: string): string[] {
  const base = role.skills ?? [];
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    // no package.json yet
  }
  const extras = "pixi.js" in deps ? (PIXI_EXTRAS[role.name] ?? []) : [];
  return [...new Set([...base, ...extras])];
}

/** Copy the named skills into `<cwd>/.claude/skills/` (git-ignored). Returns the names available there. */
export function installSkills(cwd: string, names: string[]): string[] {
  const dest = join(cwd, ".claude", "skills");
  const got: string[] = [];
  for (const name of names) {
    const target = join(dest, name);
    if (existsSync(join(target, "SKILL.md"))) {
      got.push(name);
      continue;
    }
    const src = roots().map((r) => join(r, name)).find((p) => existsSync(join(p, "SKILL.md")));
    if (!src) {
      if (!warned.has(name)) process.stderr.write(`forge: skill "${name}" not found in ${roots().join(", ")}\n`);
      warned.add(name);
      continue;
    }
    mkdirSync(dest, { recursive: true });
    cpSync(src, target, { recursive: true });
    got.push(name);
  }
  if (got.length) ignoreInGit(cwd);
  return got;
}

/** Every skill available (bundled + FORGE_SKILL_ROOTS), optionally filtered by a search term. */
export function listAllSkills(query = ""): { name: string; description: string }[] {
  const seen = new Map<string, string>();
  for (const r of roots()) {
    if (!existsSync(r)) continue;
    for (const name of readdirSync(r)) {
      const f = join(r, name, "SKILL.md");
      if (seen.has(name) || !existsSync(f)) continue;
      const m = readFileSync(f, "utf8").match(/^description:\s*(.*)$/m);
      seen.set(name, (m?.[1] ?? "").replace(/^["']|["']$/g, "").slice(0, 200));
    }
  }
  const q = query.toLowerCase();
  return [...seen].filter(([n, d]) => !q || n.toLowerCase().includes(q) || d.toLowerCase().includes(q)).map(([name, description]) => ({ name, description })).sort((a, b) => a.name.localeCompare(b.name));
}

function ignoreInGit(cwd: string): void {
  const r = sh("git rev-parse --git-common-dir", cwd);
  if (r.code !== 0) return; // not a git repo (e.g. the assistant workspace)
  const common = r.out.trim();
  if (!common) return;
  const exclude = join(common.startsWith("/") ? common : join(cwd, common), "info", "exclude");
  const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!text.includes(".claude/skills/")) {
    mkdirSync(join(exclude, ".."), { recursive: true });
    appendFileSync(exclude, "\n.claude/skills/\n");
  }
}
