import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ForgeEvent } from "./types.ts";

type Listener = (e: ForgeEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  constructor(private file: string, private run: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  emit(e: Omit<ForgeEvent, "ts" | "run">): ForgeEvent {
    const event = { ts: Date.now(), run: this.run, ...e } as ForgeEvent;
    appendFileSync(this.file, JSON.stringify(event) + "\n");
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // a broken listener must never take the pipeline down
      }
    }
    return event;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  static readAll(file: string): ForgeEvent[] {
    if (!existsSync(file)) return [];
    const out: ForgeEvent[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // partial line from a crash; skip
      }
    }
    return out;
  }
}
