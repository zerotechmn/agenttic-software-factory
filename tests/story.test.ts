import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestedPort } from "../src/phases/deploy.ts";
import { setStartPort } from "../src/phases/intake.ts";
import { splitAnswers } from "../src/phases/report.ts";
import { exportTranscripts } from "../src/story.ts";

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "st-"));
  for (const [f, b] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), b);
  }
  return d;
};

describe("deploy port from the brief", () => {
  it.each([
    ["give me to do web app. and deploy it on 4004 port on my machine", 4004],
    ["Deploy on port 3000.", 3000],
    ["Run it at http://localhost:5173 please", 5173],
    ["Must handle 80 users", undefined],
    ["port 22", undefined],
  ])("%s → %s", (brief, port) => {
    expect(requestedPort(dir({ "docs/brief.md": brief }))).toBe(port);
  });
  it("prefers the PRD's deploy.port", () => {
    expect(requestedPort(dir({ "docs/brief.md": "port 3000", "docs/prd.json": JSON.stringify({ deploy: { port: 4100 } }) }))).toBe(4100);
  });
});

describe("transcripts", () => {
  it("copies each agent's SDK session file into the run with an index", () => {
    const run = dir({ ".forge/events.jsonl": JSON.stringify({ ts: 1, run: "r", phase: "build", kind: "agent_done", role: "dev", taskId: "T1", agentId: "dev:T1#3", sessionId: "abc", model: "sonnet", usd: 0.2 }) + "\n" });
    const projects = dir({ "-Users-x-run/abc.jsonl": '{"type":"user"}\n' });
    expect(exportTranscripts(run, projects)).toBe(1);
    expect(readFileSync(join(run, ".forge/transcripts/dev_T1_3.jsonl"), "utf8")).toContain("user");
    expect(JSON.parse(readFileSync(join(run, ".forge/transcripts/index.json"), "utf8"))[0]).toMatchObject({ taskId: "T1", transcript: ".forge/transcripts/dev_T1_3.jsonl" });
    expect(existsSync(join(run, ".forge/transcripts"))).toBe(true);
  });
});

describe("assistant: what is running now", () => {
  it("lists agents that started and haven't finished, with their last action", async () => {
    const { working } = await import("../src/console/runs.ts");
    const ev = (o: object) => JSON.stringify({ ts: 1, run: "r", phase: "design", ...o });
    const d = dir({ ".forge/events.jsonl": [
      ev({ kind: "agent_start", agentId: "product#1", role: "product" }), ev({ kind: "agent_done", agentId: "product#1", role: "product" }),
      ev({ kind: "agent_start", agentId: "architect#2", role: "architect", model: "opus" }), ev({ kind: "tool", agentId: "architect#2", text: "Write docs/architecture.md" }),
    ].join("\n") + "\n" });
    expect(working(d)).toEqual([expect.objectContaining({ agentId: "architect#2", role: "architect", phase: "design", lastAction: "Write docs/architecture.md" })]);
  });
});

describe("vault documents", () => {
  it("lists only known run documents and serves them; anything else is 404", async () => {
    const { createRunHandler, listDocs } = await import("../src/server.ts");
    const d = dir({ "docs/prd.md": "# PRD", "docs/RUN_REPORT.md": "# Report", ".forge/qa/round-1.json": "{}", "secret.env": "KEY=1" });
    const paths = listDocs(d).map((x) => x.path);
    expect(paths).toEqual(expect.arrayContaining(["docs/RUN_REPORT.md", "docs/prd.md", ".forge/qa/round-1.json"]));
    expect(paths).not.toContain("secret.env");
    const h = createRunHandler(d, null);
    const call = (url: string) => new Promise<{ status: number; body: string; headers: Record<string, string> }>((res) => {
      const out = { status: 200, body: "", headers: {} as Record<string, string> };
      const r = { writeHead: (s: number, hd?: Record<string, string>) => { out.status = s; Object.assign(out.headers, hd ?? {}); return r; }, end: (b?: string | Buffer) => { out.body = b ? String(b) : ""; res(out); } };
      h.handle({ url } as never, r as never, new URL(url, "http://x").pathname);
    });
    expect((await call("/doc?path=docs/prd.md")).body).toBe("# PRD");
    expect((await call("/doc?path=docs/prd.md&download=1")).headers["Content-Disposition"]).toContain("prd.md");
    expect((await call("/doc?path=secret.env")).status).toBe(404);
    expect((await call("/doc?path=../../etc/passwd")).status).toBe(404);
    h.close();
  });
});

describe("design research check", () => {
  it("flags installed design skills the UI/UX agent never used, and accepts it once it has", async () => {
    const { designResearchGaps } = await import("../src/phases/design.ts");
    const ev = (o: object) => JSON.stringify({ ts: 1, run: "r", phase: "design", role: "uiux", ...o });
    const d = dir({
      ".claude/skills/frontend-design/SKILL.md": "x", ".claude/skills/ui-ux-pro-max/SKILL.md": "x",
      ".forge/events.jsonl": [ev({ kind: "tool", text: "Bash cat docs/brief.md" })].join("\n") + "\n",
    });
    expect(designResearchGaps({ dir: d } as never)).toEqual(["the frontend-design skill", "the ui-ux-pro-max design-system search"]);
    writeFileSync(join(d, ".forge/events.jsonl"), [ev({ kind: "tool", text: "Skill frontend-design" }), ev({ kind: "tool", text: 'Bash python3 .claude/skills/ui-ux-pro-max/scripts/search.py "yoga" --design-system' })].join("\n") + "\n");
    expect(designResearchGaps({ dir: d } as never)).toEqual([]);
  });
});

describe("npm start uses the brief's port", () => {
  it("prefixes the start script, keeping $PORT as the override", () => {
    const d = dir({ "docs/brief.md": "Run it on port 4030.", "package.json": JSON.stringify({ scripts: { start: "NODE_ENV=production tsx src/server/index.ts" } }) });
    setStartPort(d);
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).scripts.start).toBe("PORT=${PORT:-4030} NODE_ENV=production tsx src/server/index.ts");
  });
  it("leaves the template alone when the brief names no port", () => {
    const d = dir({ "docs/brief.md": "a todo app", "package.json": JSON.stringify({ scripts: { start: "x" } }) });
    setStartPort(d);
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).scripts.start).toBe("x");
  });
});

describe("operator answers mapped to questions", () => {
  const ids = ["Q1", "Q2", "Q3", "Q4", "Q5"];
  it("numbered, with an unnumbered first answer", () => {
    expect(splitAnswers("inclusive 2. just username and password 3. yes 4. you can decide 5. no need. just use seed.", ids)).toEqual({
      Q1: "inclusive", Q2: "just username and password", Q3: "yes", Q4: "you can decide", Q5: "no need. just use seed.",
    });
  });
  it("one line per question", () => {
    expect(splitAnswers("just type their name,\n2 anyone\n500\nyes\nyou can decide", ids)).toEqual({ Q1: "just type their name", Q2: "anyone", Q3: "500", Q4: "yes", Q5: "you can decide" });
  });
  it("free text stays unmapped", () => {
    expect(splitAnswers("build it however you like", ids)).toEqual({});
  });
});
