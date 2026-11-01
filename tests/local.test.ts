import { describe, it, expect } from "vitest";
import { localLLM, compressFailure } from "../src/local.ts";

const okFetch = (content: string) =>
  (async () => new Response(JSON.stringify({ message: { content } }), { status: 200 })) as unknown as typeof fetch;
const downFetch = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

describe("localLLM", () => {
  it("returns the local model's answer", async () => {
    expect(await localLLM({ prompt: "hi" }, { fetch: okFetch("hello") })).toEqual({ text: "hello", local: true });
  });
  it("falls back when Ollama is down", async () => {
    const r = await localLLM({ prompt: "hi" }, { fetch: downFetch, fallback: async () => "from-haiku" });
    expect(r).toEqual({ text: "from-haiku", local: false });
  });
  it("falls back when a schema is given and the output is not JSON", async () => {
    const r = await localLLM({ prompt: "hi", schema: { type: "object" } }, { fetch: okFetch("nope"), fallback: async () => "{}" });
    expect(r.local).toBe(false);
  });
  it("returns empty text with no fallback when Ollama is down", async () => {
    expect(await localLLM({ prompt: "hi" }, { fetch: downFetch })).toEqual({ text: "", local: false });
  });
});

describe("compressFailure", () => {
  it("returns short output unchanged", async () => {
    expect(await compressFailure("short Error: x", { fetch: downFetch })).toBe("short Error: x");
  });
  it("keeps the first error block and stays under 4000 chars", async () => {
    const noise = Array.from({ length: 400 }, (_, i) => `log line ${i} ok`).join("\n");
    const raw = `${noise}\nsrc/a.ts(3,5): Error: Type 'string' is not assignable to 'number'\n${noise}`;
    const out = await compressFailure(raw, { fetch: downFetch });
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out).toContain("Error: Type 'string' is not assignable");
  });
});
