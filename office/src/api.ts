// All FORGE fetches. Never throws. Run routes carry the page's ?run= (withRun); console routes never do.
import { API_PATHS, RUN_PATHS, withRun } from "./shared/contracts";
import type { ApiResult, AssistantResponse, NewRunRequest, NewRunResponse, Proposal, ProposalAnswerResponse, RunAction, RunSummary } from "./shared/contracts";

export { runParam, withRun } from "./shared/contracts";

export interface NewTask { title: string; description: string }

const JSON_HEADERS = { "Content-Type": "application/json" };
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function postTask(t: NewTask): Promise<boolean> {
  const r = await post(withRun(RUN_PATHS.task), t).catch(() => null);
  return !!r?.ok;
}

export async function postSay(role: string, text: string): Promise<boolean> {
  const r = await post(withRun(RUN_PATHS.say), { role, text }).catch(() => null);
  return !!r?.ok;
}

async function result<T>(req: Promise<Response>): Promise<ApiResult<T>> {
  let r: Response;
  try { r = await req; } catch { return { ok: false, status: 0, error: "network error" }; }
  const data = await r.json().catch(() => undefined);
  if (r.ok) return { ok: true, status: r.status, data: data as T };
  const msg = (data as { error?: unknown } | undefined)?.error;
  return { ok: false, status: r.status, error: typeof msg === "string" && msg ? msg : `HTTP ${r.status}` };
}

/** null = not console mode (404, non-array body or network error). */
export async function fetchRuns(): Promise<RunSummary[] | null> {
  try {
    const r = await fetch(API_PATHS.runs);
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? (data as RunSummary[]) : null;
  } catch {
    return null;
  }
}

export function startRun(body: NewRunRequest): Promise<ApiResult<NewRunResponse>> {
  const name = body.name?.trim();
  return result(post(API_PATHS.runs, { ...(name ? { name } : {}), brief: body.brief, budget: body.budget }));
}

export function runAction(name: string, action: RunAction): Promise<ApiResult<unknown>> {
  return result(post(API_PATHS.runAction(name, action)));
}

export function askAssistant(message: string): Promise<ApiResult<AssistantResponse>> {
  return result(post(API_PATHS.assistant, { message }));
}

export async function fetchProposals(): Promise<Proposal[]> {
  try {
    const r = await fetch(API_PATHS.proposals);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? (data as Proposal[]) : [];
  } catch {
    return [];
  }
}

export function answerProposal(id: string, confirm: boolean): Promise<ApiResult<ProposalAnswerResponse>> {
  return result(post(API_PATHS.proposal(id), { confirm }));
}

/** Tests spy on `nav.assign`; panels never touch `location` directly. */
export const nav = { assign: (url: string): void => location.assign(url) };

export function switchRun(name: string): void {
  nav.assign(`${location.pathname}?run=${encodeURIComponent(name)}`);
}
