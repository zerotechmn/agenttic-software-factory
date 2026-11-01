import { AGENT_LOG_CAP } from "./shared/contracts";
import type { AgentLogApi, ForgeEvent } from "./shared/contracts";

/** Raw events per agent key, newest first, capped. */
export class AgentLog implements AgentLogApi {
  private logs = new Map<string, ForgeEvent[]>();

  push(key: string, e: ForgeEvent): void {
    const l = this.logs.get(key) ?? [];
    l.unshift(e);
    if (l.length > AGENT_LOG_CAP) l.length = AGENT_LOG_CAP;
    this.logs.set(key, l);
  }

  /** Forget a key's history (a visitor slot is reused by the next session). */
  clear(key: string): void {
    this.logs.delete(key);
  }

  get(key: string): ForgeEvent[] {
    return [...(this.logs.get(key) ?? [])];
  }
}
