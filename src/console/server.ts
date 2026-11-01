import { fallbackLines, type DialogueLine, type DialogueRequest, type Speaker } from "./dialogue.ts";
import { spawn as spawnProc } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { openSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { FACTORY_ROOT } from "../config.ts";
import { createRunHandler, serveOffice, type RunHandler } from "../server.ts";
import { listRuns, runDir, runStatus, startRun, actions } from "./runs.ts";
import { listProposals, resolveProposal } from "./assistant.ts";
import type { ClaudeFeed } from "./claude.ts";

export interface ConsoleOptions {
  root: string;
  port: number;
  /** Launch the forge CLI with these args (detached). Injected in tests. */
  spawn?: (args: string[]) => void;
  /** The assistant: one chat turn. */
  ask?: (message: string) => Promise<{ reply: string; usd: number }>;
  /** Live activity of interactive Claude Code sessions (posted by scripts/claude-hook.sh). */
  claude?: ClaudeFeed;
  /** Writes the short handoff scenes the office plays (cached per run). */
  dialogue?: (r: DialogueRequest) => Promise<DialogueLine[]>;
}

export function defaultSpawn(root: string) {
  return (args: string[]) => {
    const out = args[args.indexOf("--out") + 1] ?? join(root, args[1] ?? "run");
    const log = openSync(`${out}.log`, "a");
    const child = spawnProc(join(FACTORY_ROOT, "forge"), args, { detached: true, stdio: ["ignore", log, log], env: { ...process.env, FORGE_PROBE_MIN: process.env.FORGE_PROBE_MIN ?? "30" } });
    child.unref();
  };
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage, max = 50_000) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let body = "";
    req.on("data", (d) => (body.length < max ? (body += d) : req.destroy()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });

/** The operator console: start/watch/steer runs and chat with the factory assistant, all on one port. */
export async function startConsole(o: ConsoleOptions): Promise<{ url: string; close(): Promise<void> }> {
  const spawn = o.spawn ?? defaultSpawn(o.root);
  const handlers = new Map<string, RunHandler>();
  const handlerFor = (name: string) => {
    let h = handlers.get(name);
    if (!h) {
      h = createRunHandler(runDir(o.root, name), null);
      handlers.set(name, h);
    }
    return h;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    try {
      if (p === "/") {
        res.writeHead(302, { Location: "/office/" }).end();
        return;
      }
      if (serveOffice(res, p)) return;
      if (p === "/api/runs" && req.method === "GET") return json(res, 200, listRuns(o.root).map(({ dir: _d, ...r }) => r));
      if (p === "/api/runs" && req.method === "POST") {
        const b = await readBody(req);
        if (typeof b.brief !== "string" || !b.brief.trim()) return json(res, 400, { error: "brief is required" });
        const r = startRun(o.root, { name: typeof b.name === "string" ? b.name : undefined, brief: b.brief, budget: Number(b.budget ?? 10), from: typeof b.from === "string" ? b.from : undefined }, spawn);
        return json(res, 201, { name: r.name });
      }
      const m = p.match(/^\/api\/runs\/([^/]+)\/(status|resume|stop)$/);
      if (m) {
        const [, name, action] = m;
        if (action === "status") return json(res, 200, runStatus(o.root, name));
        if (req.method !== "POST") return json(res, 405, { error: "POST" });
        if (action === "stop") actions.stop(o.root, name);
        else spawn(["resume", runDir(o.root, name), "--no-serve"]);
        return json(res, 202, { ok: true });
      }
      if (p === "/api/claude-event" && req.method === "POST") {
        // hooks must never fail or wait: accept anything, keep only a summary
        o.claude?.add(await readBody(req, 2_000_000));
        res.writeHead(204).end();
        return;
      }
      if (p === "/api/claude-events" && req.method === "GET") {
        if (!o.claude) return json(res, 404, { error: "claude feed not enabled" });
        return o.claude.subscribe(res);
      }
      if (p === "/api/proposals" && req.method === "GET") return json(res, 200, listProposals(o.root));
      const pm = p.match(/^\/api\/proposals\/([^/]+)$/);
      if (pm && req.method === "POST") {
        const b = await readBody(req);
        return json(res, 200, { result: resolveProposal(o.root, pm[1], b.confirm === true, spawn) });
      }
      if (p === "/api/dialogue" && req.method === "POST") {
        const b = await readBody(req);
        const run = typeof b.run === "string" && /^[\w.-]{1,80}$/.test(b.run) ? b.run : listRuns(o.root)[0]?.name;
        const speakers = Array.isArray(b.speakers) ? (b.speakers as unknown[]).filter((s): s is Speaker => !!s && typeof (s as Speaker).role === "string" && typeof (s as Speaker).name === "string").slice(0, 3) : [];
        if (!run || typeof b.key !== "string" || speakers.length < 2) return json(res, 400, { error: "run, key and two speakers are required" });
        const reqd: DialogueRequest = { run, key: b.key.slice(0, 80), moment: String(b.moment ?? "").slice(0, 200), speakers, facts: String(b.facts ?? "").slice(0, 1500) };
        if (!o.dialogue) return json(res, 200, { lines: fallbackLines(reqd) });
        return json(res, 200, { lines: await o.dialogue(reqd) });
      }
      if (p === "/api/assistant" && req.method === "POST") {
        const b = await readBody(req);
        if (typeof b.message !== "string" || !b.message.trim()) return json(res, 400, { error: "message is required" });
        if (!o.ask) return json(res, 503, { error: "assistant not configured" });
        return json(res, 200, await o.ask(b.message.slice(0, 8000)));
      }
      if (["/events", "/state", "/say", "/task", "/docs", "/doc"].includes(p)) {
        const name = url.searchParams.get("run") ?? listRuns(o.root)[0]?.name;
        if (!name) return json(res, 404, { error: "no runs yet" });
        if (handlerFor(name).handle(req, res, p)) return;
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(o.port, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const h of handlers.values()) h.close();
      o.claude?.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
