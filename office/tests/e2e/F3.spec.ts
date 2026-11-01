import { test, expect } from "@playwright/test";
import { boot } from "./helpers";
test("F3 hooks", async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => { const o = (window as any).__office; return { f: ["tasks","agents","zoom","openBoard","openAgent","room"].map((k) => typeof o[k]), a: o.agents(), d: o.room("Dev Floor"), u: o.room("Nope") }; });
  expect(r.f.every((x: string) => x === "function")).toBe(true);
  expect(r.a.map((a: any) => a.key).sort()).toEqual(["architect","dev:1","dev:2","dev:3","devops","final_reviewer","integrator","product","qa","researcher","reviewer","uiux"]);
  for (const a of r.a) { expect(typeof a.mode).toBe("string"); expect(typeof a.x).toBe("number"); expect(typeof a.y).toBe("number"); }
  expect(r.d).toContain("Dev Floor"); expect(r.u).toBe("");
  await page.evaluate(() => (window as any).__office.openAgent("qa"));
  await expect(page.getByText("Leave a note").first()).toBeVisible();
});
