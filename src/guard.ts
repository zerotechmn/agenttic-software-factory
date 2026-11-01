import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

export interface GuardPolicy {
  /** Agent's working root; relative paths resolve against it. */
  root: string;
  /** Absolute directories the agent may write into. */
  writable: string[];
  /** Root-relative globs that stay read-only even inside writable dirs. */
  readonlyGlobs: string[];
  /** If set, the only root-relative paths this role may write. */
  writableGlobs?: string[];
  /** If set, Read/Glob/Grep may only look inside these dirs (for roles that handle untrusted web content). */
  readRoots?: string[];
  /** Extra absolute dirs bash may reference (e.g. the main checkout's node_modules). */
  readable?: string[];
  allowBash: boolean;
}

export type GuardDecision = { allow: true } | { allow: false; reason: string };

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const BANNED_BASH: [RegExp, string][] = [
  [/\bgit\s+push\b/, "git push is not allowed; the orchestrator owns integration"],
  [/\bsudo\b/, "sudo is not allowed"],
  [/\bcurl\b[^|]*\|\s*(ba|z)?sh\b/, "piping downloads into a shell is not allowed"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~)(\s|$)/, "recursive delete of / or ~ is not allowed"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/, "destructive git commands are not allowed; ask the orchestrator"],
  [/\bgit\s+(checkout|switch)\s+(main|master)\b/, "do not switch branches; stay on your task branch"],
];
const SAFE_ABS = ["/tmp", "/dev/null", "/dev/stdout", "/dev/stderr", "/usr/bin", "/bin", "/opt/homebrew", "/usr/local"];

