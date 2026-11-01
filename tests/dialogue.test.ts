import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDialogue, dialogueCache } from "../src/console/dialogue.ts";

const req = { run: "r1", key: "prd-design", moment: "PRD handed to design", speakers: [{ role: "product", name: "Erka" }, { role: "architect", name: "Sunny Boy" }], facts: "Yoga booking, 8 features" };

describe("handoff dialogue", () => {
  it("asks the model once per run+moment, forces Erka's 'Diir,' and caches the scene", async () => {
    const root = mkdtempSync(join(tmpdir(), "dlg-"));
    let calls = 0;
    const queryFn = async function* () {
      calls++;
      yield { type: "result", subtype: "success", result: '{"lines":[{"role":"product","text":"PRD-g avaarai bro"},{"role":"architect","text":"Za, task bolgoj huvaaya"},{"role":"nobody","text":"x"}]}' };
    };
    const d = createDialogue({ runDir: (run) => join(root, run), queryFn: queryFn as never });
    const lines = await d(req);
    expect(lines).toEqual([
      { role: "product", name: "Erka", text: "Diir, PRD-g avaarai bro" },
      { role: "architect", name: "Sunny Boy", text: "Za, task bolgoj huvaaya" },
    ]);
    expect(await d(req)).toEqual(lines);
    expect(calls).toBe(1);
    expect(existsSync(dialogueCache(join(root, "r1")))).toBe(true);
  });

  it("falls back to a scripted scene when the model fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "dlg-"));
    const queryFn = async function* () { throw new Error("offline"); };
    const lines = await createDialogue({ runDir: (run) => join(root, run), queryFn: queryFn as never })(req);
    expect(lines).toHaveLength(2);
    expect(lines[0].text.startsWith("Diir, ")).toBe(true);
  });
});

describe("voice", () => {
  it("keeps Diir for Erka and Ginkhma only, Latin letters, no emoji", async () => {
    const { voice } = await import("../src/console/dialogue.ts");
    expect(voice("architect", "Diir, avlaa ☕")).toBe("avlaa");
    expect(voice("integrator", "merge hiilee")).toBe("Diir, merge hiilee");
    expect(voice("product", "ene 4 nь must")).toBe("Diir, ene 4 n must");
    expect(voice("final_reviewer", "release-g zovshoorloo")).toBe("Сайн байна өө, release-g zovshoorloo");
  });
});


describe("dialogue usage", () => {
  it("tallies tokens and dollars per run, separately from the build", async () => {
    const { createDialogue, dialogueUsageFile } = await import("../src/console/dialogue.ts");
    const { readFileSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "dlg-"));
    const queryFn = async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0.0021, usage: { input_tokens: 300, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 }, result: '{"lines":[{"role":"product","text":"a"},{"role":"architect","text":"b"}]}' };
    };
    const d = createDialogue({ runDir: (run) => join(root, run), queryFn: queryFn as never });
    await d(req);
    await d({ ...req, key: "plan-devs" });
    await d(req);
    expect(JSON.parse(readFileSync(dialogueUsageFile(join(root, "r1")), "utf8"))).toEqual({ scenes: 2, tokensIn: 600, tokensOut: 180, cacheRead: 0, cacheWrite: 2400, usd: 0.0042 });
  });
});
