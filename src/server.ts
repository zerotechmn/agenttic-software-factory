import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { lessonsFile } from "./lessons.ts";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { FACTORY_ROOT, loadConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { loadState } from "./state.ts";
import { addNote } from "./inbox.ts";
import { addRequest } from "./requests.ts";

export interface RunHandler {
  /** Handle a run-scoped route (/events, /state, /say, /task). Returns false if the path isn't one. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): boolean;
  close(): void;
}

/** Run-scoped API for one project dir. Live (bus) or tailing the events file (finished / other process). */
export function createRunHandler(dir: string, bus: EventBus | null): RunHandler {
  const eventsFile = join(dir, ".forge", "events.jsonl");
  const clients = new Set<ServerResponse>();
  let lastSize = 0;
  const unsubscribe = bus?.subscribe((e) => {
    for (const c of clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
  });
  // Without a live bus (forge serve on another process's run), tail the file.
  const poll = bus
    ? undefined
    : setInterval(() => {
        const all = EventBus.readAll(eventsFile);
        for (const e of all.slice(lastSize)) for (const c of clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
        lastSize = all.length;
      }, 1000);

  const handle = (req: IncomingMessage, res: ServerResponse, pathname: string): boolean => {
    const url = { pathname };
    if (url.pathname === "/task") {
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return true; }
      if (req.method !== "POST") { res.writeHead(405, cors).end(); return true; }
      let body = "";
      req.on("data", (d) => (body.length < 10_000 ? (body += d) : req.destroy()));
      req.on("end", () => {
        let msg: { title?: unknown; description?: unknown } = {};
        try {
          msg = JSON.parse(body || "{}");
        } catch {
          // validated below
        }
        const title = typeof msg.title === "string" ? msg.title.trim().slice(0, 120) : "";
        if (!title) { res.writeHead(400, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ error: "title is required" })); return; }
        const r = addRequest(dir, { title, description: typeof msg.description === "string" ? msg.description.slice(0, 2000) : undefined });
        const state = loadState(dir);
        const event = { phase: state?.phase ?? "intake", kind: "operator_task", text: title };
        if (bus) bus.emit(event);
        else new EventBus(eventsFile, state?.run ?? "unknown").emit(event);
        res.writeHead(202, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, id: r.id }));
      });
      return true;
    }
    if (url.pathname === "/say") {
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return true; }
      if (req.method !== "POST") { res.writeHead(405, cors).end(); return true; }
      let body = "";
      req.on("data", (d) => (body.length < 10_000 ? (body += d) : req.destroy()));
      req.on("end", () => {
        let msg: { role?: unknown; taskId?: unknown; text?: unknown } = {};
        try {
          msg = JSON.parse(body || "{}");
        } catch {
          // fall through to validation
        }
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 2000) : "";
        if (!text) { res.writeHead(400, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ error: "text is required" })); return; }
        const note = addNote(dir, { text, role: typeof msg.role === "string" ? msg.role : undefined, taskId: typeof msg.taskId === "string" ? msg.taskId : undefined });
        const state = loadState(dir);
        const event = { phase: state?.phase ?? "intake", kind: "operator_say", role: note.role, taskId: note.taskId, text };
        if (bus) bus.emit(event);
        else new EventBus(eventsFile, state?.run ?? "unknown").emit(event);
        res.writeHead(202, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, id: note.id }));
      });
      return true;
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
      const all = EventBus.readAll(eventsFile);
      if (!bus) lastSize = Math.max(lastSize, all.length);
      for (const e of all) res.write(`data: ${JSON.stringify(e)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return true;
    }
    if (url.pathname === "/docs") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(listDocs(dir)));
      return true;
    }
    if (url.pathname === "/doc") {
      const q = new URL(req.url ?? "/", "http://x").searchParams;
      const rel = q.get("path") ?? "";
      const doc = listDocs(dir).find((d) => d.path === rel);
      if (!doc) { res.writeHead(404).end(); return true; }
      const name = rel.split("/").pop()!;
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        ...(q.get("download") ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
      });
      res.end(readFileSync(doc.abs));
      return true;
    }
    if (url.pathname === "/state") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      const prdPath = join(dir, "docs", "prd.json");
      const cfg = loadConfig(dir);
      res.end(JSON.stringify({ ...loadState(dir), budgetUsd: cfg.budgetUsd, concurrency: cfg.concurrency, prd: existsSync(prdPath) ? JSON.parse(readFileSync(prdPath, "utf8")) : null }));
      return true;
    }
    return false;
  };
  return {
    handle,
    close: () => {
      unsubscribe?.();
      if (poll) clearInterval(poll);
      for (const c of clients) c.end();
    },
  };
}

/** The run's documents a person may read in the office vault: a fixed list, never arbitrary paths. */
export const VAULT_DOCS: { path: string; title: string; group: string }[] = [
  { path: "docs/RUN_REPORT.md", title: "Run report", group: "Report" },
  { path: "docs/metrics.json", title: "Metrics (tokens, autonomy)", group: "Report" },
  { path: ".forge/dialogue-usage.json", title: "Office scene dialogue usage (tokens, $)", group: "Report" },
  { path: ".forge/dialogue.json", title: "Office scene dialogue (all lines)", group: "Report" },
  { path: "docs/brief.md", title: "Brief", group: "Product" },
  { path: "docs/prd.md", title: "PRD", group: "Product" },
  { path: "docs/prd.json", title: "PRD (JSON)", group: "Product" },
  { path: "docs/brief-coverage.json", title: "Brief coverage (critic)", group: "Product" },
  { path: ".forge/clarify.json", title: "Questions for the client", group: "Product" },
  { path: "docs/architecture.md", title: "Architecture", group: "Design" },
  { path: "docs/design.md", title: "UI/UX design", group: "Design" },
  { path: "docs/tasks.json", title: "Task plan", group: "Design" },
  { path: "src/shared/contracts.ts", title: "API contracts", group: "Design" },
  { path: ".forge/security.json", title: "Security scan", group: "Quality" },
  { path: ".forge/deploy.json", title: "Deploy record", group: "Quality" },
  { path: "docs/DEPLOY.md", title: "Deploy guide", group: "Quality" },
  { path: ".forge/ledger.md", title: "Ledger (rulings)", group: "Logs" },
  { path: ".forge/events.jsonl", title: "Event log", group: "Logs" },
  { path: ".forge/transcripts/index.json", title: "Agent transcripts index", group: "Logs" },
];

export function listDocs(dir: string): { path: string; title: string; group: string; bytes: number; abs: string }[] {
  const out: { path: string; title: string; group: string; bytes: number; abs: string }[] = [];
  for (const d of VAULT_DOCS) {
    const abs = join(dir, d.path);
    if (existsSync(abs)) out.push({ ...d, bytes: statSync(abs).size, abs });
  }
  const qa = join(dir, ".forge", "qa");
  if (existsSync(qa)) for (const f of readdirSync(qa).filter((x) => /^round-\d+\.json$/.test(x)).sort()) {
    const abs = join(qa, f);
    out.push({ path: `.forge/qa/${f}`, title: `QA ${f.replace(".json", "").replace("-", " ")} (tests, features, visual)`, group: "Quality", bytes: statSync(abs).size, abs });
  }
  const lessons = lessonsFile();
  if (existsSync(lessons)) out.push({ path: "lessons", title: "Lessons learnt (all runs)", group: "Report", bytes: statSync(lessons).size, abs: lessons });
  return out;
}

/** Serve the built pixel office (office/dist) under /office/. Returns false if not an office path. */
export function serveOffice(res: ServerResponse, pathname: string): boolean {
  if (pathname !== "/office" && !pathname.startsWith("/office/")) return false;
  {
    const url = { pathname };
    {
      // the pixel-office monitor (office/dist, built with `npm run build` in office/)
      const rel = url.pathname.replace(/^\/office\/?/, "") || "index.html";
      const file = join(FACTORY_ROOT, "office", "dist", rel);
      const fallback = join(FACTORY_ROOT, "office", "public", rel);
      const path = existsSync(file) ? file : existsSync(fallback) ? fallback : null;
      if (!path || rel.includes("..")) { res.writeHead(404).end(); return true; }
      const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".jsonl": "text/plain", ".json": "application/json", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav" };
      res.writeHead(200, { "Content-Type": types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(readFileSync(path));
    }
  }
  return true;
}

/** SSE + JSON state + the monitor page. Works for a live run (bus) or a finished one (file replay). */
export async function startServer(dir: string, bus: EventBus | null, port: number): Promise<{ url: string; close(): Promise<void> }> {
  const run = createRunHandler(dir, bus);
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (run.handle(req, res, pathname)) return;
    if (serveOffice(res, pathname)) return;
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(FACTORY_ROOT, "monitor", "index.html"), "utf8"));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: async () => {
      run.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
