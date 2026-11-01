# 03 — Local model tier (Ollama + Gemini CLI) for the agentic factory

Researched 2026-10-16 on Apple M4 / 16 GB, Ollama 0.34.4, Gemini CLI 0.27.4. Nothing was pulled and no config was changed.
"VERIFIED" means it was tested with curl on this machine. "DOCS" means it comes from docs.ollama.com or geminicli.com. "SECONDARY" means blogs or listicles, so treat those with caution.

## 1. Ollama API surface (VERIFIED)

| Endpoint | URL | Status |
|---|---|---|
| Native | `POST http://localhost:11434/api/chat`, `/api/generate`, `/api/embed` | works |
| **Anthropic Messages** | `POST http://localhost:11434/v1/messages` | **works**: the reply has Anthropic shape, `stop_reason`, and `usage` |
| OpenAI Chat | `POST http://localhost:11434/v1/chat/completions` | works |
| Version | `GET /api/version` | `{"version":"0.34.4"}` |

**Claude Code / Agent SDK env vars (DOCS, docs.ollama.com/integrations/claude-code):**
```
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=""
```
There is also a one-shot launcher: `ollama launch claude --model <m> --yes -- -p "..."`.
Docs recommend at least **64k context** for local models used with Claude Code. Set `num_ctx` in a Modelfile or with `OLLAMA_CONTEXT_LENGTH`, because the loaded context defaults to 4096 (`ollama ps` showed CONTEXT 4096).

**Anthropic-compat gaps (DOCS):** no `tool_choice`, no `cache_control` prompt caching, no `count_tokens`, no batches, no citations, no PDF blocks. Images must be base64. `budget_tokens` is accepted but not enforced. A missing `tool_choice` means you can't force a tool call, so prompt for one or use `format` instead.

### Tool-calling test results (VERIFIED)
| Model | `/v1/messages` with a tool | `/v1/chat/completions` with a tool |
|---|---|---|
| qwen2.5-coder:7b | **FAIL**: emitted the tool call as *plain text JSON* (`{"name":"get_weather",...}`) with `stop_reason: end_turn` and no `tool_use` block | **FAIL**: same, and the JSON was malformed (unquoted name) |
| gemma4:latest (E4B) | **PASS**: proper `tool_use` block, `stop_reason: tool_use`, plus a `thinking` block | (not tested) |

`ollama show` lists `tools` for qwen2.5-coder, but its chat template doesn't produce structured calls in practice. **Don't use qwen2.5-coder for agent loops.**

### Structured output (VERIFIED, qwen2.5-coder:7b)
- Native `format: {json schema}` on `/api/chat` returned `{ "category": "docs", "confidence": 1.0 }`, which is valid and enum-respecting.
- OpenAI `response_format: {type: json_schema, json_schema:{schema}}` returned `{"category": "feature"}`, which is valid.
- This is grammar-constrained decoding, so the output is valid JSON every time. Use it for classification and routing instead of tool calls.

### Embeddings
`/api/embed` with qwen2.5-coder returned `"This server does not support embeddings"` because it's a generative model. You need a dedicated embedding model (see §2d).

## 2. Model picks for a 16 GB M4 (Oct 2026)

Budget: about 10 GB for one model alongside the dev tools. Ollama library sizes were fetched live from ollama.com. Memory free was 24% with gemma4 E4B loaded.

