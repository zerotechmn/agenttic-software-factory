import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export function sh(cmd: string, cwd: string, timeoutMs = 120_000): { code: number; out: string } {
  const r = spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.signal ? 124 : 1), out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function must(cmd: string, cwd: string): string {
  const r = sh(cmd, cwd);
  if (r.code !== 0) throw new Error(`git failed (${cmd}): ${r.out.slice(-800)}`);
  return r.out;
}

export function initRepo(dir: string): void {
  must("git init -q -b main", dir);
  must('git config user.name "FORGE" && git config user.email "forge@local" && git config commit.gpgsign false', dir);
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  appendFileSync(join(dir, ".git", "info", "exclude"), "\n.forge/\nnode_modules\n");
}

/** Stage everything and commit. Returns false when the tree was already clean. */
export function commitAll(dir: string, msg: string): boolean {
  must("git add -A", dir);
  if (sh("git diff --cached --quiet", dir).code === 0) return false;
  // Pass the message on stdin: a shell-quoted -m would turn newlines (and trailers) into literal "\\n".
  const r = spawnSync("git", ["commit", "-q", "--no-verify", "-F", "-"], { cwd: dir, input: msg, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git failed (commit): ${(r.stdout + r.stderr).slice(-800)}`);
  return true;
}

export function headSha(dir: string): string {
  return must("git rev-parse HEAD", dir).trim();
}

export function removeWorktree(repo: string, path: string): void {
  sh(`git worktree remove --force ${JSON.stringify(path)}`, repo);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  sh("git worktree prune", repo);
}

/** Fresh worktree on a new branch cut from main's HEAD; replaces any stale one from a crashed run. */
export function addWorktree(repo: string, branch: string, path: string): void {
  removeWorktree(repo, path);
  sh(`git branch -D ${JSON.stringify(branch)}`, repo);
  mkdirSync(dirname(path), { recursive: true });
  must(`git worktree add -q -b ${JSON.stringify(branch)} ${JSON.stringify(path)} HEAD`, repo);
}

export function mergeBranch(repo: string, branch: string, opts: { keepConflict?: boolean } = {}): { ok: boolean; conflict: boolean; out: string } {
  const r = sh(`git merge --no-ff --no-edit ${JSON.stringify(branch)}`, repo);
  if (r.code === 0) return { ok: true, conflict: false, out: r.out };
  const conflict = /CONFLICT|Automatic merge failed/.test(r.out);
  if (!opts.keepConflict) sh("git merge --abort", repo);
  return { ok: false, conflict, out: r.out };
}

/** Undo the last merge on main (orchestrator-only; main is never shared, so a reset is safe and keeps re-merge possible). */
export function revertLastMerge(repo: string): void {
  must("git reset -q --hard HEAD^1", repo);
}

export function diffStat(repo: string, from: string, to = "HEAD"): string {
  return sh(`git diff --stat ${from}..${to}`, repo).out;
}

export function changedFiles(dir: string, from: string): string[] {
  return sh(`git diff --name-only ${from}`, dir).out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** First port ≥ start that nothing is listening on (checked by binding it). */
export async function freePort(start: number, tries = 50): Promise<number> {
  const { createServer } = await import("node:net");
  for (let p = start; p < start + tries; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(false));
      s.listen(p, () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error(`no free port in ${start}..${start + tries}`);
}

/** Files that differ from `base` in the working tree: committed, staged, unstaged or untracked (ignored files excluded). */
export function changedSince(dir: string, base: string): string[] {
  const tracked = sh(`git diff --name-only ${base}`, dir).out;
  const untracked = sh("git ls-files --others --exclude-standard", dir).out;
  return [...new Set(`${tracked}\n${untracked}`.split("\n").map((s) => s.trim()).filter(Boolean))];
}

/** Put `files` back to their content at `base` (deleting files that didn't exist there). */
export function restorePaths(dir: string, base: string, files: string[]): void {
  for (const f of files) {
    const q = JSON.stringify(f);
    if (sh(`git cat-file -e ${base}:${q}`, dir).code === 0) sh(`git checkout ${base} -- ${q}`, dir);
    else sh(`git rm -q --cached --ignore-unmatch -- ${q}; rm -f -- ${q}`, dir);
  }
}

/** Recover a repo from a crash or a rogue agent: abort merges, drop stale locks, discard uncommitted changes. */
export function repairRepo(dir: string): string[] {
  const fixes: string[] = [];
  if (existsSync(join(dir, ".git", "index.lock"))) {
    rmSync(join(dir, ".git", "index.lock"), { force: true });
    fixes.push("removed stale index.lock");
  }
  if (existsSync(join(dir, ".git", "MERGE_HEAD"))) {
    sh("git merge --abort", dir);
    fixes.push("aborted an unfinished merge");
  }
  if (sh("git status --porcelain", dir).out.trim()) {
    sh("git reset -q --hard HEAD && git clean -fdq", dir);
    fixes.push("discarded uncommitted changes");
  }
  return fixes;
}

export function resetTo(dir: string, sha: string): void {
  must(`git reset -q --hard ${sha}`, dir);
}
