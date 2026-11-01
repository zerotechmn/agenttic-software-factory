import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { caps, commitMain, emit, ensureMain, hooksFor, type Ctx } from "./ctx.ts";
import { mergeBranch, sh } from "./git.ts";
import { depsPrompt } from "./prompts.ts";
import { loadRole } from "./roles.ts";
import { DependencyDecision, type PackageRequest } from "./schemas.ts";
import type { Task } from "./types.ts";

/**
 * A developer asks for npm packages in its status JSON; the architect decides from npm facts; the orchestrator
 * installs approved ones on main (developers can't: node_modules is shared with main) and merges main into the
 * task's branch, so the developer continues in the same session with the package available.
 */

export const MAX_PACKAGE_REQUESTS = 2;
const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Swappable in tests: npm lookups and installs need the network. */
export const depsIO = {
  async facts(name: string, dir: string): Promise<string> {
    const v = sh(`npm view ${name} version license deprecated --json`, dir, 30_000);
    if (v.code !== 0) return "not found on npm";
    const dl: { downloads?: number } = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ downloads?: number }>) : {}))
      .catch(() => ({}));
    return `${v.out.trim().replace(/\s+/g, " ")}${dl.downloads !== undefined ? `, ${dl.downloads} downloads last week` : ""}`;
  },
  install(specs: string[], dir: string): { ok: boolean; out: string } {
    // type packages are build-time only
    const types = specs.filter((s) => s.startsWith("@types/"));
    const runtime = specs.filter((s) => !types.includes(s));
    for (const [list, flag] of [[runtime, ""], [types, " --save-dev"]] as const) {
      if (!list.length) continue;
      const r = sh(`npm install --save-exact${flag} --no-audit --no-fund ${list.join(" ")}`, dir, 300_000);
      if (r.code !== 0) return { ok: false, out: r.out };
    }
    return { ok: true, out: "" };
  },
};

/** Runs under the merge lock. Returns the feedback the developer continues with. */
export async function handlePackages(ctx: Ctx, t: Task, wt: string, requests: PackageRequest[]): Promise<string> {
  const valid = requests.filter((r) => NAME.test(r.name));
  const lines = requests.filter((r) => !NAME.test(r.name)).map((r) => `- ${r.name}: not a valid npm package name`);
  const installed = Object.keys(pkgDeps(ctx.dir));
  const fresh = valid.filter((r) => !installed.includes(r.name));
  for (const r of valid) if (installed.includes(r.name)) lines.push(`- ${r.name}: already installed; import it`);
  if (!fresh.length) return answer(lines);

  const asked = await Promise.all(fresh.map(async (r) => ({ ...r, facts: await depsIO.facts(r.name, ctx.dir) })));
  emit(ctx, { kind: "note", taskId: t.id, text: `${t.id} asks for ${asked.map((r) => r.name).join(", ")}; architect deciding` });
  const role = loadRole("architect");
  const res = await ctx.runner.run({
    role: "architect",
    taskId: t.id,
    cwd: ctx.dir,
    prompt: depsPrompt(t, asked),
    model: ctx.cfg.models.architect,
    ...caps(ctx, "architect", Math.min(role.maxTurns, 6)),
    schema: DependencyDecision,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [], readonlyGlobs: ["**"], allowBash: false }, "architect", t.id),
  });
  const parsed = DependencyDecision.safeParse(res.output);
  if (!res.ok || !parsed.success) {
    ctx.ledger.note(`dependency request from ${t.id} undecided (${res.error ?? "invalid output"})`, t.id);
    return answer([...lines, `- ${fresh.map((r) => r.name).join(", ")}: the architect couldn't decide; build it with what's installed`]);
  }

  const approved = parsed.data.decisions.filter((d) => d.approve && fresh.some((r) => r.name === d.name) && VERSION.test(d.version));
  for (const d of parsed.data.decisions.filter((d) => !approved.includes(d))) {
    lines.push(`- ${d.name}: rejected. ${d.reason}${d.alternative ? ` Use instead: ${d.alternative}` : ""}`);
    ctx.ledger.ruling(`reject ${d.name} for ${t.id}`, d.reason, "the developer builds it without that package", t.id);
  }
  if (approved.length) {
    ensureMain(ctx);
    const inst = depsIO.install(approved.map((d) => `${d.name}@${d.version}`), ctx.dir);
    if (!inst.ok) {
      sh("git checkout -- package.json package-lock.json", ctx.dir);
      lines.push(`- ${approved.map((d) => d.name).join(", ")}: approved, but npm install failed (${inst.out.trim().split("\n").slice(-2).join(" ")}); build it with what's installed`);
    } else {
      const env = [...new Set(approved.flatMap((d) => d.envVars))];
      addEnvExample(ctx.dir, env, t.id);
      const list = approved.map((d) => `${d.name}@${d.version}`).join(", ");
      commitMain(ctx, `build(deps): add ${list} for ${t.id}\n\nForge-Task: ${t.id}\nForge-Role: architect\nForge-Phase: build`, ["package.json", "package-lock.json", ".env.example"]);
      const merged = mergeBranch(wt, "main");
      if (!merged.ok) sh("git merge --abort", wt);
      for (const d of approved) {
        lines.push(`- ${d.name}@${d.version}: installed. ${d.usage}${d.envVars.length ? ` Needs ${d.envVars.join(", ")} (in .env.example): without it, show a clear message instead of failing.` : ""}`);
        ctx.ledger.ruling(`install ${d.name}@${d.version} for ${t.id}`, d.reason, "one more dependency to maintain", t.id);
      }
      if (!merged.ok) lines.push("- (main could not be merged into your branch automatically; the package is in node_modules, so import it anyway)");
    }
  }
  return answer(lines);
}

function answer(lines: string[]): string {
  return `The architect answered your package request:\n${lines.join("\n")}\nContinue the task in your lanes and run \`npm run check\` before you finish. Don't ask for these packages again.`;
}

function pkgDeps(dir: string): Record<string, string> {
  try {
    const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...p.dependencies, ...p.devDependencies };
  } catch {
    return {};
  }
}

function addEnvExample(dir: string, vars: string[], taskId: string): void {
  const file = join(dir, ".env.example");
  const have = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = vars.filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v) && !new RegExp(`^${v}=`, "m").test(have));
  if (missing.length) appendFileSync(file, `${have && !have.endsWith("\n") ? "\n" : ""}# added for ${taskId} (free tier or trial key; the app works without it)\n${missing.map((v) => `${v}=`).join("\n")}\n`);
}
