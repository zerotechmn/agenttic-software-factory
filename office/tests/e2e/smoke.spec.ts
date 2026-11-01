import { test, expect } from "@playwright/test";

test("office boots in replay mode with the HUD and no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await expect(page.locator("#hud .badge")).toHaveText(/REPLAY|LIVE/);
  expect(errors).toEqual([]);
});
