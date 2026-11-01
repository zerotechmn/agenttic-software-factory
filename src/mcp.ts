import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/** MCP servers roles may request via `mcp:` frontmatter. Everything else is off (strictMcpConfig). */
export const MCP: Record<string, McpServerConfig> = {
  scrapling: {
    type: "stdio",
    command: process.env.FORGE_SCRAPLING_MCP ?? join(homedir(), ".local/bin/scrapling-mcp"),
    args: [],
  },
  context7: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@4.4.2", ...(process.env.CONTEXT7_API_KEY ? ["--api-key", process.env.CONTEXT7_API_KEY] : [])],
  },
};

/** A server whose local binary isn't installed (scrapling is optional, a Python tool) is left out: the role falls back to WebFetch. */
function available(c: McpServerConfig): boolean {
  const cmd = "command" in c ? c.command : undefined;
  return !cmd || !cmd.startsWith("/") || existsSync(cmd);
}

export function mcpFor(names: string[] | undefined): Record<string, McpServerConfig> | undefined {
  if (!names?.length) return undefined;
  return Object.fromEntries(names.filter((n) => MCP[n] && available(MCP[n])).map((n) => [n, MCP[n]]));
}
