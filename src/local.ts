// Local Ollama tier for cheap one-shot chores (commit messages, failure-log compression,
// report prose). Never in the critical reasoning path: every call has a fallback.

export interface LocalOpts {
  prompt: string;
  system?: string;
  schema?: object;
  host?: string;
  model?: string;
}

export interface LocalDeps {
  fetch?: typeof fetch;
  fallback?: (prompt: string, system?: string) => Promise<string>;
}

export async function localLLM(opts: LocalOpts, deps: LocalDeps = {}): Promise<{ text: string; local: boolean }> {
  const f = deps.fetch ?? fetch;
  const host = (opts.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
  const fallback = async () => ({ text: deps.fallback ? await deps.fallback(opts.prompt, opts.system) : "", local: false });
  try {
    const res = await f(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? process.env.FORGE_LOCAL_MODEL ?? "gemma4:latest",
        messages: [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: opts.prompt }],
        stream: false,
        think: false,
        keep_alive: "30m",
        ...(opts.schema ? { format: opts.schema } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as { message?: { content?: string } };
    const text = (data.message?.content ?? "").trim();
    if (!text) return fallback();
    if (opts.schema) {
      try {
        JSON.parse(text);
      } catch {
        return fallback();
      }
    }
    return { text, local: true };
  } catch {
    return fallback();
  }
}

const ERROR_LINE = /(error|Error|ERROR|FAIL|failed|✗|×|AssertionError|TypeError|ReferenceError)/;

/** Deterministic squeeze: first error block + tail. Keeps the facts a dev needs, drops noise. */
function squeeze(raw: string): string {
  const lines = raw.split("\n");
  const first = lines.findIndex((l) => ERROR_LINE.test(l));
  const head = first >= 0 ? lines.slice(Math.max(0, first - 2), first + 25) : [];
  const tail = lines.slice(-60);
  const joined = [...head, "…", ...tail].join("\n");
  return joined.length > 3500 ? joined.slice(0, 1700) + "\n…\n" + joined.slice(-1700) : joined;
}

/**
 * Shrink failing build/test output before it is fed back to a developer agent.
 * Output ≤ 4000 chars. Uses the local model for a short diagnosis when available.
 */
export async function compressFailure(raw: string, deps: LocalDeps & { host?: string; model?: string; enabled?: boolean } = {}): Promise<string> {
  if (raw.length <= 3000) return raw;
  const core = squeeze(raw);
  if (deps.enabled === false) return ("Log excerpt:\n" + core).slice(0, 4000);
  const { text, local } = await localLLM(
    {
      system: "You triage failing build/test logs. Reply with at most 6 short lines: which test or file fails and the exact error message. No advice.",
      prompt: core,
      host: deps.host,
      model: deps.model,
    },
    { fetch: deps.fetch },
  );
  const diagnosis = local && text ? `Diagnosis (local model):\n${text.slice(0, 400)}\n\n` : "";
  return (diagnosis + "Log excerpt:\n" + core).slice(0, 4000);
}
