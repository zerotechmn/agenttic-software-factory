import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, commitAll, addWorktree, removeWorktree, mergeBranch, revertLastMerge, headSha, sh } from "../src/git.ts";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "forge-git-"));
  initRepo(dir);
  writeFileSync(join(dir, "a.txt"), "one\n");
  commitAll(dir, "init");
  return dir;
}

describe("git", () => {
  it("commitAll returns false when there is nothing to commit", () => {
    expect(commitAll(repo(), "noop")).toBe(false);
  });

  it("merges a clean worktree branch into main", () => {
    const dir = repo();
    const wt = join(dir, ".forge/wt/t1");
    addWorktree(dir, "t/t1", wt);
    writeFileSync(join(wt, "b.txt"), "new\n");
    expect(commitAll(wt, "t1 work")).toBe(true);
    const r = mergeBranch(dir, "t/t1");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "b.txt"), "utf8")).toBe("new\n");
    removeWorktree(dir, wt);
    expect(existsSync(wt)).toBe(false);
  });

  it("reports a conflict and leaves main clean after aborting", () => {
    const dir = repo();
    const wt = join(dir, ".forge/wt/t2");
    addWorktree(dir, "t/t2", wt);
    writeFileSync(join(wt, "a.txt"), "branch\n");
    commitAll(wt, "branch edit");
    writeFileSync(join(dir, "a.txt"), "main\n");
    commitAll(dir, "main edit");
    const r = mergeBranch(dir, "t/t2");
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect(sh("git status --porcelain", dir).out.trim()).toBe("");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("main\n");
  });

  it("addWorktree replaces a stale worktree and branch from a crashed run", () => {
    const dir = repo();
    const wt = join(dir, ".forge/wt/t3");
    addWorktree(dir, "t/t3", wt);
    writeFileSync(join(wt, "junk.txt"), "x");
    addWorktree(dir, "t/t3", wt);
    expect(existsSync(join(wt, "junk.txt"))).toBe(false);
    expect(existsSync(join(wt, "a.txt"))).toBe(true);
  });

  it("revertLastMerge restores the pre-merge tree", () => {
    const dir = repo();
    const before = headSha(dir);
    const wt = join(dir, ".forge/wt/t4");
    addWorktree(dir, "t/t4", wt);
    writeFileSync(join(wt, "c.txt"), "c\n");
    commitAll(wt, "c");
    mergeBranch(dir, "t/t4");
    revertLastMerge(dir);
    expect(existsSync(join(dir, "c.txt"))).toBe(false);
    expect(sh(`git diff ${before} --stat`, dir).out.trim()).toBe("");
  });
});

describe("git worktree node_modules", () => {
  it("never commits a node_modules symlink inside a worktree", async () => {
    const { symlinkSync, mkdirSync: mk } = await import("node:fs");
    const dir = repo();
    mk(join(dir, "node_modules"), { recursive: true });
    const wt = join(dir, ".forge/wt/t9");
    addWorktree(dir, "t/t9", wt);
    symlinkSync(join(dir, "node_modules"), join(wt, "node_modules"), "dir");
    writeFileSync(join(wt, "x.txt"), "x");
    commitAll(wt, "work");
    expect(sh("git show --name-only --format= HEAD", wt).out).not.toContain("node_modules");
  });
});

import { freePort } from "../src/git.ts";
describe("freePort", () => {
  it("skips a port that is in use", async () => {
    const net = await import("node:net");
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, () => r()));
    const busy = (s.address() as { port: number }).port;
    expect(await freePort(busy)).not.toBe(busy);
    s.close();
  });
});