| Use | Pick | Size | Notes |
|---|---|---|---|
| (a) code edits / small functions | **gemma4:e4b** (already installed as `gemma4:latest`) | 6.6–9.5 GB disk, ~3.2 GB resident at 4k ctx (measured) | Measured **29 tok/s**. Real tool calls, thinking toggle (`think:false` for speed), 128K ctx. Alternatives: **gemma4:12b** (8.0 GB q4, 256K ctx, smarter, expect ~15–18 tok/s, SECONDARY/estimate), **qwen3.5:9b** (6.6–7.6 GB, 256K ctx). The current SOTA coders (qwen3.6:27b-coding 17–19 GB, qwen3-coder:30b ~19 GB, gemma4:26b-a4b 16–19 GB) do **not** fit in 16 GB alongside dev tools. |
| (b) summarization / log triage / commit messages | **gemma4:e4b** with `think:false`, or qwen3.5:4b (3.3–4.0 GB) | | Small and fast, and good enough for summaries. |
| (c) JSON classification / routing | **qwen3.5:4b** or **gemma4:e4b** with `format: <schema>` | | Constrained decoding makes the output valid. Accuracy on a fixed label set is fine. granite4:3b-h (1.9 GB) is an ultra-cheap option. |
| (d) embeddings for RAG | **embeddinggemma:300m** (622 MB, or 239 MB qat-q4) as the default; **qwen3-embedding:0.6b** (639 MB, 32K ctx) for longer chunks | | embeddinggemma has only 2K ctx, so chunk to ~1.5K tokens. qwen3-embedding:4b (2.5 GB) gives higher quality if RAM allows. nomic-embed-text (274 MB) is the old default. |

The installed `rafw007/gemma4-e4b-claude-coder` is a community Modelfile over the same gemma4 E4B weights (same 8.0B/Q4_K_M) with a Claude-Code system prompt, `<|think|>` forced, and num_ctx 65536. It's convenient for `ANTHROPIC_BASE_URL` experiments, but it adds no new capability. The two 9.6 GB entries share most of their blobs.

Speed expectations on M4 / 120 GB/s: ~4B-active models run at 25–35 tok/s, 7–9B dense at 18–25 tok/s, 12B at ~12–18 tok/s (estimate). Prompt processing ran at **~95 tok/s** for qwen 7B (measured, short prompt). That's the real bottleneck for agentic use (below).

## 3. Measured speed (VERIFIED)
- **qwen2.5-coder:7b**: 20 tokens in 0.96 s = **20.9 tok/s**, and 200 tokens = **20.9 tok/s**. Prompt eval ~95 tok/s. Cold load took 5.6 s.
- **gemma4:e4b** (`think:false`): 61 tokens = **29.0 tok/s**.
- Models unload after 5 minutes idle (`OLLAMA_KEEP_ALIVE`).

## 4. What to delegate locally and what stays on Claude

**Running Claude Code itself against a local model is a poor fit.** Claude Code's system prompt plus tool schemas are ~15–25k tokens. At ~100–300 tok/s prompt eval, that's roughly 1–4 minutes before the first token on every uncached turn, and Ollama's Anthropic shim ignores `cache_control`. 4–8B models also lose track of multi-step tool loops. Treat local models as **single-shot workers called by the Claude orchestrator** (Agent SDK custom tool / MCP tool that curls `/api/chat`), not as the agent loop.

Safe to run locally (each has a deterministic check or is low-stakes):
- Commit messages and PR descriptions drafted from a diff (Claude or a human glances at it)
- Log and test-output triage: "which test failed, extract the stack trace, one-line cause guess"
- Summarizing long files or tool output before it goes into Claude's context (big token saver)
- JSON classification and routing: task type, file-area tagging, priority, with `format` schema
- Embeddings and RAG retrieval over local docs
- Boilerplate with a verifier: docstrings, simple unit-test scaffolds, type stubs, renames, lint fixes. Gate each on `tsc`/tests passing and fall back to Claude on failure
- Dashboard narration and status text for the visualization

Keep on Claude:
- Planning, task decomposition, architecture, cross-file refactors
- Any multi-step agent loop with tools (local tool calling is fragile, and qwen2.5-coder fails outright)
- Debugging non-obvious failures, security-sensitive code, final code review / merge gates
- Anything without an automatic verifier. 7B-class models produce plausible but wrong code often enough that unverified output costs more in Claude rework than it saves

Pattern: **local first, verify, escalate.** Log every escalation so you can show "% of tasks handled locally" in the demo.

## 5. Gemini CLI

