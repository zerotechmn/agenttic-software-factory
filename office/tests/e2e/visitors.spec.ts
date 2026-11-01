import { test, expect } from "@playwright/test";

// console mode with one live Claude Code session in the lobby
test("clicking a Claude visitor in the lobby opens its panel, not New job", async ({ page }) => {
  const ev = { ts: Date.now() + 60_000, session: "s1", project: "factory", kind: "prompt", text: "hello office" };
  await page.route("**/api/runs", (r) => r.fulfill({ json: [{ name: "todo", phase: "build", usd: 1, budget: 10, active: true }] }));
  await page.route("**/api/claude-events", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `data: ${JSON.stringify(ev)}\n\n` }));
  await page.route("**/api/proposals", (r) => r.fulfill({ json: [] }));
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "x", tasks: [] } }));
  await page.route("**/events*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await expect.poll(() => page.evaluate(() => (window as any).__office.screenOf("claude:1"))).not.toBeNull();
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => (window as any).__office.screenOf("claude:1"));
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y - 20);
  await expect(page.locator("#hud .panel h2")).toContainText("Claude");
  await expect(page.locator("#hud .panel")).not.toContainText("New job");
  // the room itself still opens the lobby panel
  await page.locator("#hud .panel .x").click();
  const lobby = await page.evaluate(() => { const a = (window as any).__office.screenOf("claude:1"); return a; });
  await page.mouse.click(box.x + lobby.x + 45, box.y + lobby.y - 90);
  await expect(page.locator("#hud .panel")).toBeVisible();
  await expect(page.locator("#hud .panel h2")).not.toContainText("Claude");
});
