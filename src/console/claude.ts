import type { ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

/** One interactive Claude Code session's activity, as shown in the office (display only). */
export interface ClaudeEvent { ts: number; session: string; project: string; kind: "start" | "prompt" | "tool" | "stop" | "end"; tool?: string; text: string }

const KINDS: Record<string, ClaudeEvent["kind"]> = { SessionStart: "start", UserPromptSubmit: "prompt", PreToolUse: "tool", Stop: "stop", SessionEnd: "end" };
const cut = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Reduce a raw hook payload to a short summary; everything else (file contents, responses) is dropped. */
export function summarizeHook(h: Record<string, unknown>): ClaudeEvent | null {
  const kind = KINDS[String(h.hook_event_name)];
  if (!kind || typeof h.session_id !== "string") return null;
  const cwd = typeof h.cwd === "string" ? h.cwd : "";
  const ev: ClaudeEvent = { ts: Date.now(), session: h.session_id.slice(0, 40), project: basename(cwd) || "?", kind, text: "" };
  if (kind === "prompt") ev.text = cut(h.prompt, 160);
  if (kind === "tool") {
    const i = (h.tool_input ?? {}) as Record<string, unknown>;
    ev.tool = cut(h.tool_name, 60);
    const file = typeof i.file_path === "string" ? (cwd && i.file_path.startsWith(cwd) ? relative(cwd, i.file_path) : basename(i.file_path)) : "";
    const what = cut(i.command, 120) || file || cut(i.pattern, 80) || cut(i.query, 80) || cut(i.url, 100) || cut(i.skill, 60) || cut(i.prompt, 80);
    ev.text = [cut(i.description, 60), what].filter(Boolean).join(" · ");
  }
  return ev;
}

/** In-memory recent history + a small jsonl log under <runs root>/.console, streamed to the office over SSE. */
export class ClaudeFeed {
  private recent: ClaudeEvent[] = [];
  private clients = new Set<ServerResponse>();
  private file: string;

  constructor(root: string, private keepMs = 30 * 60_000) {
    mkdirSync(join(root, ".console"), { recursive: true });
    this.file = join(root, ".console", "claude-events.jsonl");
    if (existsSync(this.file)) {
      const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean).slice(-1000);
      writeFileSync(this.file, lines.length ? lines.join("\n") + "\n" : "");
      for (const l of lines) try { this.recent.push(JSON.parse(l)); } catch { /* skip a torn line */ }
    }
  }

  add(raw: unknown): void {
    const ev = raw && typeof raw === "object" ? summarizeHook(raw as Record<string, unknown>) : null;
    if (!ev) return;
    this.recent.push(ev);
    const cutoff = Date.now() - this.keepMs;
    while (this.recent.length && (this.recent[0].ts < cutoff || this.recent.length > 500)) this.recent.shift();
    appendFileSync(this.file, JSON.stringify(ev) + "\n");
    for (const c of this.clients) c.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  subscribe(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const cutoff = Date.now() - this.keepMs;
    const history = this.recent.filter((e) => e.ts >= cutoff);
    res.write(history.length ? history.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") : ": ok\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  close(): void {
    for (const c of this.clients) c.end();
  }
}
