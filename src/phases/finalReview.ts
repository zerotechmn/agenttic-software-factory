import { caps, checkLanding, emit, hooksFor, type Ctx } from "../ctx.ts";
import { finalReviewPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { ReviewVerdict } from "../schemas.ts";
import { build } from "./build.ts";
import { addFixTasks } from "./qa.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { securityScan, type SecurityReport } from "../security.ts";

/** Static rules + npm audit, saved for the report and handed to the final reviewer. Never blocks on its own. */
export function runSecurityScan(ctx: Ctx): SecurityReport {
  const r = securityScan(ctx.dir, ctx.install);
  writeFileSync(join(ctx.dir, ".forge", "security.json"), JSON.stringify(r, null, 2));
  const high = r.findings.filter((f) => f.severity === "high").length + (r.audit ? r.audit.high + r.audit.critical : 0);
  emit(ctx, { kind: "security_scan", status: high ? "fail" : "ok", text: `${r.findings.length} static finding(s), ${high} high${r.audit?.note ? `; ${r.audit.note}` : ""}` });
  return r;
}

export async function finalReview(ctx: Ctx): Promise<void> {
  const scan = runSecurityScan(ctx);
  if (checkLanding(ctx) && ctx.budget.remaining() < ctx.cfg.budgetUsd * 0.08) {
    ctx.ledger.ruling("skip final review", "landing mode with under 8% budget left", "unreviewed cross-cutting issues");
    return;
  }
  const role = loadRole("final_reviewer");
  const res = await ctx.runner.run({
    role: "final_reviewer",
    cwd: ctx.dir,
    prompt: finalReviewPrompt(ctx.state.baseSha ?? "HEAD~1", scan, ctx.state.changeRequests),
    model: ctx.cfg.models.final_reviewer,
    ...caps(ctx, "final_reviewer", role.maxTurns),
    schema: ReviewVerdict,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [], readonlyGlobs: ["**"], allowBash: true }, "final_reviewer"),
  });
  if (!res.ok) {
    ctx.ledger.ruling("ship without final review", `final reviewer failed: ${res.error}`, "unreviewed cross-cutting issues");
    return;
  }
  const v = res.output as ReviewVerdict;
  const blocking = v.issues.filter((i) => i.severity !== "minor");
  emit(ctx, { kind: "review", status: v.verdict, text: `final review: ${blocking.length} blocking, ${v.issues.length - blocking.length} minor` });
  if (v.verdict === "approve" || !blocking.length) return;
  addFixTasks(ctx, "R", blocking.map((i) => ({ title: i.message.slice(0, 120), suspectedFiles: i.file ? [i.file] : undefined, fix: i.fix })));
  await build(ctx);
}
