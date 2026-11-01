import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeHook, ClaudeFeed } from "../src/console/claude.ts";
import { startConsole } from "../src/console/server.ts";

const hook = (o: Record<string, unknown>) => ({ session_id: "s1", cwd: "/Users/x/factory", ...o });

describe("summarizeHook", () => {
  it("keeps only a short, display-safe summary of each hook event", () => {
    expect(summarizeHook(hook({ hook_event_name: "UserPromptSubmit", prompt: "fix the bug " + "x".repeat(500) }))).toMatchObject({ session: "s1", kind: "prompt", project: "factory" });
    expect(summarizeHook(hook({ hook_event_name: "UserPromptSubmit", prompt: "x".repeat(500) }))!.text.length).toBeLessThanOrEqual(160);
    const t = summarizeHook(hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test", description: "Run tests" } }))!;
    expect(t).toMatchObject({ kind: "tool", tool: "Bash", text: "Run tests · npm test" });
    expect(summarizeHook(hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/Users/x/factory/src/a.ts" } }))!.text).toBe("src/a.ts");
    expect(summarizeHook(hook({ hook_event_name: "Stop" }))!.kind).toBe("stop");
    expect(summarizeHook(hook({ hook_event_name: "SessionEnd" }))!.kind).toBe("end");
    expect(summarizeHook({ nope: 1 })).toBeNull();
  });
});

describe("console claude feed", () => {
  it("accepts hook posts and streams them (with recent history) over SSE", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-"));
    const srv = await startConsole({ root, port: 0, spawn: () => {}, claude: new ClaudeFeed(root) });
    try {
      const post = (b: unknown) => fetch(`${srv.url}/api/claude-event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      expect((await post(hook({ hook_event_name: "UserPromptSubmit", prompt: "hello" }))).status).toBe(204);
      expect((await post({ junk: true })).status).toBe(204); // never error back to a hook
      const res = await fetch(`${srv.url}/api/claude-events`);
      const reader = res.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toContain('"text":"hello"');
      await post(hook({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "foo" } }));
      const next = new TextDecoder().decode((await reader.read()).value);
      expect(next).toContain('"tool":"Grep"');
      await reader.cancel();
    } finally {
      await srv.close();
    }
  });
});
