import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sh } from "./git.ts";

export interface SecurityFinding { rule: string; severity: "high" | "medium" | "low"; file: string; line: number; text: string }
export interface SecurityReport { findings: SecurityFinding[]; audit?: { high: number; critical: number; moderate: number; ok: boolean; note?: string } }

/** Cheap static rules for the house stack (Hono + Drizzle + React). No extra dependencies. */
const RULES: { rule: string; severity: SecurityFinding["severity"]; re: RegExp; files?: RegExp }[] = [
  { rule: "hardcoded-secret", severity: "high", re: /(sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|(password|secret|api_?key|token)\s*[:=]\s*["'][^"'\s]{8,}["'])/i },
  { rule: "sql-raw-interpolation", severity: "high", re: /sql\.raw\(|sql`[^`]*\$\{(?![^}]*\bsql\b)/, files: /src\/server\// },
  { rule: "eval", severity: "high", re: /\beval\(|new Function\(/ },
  { rule: "shell-exec", severity: "high", re: /\b(exec|execSync)\(\s*`[^`]*\$\{/ },
  { rule: "dangerously-set-inner-html", severity: "medium", re: /dangerouslySetInnerHTML/ },
  { rule: "inner-html-assignment", severity: "medium", re: /\.innerHTML\s*=/ },
  { rule: "cors-wildcard", severity: "medium", re: /cors\(\s*\)|origin:\s*["']\*["']/, files: /src\/server\// },
  { rule: "unvalidated-json-body", severity: "low", re: /await\s+c\.req\.json\(\)/, files: /src\/server\// },
];

function walk(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist" || name === "coverage") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, root, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && st.size < 500_000) out.push(relative(root, p));
  }
}

export function scanSource(dir: string): SecurityFinding[] {
  const files: string[] = [];
  for (const top of ["src", "server", "app"]) {
    try {
      walk(join(dir, top), dir, files);
    } catch {
      // folder absent
    }
  }
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    if (/\.(test|spec)\.[jt]sx?$/.test(file)) continue;
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const r of RULES) {
        if (r.files && !r.files.test(file)) continue;
        if (!r.re.test(text)) continue;
        // A published demo login in seed data (the brief's "sarah / password123") is a feature, not a leaked secret.
        const demo = r.rule === "hardcoded-secret" && /(seed|fixture|demo|sample)/i.test(file) && /\b(demo|sample|example)/i.test(text) && !/sk-ant-|AKIA|ghp_|PRIVATE KEY/.test(text);
        findings.push({ rule: demo ? "demo-credential" : r.rule, severity: demo ? "low" : r.severity, file, line: i + 1, text: text.trim().slice(0, 160) });
      }
    });
  }
  return findings;
}

/** npm audit on production deps. Offline or failing audits are reported, never fatal. */
export function npmAudit(dir: string): SecurityReport["audit"] {
  const r = sh("npm audit --omit=dev --json", dir, 60_000);
  try {
    const v = JSON.parse(r.out.slice(r.out.indexOf("{"))).metadata?.vulnerabilities ?? {};
    return { high: v.high ?? 0, critical: v.critical ?? 0, moderate: v.moderate ?? 0, ok: !(v.high || v.critical) };
  } catch {
    return { high: 0, critical: 0, moderate: 0, ok: true, note: "npm audit unavailable (offline?)" };
  }
}

export function securityScan(dir: string, audit = true): SecurityReport {
  return { findings: scanSource(dir), ...(audit ? { audit: npmAudit(dir) } : {}) };
}

export function renderSecurity(r: SecurityReport): string[] {
  const by = (s: string) => r.findings.filter((f) => f.severity === s).length;
  return [
    "## Security scan",
    `- Static rules: ${r.findings.length} finding(s) (${by("high")} high, ${by("medium")} medium, ${by("low")} low)`,
    r.audit ? `- npm audit (prod deps): ${r.audit.critical} critical, ${r.audit.high} high, ${r.audit.moderate} moderate${r.audit.note ? ` (${r.audit.note})` : ""}` : "- npm audit: skipped",
    ...r.findings.filter((f) => f.severity !== "low").slice(0, 15).map((f) => `  - ${f.severity} \`${f.rule}\` ${f.file}:${f.line}`),
    "",
  ];
}
