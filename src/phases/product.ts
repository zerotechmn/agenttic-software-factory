import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { caps, commitMain, commitMessage, hooksFor, readJson, type Ctx } from "../ctx.ts";
import { criticPrompt, productPrompt } from "../prompts.ts";
import { loadRole } from "../roles.ts";
import { AgentStatus, Prd, PrdCritique } from "../schemas.ts";
import { checkStop, emit } from "../ctx.ts";
import { readNotes } from "../inbox.ts";

export async function product(ctx: Ctx): Promise<void> {
  const role = loadRole("product");
  const prdPath = join(ctx.dir, "docs", "prd.json");
  let error: string | undefined;
  let sessionId: string | undefined;
  let critiqued = false;
  let invalid = 0;
  let revised = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (invalid >= 2) break;
    const res = await ctx.runner.run({
      role: "product",
      cwd: ctx.dir,
      prompt: productPrompt(timebox(ctx), error),
      model: ctx.cfg.models.product,
      ...caps(ctx, "product", role.maxTurns),
      schema: AgentStatus,
      resume: error ? sessionId : undefined,
      hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: ["docs/prd.json", "docs/prd.md", ".forge/holdout/**"], allowBash: false }, "product"),
    });
    sessionId = res.sessionId;
    if (!existsSync(prdPath)) {
      invalid++;
      error = `docs/prd.json was not written (${res.error ?? "no error reported"})`;
      continue;
    }
    let raw: unknown;
    try {
      raw = readJson(prdPath);
    } catch (e) {
      invalid++;
      error = `docs/prd.json is not valid JSON: ${(e as Error).message}`;
      continue;
    }
    // A missing question id is not worth a whole Product turn: number them.
    const oq = (raw as { openQuestions?: { id?: string }[] } | null)?.openQuestions;
    if (Array.isArray(oq) && oq.some((q) => q && !q.id)) {
      oq.forEach((q, i) => { if (q && !q.id) q.id = `Q${i + 1}`; });
      writeFileSync(prdPath, JSON.stringify(raw, null, 2) + "\n");
    }
    const parsed = Prd.safeParse(raw);
    if (!parsed.success) {
      invalid++;
      error = parsed.error.message.slice(0, 1500);
      continue;
    }
    // An independent critic checks the PRD against the brief once; gaps go back to Product for one revision.
    if (!critiqued) {
      critiqued = true;
      const gaps = await critique(ctx);
      if (gaps && attempt < 3) {
        error = gaps;
        revised = true;
        continue;
      }
    } else if (revised) {
      // Re-map the revised PRD so the brief-coverage trace matches what will be built (no second revision).
      await critique(ctx, true);
    }
    const prd = { ...parsed.data, features: parsed.data.features.map((f) => ({ ...f, passes: false })) };
    writeFileSync(prdPath, JSON.stringify(prd, null, 2) + "\n");
    applyProductName(ctx.dir, prd.product);
    const musts = prd.features.filter((f) => f.priority === "must").length;
    ctx.ledger.note(`PRD: ${prd.product} — ${prd.features.length} features (${musts} must)`);
    commitMain(ctx, await commitMessage(ctx, `docs: PRD for ${prd.product}`, `PRD for ${prd.product}: ${prd.pitch}`), ["docs/prd.json", "docs/prd.md", "docs/brief-coverage.json", "src/shared/product.ts", "index.html"]);
    if (prd.openQuestions.length && (await clarify(ctx, prd.openQuestions))) {
      // The operator answered: one Product revision with the answers (the inbox delivers them), then re-map coverage.
      await ctx.runner.run({
        role: "product", cwd: ctx.dir, model: ctx.cfg.models.product, ...caps(ctx, "product", role.maxTurns), schema: AgentStatus, resume: sessionId,
        prompt: "Dispatch: PRODUCT. The operator answered your open questions (operator notes below). Update docs/prd.json and docs/prd.md to match the answers; keep feature ids stable and remove answered questions from openQuestions.",
        hooks: hooksFor(ctx, { root: ctx.dir, writable: [ctx.dir], readonlyGlobs: [], writableGlobs: ["docs/prd.json", "docs/prd.md", ".forge/holdout/**"], allowBash: false }, "product"),
      });
      const again = Prd.safeParse(readJson(prdPath));
      if (again.success) {
        writeFileSync(prdPath, JSON.stringify({ ...again.data, features: again.data.features.map((f) => ({ ...f, passes: false })) }, null, 2) + "\n");
        await critique(ctx, true);
        commitMain(ctx, "docs: PRD updated with the operator's answers", ["docs/prd.json", "docs/prd.md", "docs/brief-coverage.json"]);
      } else ctx.ledger.note("PRD revision after the operator's answers was invalid; keeping the previous PRD");
    }
    return;
  }
  throw new Error(`Product agent failed to produce a valid PRD: ${error}`);
}

