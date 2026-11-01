import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { caps, commitMain, commitMessage, emit, hooksFor, writeFile, type Ctx } from "../ctx.ts";
import { freePort, sh } from "../git.ts";
import { devopsPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { DeployReport } from "../schemas.ts";

export const DEPLOY_PORT = 8800; // above QA (8790) and e2e (8799) ports, so later QA runs never kill a deployed app
export const DEVOPS_GLOBS = ["Dockerfile", ".dockerignore", "docs/DEPLOY.md"];

export async function deploy(ctx: Ctx): Promise<void> {
  const role = loadRole("devops");
  const image = `forge-${(ctx.dir.split("/").pop() ?? "app").toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  const wanted = requestedPort(ctx.dir);
  // A redeploy (iterate/resume) replaces this run's own container on the same port, so the demo URL stays the same.
  const own = wanted ? undefined : hostPort(sh(`docker ps --filter name=^${image}$ --format '{{.Ports}}'`, ctx.dir).out);
  const port = wanted ?? own ?? (await freePort(DEPLOY_PORT));
  if (own) ctx.ledger.note(`redeploy on port ${own}, where this run's app already runs`);
  if (wanted) {
    ctx.ledger.note(`deploy on port ${wanted}, as the brief asks`);
    // An earlier FORGE demo (forge-* container) holding the client's port is ours to stop; anything else is left alone.
    const holder = sh(`docker ps --filter publish=${wanted} --format '{{.Names}}'`, ctx.dir).out.trim().split("\n")[0];
    if (holder && holder.startsWith("forge-") && holder !== image) {
      sh(`docker stop ${holder}`, ctx.dir, 60_000);
      ctx.ledger.ruling(`stopped ${holder}`, `an earlier FORGE demo held port ${wanted}, which the brief asks for`, `restart it with: docker start ${holder}`);
    }
  }
  const res = await ctx.runner.run({
    role: "devops",
    cwd: ctx.dir,
    prompt: devopsPrompt(image, port),
    model: ctx.cfg.models.devops,
    ...caps(ctx, "devops", role.maxTurns),
    schema: DeployReport,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: [...DEVOPS_GLOBS, ".forge/deploy.log"], allowBash: true }, "devops"),
  });
  const report: DeployReport = res.ok ? (res.output as DeployReport) : { ok: false, method: "node", notes: `devops agent failed: ${res.error}` };
  const url = report.url ?? `http://localhost:${port}`;
  // The health check is the source of truth, not the agent's self-report.
  const verified = await healthy(url);
  const record = { ...report, ok: verified, agentOk: report.ok, url, verified, image, at: new Date().toISOString() };
  writeFile(join(ctx.dir, ".forge", "deploy.json"), JSON.stringify(record, null, 2));
  emit(ctx, { kind: "deploy", status: verified ? "ok" : "fail", text: verified ? url : report.notes.slice(0, 200) });
  if (!verified) ctx.ledger.ruling("finish without a running deploy", report.notes.slice(0, 200), "demo must use `npm run build && npm start`");
  commitMain(ctx, await commitMessage(ctx, "chore: deploy", "deploy files"), DEVOPS_GLOBS);
}

/** The host port in `docker ps` output like "0.0.0.0:8800->8787/tcp, [::]:8800->8787/tcp". */
export function hostPort(dockerPorts: string): number | undefined {
  const m = dockerPorts.match(/:(\d+)->8787\b/);
  return m ? Number(m[1]) : undefined;
}

async function healthy(url: string): Promise<boolean> {
  try {
    const r = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** A deploy port the client asked for ("deploy it on 4004 port", "port: 3000"), from the brief or the PRD. */
export function requestedPort(dir: string): number | undefined {
  const texts: string[] = [];
  for (const f of ["docs/brief.md", ".forge/brief.md"]) if (existsSync(join(dir, f))) texts.push(readFileSync(join(dir, f), "utf8"));
  try {
    const prd = JSON.parse(readFileSync(join(dir, "docs", "prd.json"), "utf8")) as { deploy?: { port?: number } };
    if (prd.deploy?.port) return prd.deploy.port;
  } catch {
    // no PRD yet
  }
  for (const t of texts) {
    const m = t.match(/\bport\s*(?:number\s*)?[:#=]?\s*(\d{2,5})\b/i) ?? t.match(/\b(\d{2,5})\s*(?:port|порт)\b/i) ?? t.match(/localhost:(\d{2,5})\b/i);
    const n = m ? Number(m[1]) : NaN;
    if (n >= 1024 && n <= 65535) return n;
  }
  return undefined;
}
