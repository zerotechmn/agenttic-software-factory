/** Interactive Claude Code sessions as office visitors (display only), fed by the console's /api/claude-events. */
export interface ClaudeEvent { ts: number; session: string; project: string; kind: "start" | "prompt" | "tool" | "stop" | "end"; tool?: string; text: string }

export type VisitorCommand =
  | { type: "spawn"; key: string; project: string }
  | { type: "go"; key: string; room: string }
  | { type: "say"; key: string; text: string }
  | { type: "leave"; key: string };

const TESTS = /\b(test|tests|vitest|jest|playwright|tsc|typecheck|lint|eslint|build|check)\b/;

/** The room that matches what the session is doing. */
export function roomFor(e: ClaudeEvent): string {
  if (e.kind !== "tool") return "lobby";
  const t = e.tool ?? "";
  if (/^(Read|Glob|Grep|LS|NotebookRead|WebSearch|WebFetch)$/.test(t) || t.startsWith("mcp__")) return "research";
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return "dev";
  if (/^(Agent|Task)$/.test(t)) return "architecture";
  if (/^(TodoWrite|Skill|EnterPlanMode|ExitPlanMode)$/.test(t)) return "product";
  if (t === "Bash") {
    const cmd = e.text.split(" · ").pop() ?? "";
    if (/^\s*git\b/.test(cmd)) return "vault";
    if (TESTS.test(cmd)) return "qa";
  }
  return "dev";
}

interface Slot { session: string; room: string; last: number; moved: number }

export class Visitors {
  private slots = new Map<string, Slot>();

  /** minDwellMs: stay in a room at least this long, so a burst of mixed tool calls doesn't make the visitor pace. */
  constructor(private max = 3, private idleMs = 10 * 60_000, private minDwellMs = 4000) {}

  keyFor(session: string): string | undefined {
    for (const [k, s] of this.slots) if (s.session === session) return k;
    return undefined;
  }

  handle(e: ClaudeEvent, now: number): VisitorCommand[] {
    let key = this.keyFor(e.session);
    if (e.kind === "end") {
      if (!key) return [];
      this.slots.delete(key);
      return [{ type: "leave", key }];
    }
    const out: VisitorCommand[] = [];
    if (!key) {
      for (let i = 1; i <= this.max && !key; i++) if (!this.slots.has(`claude:${i}`)) key = `claude:${i}`;
      if (!key) return [];
      this.slots.set(key, { session: e.session, room: "", last: now, moved: -Infinity });
      out.push({ type: "spawn", key, project: e.project });
    }
    const slot = this.slots.get(key)!;
    slot.last = now;
    const room = roomFor(e);
    // leaving the idle lobby (or going back to it) is immediate; between work rooms, dwell first
    const free = room === "lobby" || slot.room === "lobby" || slot.room === "";
    if (room !== slot.room && (free || now - slot.moved >= this.minDwellMs)) {
      slot.room = room;
      slot.moved = now;
      out.push({ type: "go", key, room });
    }
    if (e.kind === "prompt" && e.text) out.push({ type: "say", key, text: e.text });
    if (e.kind === "stop") out.push({ type: "say", key, text: "done · your turn" });
    return out;
  }

  /** Sessions with no activity for idleMs leave (a crashed or closed terminal never sends SessionEnd). */
  tick(now: number): VisitorCommand[] {
    const out: VisitorCommand[] = [];
    for (const [key, s] of this.slots) if (now - s.last > this.idleMs) { this.slots.delete(key); out.push({ type: "leave", key }); }
    return out;
  }
}