function timebox(ctx: Ctx): string {
  if (!ctx.cfg.deadline) return "a few hours of autonomous agent work";
  const hours = Math.max(1, Math.round((new Date(ctx.cfg.deadline).getTime() - Date.now()) / 3_600_000));
  return `about ${hours} hours until the deadline (${ctx.cfg.deadline})`;
}

/** Deterministic: the product name shows up in the app shell and page title. */
export function applyProductName(dir: string, name: string): void {
  const p = join(dir, "src", "shared", "product.ts");
  if (existsSync(p)) writeFileSync(p, `export const PRODUCT_NAME = ${JSON.stringify(name)};\n`);
  const html = join(dir, "index.html");
  if (existsSync(html)) writeFileSync(html, readFileSync(html, "utf8").replace(/<title>.*<\/title>/, `<title>${name.replace(/[<>&]/g, "")}</title>`));
}

/** Returns the gaps to send back to Product, or undefined when the PRD covers the brief (or the critic failed). */
async function critique(ctx: Ctx, final = false): Promise<string | undefined> {
  const role = loadRole("critic");
  const res = await ctx.runner.run({
    role: "critic",
    cwd: ctx.dir,
    prompt: criticPrompt(),
    model: ctx.cfg.models.critic,
    ...caps(ctx, "critic", role.maxTurns),
    schema: PrdCritique,
    hooks: hooksFor(ctx, { root: ctx.dir, writable: [], readonlyGlobs: ["**"], allowBash: false }, "critic"),
  });
  const c = PrdCritique.safeParse(res.output);
  if (!res.ok || !c.success) {
    ctx.ledger.note(`PRD critic unavailable (${res.error ?? "invalid output"}); continuing with the PRD as written`);
    return undefined;
  }
  writeFileSync(join(ctx.dir, "docs", "brief-coverage.json"), JSON.stringify(c.data, null, 2) + "\n");
  writeFileSync(join(ctx.dir, ".forge", "stack-check.json"), JSON.stringify({ conflicts: c.data.stackConflicts }, null, 2));
  const v = c.data;
  emit(ctx, { kind: "prd_critic", status: v.uncovered.length ? "gaps" : "ok", text: `${v.coverage.length} brief requirements, ${v.uncovered.length} uncovered, ${v.invented.length} invented must-haves` });
  if (v.invented.length) ctx.ledger.note(`critic: ${v.invented.length} must-have(s) not asked for by the brief: ${v.invented.map((i) => i.featureId).join(", ")}`);
  if (final || !v.uncovered.length) return undefined;
  ctx.ledger.ruling("revise PRD", `critic found ${v.uncovered.length} brief requirement(s) no feature delivers`, "one extra Product turn");
  return [
    "An independent critic compared it with docs/brief.md.",
    ...v.uncovered.map((u) => `- Not covered: ${u}`),
    ...v.invented.map((i) => `- ${i.featureId} is a must-have the brief never asked for: ${i.why} (downgrade or drop it)`),
    "Add or sharpen features so every brief requirement has testable acceptance criteria.",
  ].join("\n");
}

/**
 * Ask the client: publish the open questions with the assumptions already built into the PRD, then wait up to
 * `clarifyMinutes` for answers (operator notes to Product, or unaddressed). Never blocks: no answer = assumptions stand.
 * Returns true when answers arrived.
 */
export async function clarify(ctx: Ctx, questions: Prd["openQuestions"], pollMs = 5000): Promise<boolean> {
  writeFileSync(join(ctx.dir, ".forge", "clarify.json"), JSON.stringify(questions, null, 2));
  emit(ctx, { kind: "clarify", status: "asked", role: "product", text: questions.map((q) => `${q.id}: ${q.question} (assuming: ${q.assumption})`).join(" · ").slice(0, 1500), data: questions });
  const pending = () => {
    const delivered = new Set(ctx.state.inboxDelivered ?? []);
    return readNotes(ctx.dir).filter((n) => !delivered.has(n.id) && (!n.role || n.role === "product"));
  };
  const until = Date.now() + ctx.cfg.clarifyMinutes * 60_000;
  let answered = pending().length > 0;
  while (!answered && Date.now() < until) {
    checkStop(ctx);
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, until - Date.now()))));
    answered = pending().length > 0;
  }
  if (answered) {
    emit(ctx, { kind: "clarify", status: "answered", role: "product", text: `${pending().length} answer(s) from the operator` });
    return true;
  }
  for (const q of questions) ctx.ledger.ruling(`assume: ${q.assumption}`, `open question ${q.id} unanswered: ${q.question}`, "rework if the client meant otherwise");
  return false;
}
