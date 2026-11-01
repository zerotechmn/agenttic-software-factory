import { test, expect } from "@playwright/test";
import { boot } from "./helpers";
test("F5 tooltip", async ({ page }) => {
  await boot(page);
  await page.mouse.move(450, 300);
  const tip = page.locator("#room-tip");
  await expect(tip).toBeVisible(); await expect(tip).toContainText("Product");
  await page.mouse.move(300, 900);
  const dev = await page.evaluate(() => (window as any).__office.room("Dev Floor"));
  expect((await tip.innerText()).replace(/\s+/g, " ")).toBe(dev.replace(/\s+/g, " "));
  await page.mouse.move(140, 300); await expect(tip).toContainText("nobody here");
  await page.mouse.move(900, 550); await expect(tip).toBeHidden();
  await page.mouse.move(1900, 1060);
  const b = await tip.boundingBox(); expect(b!.x + b!.width).toBeLessThanOrEqual(1920); expect(b!.y + b!.height).toBeLessThanOrEqual(1080);
});
