import { describe, it, expect } from "vitest";
import { roomFor, Visitors, type ClaudeEvent } from "../../src/visitors";

const ev = (o: Partial<ClaudeEvent>): ClaudeEvent => ({ ts: 0, session: "a", project: "factory", kind: "tool", text: "", ...o });

describe("roomFor", () => {
  it("sends a session to the room that matches what it is doing", () => {
    expect(roomFor(ev({ tool: "Read" }))).toBe("research");
    expect(roomFor(ev({ tool: "Grep" }))).toBe("research");
    expect(roomFor(ev({ tool: "WebSearch" }))).toBe("research");
    expect(roomFor(ev({ tool: "mcp__context7__query-docs" }))).toBe("research");
    expect(roomFor(ev({ tool: "Edit" }))).toBe("dev");
    expect(roomFor(ev({ tool: "Write" }))).toBe("dev");
    expect(roomFor(ev({ tool: "Bash", text: "Run tests · npx vitest run" }))).toBe("qa");
    expect(roomFor(ev({ tool: "Bash", text: "npm run typecheck" }))).toBe("qa");
    expect(roomFor(ev({ tool: "Bash", text: "git log --oneline" }))).toBe("vault");
    expect(roomFor(ev({ tool: "Bash", text: "ls src" }))).toBe("dev");
    expect(roomFor(ev({ tool: "Agent" }))).toBe("architecture");
    expect(roomFor(ev({ tool: "TodoWrite" }))).toBe("product");
    expect(roomFor(ev({ kind: "stop" }))).toBe("lobby");
    expect(roomFor(ev({ kind: "prompt" }))).toBe("lobby");
  });
});

describe("Visitors", () => {
  it("gives each session its own visitor slot, moves it per event and frees the slot on end", () => {
    const v = new Visitors(2, 600_000, 0);
    const a = v.handle(ev({ session: "s1", kind: "prompt", text: "fix it" }), 0);
    expect(a).toEqual([{ type: "spawn", key: "claude:1", project: "factory" }, { type: "go", key: "claude:1", room: "lobby" }, { type: "say", key: "claude:1", text: "fix it" }]);
    // same room twice: no new walk
    expect(v.handle(ev({ session: "s1", tool: "Read", text: "src/a.ts" }), 1)).toContainEqual({ type: "go", key: "claude:1", room: "research" });
    expect(v.handle(ev({ session: "s1", tool: "Grep", text: "foo" }), 2).some((c) => c.type === "go")).toBe(false);
    expect(v.handle(ev({ session: "s2", kind: "start" }), 3)[0]).toEqual({ type: "spawn", key: "claude:2", project: "factory" });
    expect(v.handle(ev({ session: "s3", kind: "start" }), 4)).toEqual([]); // no free slot
    expect(v.handle(ev({ session: "s1", kind: "end" }), 5)).toEqual([{ type: "leave", key: "claude:1" }]);
    expect(v.handle(ev({ session: "s3", kind: "start" }), 6)[0]).toEqual({ type: "spawn", key: "claude:1", project: "factory" });
  });
  it("lets idle sessions leave after the timeout, and says it is waiting on stop", () => {
    const v = new Visitors(3, 600_000);
    v.handle(ev({ session: "s1", kind: "start" }), 0);
    expect(v.handle(ev({ session: "s1", kind: "stop" }), 10)).toContainEqual({ type: "say", key: "claude:1", text: "done · your turn" });
    expect(v.tick(500_000)).toEqual([]);
    expect(v.tick(700_000)).toEqual([{ type: "leave", key: "claude:1" }]);
    expect(v.keyFor("s1")).toBeUndefined();
  });
  it("stays in a room for the dwell time, but always returns to the lobby at once", () => {
    const v = new Visitors(3, 600_000, 4000);
    v.handle(ev({ session: "s1", kind: "prompt", text: "go" }), 0);
    expect(v.handle(ev({ session: "s1", tool: "Read" }), 500)).toContainEqual({ type: "go", key: "claude:1", room: "research" }); // out of the lobby at once
    expect(v.handle(ev({ session: "s1", tool: "Edit" }), 1000).some((c) => c.type === "go")).toBe(false);
    expect(v.handle(ev({ session: "s1", tool: "Edit" }), 5000)).toContainEqual({ type: "go", key: "claude:1", room: "dev" });
    expect(v.handle(ev({ session: "s1", kind: "stop" }), 5100)).toContainEqual({ type: "go", key: "claude:1", room: "lobby" });
  });
});
