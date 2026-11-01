import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSecurity, scanSource } from "../src/security.ts";

const project = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "sec-"));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
};

describe("security scan", () => {
  it("flags secrets, raw SQL, innerHTML and eval, but not tests or node_modules", () => {
    const dir = project({
      "src/server/routes/a.ts": 'const apiKey = "abcd1234efgh5678";\ndb.execute(sql.raw(`select * from t where id=${id}`));\n',
      "src/web/b.tsx": "<div dangerouslySetInnerHTML={{ __html: x }} />\nel.innerHTML = y;\neval(code);\n",
      "src/web/b.test.tsx": "eval(x)",
      "node_modules/x/index.js": "eval(x)",
    });
    const rules = scanSource(dir).map((f) => `${f.rule}@${f.file}:${f.line}`).sort();
    expect(rules).toEqual([
      "dangerously-set-inner-html@src/web/b.tsx:1",
      "eval@src/web/b.tsx:3",
      "hardcoded-secret@src/server/routes/a.ts:1",
      "inner-html-assignment@src/web/b.tsx:2",
      "sql-raw-interpolation@src/server/routes/a.ts:2",
    ]);
  });

  it("is quiet on the house-template style of code", () => {
    const dir = project({ "src/server/app.ts": 'app.use("*", secureHeaders());\nconst rows = await db.select().from(notes).where(eq(notes.id, id));\n' });
    expect(scanSource(dir)).toEqual([]);
    expect(renderSecurity({ findings: [] }).join("\n")).toContain("0 finding(s)");
  });

  it("treats a published demo login in seed data as low, a real key there stays high", () => {
    const dir = project({ "src/server/db/seed.ts": 'export const DEMO_PASSWORD = "password123";\nconst key = "sk-ant-abcdefghijklmnop";\n' });
    expect(scanSource(dir).map((f) => `${f.rule}:${f.severity}`)).toEqual(["demo-credential:low", "hardcoded-secret:high"]);
  });
});
