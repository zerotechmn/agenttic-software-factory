export type Role =
  | "product" | "architect" | "uiux" | "dev" | "reviewer" | "integrator"
  | "qa" | "final_reviewer" | "devops" | "reporter" | "researcher" | "learner" | "critic";

export const PHASES = [
  "intake", "product", "research", "design", "contract_gate", "build", "qa", "final_review", "deploy", "report",
] as const;
export type Phase = (typeof PHASES)[number] | "done";

export type TaskStatus = "backlog" | "ready" | "running" | "review" | "blocked" | "merged" | "parked";

export interface Task {
  id: string;
  title: string;
  description: string;
  deps: string[];
  lanes: string[];
  acceptance: string[];
  kind: "feature" | "fix" | "contract";
  status: TaskStatus;
  attempts: number;
  escalations: number;
  lastSignature?: string;
  branch?: string;
  featureIds: string[];
  feedback?: string;
  sessionId?: string;
  escalated?: boolean;
  /** The dev's BLOCKED concern on its latest attempt, and how many attempts in a row reported BLOCKED. */
  blocked?: string;
  blockedStreak?: number;
  /** A fix task whose lanes were wrong got src/** once. */
  lanesWidened?: boolean;
}

export interface ForgeEvent {
  ts: number;
  run: string;
  phase: Phase;
  role?: string;
  agentId?: string;
  taskId?: string;
  kind: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  usd?: number;
  sessionId?: string;
  status?: string;
  text?: string;
  data?: unknown;
}

export interface TokenCount { in: number; out: number; cacheRead: number; cacheWrite?: number; calls: number }
export interface TokenSpend extends TokenCount {
  byRole: Record<string, TokenCount>; byPhase: Record<string, TokenCount>; models: Record<string, string[]>;
  /** Per exact model id (from the SDK's modelUsage), with the SDK's cost estimate: what to compare with the Anthropic Console. */
  byModel?: Record<string, TokenCount & { usd: number }>;
}
export interface Intervention { at: number; kind: "note" | "task" | "resume" | "retry_parked" | "iterate" | "manual_commit"; text?: string }

export interface QaRound {
  round: number;
  score: number;
  failures: number;
}

export interface RunState {
  run: string;
  phase: Phase;
  startedAt: number;
  baseSha?: string;
  /** Last main commit the orchestrator made or verified; anything else on main is rogue or un-gated. */
  mainSha?: string;
  tasks: Task[];
  qaRounds: QaRound[];
  /** Operator change requests (forge iterate): they override the PRD and brief where they conflict. */
  changeRequests?: string[];
  /** QA round in which the whole-app design pass was queued (once per run). */
  designPassRound?: number;
  spend: { usd: number; byRole: Record<string, number>; byPhase: Record<string, number>; local: number; remote: number; tokens?: TokenSpend };
  /** Human actions on this run (steering or hands-on), for the autonomy metric. */
  interventions?: Intervention[];
  /** Lesson changes the learner made at the end of this run. */
  learned?: { added: string[]; reinforced: string[]; contradicted: string[]; promotable: string[] };
  landing: boolean;
  done: Phase[];
  /** Operator note ids already delivered to an agent. */
  inboxDelivered?: string[];
  /** Failure signature → distinct task ids that hit it (systemic-failure breaker). */
  failureSpread?: Record<string, string[]>;
  /** Set when the breaker trips; the build halts for a human. */
  systemicHalt?: string;
  /** Operator backlog request ids already turned into tasks. */
  requestsTaken?: string[];
}
