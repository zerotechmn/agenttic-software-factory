import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { EventBus } from "../src/events.ts";
import { newState, saveState } from "../src/state.ts";

describe("server", () => {
  it("serves state, the monitor page, and replays + streams events over SSE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-srv-"));
    saveState(dir, newState("r1"));
    const bus = new EventBus(join(dir, ".forge", "events.jsonl"), "r1");
    bus.emit({ phase: "intake", kind: "phase_start" });
    const srv = await startServer(dir, bus, 0);
    try {
      const state = await (await fetch(`${srv.url}/state`)).json();
      expect(state.run).toBe("r1");
      const page = await (await fetch(`${srv.url}/`)).text();
      expect(page).toContain("FORGE");

      const res = await fetch(`${srv.url}/events`);
      const reader = res.body!.getReader();
      let text = "";
      setTimeout(() => bus.emit({ phase: "build", kind: "live_one" }), 50);
      while (!text.includes("live_one")) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain("phase_start");
      await reader.cancel();
    } finally {
      await srv.close();
    }
  });
});

describe("POST /say", () => {
  it("stores an operator note in the inbox and emits an event", async () => {
    const { readFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "forge-say-"));
    saveState(dir, newState("r1"));
    const bus = new EventBus(join(dir, ".forge", "events.jsonl"), "r1");
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.kind));
    const srv = await startServer(dir, bus, 0);
    try {
      const ok = await fetch(`${srv.url}/say`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "dev", text: "use the teal accent" }) });
      expect(ok.status).toBe(202);
      expect(readFileSync(join(dir, ".forge", "inbox.jsonl"), "utf8")).toContain("use the teal accent");
      expect(seen).toContain("operator_say");
      const bad = await fetch(`${srv.url}/say`, { method: "POST", body: JSON.stringify({ text: "  " }) });
      expect(bad.status).toBe(400);
      const pre = await fetch(`${srv.url}/say`, { method: "OPTIONS" });
      expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    } finally {
      await srv.close();
    }
  });
});

describe("office monitor route", () => {
  it("serves the built pixel office at /office/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-off-"));
    saveState(dir, newState("r1"));
    const srv = await startServer(dir, null, 0);
    try {
      const res = await fetch(`${srv.url}/office/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("FORGE Office");
      expect((await fetch(`${srv.url}/office/../package.json`)).status).not.toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe("POST /task", () => {
  it("queues a backlog request from the UI", async () => {
    const { readFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "forge-task-"));
    saveState(dir, newState("r1"));
    const bus = new EventBus(join(dir, ".forge", "events.jsonl"), "r1");
    const srv = await startServer(dir, bus, 0);
    try {
      const ok = await fetch(`${srv.url}/task`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Add zoom", description: "wheel zoom" }) });
      expect(ok.status).toBe(202);
      expect(readFileSync(join(dir, ".forge", "requests.jsonl"), "utf8")).toContain("Add zoom");
      expect((await fetch(`${srv.url}/task`, { method: "POST", body: "{}" })).status).toBe(400);
    } finally {
      await srv.close();
    }
  });
});
