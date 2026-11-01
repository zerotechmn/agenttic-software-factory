import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type GateStep = "typecheck" | "lint" | "test" | "build" | "e2e";
export interface GateResult {
  ok: boolean;
  failed?: GateStep;
  output: string;
  signature?: string;
}

const ERR = /(error|Error|ERROR|FAIL|✗|×|failed|AssertionError)/;

/** Normalized fingerprint of a failure: same root error ⇒ same signature across retries. */
export function signature(step: string, output: string): string {
  const line = output.split("\n").find((l) => ERR.test(l)) ?? output.trim().split("\n").pop() ?? "";
  const norm = line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\S*\.forge\/wt\/[^/\s]+\//g, "<wt>/")
    .replace(/\(\d+,\d+\)/g, "(L,C)")
    .replace(/:\d+(:\d+)?/g, ":L")
    .replace(/\/(private\/)?(var|tmp)\/[^\s:'")]+/g, "<tmp>")
    .replace(/\d+(\.\d+)?\s?(ms|s)\b/g, "<t>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${step}:${norm}`;
}

function run(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    const add = (d: Buffer) => {
      out += d.toString();
      if (out.length > 2_000_000) out = out.slice(-1_000_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const t = setTimeout(() => {
      out += `\n[forge] ${cmd} timed out after ${timeoutMs / 1000}s`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out });
    });
  });
}

export async function runGate(cwd: string, steps: GateStep[] = ["typecheck", "lint", "test"], timeoutMs = 300_000): Promise<GateResult> {
  let output = "";
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
  } catch {
    // no package.json: every step will fail loudly below
  }
  for (const step of steps) {
    if (Object.keys(scripts).length && !scripts[step]) {
      output += `\n(no ${step} script; skipped)`;
      continue;
    }
    const r = await run(`npm run --silent ${step}`, cwd, timeoutMs);
    output += `\n$ npm run ${step}\n${r.out}`;
    if (r.code !== 0) return { ok: false, failed: step, output, signature: signature(step, r.out) };
  }
  return { ok: true, output };
}
