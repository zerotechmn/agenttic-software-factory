import type { TaskRow } from "./board";
import type { OfficeHooksExtra } from "./shared/contracts";

export interface AgentState { key: string; mode: string; x: number; y: number; tag?: string }

/** Test hooks on window.__office (Playwright + QA). Every getter returns live values. */
export interface OfficeHooks extends OfficeHooksExtra {
  tasks(): TaskRow[];
  agents(): AgentState[];
  zoom(): number;
  openBoard(): void;
  /** Play a beer run for a character (demo/testing). */
  beer(key?: string): void;
  /** The full-window task board (Board, Handoffs, Timeline). */
  openKanban(tab?: "board" | "handoffs" | "timeline"): void;
  openAgent(key: string): void;
  room(name: string): string;
}

export function installHooks(h: OfficeHooks): void {
  (window as unknown as { __office: OfficeHooks }).__office = h;
}
