import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { FACTORY_ROOT } from "./config.ts";
import { sh } from "./git.ts";
import { missingSkills } from "./skills.ts";

/**
 * `forge doctor`: everything a fresh machine needs before `forge run`, each with the one command that fixes it.
 * "fail" stops a run from working; "warn" degrades it (no deploy, no stealth fetch) but a run still finishes.
 */
export interface Check { name: string; ok: boolean; level: "fail" | "warn"; detail: string; fix?: string }

type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

const has = (cmd: string) => sh(`command -v ${cmd}`, FACTORY_ROOT).code === 0;

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function playwrightCache(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform() === "darwin") return join(homedir(), "Library", "Caches", "ms-playwright");
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), "ms-playwright");
  return join(homedir(), ".cache", "ms-playwright");
}

function roleSkills(): string[] {
  const names = new Set(["pixijs", "pixi-v8-pixel-games", "game-feel", "game-ai"]);
  for (const f of readdirSync(join(FACTORY_ROOT, "roles"))) {
    const line = readFileSync(join(FACTORY_ROOT, "roles", f), "utf8").match(/^skills:(.*)$/m);
    for (const n of line?.[1].split(",") ?? []) if (n.trim()) names.add(n.trim());
  }
  return [...names];
}

export async function runDoctor(o: { fetch?: Fetch; ports?: number[] } = {}): Promise<Check[]> {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  const major = Number(process.versions.node.split(".")[0]);
  add({ name: "Node ≥ 24", ok: major >= 24, level: "fail", detail: `node ${process.versions.node}`, fix: "install Node 24 (e.g. nvm install 24)" });
  add({ name: "git", ok: has("git"), level: "fail", detail: has("git") ? sh("git --version", FACTORY_ROOT).out.trim() : "not found", fix: "install git" });
  add({ name: "dependencies installed", ok: existsSync(join(FACTORY_ROOT, "node_modules", "@anthropic-ai", "claude-agent-sdk")), level: "fail", detail: "node_modules", fix: "./setup.sh" });

  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) add({ name: "ANTHROPIC_API_KEY", ok: false, level: "fail", detail: "not set", fix: "cp .env.example .env, then put the key in .env" });
  else {
    const f = o.fetch ?? (fetch as unknown as Fetch);
    // listing models is free and proves the key works
    const r = await f("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }).catch(() => ({ ok: false, status: 0 }));
    add({ name: "ANTHROPIC_API_KEY", ok: r.ok, level: "fail", detail: r.ok ? `set (${key.slice(0, 7)}…), accepted by the API` : r.status ? `rejected by the API (HTTP ${r.status})` : "could not reach api.anthropic.com", fix: r.status ? "check the key in .env" : "check the network" });
  }

  const missing = missingSkills(roleSkills());
  add({ name: "role skills bundled", ok: !missing.length, level: "fail", detail: missing.length ? `missing: ${missing.join(", ")}` : `${roleSkills().length} skills in skills/`, fix: "git checkout -- skills" });

  const cache = playwrightCache();
  const chromium = existsSync(cache) && readdirSync(cache).some((d) => d.startsWith("chromium"));
  add({ name: "Playwright Chromium (QA)", ok: chromium, level: "fail", detail: chromium ? cache : "not installed", fix: "npx playwright install chromium" });

  const docker = has("docker") && sh("docker info", FACTORY_ROOT).code === 0;
  add({ name: "Docker running (deploy)", ok: docker, level: "warn", detail: docker ? "docker info ok" : has("docker") ? "installed but not running" : "not installed", fix: "start Docker Desktop (without it the app is built and tested, not containerised)" });

  const office = existsSync(join(FACTORY_ROOT, "office", "dist", "index.html"));
  add({ name: "Office UI built", ok: office, level: "warn", detail: office ? "office/dist" : "not built", fix: "(cd office && npm ci && npm run build)" });

  for (const p of o.ports ?? [4300, 8800]) {
    const free = await portFree(p);
    add({ name: `port ${p} free`, ok: free, level: "warn", detail: free ? "free" : "in use", fix: p === 4300 ? "stop the other console, or forge console --port N" : "stop whatever holds it (docker ps)" });
  }

  const scrapling = existsSync(process.env.FORGE_SCRAPLING_MCP ?? join(homedir(), ".local/bin/scrapling-mcp"));
  add({ name: "Scrapling MCP (optional)", ok: scrapling, level: "warn", detail: scrapling ? "found" : "not installed: the researcher uses WebFetch", fix: "optional: pipx install 'scrapling[ai]' && scrapling install" });
  return out;
}

export function formatDoctor(checks: Check[]): { text: string; ok: boolean } {
  const lines = checks.map((c) => `${c.ok ? "✓" : c.level === "fail" ? "✗" : "!"} ${c.name.padEnd(28)} ${c.detail}${c.ok || !c.fix ? "" : `\n    → ${c.fix}`}`);
  const fails = checks.filter((c) => !c.ok && c.level === "fail").length;
  const warns = checks.filter((c) => !c.ok && c.level === "warn").length;
  lines.push("", fails ? `${fails} problem(s) to fix before forge run.` : warns ? `Ready to run (${warns} warning(s)).` : "Ready to run.");
  return { text: lines.join("\n"), ok: !fails };
}
