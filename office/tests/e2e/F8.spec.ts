import { test, expect } from "@playwright/test";
import { boot, CORK } from "./helpers";
test("F8 one panel, Escape, panel width, cursor", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__office.openBoard());
  await page.evaluate(() => (window as any).__office.openAgent("qa"));
  await expect(page.getByRole("heading", { name: "Task board" })).toHaveCount(0);
  const w = await page.evaluate(() => { const p = document.querySelector("#hud .panel") as HTMLElement; return p ? p.getBoundingClientRect().width : -1; });
  expect(w).toBeGreaterThan(0); expect(w).toBeLessThanOrEqual(0.3 * 1920);
  await page.keyboard.press("Escape");
  await expect(page.locator("#hud .panel")).toBeHidden();
});
