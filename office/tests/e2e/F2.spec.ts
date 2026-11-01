import { test, expect } from "@playwright/test";
import { boot } from "./helpers";
const Z = (p: any) => p.evaluate(() => (window as any).__office.zoom());
test("F2 wheel zoom steps and clamps", async ({ page }) => {
  await boot(page);
  expect([2,3,4]).toContain(await Z(page));
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(150); }
  expect(await Z(page)).toBe(2);
  await page.mouse.move(600, 700);
  const seq: number[] = [];
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(150); seq.push(await Z(page)); }
  expect(seq).toEqual([3, 4, 4]);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(150); seq[i] = await Z(page); }
  expect(seq).toEqual([3, 2, 2]);
});
test("F2 F key fits, ignored in input; drag no click", async ({ page }) => {
  await boot(page);
  await page.mouse.move(600, 700); await page.mouse.wheel(0, -100); await page.waitForTimeout(200);
  await page.keyboard.press("f"); await page.waitForTimeout(300);
  expect(await Z(page)).toBe(3); // largest integer scale that fits 1920x1080
  await page.mouse.move(600, 700); await page.mouse.wheel(0, 100); await page.waitForTimeout(200);
  await page.evaluate(() => (window as any).__office.openBoard());
  await page.getByPlaceholder("Title").focus();
  const z0 = await Z(page); await page.keyboard.press("f"); await page.waitForTimeout(200);
  expect(await Z(page)).toBe(z0);
});
test("F2 drag from cork board doesn't open board; dblclick room focuses", async ({ page }) => {
  await boot(page);
  await page.mouse.move(600, 700); await page.mouse.wheel(0, -100); await page.waitForTimeout(200);
  await page.mouse.move(700, 700); await page.mouse.down(); await page.mouse.move(500, 600, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole("heading", { name: "Task board" })).toHaveCount(0);
  await page.keyboard.press("f"); await page.waitForTimeout(300);
  await page.mouse.dblclick(830, 450); await page.waitForTimeout(500);
  expect(await Z(page)).toBeGreaterThanOrEqual(2);
});
