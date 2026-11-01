import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentRequest, AgentResult, AgentRunner } from "./agent.ts";
import type { Ledger } from "./ledger.ts";
import type { RunState } from "./types.ts";

export interface OperatorNote {
  id: string;
  ts: number;
  role?: string;
  taskId?: string;
  text: string;
}

export const inboxPath = (dir: string) => join(dir, ".forge", "inbox.jsonl");

export function addNote(dir: string, note: Omit<OperatorNote, "id" | "ts">): OperatorNote {
  const full: OperatorNote = { id: randomUUID(), ts: Date.now(), ...note };
  mkdirSync(dirname(inboxPath(dir)), { recursive: true });
  appendFileSync(inboxPath(dir), JSON.stringify(full) + "\n");
  return full;
}

export function readNotes(dir: string): OperatorNote[] {
  if (!existsSync(inboxPath(dir))) return [];
  return readFileSync(inboxPath(dir), "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as OperatorNote];
    } catch {
      return [];
    }
  });
}

/** Decorates a runner: undelivered operator notes for this role/task are appended to the next dispatch, once. */
export class InboxRunner implements AgentRunner {
  constructor(private dir: string, private inner: AgentRunner, private state: RunState, private ledger: Ledger, private save: () => void) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    const delivered = new Set(this.state.inboxDelivered ?? []);
    const due = readNotes(this.dir).filter(
      (n) => !delivered.has(n.id) && (!n.role || n.role === req.role) && (!n.taskId || n.taskId === req.taskId),
    );
    if (due.length) {
      this.state.inboxDelivered = [...delivered, ...due.map((n) => n.id)];
      for (const n of due) this.ledger.note(`operator → ${req.role}${req.taskId ? ` (${req.taskId})` : ""}: ${n.text.slice(0, 200)}`, req.taskId);
      this.save();
      req = {
        ...req,
        prompt: `${req.prompt}\n\n## Operator notes (from the human running the factory; follow them unless they conflict with the frozen contracts)\n${due.map((n) => `- ${n.text}`).join("\n")}`,
      };
    }
    return this.inner.run(req);
  }
}
