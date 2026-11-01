import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkills, skillsFor } from "../src/skills.ts";
import { loadRole } from "../src/roles.ts";
import { initRepo } from "../src/git.ts";

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "forge-skroot-"));
  for (const n of ["tdd", "research", "pixijs"]) {
    mkdirSync(join(root, n), { recursive: true });
    writeFileSync(join(root, n, "SKILL.md"), `---\nname: ${n}\ndescription: test\n---\nbody`);
  }
  return root;
}

describe("per-role skills", () => {
  beforeEach(() => { process.env.FORGE_SKILL_ROOTS = fakeRoot(); });

  it("each role declares a focused skill set; researcher and reviewer get theirs", () => {
    expect(loadRole("researcher").skills).toEqual(expect.arrayContaining(["research", "documentation-lookup"]));
    expect(loadRole("reviewer").skills).toEqual(expect.arrayContaining(["security-review", "coding-standards"]));
    expect(loadRole("dev").skills).toContain("tdd");
  });

  it("adds the Pixi/game skills only when the project depends on pixi.js", () => {
    const plain = mkdtempSync(join(tmpdir(), "forge-p-"));
    writeFileSync(join(plain, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    const pixi = mkdtempSync(join(tmpdir(), "forge-p-"));
    writeFileSync(join(pixi, "package.json"), JSON.stringify({ dependencies: { "pixi.js": "^8" } }));
    expect(skillsFor(loadRole("dev"), plain)).not.toContain("pixijs");
    expect(skillsFor(loadRole("dev"), pixi)).toEqual(expect.arrayContaining(["pixijs", "pixi-v8-pixel-games", "game-feel"]));
    expect(skillsFor(loadRole("reviewer"), pixi)).not.toContain("pixijs");
  });

  it("copies only the requested skills into the working dir, git-ignored, idempotently", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-sk-"));
    initRepo(dir);
    const got = installSkills(dir, ["tdd", "research", "nope-missing"]);
    expect(got.sort()).toEqual(["research", "tdd"]);
    expect(existsSync(join(dir, ".claude/skills/tdd/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude/skills/pixijs"))).toBe(false);
    expect(installSkills(dir, ["tdd"])).toEqual(["tdd"]);
    expect(readFileSync(join(dir, ".git/info/exclude"), "utf8")).toContain(".claude/skills/");
  });
});
