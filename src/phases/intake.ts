import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkStop, commitMain, emit, writeFile, type Ctx } from "../ctx.ts";
import { headSha, initRepo, sh } from "../git.ts";
import { requestedPort } from "./deploy.ts";

export async function intake(ctx: Ctx): Promise<void> {
  const { dir } = ctx;
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) {
    cpSync(ctx.templateDir, dir, {
      recursive: true,
      filter: (src) => !/[/\\](node_modules|dist|playwright-report|test-results)([/\\]|$)/.test(src.slice(ctx.templateDir.length)) && !src.endsWith(".db"),
    });
    initRepo(dir);
  }
  writeFile(join(dir, "docs", "brief.md"), readFileSync(ctx.briefPath, "utf8"));
  // Attachments: a `<brief>.files/` folder next to the brief becomes fixtures/ (data files, recordings, specs).
  const attachments = ctx.briefPath.replace(/\.md$/, ".files");
  if (existsSync(attachments)) {
    cpSync(attachments, join(dir, "fixtures"), { recursive: true });
    emit(ctx, { kind: "note", text: "brief attachments copied to fixtures/" });
  }
  checkStop(ctx);
  setStartPort(dir);

  ensureDeps(ctx);
  const gi = join(dir, ".gitignore");
  if (existsSync(gi) && !readFileSync(gi, "utf8").includes(".forge/")) writeFileSync(gi, readFileSync(gi, "utf8") + "\n.forge/\n");

  commitMain(ctx, "chore: scaffold from FORGE house template + brief");
  ctx.state.baseSha = headSha(dir);
}

/** Make sure the main checkout has node_modules (fresh run, or a resume after something removed them). */
export function ensureDeps(ctx: Ctx): void {
  const { dir } = ctx;
  if (!ctx.install || existsSync(join(dir, "node_modules"))) return;
  const tplModules = join(ctx.templateDir, "node_modules");
  // APFS clone (instant, copy-on-write) of the template's installed deps; npm ci as fallback.
  const cloned = existsSync(tplModules) && sh(`cp -cR ${JSON.stringify(tplModules)} ${JSON.stringify(join(dir, "node_modules"))}`, dir).code === 0;
  emit(ctx, { kind: "note", text: cloned ? "node_modules cloned from template" : "installing dependencies" });
  if (!cloned) {
    const r = sh("npm ci --no-audit --no-fund || npm install --no-audit --no-fund", dir, 600_000);
    if (r.code !== 0) throw new Error(`npm install failed:\n${r.out.slice(-2000)}`);
  }
}

/**
 * The brief names a port ("run it on port 4030"): make `npm start` use it by default, so QA's "runs on 4030" check
 * passes without a fix round. Dev mode keeps the template's API port (vite proxies to it); $PORT still wins.
 */
export function setStartPort(dir: string): void {
  const port = requestedPort(dir);
  const pkgPath = join(dir, "package.json");
  if (!port || !existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  const start = pkg.scripts?.start;
  if (!start || start.includes("PORT=")) return;
  pkg.scripts!.start = `PORT=\${PORT:-${port}} ${start}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}
