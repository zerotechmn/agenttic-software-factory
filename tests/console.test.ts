import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRuns, startRun, runStatus, actions } from "../src/console/runs.ts";
import { assistantOps } from "../src/console/assistant.ts";
import { startConsole } from "../src/console/server.ts";
import { newState, saveState, loadState } from "../src/state.ts";
import { EventBus } from "../src/events.ts";

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "forge-console-"));
  for (const [name, phase, usd] of [["alpha", "done", 3.2], ["beta", "build", 1.1]] as const) {
    const dir = join(root, name);
    const s = newState(name);
    s.phase = phase;
    s.spend.usd = usd;
    s.startedAt = name === "beta" ? Date.now() : Date.now() - 100000;
    saveState(dir, s);
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "prd.json"), JSON.stringify({ product: `${name} app`, features: [] }));
    writeFileSync(join(dir, ".forge", "ledger.md"), "- 01:00 [qa] RULING: stop QA — plateau — cost\n");
    new EventBus(join(dir, ".forge", "events.jsonl"), name).emit({ phase: "build", kind: "note", text: `hello ${name}` });
  }
  return root;
}

describe("console runs", () => {
  it("lists runs newest first with product, phase and spend", () => {
    const runs = listRuns(fakeRoot());
    expect(runs.map((r) => r.name)).toEqual(["beta", "alpha"]);
    expect(runs[1]).toMatchObject({ phase: "done", product: "alpha app", usd: 3.2 });
  });

  it("starts a run from a brief: writes the brief and spawns forge with the right args", () => {
    const root = fakeRoot();
    const calls: string[][] = [];
    const r = startRun(root, { name: "My New App!", brief: "# Brief\nBuild a todo app", budget: 12 }, (args) => calls.push(args));
    expect(r.name).toBe("my-new-app");
    expect(readFileSync(r.briefPath, "utf8")).toContain("todo app");
    expect(calls[0]).toEqual(expect.arrayContaining(["run", r.briefPath, "--out", join(root, "my-new-app"), "--budget", "12", "--no-serve"]));
    expect(() => startRun(root, { name: "alpha", brief: "x", budget: 5 }, () => {})).toThrow(/exists/);
  });

  it("run status gives the diagnosis inputs: phase, tasks, rulings, last QA failures", () => {
    const st = runStatus(fakeRoot(), "alpha");
    expect(st.phase).toBe("done");
    expect(st.rulings.join("\n")).toMatch(/stop QA/);
  });

  it("actions: backlog, note, stop and iterate act on the named run only", () => {
    const root = fakeRoot();
    actions.addBacklog(root, "beta", "Add zoom", "wheel");
    actions.note(root, "beta", "dev", "smaller components");
    actions.stop(root, "beta");
    const added = actions.iterate(root, "alpha", ["polish the HUD"]);
    expect(readFileSync(join(root, "beta", ".forge", "requests.jsonl"), "utf8")).toContain("Add zoom");
    expect(readFileSync(join(root, "beta", ".forge", "inbox.jsonl"), "utf8")).toContain("smaller components");
    expect(existsSync(join(root, "beta", ".forge", "STOP"))).toBe(true);
    expect(added[0].title).toMatch(/polish/);
    expect(loadState(join(root, "alpha"))!.phase).toBe("build");
  });

  it("rejects run names that escape the runs root", () => {
    expect(() => runStatus(fakeRoot(), "../etc")).toThrow(/run/);
  });
});

describe("console server", () => {
  it("serves the run list, run-scoped events, starts runs and answers the assistant", async () => {
    const root = fakeRoot();
    const spawned: string[][] = [];
    const srv = await startConsole({ root, port: 0, spawn: (a) => spawned.push(a), ask: async (m) => ({ reply: `echo: ${m}`, usd: 0.01 }) });
    try {
      const runs = await (await fetch(`${srv.url}/api/runs`)).json();
      expect(runs.map((r: { name: string }) => r.name)).toEqual(["beta", "alpha"]);
      const ev = await fetch(`${srv.url}/events?run=alpha`);
      const reader = ev.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toContain("hello alpha");
      await reader.cancel();
      const st = await (await fetch(`${srv.url}/state?run=beta`)).json();
      expect(st.phase).toBe("build");
      const made = await fetch(`${srv.url}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "gamma", brief: "build x", budget: 5 }) });
      expect(made.status).toBe(201);
      expect(spawned).toHaveLength(1);
      const chat = await (await fetch(`${srv.url}/api/assistant`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "what is going on?" }) })).json();
      expect(chat.reply).toBe("echo: what is going on?");
      expect((await fetch(`${srv.url}/office/`)).status).toBe(200);
      // an assistant proposal only runs when the operator confirms it
      assistantOps(root, (a) => spawned.push(a)).start_run("delta", "build y", 3);
      const props = await (await fetch(`${srv.url}/api/proposals`)).json();
      expect(props).toHaveLength(1);
      expect(spawned).toHaveLength(1);
      const ok = await (await fetch(`${srv.url}/api/proposals/${props[0].id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })).json();
      expect(ok.result).toMatch(/started run delta/);
      expect(spawned).toHaveLength(2);
    } finally {
      await srv.close();
    }
  });
});
