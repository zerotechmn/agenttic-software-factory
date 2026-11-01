import { test, expect } from "@playwright/test";

// Generic on purpose: devs replace the home page, so this checks the shell and the API, not any page text.
test("app shell loads without errors and the API is healthy", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/");
  expect(res?.ok()).toBe(true);
  await expect(page.locator("#root")).not.toBeEmpty();
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(errors).toEqual([]);
});
