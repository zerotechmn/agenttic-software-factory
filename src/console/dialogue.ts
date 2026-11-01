import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * Short handoff scenes for the office: 2–3 lines between the characters at a handoff, written by a cheap model from
 * the real facts (with playful, plausible flavour), in casual Latin-letter Mongolian. Cached per run + moment, so a
 * replay plays the same scene for free. Tool-less, one turn, a few tenths of a cent.
 */

export interface Speaker { role: string; name: string }
export interface DialogueRequest { run: string; key: string; moment: string; speakers: Speaker[]; facts: string }
export interface DialogueLine { role: string; name: string; text: string }

const Lines = z.object({ lines: z.array(z.object({ role: z.string(), text: z.string().min(1).max(220) })).min(2).max(4) });

/** Catchphrases the team asked for: who always opens a line with what. */
const OPENERS: Record<string, string> = { product: "Diir, ", integrator: "Diir, ", final_reviewer: "Сайн байна өө, " };

const SYSTEM = [
  "You write tiny dialogue scenes for a pixel-art office where AI agents build software (like an RPG dialogue box).",
  "Language: casual Mongolian written in Latin letters, the way young Mongolian developers chat (e.g. \"Ene PRD-g avaarai, sain hiigeerei bro\"). Technical words stay in English (PRD, API, task, deploy, bug, review).",
  "2 or 3 short lines total, alternating speakers, each under 140 characters. Warm, funny, office banter. Use the real facts given, and you may add small made-up but plausible details (coffee, deadlines, jokes) that fit.",
  'Openers are added automatically (product and integrator start with "Diir,", final_reviewer with a Mongolian greeting): do NOT write any greeting or "Diir" yourself.',
  "Match the mood in the moment: a first rejection is friendly, repeated bugs make the speaker annoyed, then openly angry (still funny, never insulting).",
  "Latin letters only (no Cyrillic), no emoji, no markdown. Talk like people, not logs: never read out file names, paths or JSON fields; say what the work means (\"8 feature bichlee, 4 ni must\").",
  'Reply ONLY with JSON: {"lines":[{"role":"<role>","text":"..."}]}. Roles must be from the given speakers.',
].join("\n");

type QueryFn = (a: { prompt: string; options: Options }) => AsyncIterable<{ type: string; subtype?: string; result?: string; structured_output?: unknown; total_cost_usd?: number; usage?: Record<string, number> }>;

export interface DialogueUsage { scenes: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; usd: number }
export const dialogueUsageFile = (runDir: string) => join(runDir, ".forge", "dialogue-usage.json");

/** Add one generated scene's spend to the run's dialogue tally (kept apart from the build's own budget). */
export function recordDialogueUsage(runDir: string, u: Partial<DialogueUsage>): DialogueUsage {
  const file = dialogueUsageFile(runDir);
  const cur: DialogueUsage = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { scenes: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, usd: 0 };
  const next = { scenes: cur.scenes + 1, tokensIn: cur.tokensIn + (u.tokensIn ?? 0), tokensOut: cur.tokensOut + (u.tokensOut ?? 0), cacheRead: cur.cacheRead + (u.cacheRead ?? 0), cacheWrite: cur.cacheWrite + (u.cacheWrite ?? 0), usd: Math.round((cur.usd + (u.usd ?? 0)) * 1e6) / 1e6 };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

export function dialogueCache(runDir: string): string {
  return join(runDir, ".forge", "dialogue.json");
}

/** Deterministic fallback when the model is unavailable: still in the team's voice. */
export function fallbackLines(r: DialogueRequest): DialogueLine[] {
  const [a, b] = r.speakers;
  const open = (s: Speaker, t: string) => ({ role: s.role, name: s.name, text: `${OPENERS[s.role] ?? ""}${t}` });
  if (!a || !b) return [];
  return [open(a, `${r.facts.slice(0, 110)}. Ene chinii eelj!`), open(b, "Oilgoloo, odoo l ehelne. Kofeegoo uuchaad irlee.")];
}

/** House style: Latin letters only, no emoji, and each catchphrase opener added exactly once. */
export function voice(role: string, text: string): string {
  let t = text.replace(/[\u0400-\u04FF]/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim();
  t = t.replace(/^diir,?\s*/i, "").replace(/^sain baina uu,?\s*/i, "");
  return `${OPENERS[role] ?? ""}${t}`;
}

export function createDialogue(o: { runDir: (run: string) => string; queryFn?: QueryFn; model?: string }) {
  const queryFn = o.queryFn ?? (query as unknown as QueryFn);
  const inflight = new Map<string, Promise<DialogueLine[]>>();
  return async (r: DialogueRequest): Promise<DialogueLine[]> => {
    const file = dialogueCache(o.runDir(r.run));
    const cache: Record<string, DialogueLine[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (cache[r.key]) return cache[r.key];
    const id = `${r.run}:${r.key}`;
    if (inflight.has(id)) return inflight.get(id)!;
    const p = (async () => {
      const names = new Map(r.speakers.map((s) => [s.role, s.name]));
      let lines: DialogueLine[] = [];
      try {
        const prompt = [`Moment: ${r.moment}`, `Speakers (in order): ${r.speakers.map((s) => `${s.name} (role ${s.role})`).join(", ")}`, `Facts: ${r.facts.slice(0, 1500)}`].join("\n");
        const options: Options = {
          model: o.model ?? "haiku", maxTurns: 1, maxBudgetUsd: 0.05, tools: [], permissionMode: "dontAsk", settingSources: [], strictMcpConfig: true,
          systemPrompt: SYSTEM,
        };
        for await (const m of queryFn({ prompt, options })) {
          if (m.type !== "result") continue;
          const u = m.usage ?? {};
          recordDialogueUsage(o.runDir(r.run), { tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, usd: m.total_cost_usd ?? 0 });
          if (typeof m.result !== "string") continue;
          const json = m.result.match(/\{[\s\S]*\}/)?.[0];
          const parsed = json ? Lines.safeParse(JSON.parse(json)) : undefined;
          if (parsed?.success) lines = parsed.data.lines.filter((l) => names.has(l.role)).map((l) => ({ role: l.role, name: names.get(l.role)!, text: voice(l.role, l.text) }));
        }
      } catch {
        lines = [];
      }
      if (lines.length < 2) lines = fallbackLines(r);
      const fresh: Record<string, DialogueLine[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      fresh[r.key] = lines;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(fresh, null, 2));
      return lines;
    })().finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };
}