export function matchesGlob(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${re}$`);
}

/** realpath of the deepest existing ancestor + the not-yet-existing rest (macOS /var → /private/var). */
function canonical(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) {
    rest.unshift(basename(cur));
    cur = dirname(cur);
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return resolve(p);
  }
}

const inside = (dir: string, p: string) => {
  const rel = relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function checkWritePath(policy: GuardPolicy, filePath: string): GuardDecision {
  const abs = canonical(resolve(policy.root, filePath));
  if (!policy.writable.some((d) => inside(canonical(d), abs))) {
    return { allow: false, reason: `${filePath} is outside your writable area (${policy.writable.join(", ")})` };
  }
  const rel = relative(canonical(policy.root), abs);
  if (policy.writableGlobs && !policy.writableGlobs.some((g) => globToRegExp(g).test(rel))) {
    return { allow: false, reason: `${rel} is not one of the files your role may write (${policy.writableGlobs.join(", ")})` };
  }
  const hit = policy.readonlyGlobs.find((g) => globToRegExp(g).test(rel));
  if (hit) return { allow: false, reason: `${rel} is read-only for your role (${hit}); report the needed change instead` };
  return { allow: true };
}

const WRITE_OP = /(>>?|\btee\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\brm\b|\bmv\b|\bcp\b|\btouch\b|\bgit\s+(checkout|restore|apply|am|rm|mv)\b|\btruncate\b)/;

function staticPrefix(glob: string): string {
  const i = glob.indexOf("*");
  return (i < 0 ? glob : glob.slice(0, i)).replace(/\/$/, "");
}

/** Drop redirections that never touch project files (stderr/stdout to /dev/null, fd duplication). */
const stripHarmlessRedirects = (c: string) => c.replace(/\d*>>?\s*\/dev\/(null|stdout|stderr)/g, " ").replace(/\d*>&\d/g, " ");

/**
 * Drop the bodies of `cat`/`tee` heredocs: they are file contents, not commands. Without this, a dev writing
 * `import { db } from "../db/client.ts"` looks like a write outside the worktree. Interpreter heredocs
 * (`python3 - <<EOF`, `bash <<EOF`) run their body, so those stay.
 */
export const stripFileHeredocs = (c: string) => c.replace(/(\b(?:cat|tee)\b[^\n]*?<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, "$1");

function checkBash(policy: GuardPolicy, rawCommand: string): GuardDecision {
  if (!policy.allowBash) return { allow: false, reason: "your role has no shell access" };
  const command = stripHarmlessRedirects(rawCommand);
  for (const [re, reason] of BANNED_BASH) if (re.test(command)) return { allow: false, reason };
  if (/(^|[\s=:'"])~\//.test(command) || /\$\{?HOME\b/.test(command)) return { allow: false, reason: "home-directory paths are outside your project" };
  if (/\bgit\b[^|;&]*\s-C\s/.test(command) || /\bgit\b[^|;&]*--(git-dir|work-tree)/.test(command)) {
    return { allow: false, reason: "run git only in your own working directory" };
  }
  if (/\bgit\b[^|;&]*\b(reset|rebase|update-ref|branch\s+-[dDfm])\b/.test(command)) return { allow: false, reason: "history-rewriting git commands are not allowed" };
  // Relative paths that climb out of the working root (resolved from the root and from any `cd` target in the command).
  const bases = [policy.root];
  for (const m of command.matchAll(/\bcd\s+([^\s;&|]+)/g)) bases.push(resolve(bases[bases.length - 1], m[1].replace(/^['"]|['"]$/g, "")));
  const rootC = canonical(policy.root);
  const shell = stripFileHeredocs(command);
  for (const tok of WRITE_OP.test(shell) ? shell.match(/(?:^|[\s'"=])((?:\.\.\/)+[^\s'";|&<>()]*)/g) ?? [] : []) {
    const rel = tok.trim().replace(/^['"=]/, "");
    const ok = bases.some((b) => inside(rootC, canonical(b)) && inside(rootC, canonical(resolve(b, rel))));
    if (!ok) return { allow: false, reason: `${rel} is outside your working directory` };
  }
  // Best-effort: shell writes to protected files (the orchestrator also restores them after every attempt).
  if (WRITE_OP.test(shell) && policy.readonlyGlobs.length) {
    const root = canonical(policy.root);
    for (const tok of shell.split(/[\s'";|&<>()]+/)) {
      if (!tok || tok.startsWith("-") || tok.includes("=")) continue;
      const abs = canonical(resolve(policy.root, tok));
      if (!inside(root, abs)) continue;
      const rel = relative(root, abs);
      if (rel && (matchesGlob(rel, policy.readonlyGlobs) || policy.readonlyGlobs.some((g) => staticPrefix(g) === rel))) {
        return { allow: false, reason: `${rel} is read-only for your role` };
      }
    }
  }
  const home = homedir();
  for (const token of command.match(/(?<![\w.-])\/[^\s'";|&<>()]+/g) ?? []) {
    if (SAFE_ABS.some((s) => token === s || token.startsWith(s + "/"))) continue;
    const t = canonical(token);
    if (policy.writable.some((d) => inside(canonical(d), t)) || inside(canonical(policy.root), t)) continue;
    if (policy.readable?.some((d) => inside(canonical(d), t))) continue;
    if (token.startsWith(home) || token.startsWith("/Users") || token.startsWith("/etc") || token.startsWith("/var")) {
      return { allow: false, reason: `${token} is outside your project` };
    }
  }
  return { allow: true };
}

export function checkTool(policy: GuardPolicy, toolName: string, input: Record<string, unknown>): GuardDecision {
  if (WRITE_TOOLS.has(toolName)) {
    const p = (input.file_path ?? input.notebook_path) as string | undefined;
    return p ? checkWritePath(policy, p) : { allow: false, reason: "missing file_path" };
  }
  if (toolName === "Bash") {
    if (input.run_in_background) return { allow: false, reason: "background shell jobs are not allowed: run commands in the foreground with a bounded runtime (servers are started by the orchestrator)" };
    return checkBash(policy, String(input.command ?? ""));
  }
  if (policy.readRoots && (toolName === "Read" || toolName === "Glob" || toolName === "Grep")) {
    const target = String(input.file_path ?? input.path ?? policy.root);
    const abs = canonical(resolve(policy.root, target));
    if (!policy.readRoots.some((d) => inside(canonical(d), abs))) return { allow: false, reason: `${target} is outside what your role may read` };
  }
  return { allow: true };
}

/** PreToolUse hook enforcing the policy; fires in every permission mode, unlike canUseTool. */
/** `rtk rewrite`: the token-saving equivalent of a shell command, or null (no equivalent, rtk missing, error). */
export function rtkRewrite(command: string, bin = process.env.FORGE_RTK_BIN ?? "rtk"): string | null {
  const r = spawnSync(bin, ["rewrite", command], { encoding: "utf8", timeout: 3000 });
  if (r.error || (r.status !== 0 && r.status !== 3)) return null;
  const out = r.stdout.trim();
  return out && out !== command ? out : null;
}

export function guardHooks(
  policy: GuardPolicy,
  onDeny?: (tool: string, reason: string) => void,
  /** Optional Bash rewrite (rtk), applied only to commands the guard already allowed. */
  rewrite?: (command: string) => string | null,
): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return {};
            const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
            const d = checkTool(policy, input.tool_name, toolInput);
            if (d.allow) {
              const cmd = input.tool_name === "Bash" && typeof toolInput.command === "string" ? toolInput.command : null;
              const rewritten = cmd && rewrite ? rewrite(cmd) : null;
              if (!rewritten) return {};
              return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...toolInput, command: rewritten } } };
            }
            onDeny?.(input.tool_name, d.reason);
            return {
              hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason },
            };
          },
        ],
      },
    ],
  };
}
