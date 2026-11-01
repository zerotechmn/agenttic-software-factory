import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventBus } from "./events.ts";
import type { Phase } from "./types.ts";

export interface Ledger {
  ruling(decision: string, why: string, costIfWrong: string, taskId?: string): void;
  note(text: string, taskId?: string): void;
}

export function ledger(projectDir: string, bus: EventBus, phase: () => Phase): Ledger {
  const dir = join(projectDir, ".forge");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "ledger.md");
  const stamp = () => new Date().toISOString().slice(11, 19);
  return {
    ruling(decision, why, costIfWrong, taskId) {
      const text = `RULING: ${decision} — ${why} — cost if wrong: ${costIfWrong}`;
      appendFileSync(file, `- ${stamp()} [${phase()}]${taskId ? ` (${taskId})` : ""} ${text}\n`);
      bus.emit({ phase: phase(), kind: "ruling", taskId, text });
    },
    note(text, taskId) {
      appendFileSync(file, `- ${stamp()} [${phase()}]${taskId ? ` (${taskId})` : ""} ${text}\n`);
      bus.emit({ phase: phase(), kind: "note", taskId, text });
    },
  };
}
