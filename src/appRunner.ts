import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AppHandle } from "./ctx.ts";
import { sh } from "./git.ts";

/** Build main and start it in production mode on `port` with a throwaway QA database. */
export async function startApp(dir: string, port: number): Promise<AppHandle> {
  // Only the process LISTENING on the port: plain `lsof -ti tcp:PORT` also lists clients (including us).
  sh(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null; true`, dir);
  const b = sh("npm run build", dir, 300_000);
  if (b.code !== 0) throw new Error(`build failed before QA:\n${b.out.slice(-2000)}`);
  const db = join(dir, ".forge", "qa.db");
  for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
  const child = spawn("npm", ["start"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), DATABASE_URL: db, NODE_ENV: "production" },
    detached: true,
    stdio: "ignore",
  });
  const url = `http://localhost:${port}`;
  const stop = async () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { url, stop };
      // front-end-only apps (no API): the page itself answering is healthy enough
      if (r.status === 404 && (await fetch(`${url}/`, { signal: AbortSignal.timeout(1000) })).ok) return { url, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  throw new Error(`app did not become healthy on ${url} within 60s`);
}