- Headless: `gemini -p "prompt" -o json` (also `-o stream-json`) returns `{response, stats}`. `-m <model>` picks the model. `--approval-mode default|auto_edit|yolo` (`plan` needs `experimental.plan`), and `-y` sets yolo. Stdin is prepended: `git diff | gemini -p "review this" -o json`.
- **Free tier is effectively gone.** geminicli.com/docs quota page: "Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026." The old free limit was 1,000 requests/day. This machine's auth is `oauth-personal`, and a trivial `gemini -p "Reply with exactly: OK" -o json` **hung for more than 3 minutes with no output** (VERIFIED), consistent with the free tier no longer being served. `~/.gemini/antigravity*` dirs exist, but `agy` isn't on PATH. Secondary sources disagree on whether Antigravity CLI (`agy`, closed-source) keeps a free Flash quota.
- Verdict: **don't build the hackathon plan on Gemini CLI free tier.** If it's needed, use a paid `GEMINI_API_KEY` (`gemini` works with API keys, and per secondary sources paid API/Vertex were unaffected) or install `agy` and re-test. As a *second-opinion reviewer* a different-family model is genuinely useful (it catches correlated Claude blind spots). As a *bulk worker* it now costs money or is quota-capped, so the local tier is the cheap bulk worker.

## 6. Claude Code and local/OpenAI-compatible models (2026)

- Ollama ≥ ~0.14 exposes `/v1/messages` natively, so **no LiteLLM is needed** for Ollama. Point `ANTHROPIC_BASE_URL` at it (env vars above), or run `ollama launch claude`. Check with `/status` in Claude Code, because settings.json env can override shell vars.
- Model names: Claude Code sends Claude model ids. Either pass `--model <ollama-tag>` or alias with `ollama cp qwen3-coder claude-3-5-sonnet` (DOCS example). `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL`-style overrides can map only the background/small-model calls to a local model. Verify the exact var names in the current Claude Code settings docs before relying on them.
- LiteLLM proxy is still the route for OpenAI-only backends (vLLM, LM Studio's OpenAI endpoint, OpenRouter) and for per-request routing between Claude and local models through one URL.
- Ollama Cloud (`ANTHROPIC_BASE_URL=https://ollama.com`, token = `OLLAMA_API_KEY`) offers bigger open models (gemma4:31b-cloud, qwen3.5 cloud, kimi/glm code models) as a mid tier, but it's off-machine.

## Recommended setup

```
# one-time (only when you decide to; not done here)
ollama pull embeddinggemma:300m        # 622 MB, RAG
ollama pull qwen3.5:4b                 # optional ~3.5 GB router/summarizer
# keep gemma4:latest (= e4b) as the worker; delete qwen2.5-coder:7b (broken tool calls) if disk/RAM matters
export OLLAMA_KEEP_ALIVE=30m OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_CONTEXT_LENGTH=16384
```
- The orchestrator (Claude Agent SDK) exposes a `local_llm` tool, `{task, input, schema?}`, that calls `http://localhost:11434/api/chat` with `model: gemma4:e4b`, `think:false`, and `format: schema` when structured output is needed.
- Resident memory: gemma4 E4B (~3–5 GB at 16k ctx) plus embeddinggemma (~0.6 GB) fits easily in 16 GB alongside dev tools. Upgrade to gemma4:12b (8 GB) if quality is lacking and RAM allows.
- Escalate to Claude Haiku/Sonnet when a verifier fails or confidence is low.

## Sources
- https://docs.ollama.com/api/anthropic-compatibility
- https://docs.ollama.com/integrations/claude-code
- https://ollama.com/library (gemma4, qwen3.5, qwen3.6, qwen3-coder, qwen3-embedding, embeddinggemma, gpt-oss, ministral-3, granite4 tag pages, fetched 2026-10-16)
- https://geminicli.com/docs/resources/quota-and-pricing/
- https://geminicli.com/docs/cli/tutorials/automation/ (headless)
- SECONDARY: https://amux.io/guides/gemini-cli-to-antigravity-cli/ , https://letsdatascience.com/news/google-replaces-gemini-cli-with-antigravity-cli-574b2056 , https://www.morphllm.com/best-ollama-models
