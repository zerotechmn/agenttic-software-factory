import { describe, expect, it } from "vitest";
import { formatDoctor, runDoctor } from "../src/doctor.ts";

describe("forge doctor", () => {
  it("checks the API key against the API and finds every role skill bundled", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const seen: string[] = [];
    try {
      const checks = await runDoctor({ ports: [], fetch: async (url) => { seen.push(url); return { ok: false, status: 401 }; } });
      const key = checks.find((c) => c.name === "ANTHROPIC_API_KEY")!;
      expect(key.ok).toBe(false);
      expect(key.detail).toContain("401");
      expect(seen[0]).toContain("api.anthropic.com/v1/models");
      expect(checks.find((c) => c.name === "role skills bundled")!.ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("only failures block a run; warnings don't", () => {
    expect(formatDoctor([{ name: "Docker", ok: false, level: "warn", detail: "not running", fix: "start it" }]).ok).toBe(true);
    const r = formatDoctor([{ name: "key", ok: false, level: "fail", detail: "not set", fix: "set it" }]);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("→ set it");
  });
});
