import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate, signature } from "../src/checks.ts";

describe("signature", () => {
  it("is stable across line numbers, durations and temp paths", () => {
    const a = "PASS x\nsrc/a.ts(12,5): error TS2322: Type 'string' is not assignable\nDone in 1.2s";
    const b = "PASS y\nsrc/a.ts(40,9): error TS2322: Type 'string' is not assignable\nDone in 9.9s";
    expect(signature("typecheck", a)).toBe(signature("typecheck", b));
  });
  it("differs for different errors", () => {
    expect(signature("test", "FAIL tests/a.test.ts")).not.toBe(signature("test", "FAIL tests/b.test.ts"));
  });
});

describe("runGate", () => {
  function pkg(scripts: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "forge-gate-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts }));
    return dir;
  }
  it("passes when every step exits 0", async () => {
    const r = await runGate(pkg({ typecheck: "echo ok", lint: "echo ok", test: "echo ok" }));
    expect(r.ok).toBe(true);
  });
  it("stops at the first failing step and reports it", async () => {
    const r = await runGate(pkg({ typecheck: "echo ok", lint: "echo 'Error: bad lint' && exit 1", test: "echo ok" }));
    expect(r).toMatchObject({ ok: false, failed: "lint" });
    expect(r.output).toContain("bad lint");
    expect(r.signature).toBeTruthy();
  });
});

describe("signature across worktrees", () => {
  it("is the same for the same error seen from different task worktrees", () => {
    const a = "/Users/x/run/.forge/wt/FIX2-3/tests/e2e/F1.spec.ts 22:1 error A require() style import is forbidden";
    const b = "/Users/x/run/.forge/wt/T7/tests/e2e/F1.spec.ts 22:1 error A require() style import is forbidden";
    expect(signature("lint", a)).toBe(signature("lint", b));
  });
});

describe("runGate missing scripts", () => {
  it("skips a gate step the project has no script for", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "forge-gate2-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { typecheck: "echo ok", test: "echo ok" } }));
    const r = await runGate(dir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("no lint script");
  });
});
